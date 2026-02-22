import { createFileRoute } from '@tanstack/react-router';
import { promises as fs } from 'node:fs';
import path from 'node:path';

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
					const filename = decodeURIComponent(encodedFilename);

					const arrayBuffer = await request.arrayBuffer();
					if (!arrayBuffer || arrayBuffer.byteLength === 0) {
						return new Response('No file content', { status: 400 });
					}

					// Use DOWNLOAD_DIR from environment if set, otherwise default to './downloads'
					const downloadDir = process.env.DOWNLOAD_DIR || path.join(process.cwd(), 'downloads');
					await fs.mkdir(downloadDir, { recursive: true });

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
