import { createFileRoute } from '@tanstack/react-router'
import { useAppDispatch } from '@/lib/hooks'
import { setQueue, play } from '@/lib/features/playerSlice'
import SearchInterface from '@/components/SearchInterface'
import type { PlayableTrack } from '@/lib/types'
import { isSonglinkTrack } from '@/lib/types'
import { losslessAPI } from '@/lib/api'
import { APP_VERSION } from '@/lib/version'

export const Route = createFileRoute('/')({ component: App })

function App() {
  const dispatch = useAppDispatch()

  const fillQueueWithRecommendations = async (track: PlayableTrack) => {
    if (isSonglinkTrack(track)) return
    try {
      const recommendations = await losslessAPI.getRecommendations(track.id)
      dispatch(setQueue({ queue: [track, ...recommendations], startIndex: 0 }))
    } catch (error) {
      console.warn('Failed to load recommendations', error)
    }
  }

  const handleTrackSelect = (track: PlayableTrack) => {
    dispatch(setQueue({ queue: [track], startIndex: 0 }))
    dispatch(play())
    void fillQueueWithRecommendations(track)
  }

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-4 pb-40 text-slate-100 sm:px-6 lg:px-8">
      <section className="py-10 text-center">
        <div className="inline-flex items-baseline gap-3">
          <h1 className="gradient-text-hero text-4xl font-bold sm:text-6xl">
            BiniLossless
          </h1>
          <span className="text-xs text-slate-400">{APP_VERSION}</span>
        </div>
        <p className="mt-3 text-slate-400">
          sailing on PCM tidal waves
        </p>
      </section>

      <section className="glass-medium rounded-2xl p-4 sm:p-6">
        <SearchInterface onTrackSelect={handleTrackSelect} />
      </section>
    </main>
  )
}
