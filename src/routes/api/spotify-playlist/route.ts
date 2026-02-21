import { Buffer } from 'node:buffer';
import crypto from 'node:crypto';
import { createFileRoute } from '@tanstack/react-router';

const BROWSER_VERSION = '131';

const COMMON_HEADERS = {
  'Content-Type': 'application/json',
  'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${BROWSER_VERSION}.0.0.0 Safari/537.36`,
  'Sec-Ch-Ua': `"Chromium";v="${BROWSER_VERSION}", "Not(A:Brand";v="24", "Google Chrome";v="${BROWSER_VERSION}"`,
};

const FALLBACK_SECRET = [
  44, 55, 47, 42, 70, 40, 34, 114, 76, 74, 50, 111, 120, 97, 75, 76, 94, 102, 43,
  69, 49, 120, 118, 80, 64, 78,
];

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function getLatestTotpSecret() {
  return { version: 61, secret: FALLBACK_SECRET };
}

function generateTotp(secret: number[]) {
  const transformed = secret.map((value, index) => value ^ ((index % 33) + 9));
  const joined = transformed.map((num) => num.toString()).join('');
  const hexStr = Buffer.from(joined, 'ascii').toString('hex');
  const base32Secret = Buffer.from(hexStr, 'hex').toString('base64').replace(/=/g, '');

  const timeStep = Math.floor(Date.now() / 1000 / 30);
  const timeHex = timeStep.toString(16).padStart(16, '0');
  const hmac = crypto.createHmac('sha1', Buffer.from(base32Secret, 'base64'));
  hmac.update(Buffer.from(timeHex, 'hex'));
  const digest = hmac.digest();
  const offset = digest[19]! & 0xf;
  const code = (digest.readUInt32BE(offset) & 0x7fffffff) % 1000000;
  return code.toString().padStart(6, '0');
}

function extractJsLinks(html: string): string[] {
  const jsLinks: string[] = [];
  const scriptTagRegex = /<script[^>]+src="([^"]+\.js)"[^>]*>/g;
  let match: RegExpExecArray | null;

  while ((match = scriptTagRegex.exec(html)) !== null) {
    jsLinks.push(match[1]!);
  }

  return jsLinks;
}

async function getSessionData() {
  const response = await fetch('https://open.spotify.com', {
    headers: COMMON_HEADERS,
  });
  const html = await response.text();
  const cookie = response.headers.get('set-cookie')?.match(/sp_t=([^;]+)/)?.[1] || '';

  const appServerConfigMatch = html.match(
    /<script id="appServerConfig" type="text\/plain">([^<]+)<\/script>/
  );

  let clientVersion = '';
  if (appServerConfigMatch) {
    try {
      const base64Config = appServerConfigMatch[1]!;
      const decodedConfig = Buffer.from(base64Config, 'base64').toString('utf-8');
      const serverConfig = JSON.parse(decodedConfig);
      clientVersion = serverConfig.clientVersion || '';
    } catch {
      clientVersion = html.match(/"clientVersion":"([^"]+)"/)?.[1] || '';
    }
  } else {
    clientVersion = html.match(/"clientVersion":"([^"]+)"/)?.[1] || '';
  }

  const allJsLinks = extractJsLinks(html);
  const jsPackRelative =
    allJsLinks.find((link) => link.includes('web-player/web-player') && link.endsWith('.js')) ||
    '';
  const jsPack = jsPackRelative.startsWith('http')
    ? jsPackRelative
    : `https://open.spotify.com${jsPackRelative}`;

  return { deviceId: cookie, clientVersion, jsPack };
}

async function getAccessToken(totp: string, totpVer: number) {
  const params = new URLSearchParams({
    reason: 'init',
    productType: 'web-player',
    totp,
    totpVer: totpVer.toString(),
    totpServer: totp,
  });
  const response = await fetch(`https://open.spotify.com/api/token?${params}`, {
    headers: COMMON_HEADERS,
  });
  const data = await response.json();
  return { accessToken: data.accessToken, clientId: data.clientId };
}

