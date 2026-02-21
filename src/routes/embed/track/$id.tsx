import { useEffect, useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { ExternalLink, LoaderCircle, Pause, Play } from 'lucide-react'
import { losslessAPI } from '@/lib/api'
import type { Track, TrackInfo } from '@/lib/types'
import { formatArtists } from '@/lib/utils'
import { useAppDispatch, useAppSelector } from '@/lib/hooks'
import { pause, play, setQueue } from '@/lib/features/playerSlice'

export const Route = createFileRoute('/embed/track/$id' as any)({ component: EmbedTrackPage })

function qualityLabel(info: TrackInfo | null): string | null {
  if (!info) return null
  if (info.bitDepth && info.sampleRate) {
    return `${info.bitDepth}-bit / ${(info.sampleRate / 1000).toFixed(1).replace(/\.0$/, '')} kHz FLAC`
  }
  if (info.audioQuality === 'HI_RES_LOSSLESS') return 'Hi-Res FLAC'
  if (info.audioQuality === 'LOSSLESS') return '16-bit / 44.1 kHz FLAC'
  if (info.audioQuality === 'HIGH') return '320 kbps AAC'
  if (info.audioQuality === 'LOW') return '96 kbps AAC'
  return null
}

function EmbedTrackPage() {
  const { id } = Route.useParams() as { id: string }
  const dispatch = useAppDispatch()
  const playerState = useAppSelector((state) => state.player)

  const [track, setTrack] = useState<Track | null>(null)
  const [trackInfo, setTrackInfo] = useState<TrackInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        try {
          const data = await losslessAPI.getTrack(Number(id), 'HI_RES_LOSSLESS')
          if (cancelled) return
          setTrack(data.track)
          setTrackInfo(data.info)
        } catch {
          const data = await losslessAPI.getTrack(Number(id), 'LOSSLESS')
          if (cancelled) return
          setTrack(data.track)
          setTrackInfo(data.info)
        }
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load track')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [id])

  const isCurrentTrack = playerState.currentTrack?.id === track?.id
  const isPlaying = isCurrentTrack && playerState.isPlaying

  const progress = useMemo(() => {
    if (!isCurrentTrack || !playerState.duration) return 0
    return Math.max(0, Math.min(100, (playerState.currentTime / playerState.duration) * 100))
  }, [isCurrentTrack, playerState.currentTime, playerState.duration])

  const togglePlayback = () => {
    if (!track) return
    if (isPlaying) {
      dispatch(pause())
      return
    }
    if (!isCurrentTrack) {
      dispatch(setQueue({ queue: [track], startIndex: 0 }))
    }
    dispatch(play())
  }

  if (loading) {
    return (
      <main className="grid h-screen place-items-center bg-slate-950 text-slate-200">
        <LoaderCircle className="h-8 w-8 animate-spin" />
      </main>
    )
  }

  if (error || !track) {
    return (
      <main className="grid h-screen place-items-center bg-slate-950 px-4 text-center text-sm text-red-200">
        {error ?? 'Track not found'}
      </main>
    )
  }

  const quality = qualityLabel(trackInfo)
  const coverUrl = losslessAPI.getCoverUrl(track.album.cover, '320')

  return (
    <main className="relative flex h-screen items-center overflow-hidden bg-slate-950 text-white">
      <div
        className="absolute inset-0 scale-110 bg-cover bg-center brightness-40 blur-2xl"
        style={{ backgroundImage: `url(${coverUrl})` }}
      />
      <div className="relative z-10 flex w-full items-center gap-4 p-4">
        <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg shadow-2xl">
          <img src={coverUrl} alt={track.album.title} className="h-full w-full object-cover" />
          <button
            onClick={togglePlayback}
            className="absolute inset-0 grid place-items-center bg-black/35 text-white transition hover:bg-black/50"
            aria-label={isPlaying ? 'Pause' : 'Play'}
            type="button"
          >
            {isPlaying ? <Pause className="h-5 w-5" fill="currentColor" /> : <Play className="ml-0.5 h-5 w-5" fill="currentColor" />}
          </button>
        </div>

        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold" title={track.title}>{track.title}</h1>
          <p className="truncate text-sm text-slate-200/85" title={formatArtists(track.artists)}>
            {formatArtists(track.artists)}
          </p>
          {quality && <p className="mt-1 inline-block rounded bg-amber-300/15 px-2 py-0.5 text-xs text-amber-300">{quality}</p>}
          <div className="mt-2">
            <a href={`/track/${track.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-blue-300 hover:text-blue-200">
              <span>Open in BiniLossless</span>
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>
      </div>

      {isCurrentTrack && (
        <div className="absolute right-0 bottom-0 left-0 h-1 bg-white/10">
          <div className="h-full bg-blue-500" style={{ width: `${progress}%` }} />
        </div>
      )}
    </main>
  )
}
