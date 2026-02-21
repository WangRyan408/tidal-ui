import { useEffect, useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { ExternalLink, LoaderCircle, Pause, Play } from 'lucide-react'
import { losslessAPI } from '@/lib/api'
import type { Playlist, Track } from '@/lib/types'
import { useAppDispatch, useAppSelector } from '@/lib/hooks'
import { pause, play, setQueue } from '@/lib/features/playerSlice'

export const Route = createFileRoute('/embed/playlist/$id' as any)({ component: EmbedPlaylistPage })

function EmbedPlaylistPage() {
  const { id } = Route.useParams() as { id: string }
  const dispatch = useAppDispatch()
  const playerState = useAppSelector((state) => state.player)

  const [playlist, setPlaylist] = useState<Playlist | null>(null)
  const [tracks, setTracks] = useState<Track[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const result = await losslessAPI.getPlaylist(id)
        if (cancelled) return
        setPlaylist(result.playlist)
        setTracks(result.items.map((entry) => entry.item))
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load playlist')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [id])

  const isCurrentContext = tracks.some((track) => track.id === playerState.currentTrack?.id)
  const isPlaying = isCurrentContext && playerState.isPlaying

  const progress = useMemo(() => {
    if (!isCurrentContext || !playerState.duration) return 0
    return Math.max(0, Math.min(100, (playerState.currentTime / playerState.duration) * 100))
  }, [isCurrentContext, playerState.currentTime, playerState.duration])

  const togglePlayback = () => {
    if (!tracks.length) return
    if (isPlaying) {
      dispatch(pause())
      return
    }
    if (!isCurrentContext) {
      dispatch(setQueue({ queue: tracks, startIndex: 0 }))
    }
    dispatch(play())
  }

  const playTrackAt = (index: number) => {
    if (!tracks.length) return
    dispatch(setQueue({ queue: tracks, startIndex: index }))
    dispatch(play())
  }

  if (loading) {
    return (
      <main className="grid h-screen place-items-center bg-slate-950 text-slate-200">
        <LoaderCircle className="h-8 w-8 animate-spin" />
      </main>
    )
  }

  if (error || !playlist) {
    return (
      <main className="grid h-screen place-items-center bg-slate-950 px-4 text-center text-sm text-red-200">
        {error ?? 'Playlist not found'}
      </main>
    )
  }

  const cover = playlist.squareImage || playlist.image
  const coverUrl = cover ? losslessAPI.getCoverUrl(cover, '320') : null

  return (
    <main className="relative flex h-screen flex-col overflow-hidden bg-slate-950 text-white">
      <div
        className="absolute inset-0 scale-110 bg-cover bg-center brightness-40 blur-2xl"
        style={{ backgroundImage: coverUrl ? `url(${coverUrl})` : undefined, backgroundColor: coverUrl ? undefined : '#1e293b' }}
      />

      <header className="relative z-10 flex items-center gap-3 bg-black/25 p-4 backdrop-blur-md">
        <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md shadow-xl bg-slate-700">
          {coverUrl ? <img src={coverUrl} alt={playlist.title} className="h-full w-full object-cover" /> : null}
          <button
            onClick={togglePlayback}
            className="absolute inset-0 grid place-items-center bg-black/30 text-white transition hover:bg-black/50"
            aria-label={isPlaying ? 'Pause' : 'Play'}
            type="button"
          >
            {isPlaying ? <Pause className="h-5 w-5" fill="currentColor" /> : <Play className="ml-0.5 h-5 w-5" fill="currentColor" />}
          </button>
        </div>

        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold" title={playlist.title}>{playlist.title}</h1>
          <p className="truncate text-xs text-slate-200/85" title={playlist.description || 'Playlist'}>
            {playlist.description || 'Playlist'}
          </p>
          <a href={`/playlist/${playlist.uuid}`} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-blue-300 hover:text-blue-200">
            <span>Open playlist</span>
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </header>

      <section className="relative z-10 flex-1 space-y-1 overflow-y-auto p-2 pb-12">
        {tracks.map((track, index) => {
          const active = playerState.currentTrack?.id === track.id
          return (
            <button
              key={track.id}
              onClick={() => playTrackAt(index)}
              className={`flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left transition ${active ? 'bg-blue-500/20 text-white' : 'bg-black/15 text-slate-100 hover:bg-black/30'}`}
              type="button"
            >
              <span className="w-5 text-[11px] text-slate-300">{index + 1}</span>
              <span className="min-w-0 flex-1 truncate text-xs">{track.title}</span>
              <span className="text-[11px] text-slate-300">{losslessAPI.formatDuration(track.duration)}</span>
            </button>
          )
        })}
      </section>

      {isCurrentContext && (
        <div className="absolute right-0 bottom-0 left-0 z-20 h-1 bg-white/10">
          <div className="h-full bg-blue-500" style={{ width: `${progress}%` }} />
        </div>
      )}
    </main>
  )
}
