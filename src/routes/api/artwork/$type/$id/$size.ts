import { createFileRoute } from '@tanstack/react-router';

const isAllowedType = (value: string) => value === 'images' || value === 'videos';

export const Route = createFileRoute('/api/artwork/$type/$id/$size' as any)({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { type, id, size } = params;

        if (!isAllowedType(type)) {
          return new Response('Invalid artwork type', { status: 400 });
        }

        const normalizedSize = /^\d{2,4}$/.test(size) ? size : '640';
        const normalizedId = id.replace(/-/g, '/');
        const extension = type === 'videos' ? 'mp4' : 'jpg';
        const target = `https://resources.tidal.com/${type}/${normalizedId}/${normalizedSize}x${normalizedSize}.${extension}`;

        const response = await fetch(target, { redirect: 'follow' });
        if (!response.ok) {
          return new Response('Artwork not found', { status: response.status });
        }

        const headers = new Headers(response.headers);
        headers.set('Cache-Control', 'public, max-age=86400');
        return new Response(response.body, {
          status: response.status,
          headers,
        });
      },
    },
  },
});
