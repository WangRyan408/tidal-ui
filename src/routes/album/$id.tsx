import { useEffect, useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { losslessAPI } from '@/lib/api';
import type { Album, Track } from '@/lib/types';
import TrackList from '@/components/TrackList';

export const Route = createFileRoute('/album/$id' as any)({ component: AlbumPage });

function AlbumPage() {
  const { id } = Route.useParams() as { id: string };
  const [album, setAlbum] = useState<Album | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await losslessAPI.getAlbum(Number(id));
        if (cancelled) return;
        setAlbum(result.album);
        setTracks(result.tracks);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load album');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) return <div className="py-10 text-slate-300">Loading album…</div>;
  if (error) return <div className="py-10 text-red-300">{error}</div>;
  if (!album) return <div className="py-10 text-slate-300">Album not found</div>;

  return (
    <main className="mx-auto max-w-6xl px-4 pb-40 sm:px-6 lg:px-8">
      <Link to="/" className="inline-block py-4 text-sm text-slate-400 hover:text-slate-200">
        ← Back
      </Link>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row">
        <img
          src={losslessAPI.getCoverUrl(album.cover, '640')}
          alt={album.title}
          className="h-52 w-52 rounded-xl object-cover"
        />
        <div className="min-w-0">
          <h1 className="text-3xl font-bold text-slate-100">{album.title}</h1>
          <p className="text-slate-400">{album.artist?.name ?? 'Unknown Artist'}</p>
          <p className="text-sm text-slate-500">{tracks.length} tracks</p>
        </div>
      </div>
      <TrackList tracks={tracks} showAlbum={false} showArtist={true} showCover={false} />
    </main>
  );
}
