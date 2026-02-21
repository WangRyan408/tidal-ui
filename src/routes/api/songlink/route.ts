import { createFileRoute } from '@tanstack/react-router';

const SONGLINK_API_BASE = 'https://api.song.link/v1-alpha.1/links';
const SONGLINK_BACKUP_API_BASE = 'https://tracks.monochrome.tf/api/links';
const BROWSER_CACHE_TTL = 2_592_000;

interface SonglinkQuery {
  url: string;
  userCountry?: string;
  songIfSingle?: boolean;
  platform?: string;
  type?: string;
  id?: string;
  key?: string;
  preferBackup?: boolean;
}

function buildSonglinkUrl(params: SonglinkQuery, useBackup = false): string {
  const url = new URL(useBackup ? SONGLINK_BACKUP_API_BASE : SONGLINK_API_BASE);
  url.searchParams.set('url', params.url);

  if (params.userCountry) url.searchParams.set('userCountry', params.userCountry);
  if (params.songIfSingle !== undefined) {
    url.searchParams.set('songIfSingle', String(params.songIfSingle));
  }
  if (params.platform) url.searchParams.set('platform', params.platform);
  if (params.type) url.searchParams.set('type', params.type);
  if (params.id) url.searchParams.set('id', params.id);
  if (params.key) url.searchParams.set('key', params.key);

  return url.toString();
}

function jsonResponse(
  data: unknown,
  status = 200,
  headers: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  });
}

export const Route = createFileRoute('/api/songlink' as any)({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const requestUrl = new URL(request.url);
        const origin = request.headers.get('origin');

        const params: SonglinkQuery = {
          url: requestUrl.searchParams.get('url') || '',
          userCountry: requestUrl.searchParams.get('userCountry') || undefined,
          songIfSingle:
            requestUrl.searchParams.get('songIfSingle') === 'true' ? true : undefined,
          platform: requestUrl.searchParams.get('platform') || undefined,
          type: requestUrl.searchParams.get('type') || undefined,
          id: requestUrl.searchParams.get('id') || undefined,
          key: requestUrl.searchParams.get('key') || undefined,
          preferBackup:
            requestUrl.searchParams.get('preferBackup') === 'true' ? true : undefined,
        };

        if (!params.url) {
          return jsonResponse(
            { error: 'Missing required parameter: url' },
            400,
            {
              'Access-Control-Allow-Origin': origin || '*',
              'Cache-Control': 'no-cache',
            }
          );
        }

        const useRandomBackup = Math.random() < 0.5;
        const shouldTryBackupFirst =
          params.preferBackup === true ? true : useRandomBackup;

        const primaryUrl = buildSonglinkUrl(params, false);
        const backupUrl = buildSonglinkUrl(params, true);

        try {
          const firstUrl = shouldTryBackupFirst ? backupUrl : primaryUrl;
          const firstSource = shouldTryBackupFirst ? 'backup' : 'primary';

          const response = await fetch(firstUrl, {
            headers: {
              'User-Agent': 'BiniLossless/3.0',
              Accept: 'application/json',
            },
          });

          if (!response.ok) {
            const errorText = await response.text();
            console.warn(`${firstSource} Songlink API failed:`, response.status, errorText);

            const secondUrl = shouldTryBackupFirst ? primaryUrl : backupUrl;
            const secondSource = shouldTryBackupFirst ? 'primary' : 'backup';

            const backupResponse = await fetch(secondUrl, {
              headers: {
                'User-Agent': 'BiniLossless/3.0',
                Accept: 'application/json',
              },
            });

            if (!backupResponse.ok) {
              const backupErrorText = await backupResponse.text();
              return jsonResponse(
                {
                  error: 'Both Songlink APIs failed',
                  primaryStatus: shouldTryBackupFirst
                    ? backupResponse.status
                    : response.status,
                  backupStatus: shouldTryBackupFirst
                    ? response.status
                    : backupResponse.status,
                  message: backupErrorText,
                },
                backupResponse.status,
                {
                  'Access-Control-Allow-Origin': origin || '*',
                  'Cache-Control': 'no-cache',
                }
              );
            }

            const backupData = await backupResponse.json();
            return jsonResponse(backupData, 200, {
              'Access-Control-Allow-Origin': origin || '*',
              'Cache-Control': `public, max-age=${BROWSER_CACHE_TTL}`,
              'X-Songlink-Source': secondSource,
            });
          }

          const data = await response.json();
          return jsonResponse(data, 200, {
            'Access-Control-Allow-Origin': origin || '*',
            'Cache-Control': `public, max-age=${BROWSER_CACHE_TTL}`,
            'X-Songlink-Source': firstSource,
          });
        } catch (error) {
          console.error('Songlink API fetch error:', error);

          try {
            const fallbackUrl = buildSonglinkUrl(params, true);
            const fallbackResponse = await fetch(fallbackUrl, {
              headers: {
                'User-Agent': 'BiniLossless/3.0',
                Accept: 'application/json',
              },
            });

            if (!fallbackResponse.ok) {
              throw new Error(`Backup API returned ${fallbackResponse.status}`);
            }

            const fallbackData = await fallbackResponse.json();
            return jsonResponse(fallbackData, 200, {
              'Access-Control-Allow-Origin': origin || '*',
              'Cache-Control': `public, max-age=${BROWSER_CACHE_TTL}`,
              'X-Songlink-Source': 'backup-fallback',
            });
          } catch (backupError) {
            return jsonResponse(
              {
                error: 'Failed to fetch from both Songlink APIs',
                primaryError:
                  error instanceof Error ? error.message : 'Unknown error',
                backupError:
                  backupError instanceof Error
                    ? backupError.message
                    : 'Unknown error',
              },
              502,
              {
                'Access-Control-Allow-Origin': origin || '*',
                'Cache-Control': 'no-cache',
              }
            );
          }
        }
      },
      OPTIONS: async ({ request }) => {
        const origin = request.headers.get('origin');
        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': origin || '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '86400',
          },
        });
      },
    },
  },
});
