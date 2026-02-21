import { useEffect, useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useAppDispatch } from '@/lib/hooks';
import { losslessAPI } from '@/lib/api';
import type { Track } from '@/lib/types';
import { play, setQueue } from '@/lib/features/playerSlice';
import TopTracksGrid from '@/components/TopTracksGrid';

export const Route = createFileRoute('/track/$id' as any)({ component: TrackPage });

function TrackPage() {
  const { id } = Route.useParams() as { id: string };
  const dispatch = useAppDispatch();
  const [track, setTrack] = useState<Track | null>(null);
  const [recommendations, setRecommendations] = useState<Track[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const lookup = await losslessAPI.getTrack(Number(id));
        const recs = await losslessAPI.getRecommendations(Number(id));
        if (cancelled) return;
        setTrack(lookup.track);
        setRecommendations(recs);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load track');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const playTrack = () => {
    if (!track) return;
    dispatch(setQueue({ queue: [track, ...recommendations], startIndex: 0 }));
    dispatch(play());
  };

  if (loading) return <div className="py-10 text-slate-300">Loading track…</div>;
  if (error) return <div className="py-10 text-red-300">{error}</div>;
  if (!track) return <div className="py-10 text-slate-300">Track not found</div>;

  return (
    <main className="mx-auto max-w-6xl px-4 pb-40 sm:px-6 lg:px-8">
      <Link to="/" className="inline-block py-4 text-sm text-slate-400 hover:text-slate-200">
        ← Back
      </Link>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row">
        {track.album?.cover ? (
          <img
            src={losslessAPI.getCoverUrl(track.album.cover, '640')}
            alt={track.title}
            className="h-52 w-52 rounded-xl object-cover"
          />
        ) : null}
        <div className="min-w-0">
          <h1 className="text-3xl font-bold text-slate-100">{track.title}</h1>
          <p className="text-slate-400">{track.artist?.name ?? 'Unknown Artist'}</p>
          <button
            className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-500"
            onClick={playTrack}
          >
            Play
          </button>
        </div>
      </div>
      <h2 className="mb-3 text-xl font-semibold text-slate-200">Recommended</h2>
      <TopTracksGrid tracks={recommendations} maxTracks={12} columns={3} />
    </main>
  );
}
