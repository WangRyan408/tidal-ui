import { useEffect, useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { losslessAPI } from '@/lib/api';
import type { ArtistDetails } from '@/lib/types';
import TopTracksGrid from '@/components/TopTracksGrid';

export const Route = createFileRoute('/artist/$id' as any)({ component: ArtistPage });

function ArtistPage() {
  const { id } = Route.useParams() as { id: string };
  const [artist, setArtist] = useState<ArtistDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await losslessAPI.getArtist(Number(id));
        if (cancelled) return;
        setArtist(result);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load artist');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) return <div className="py-10 text-slate-300">Loading artist…</div>;
  if (error) return <div className="py-10 text-red-300">{error}</div>;
  if (!artist) return <div className="py-10 text-slate-300">Artist not found</div>;

  return (
    <main className="mx-auto max-w-6xl px-4 pb-40 sm:px-6 lg:px-8">
      <Link to="/" className="inline-block py-4 text-sm text-slate-400 hover:text-slate-200">
        ← Back
      </Link>
      <div className="mb-6 flex items-center gap-4">
        {artist.picture ? (
          <img
            src={losslessAPI.getArtistPictureUrl(artist.picture)}
            alt={artist.name}
            className="h-28 w-28 rounded-full object-cover"
          />
        ) : null}
        <div>
          <h1 className="text-3xl font-bold text-slate-100">{artist.name}</h1>
          <p className="text-sm text-slate-400">Top tracks</p>
        </div>
      </div>
      <TopTracksGrid tracks={artist.tracks ?? []} maxTracks={12} columns={3} />
    </main>
  );
}
