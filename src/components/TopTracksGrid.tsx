import { useState, useMemo } from 'react';
import type { Track } from '@/lib/types';
import { losslessAPI, type TrackDownloadProgress } from '@/lib/api';
import { buildTrackFilename } from '@/lib/downloads';
import { useAppDispatch, useAppSelector } from '@/lib/hooks';
import { setQueue, play, enqueue, enqueueNext } from '@/lib/features/playerSlice';
import {
  beginTrackDownload,
  cancelTrackDownload,
  updateTrackProgress,
  updateTrackStage,
  startFfmpegCountdown,
  startFfmpegLoading,
  updateFfmpegProgress,
  completeFfmpeg,
  errorFfmpeg,
  completeTrackDownload,
  errorTrackDownload,
  skipFfmpegCountdown,
  registerTrackDownloadController,
  abortTrackDownloadController,
  releaseTrackDownloadController,
} from '@/lib/features/downloadUiSlice';
import { formatArtists } from '@/lib/utils';
import { Play, Pause, Download, ListPlus, Plus, Clock, X } from 'lucide-react';

interface TopTracksGridProps {
  tracks: Track[];
  maxTracks?: number;
  columns?: number;
}

const TopTracksGrid: React.FC<TopTracksGridProps> = ({ tracks, maxTracks = 6, columns = 3 }) => {
  const dispatch = useAppDispatch();
  const currentTrack = useAppSelector((state) => state.player.currentTrack);
  const isPlayingState = useAppSelector((state) => state.player.isPlaying);
  const quality = useAppSelector((state) => state.player.quality);
  const convertAacToMp3Preference = useAppSelector((state) => state.userPreferences.convertAacToMp3);
  const downloadCoverSeperatelyPreference = useAppSelector((state) => state.userPreferences.downloadCoversSeperately);

  const [downloadingIds, setDownloadingIds] = useState<Set<number>>(new Set());
  const [downloadTaskIds, setDownloadTaskIds] = useState<Map<number, string>>(new Map());
  const [cancelledIds, setCancelledIds] = useState<Set<number>>(new Set());

  const columnClass = useMemo(() => {
    if (columns >= 3) return 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-3';
    if (columns === 2) return 'grid-cols-1 sm:grid-cols-2';
    return 'grid-cols-1';
  }, [columns]);

  const displayedTracks = useMemo(() => (maxTracks ? tracks.slice(0, maxTracks) : tracks), [tracks, maxTracks]);

  const IGNORED_TAGS = new Set(['HI_RES_LOSSLESS']);

  const getDisplayTags = (tags?: string[] | null): string[] => {
    if (!tags) return [];
    return tags.filter((tag) => tag && !IGNORED_TAGS.has(tag));
  };

  const handlePlayTrack = (track: Track, index: number) => {
    dispatch(setQueue({ tracks: displayedTracks, index }));
    dispatch(play());
  };

  const handleAddToQueue = (track: Track, event: React.MouseEvent) => {
    event.stopPropagation();
    dispatch(enqueue(track));
  };

  const handlePlayNext = (track: Track, event: React.MouseEvent) => {
    event.stopPropagation();
    dispatch(enqueueNext(track));
  };

  const handleCardKeydown = (event: React.KeyboardEvent, track: Track, index: number) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handlePlayTrack(track, index);
    }
  };

  const isCurrentTrack = (track: Track): boolean => {
    return currentTrack?.id === track.id;
  };

  const isPlaying = (track: Track): boolean => {
    return isCurrentTrack(track) && isPlayingState;
  };

  const markCancelled = (trackId: number) => {
    setCancelledIds((prev) => {
      const next = new Set(prev);
      next.add(trackId);
      return next;
    });
    setTimeout(() => {
      setCancelledIds((prev) => {
        const updated = new Set(prev);
        updated.delete(trackId);
        return updated;
      });
    }, 1500);
  };

  const handleCancelDownload = (trackId: number, event: React.MouseEvent) => {
    event.stopPropagation();
    const taskId = downloadTaskIds.get(trackId);
    if (taskId) {
      abortTrackDownloadController(taskId);
      dispatch(cancelTrackDownload(taskId));
    }
    setDownloadingIds((prev) => {
      const next = new Set(prev);
      next.delete(trackId);
      return next;
    });
    setDownloadTaskIds((prev) => {
      const taskMap = new Map(prev);
      taskMap.delete(trackId);
      return taskMap;
    });
    markCancelled(trackId);
  };

  const handleDownload = async (track: Track, event: React.MouseEvent) => {
    event.stopPropagation();
    setDownloadingIds((prev) => {
      const next = new Set(prev);
      next.add(track.id);
      return next;
    });

    const filename = buildTrackFilename(
      track.album,
      track,
      quality,
      formatArtists(track.artists),
      convertAacToMp3Preference
    );
    
    const taskId = crypto.randomUUID();
    const controller = new AbortController();
    registerTrackDownloadController(taskId, controller);
    
    dispatch(beginTrackDownload({ track, filename, subtitle: track.album?.title ?? track.artist?.name, taskId }));
    
    setDownloadTaskIds((prev) => {
      const taskMap = new Map(prev);
      taskMap.set(track.id, taskId);
      return taskMap;
    });
    dispatch(skipFfmpegCountdown());

    try {
      await losslessAPI.downloadTrack(track.id, quality, filename, {
        signal: controller.signal,
        onProgress: (progress: TrackDownloadProgress) => {
          if (progress.stage === 'downloading') {
            dispatch(updateTrackProgress({ taskId, receivedBytes: progress.receivedBytes, totalBytes: progress.totalBytes }));
          } else {
            dispatch(updateTrackStage({ taskId, stage: progress.progress }));
          }
        },
        onFfmpegCountdown: ({ totalBytes }) => {
          if (typeof totalBytes === 'number') {
            dispatch(startFfmpegCountdown({ totalBytes, autoTriggered: false }));
          } else {
            dispatch(startFfmpegCountdown({ totalBytes: 0, autoTriggered: false }));
          }
        },
        onFfmpegStart: () => dispatch(startFfmpegLoading()),
        onFfmpegProgress: (value) => dispatch(updateFfmpegProgress(value)),
        onFfmpegComplete: () => dispatch(completeFfmpeg()),
        onFfmpegError: (error) => dispatch(errorFfmpeg(error)),
        ffmpegAutoTriggered: false,
        convertAacToMp3: convertAacToMp3Preference,
        downloadCoverSeperately: downloadCoverSeperatelyPreference
      });
      dispatch(completeTrackDownload(taskId));
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        dispatch(completeTrackDownload(taskId));
        markCancelled(track.id);
      } else {
        console.error('Failed to download track:', error);
        const fallbackMessage = 'Failed to download track. Please try again.';
        const message = error instanceof Error && error.message ? error.message : fallbackMessage;
        dispatch(errorTrackDownload({ taskId, error: message }));
        alert(message);
      }
    } finally {
      releaseTrackDownloadController(taskId);
      setDownloadingIds((prev) => {
        const updated = new Set(prev);
        updated.delete(track.id);
        return updated;
      });
      setDownloadTaskIds((prev) => {
        const ids = new Map(prev);
        ids.delete(track.id);
        return ids;
      });
    }
  };

  return (
    <div className={`grid gap-4 ${columnClass}`}>
      {displayedTracks.length === 0 ? (
        <div className="col-span-full py-12 text-center text-gray-400">
          <p>No tracks available</p>
        </div>
      ) : (
        displayedTracks.map((track, index) => (
          <div
            key={track.id}
            role="button"
            tabIndex={0}
            onClick={() => handlePlayTrack(track, index)}
            onKeyDown={(event) => handleCardKeydown(event, track, index)}
            className="group flex h-full cursor-pointer flex-col gap-4 rounded-xl border border-gray-800 bg-gray-900/50 p-4 transition-colors hover:border-blue-700 hover:bg-gray-900/70 focus:ring-2 focus:ring-blue-500 focus:outline-none"
          >
            <div className="flex items-start gap-4">
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  handlePlayTrack(track, index);
                }}
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-gray-800 transition-transform hover:scale-110"
                aria-label={isPlaying(track) ? 'Pause' : 'Play'}
              >
                {isPlaying(track) ? (
                  <Pause size={18} className="text-blue-500" />
                ) : isCurrentTrack(track) ? (
                  <Play size={18} className="text-blue-500" />
                ) : (
                  <span className="text-sm font-semibold text-gray-300">{index + 1}</span>
                )}
              </button>

              {track.album?.cover && (
                <img
                  src={losslessAPI.getCoverUrl(track.album.cover, '320')}
                  alt={track.title}
                  className="h-20 w-20 flex-shrink-0 rounded-lg object-cover shadow-lg"
                />
              )}

              <div className="min-w-0 flex-1">
                <h3
                  className={`truncate text-lg font-semibold ${
                    isCurrentTrack(track) ? 'text-blue-500' : 'text-white group-hover:text-blue-400'
                  }`}
                >
                  {track.title}
                  {track.explicit && <span className="ml-1 text-xs text-gray-500">[E]</span>}
                </h3>
                <div className="mt-1 space-y-1 text-sm text-gray-400">
                  <p className="truncate">{formatArtists(track.artists)}</p>
                  {track.album && <p className="truncate text-xs text-gray-500">{track.album.title}</p>}
                </div>
                {getDisplayTags(track.mediaMetadata?.tags).length > 0 && (
                  <p className="mt-2 text-xs text-gray-500">
                    {getDisplayTags(track.mediaMetadata?.tags).join(', ')}
                  </p>
                )}
              </div>
            </div>

            <div className="mt-auto flex flex-wrap items-center justify-between gap-3 text-sm text-gray-400">
              <div className="flex items-center gap-2">
                <button
                  onClick={(event) => handlePlayNext(track, event)}
                  className="rounded-full p-2 transition-colors hover:bg-gray-800 hover:text-white"
                  title="Play next"
                  aria-label={`Play ${track.title} next`}
                >
                  <ListPlus size={18} />
                </button>
                <button
                  onClick={(event) => handleAddToQueue(track, event)}
                  className="rounded-full p-2 transition-colors hover:bg-gray-800 hover:text-white"
                  title="Add to queue"
                  aria-label={`Add ${track.title} to queue`}
                >
                  <Plus size={18} />
                </button>
                <button
                  onClick={(event) =>
                    downloadingIds.has(track.id)
                      ? handleCancelDownload(track.id, event)
                      : handleDownload(track, event)
                  }
                  className="rounded-full p-2 transition-colors hover:bg-gray-800 hover:text-white"
                  title={downloadingIds.has(track.id) ? 'Cancel download' : 'Download track'}
                  aria-label={downloadingIds.has(track.id) ? 'Cancel download' : 'Download track'}
                  aria-busy={downloadingIds.has(track.id)}
                  aria-pressed={downloadingIds.has(track.id)}
                >
                  {downloadingIds.has(track.id) ? (
                    <span className="flex h-4 w-4 items-center justify-center">
                      {cancelledIds.has(track.id) ? (
                        <X size={14} />
                      ) : (
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"></span>
                      )}
                    </span>
                  ) : cancelledIds.has(track.id) ? (
                    <X size={18} />
                  ) : (
                    <Download size={18} />
                  )}
                </button>
              </div>
              <div className="flex items-center gap-1 text-xs text-gray-400">
                <Clock size={14} />
                <span>{losslessAPI.formatDuration(track.duration)}</span>
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
};

export default TopTracksGrid;
