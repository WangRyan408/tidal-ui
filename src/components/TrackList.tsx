import { useState } from 'react';
import type { Track } from '@/lib/types';
import { losslessAPI, type TrackDownloadProgress } from '@/lib/api';
import { buildTrackFilename } from '@/lib/downloads';
import { generateUUID } from '@/lib/uuid';
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
import ShareButton from '@/components/ShareButton';
import { Play, Pause, Download, Clock, Plus, ListPlus, X } from 'lucide-react';
import './TrackList.css';

interface TrackListProps {
  tracks: Track[];
  showAlbum?: boolean;
  showArtist?: boolean;
  showCover?: boolean;
}

const TrackList: React.FC<TrackListProps> = ({ tracks, showAlbum = true, showArtist = true, showCover = true }) => {
  const dispatch = useAppDispatch();
  const currentTrack = useAppSelector((state) => state.player.currentTrack);
  const isPlayingState = useAppSelector((state) => state.player.isPlaying);
  const quality = useAppSelector((state) => state.player.quality);
  const convertAacToMp3Preference = useAppSelector((state) => state.userPreferences.convertAacToMp3);
  const downloadCoverSeperatelyPreference = useAppSelector((state) => state.userPreferences.downloadCoversSeperately);

  const [downloadingIds, setDownloadingIds] = useState<Set<number>>(new Set());
  const [downloadTaskIds, setDownloadTaskIds] = useState<Map<number, string>>(new Map());
  const [cancelledIds, setCancelledIds] = useState<Set<number>>(new Set());

  const IGNORED_TAGS = new Set(['HI_RES_LOSSLESS']);

  const getDisplayTags = (tags?: string[] | null): string[] => {
    if (!tags) return [];
    return tags.filter((tag) => tag && !IGNORED_TAGS.has(tag));
  };

  const formatTrackNumber = (track: Track): string => {
    const volumeNumber = Number(track.volumeNumber);
    const trackNumber = Number(track.trackNumber);

    const isMultiVolume = (track.album?.numberOfVolumes && track.album.numberOfVolumes > 1) ||
      Number.isFinite(volumeNumber);

    if (isMultiVolume) {
      const volumePadded = Number.isFinite(volumeNumber) && volumeNumber > 0 ? volumeNumber.toString() : '1';
      const trackPadded = Number.isFinite(trackNumber) && trackNumber > 0 ? trackNumber.toString() : '0';
      return `${volumePadded}-${trackPadded}`;
    } else {
      const trackPadded = Number.isFinite(trackNumber) && trackNumber > 0 ? trackNumber.toString() : '0';
      return trackPadded;
    }
  };

  const handlePlayTrack = (index: number) => {
    dispatch(setQueue({ tracks, index }));
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
      const nextTasks = new Map(prev);
      nextTasks.delete(trackId);
      return nextTasks;
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

    const taskId = generateUUID();
    const controller = new AbortController();
    registerTrackDownloadController(taskId, controller);

    dispatch(beginTrackDownload({ track, filename, subtitle: showAlbum ? (track.album?.title ?? track.artist?.name) : track.artist?.name, taskId }));

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
        onFfmpegError: (error) => dispatch(errorFfmpeg(error instanceof Error ? error.message : typeof error === 'string' ? error : 'Failed to load FFmpeg')),
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

  const isCurrentTrack = (track: Track): boolean => {
    return currentTrack?.id === track.id;
  };

  const isPlaying = (track: Track): boolean => {
    return isCurrentTrack(track) && isPlayingState;
  };

  return (
    <div className="track-list">
      {tracks.length === 0 ? (
        <div className="track-list__empty">
          <p>No tracks available</p>
        </div>
      ) : (
        <div className="track-list__items">
          {tracks.map((track, index) => (
            <div
              key={track.id}
              className={`track-row ${isCurrentTrack(track) ? 'track-row--active' : ''}`}
            >
              <button
                onClick={() => handlePlayTrack(index)}
                className="track-row__play-btn touch-target"
                aria-label={isPlaying(track) ? 'Pause' : 'Play'}
              >
                {isPlaying(track) ? (
                  <Pause size={18} className="track-row__icon--active" />
                ) : isCurrentTrack(track) ? (
                  <Play size={18} className="track-row__icon--active" />
                ) : (
                  <>
                    <span className="track-row__number">{formatTrackNumber(track)}</span>
                    <Play size={18} className="track-row__icon--hover" />
                  </>
                )}
              </button>

              {showCover && track.album?.cover && (
                <img
                  src={losslessAPI.getCoverUrl(track.album.cover, '320')}
                  alt={track.title}
                  className="track-row__cover"
                  loading="lazy"
                />
              )}

              <div className="track-row__info">
                <button
                  onClick={() => handlePlayTrack(index)}
                  className={`track-row__title ${isCurrentTrack(track) ? 'track-row__title--active' : ''}`}
                >
                  {track.title}
                  {track.explicit && (
                    <svg
                      className="track-row__explicit"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="currentColor"
                      height="24"
                      viewBox="0 0 24 24"
                      width="24"
                      focusable="false"
                      aria-hidden="true"
                    >
                      <path d="M20 2H4a2 2 0 00-2 2v16a2 2 0 002 2h16a2 2 0 002-2V4a2 2 0 00-2-2ZM8 6h8a1 1 0 110 2H9v3h5a1 1 0 010 2H9v3h7a1 1 0 010 2H8a1 1 0 01-1-1V7a1 1 0 011-1Z"></path>
                    </svg>
                  )}
                </button>
                <div className="track-row__meta">
                  {showArtist && <span className="track-row__artist">{formatArtists(track.artists)}</span>}
                  {showAlbum && showArtist && <span className="track-row__sep">•</span>}
                  {showAlbum && <span className="track-row__album">{track.album?.title}</span>}
                </div>
                {getDisplayTags(track.mediaMetadata?.tags).length > 0 && (
                  <div className="track-row__tags">
                    • {getDisplayTags(track.mediaMetadata?.tags).join(', ')}
                  </div>
                )}
              </div>

              <div className="track-row__actions">
                <button
                  onClick={(event) => handlePlayNext(track, event)}
                  className="track-row__action-btn touch-target"
                  title="Play next"
                  aria-label={`Play ${track.title} next`}
                >
                  <ListPlus size={20} />
                </button>
                <button
                  onClick={(event) => handleAddToQueue(track, event)}
                  className="track-row__action-btn touch-target"
                  title="Add to queue"
                  aria-label={`Add ${track.title} to queue`}
                >
                  <Plus size={20} />
                </button>

                <div className="track-row__action-btn">
                  <ShareButton type="track" id={track.id} iconOnly size={20} title="Share track" />
                </div>

                <button
                  onClick={(e) =>
                    downloadingIds.has(track.id)
                      ? handleCancelDownload(track.id, e)
                      : handleDownload(track, e)
                  }
                  className="track-row__action-btn touch-target"
                  aria-label={downloadingIds.has(track.id) ? 'Cancel download' : 'Download track'}
                  title={downloadingIds.has(track.id) ? 'Cancel download' : 'Download track'}
                  aria-busy={downloadingIds.has(track.id)}
                >
                  {downloadingIds.has(track.id) ? (
                    <span className="track-row__spinner">
                      {cancelledIds.has(track.id) ? (
                        <X size={16} />
                      ) : (
                        <span className="track-row__loading"></span>
                      )}
                    </span>
                  ) : cancelledIds.has(track.id) ? (
                    <X size={20} />
                  ) : (
                    <Download size={20} />
                  )}
                </button>

                <div className="track-row__duration">
                  <Clock size={14} />
                  {losslessAPI.formatDuration(track.duration)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default TrackList;