async function getClientToken(clientVersion: string, clientId: string, deviceId: string) {
  const payload = {
    client_data: {
      client_version: clientVersion,
      client_id: clientId,
      js_sdk_data: {
        device_brand: 'unknown',
        device_model: 'unknown',
        os: 'windows',
        os_version: 'NT 10.0',
        device_id: deviceId,
        device_type: 'computer',
      },
    },
  };
  const response = await fetch('https://clienttoken.spotify.com/v1/clienttoken', {
    method: 'POST',
    headers: {
      ...COMMON_HEADERS,
      Authority: 'clienttoken.spotify.com',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  return data.granted_token.token;
}

function extractMappings(jsCode: string): [Record<string, string>, Record<string, string>] {
  const pattern = /\{\d+:"[^"]+"(?:,\d+:"[^"]+")*\}/g;
  const matches = jsCode.match(pattern);

  if (!matches || matches.length < 5) {
    return [{}, {}];
  }

  const mapping1: Record<string, string> = {};
  const match3 = matches[3]!;
  const entries3 = match3.slice(1, -1).split(/,(?=\d+:)/);

  for (const entry of entries3) {
    const colonIndex = entry.indexOf(':');
    if (colonIndex === -1) continue;

    const key = entry.substring(0, colonIndex).trim();
    const value = entry.substring(colonIndex + 1).trim().replace(/^"|"$/g, '');
    mapping1[key] = value;
  }

  const mapping2: Record<string, string> = {};
  const match4 = matches[4]!;
  const entries4 = match4.slice(1, -1).split(/,(?=\d+:)/);

  for (const entry of entries4) {
    const colonIndex = entry.indexOf(':');
    if (colonIndex === -1) continue;

    const key = entry.substring(0, colonIndex).trim();
    const value = entry.substring(colonIndex + 1).trim().replace(/^"|"$/g, '');
    mapping2[key] = value;
  }

  return [mapping1, mapping2];
}

function combineChunks(
  strMapping: Record<string, string>,
  hashMapping: Record<string, string>
): string[] {
  const chunks: string[] = [];
  for (const [key, str] of Object.entries(strMapping)) {
    const hash = hashMapping[key];
    if (hash) chunks.push(`${str}.${hash}.js`);
  }
  return chunks;
}

async function getSha256Hash(jsPack: string): Promise<string> {
  const fallbackHash = 'a67612f8c59f4cb4a9723d8e0e0e7b7cb8c5c3d45e3d8c4f5e6f7e8f9a0b1c2d';

  if (!jsPack) {
    return fallbackHash;
  }

  try {
    const response = await fetch(jsPack, { headers: COMMON_HEADERS });
    let rawHashes = await response.text();

    const [strMapping, hashMapping] = extractMappings(rawHashes);
    const chunks = combineChunks(strMapping, hashMapping);

    for (const chunk of chunks) {
      const chunkUrl = `https://open.spotifycdn.com/cdn/build/web-player/${chunk}`;
      try {
        const chunkResponse = await fetch(chunkUrl, { headers: COMMON_HEADERS });
        rawHashes += await chunkResponse.text();
      } catch {
        // Ignore missing chunk
      }
    }

    try {
      return rawHashes.split('"fetchPlaylist","query","')[1]!.split('"')[0]!;
    } catch {
      try {
        return rawHashes.split('"fetchPlaylist","mutation","')[1]!.split('"')[0]!;
      } catch {
        return fallbackHash;
      }
    }
  } catch {
    return fallbackHash;
  }
}

async function fetchPlaylist(
  accessToken: string,
  clientToken: string,
  clientVersion: string,
  playlistId: string,
  jsPack: string,
  offset = 0,
  limit = 25
) {
  const sha256Hash = await getSha256Hash(jsPack);
  const variables = {
    uri: `spotify:playlist:${playlistId}`,
    offset,
    limit,
    enableWatchFeedEntrypoint: false,
  };
  const extensions = {
    persistedQuery: {
      version: 1,
      sha256Hash,
    },
  };
  const params = JSON.stringify({
    operationName: 'fetchPlaylist',
    variables,
    extensions,
  });
  const response = await fetch('https://api-partner.spotify.com/pathfinder/v2/query', {
    method: 'POST',
    headers: {
      'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${BROWSER_VERSION}.0.0.0 Safari/537.36`,
      'Sec-Ch-Ua': `"Chromium";v="${BROWSER_VERSION}", "Not(A:Brand";v="24", "Google Chrome";v="${BROWSER_VERSION}"`,
      Authorization: `Bearer ${accessToken}`,
      'Client-Token': clientToken,
      'Spotify-App-Version': clientVersion,
      'Content-Type': 'application/json;charset=UTF-8',
    },
    body: params,
  });
  return response.json();
}

async function getAllTracks(
  accessToken: string,
  clientToken: string,
  clientVersion: string,
  playlistId: string,
  jsPack: string
) {
  const tracks: unknown[] = [];
  let offset = 0;
  const limit = 343;
  while (true) {
    const data = await fetchPlaylist(
      accessToken,
      clientToken,
      clientVersion,
      playlistId,
      jsPack,
      offset,
      limit
    );
    const content = (data as any)?.data?.playlistV2?.content;
    if (!content) break;
    tracks.push(...content.items);
    if (content.totalCount <= offset + limit) break;
    offset += limit;
  }
  return tracks;
}

export const Route = createFileRoute('/api/spotify-playlist' as any)({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as { playlistUrl?: string };
          const playlistUrl = body.playlistUrl;

          if (!playlistUrl) {
            return jsonResponse({ error: 'Missing playlistUrl' }, 400);
          }

          const playlistId = playlistUrl.includes('playlist/')
            ? playlistUrl.split('playlist/')[1]!.split('?')[0]!
            : playlistUrl;

          const { deviceId, clientVersion, jsPack } = await getSessionData();
          const { secret, version } = await getLatestTotpSecret();
          const totp = generateTotp(secret);
          const { accessToken, clientId } = await getAccessToken(totp, version);
          const clientToken = await getClientToken(clientVersion, clientId, deviceId);
          const tracks = await getAllTracks(
            accessToken,
            clientToken,
            clientVersion,
            playlistId,
            jsPack
          );

          const songLinks = tracks
            .filter((item: any) => item?.itemV2?.data?.uri)
            .map((item: any) => {
              const uri = item.itemV2.data.uri as string;
              const trackId = uri.split(':')[2];
              return `https://open.spotify.com/track/${trackId}`;
            });

          return jsonResponse({ songLinks, totalTracks: songLinks.length });
        } catch (error) {
          console.error('Spotify playlist fetch error:', error);
          return jsonResponse(
            {
              error: 'Failed to fetch playlist',
              details: error instanceof Error ? error.message : 'Unknown error',
            },
            500
          );
        }
      },
    },
  },
});
