import { useEffect, useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { losslessAPI } from '@/lib/api';
import type { Playlist, Track } from '@/lib/types';
import TrackList from '@/components/TrackList';

export const Route = createFileRoute('/playlist/$id' as any)({ component: PlaylistPage });

function PlaylistPage() {
  const { id } = Route.useParams() as { id: string };
  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await losslessAPI.getPlaylist(id);
        if (cancelled) return;
        setPlaylist(result.playlist);
        setTracks(result.items.map((entry) => entry.item));
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load playlist');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) return <div className="py-10 text-slate-300">Loading playlist…</div>;
  if (error) return <div className="py-10 text-red-300">{error}</div>;
  if (!playlist) return <div className="py-10 text-slate-300">Playlist not found</div>;

  return (
    <main className="mx-auto max-w-6xl px-4 pb-40 sm:px-6 lg:px-8">
      <Link to="/" className="inline-block py-4 text-sm text-slate-400 hover:text-slate-200">
        ← Back
      </Link>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row">
        <img
          src={playlist.squareImage || playlist.image}
          alt={playlist.title}
          className="h-52 w-52 rounded-xl object-cover"
        />
        <div className="min-w-0">
          <h1 className="text-3xl font-bold text-slate-100">{playlist.title}</h1>
          <p className="text-sm text-slate-400">{playlist.numberOfTracks} tracks</p>
        </div>
      </div>
      <TrackList tracks={tracks} showAlbum={true} showArtist={true} showCover={false} />
    </main>
  );
}
