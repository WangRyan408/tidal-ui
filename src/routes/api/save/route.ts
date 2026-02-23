import { createFileRoute } from '@tanstack/react-router';
import { constants as fsConstants, promises as fs } from 'node:fs';
import path from 'node:path';

async function canUseDirectory(dir: string): Promise<boolean> {
	try {
		await fs.mkdir(dir, { recursive: true });
		await fs.access(dir, fsConstants.W_OK);
		return true;
	} catch {
		return false;
	}
}

async function resolveDownloadDir(): Promise<string> {
	const configured = process.env.DOWNLOAD_DIR?.trim();
	const defaultDir = path.join(process.cwd(), 'downloads');

	if (!configured) {
		if (await canUseDirectory(defaultDir)) {
			return defaultDir;
		}
		throw new Error(`Unable to access default download directory: ${defaultDir}`);
	}

	const candidates = new Set<string>();

	if (path.isAbsolute(configured)) {
		candidates.add(configured);
	} else {
		candidates.add(path.join(process.cwd(), configured));
		candidates.add(path.join(path.sep, configured));
	}

	for (const candidate of candidates) {
		if (await canUseDirectory(candidate)) {
			return candidate;
		}
	}

	throw new Error(
		`Unable to access configured download directory. Tried: ${Array.from(candidates).join(', ')}`
	);
}

export const Route = createFileRoute('/api/save' as any)({
	server: {
		handlers: {
			POST: async ({ request }) => {
				try {
					console.log('[API/SAVE] Received POST request');
					const encodedFilename = request.headers.get('x-filename');
					if (!encodedFilename) {
						return new Response('Missing x-filename header', { status: 400 });
					}
					const decodedFilename = decodeURIComponent(encodedFilename);
					const filename = path.basename(decodedFilename);

					const arrayBuffer = await request.arrayBuffer();
					if (!arrayBuffer || arrayBuffer.byteLength === 0) {
						return new Response('No file content', { status: 400 });
					}

					const downloadDir = await resolveDownloadDir();

					const filePath = path.join(downloadDir, filename);
					
					// Write the file to disk
					await fs.writeFile(filePath, Buffer.from(arrayBuffer));
					console.log(`[API/SAVE] Successfully saved file to ${filePath}`);

					return new Response('Saved successfully', { status: 200 });
				} catch (error) {
					console.error('Save API Error:', error);
					return new Response(error instanceof Error ? error.message : 'Internal Server Error', { status: 500 });
				}
			}
		}
	}
});
