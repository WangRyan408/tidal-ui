import { useEffect, useMemo, useState } from 'react';
import { Search, LoaderCircle, Download } from 'lucide-react';
import { losslessAPI } from '@/lib/api';
import TrackList from '@/components/TrackList';
import { downloadAlbum } from '@/lib/downloads';
import { useAppDispatch, useAppSelector } from '@/lib/hooks';
import {
  setActiveTab,
  setAlbums,
  setArtists,
  setError,
  setIsLoading,
  setPlaylists,
  setQuery,
  setTracks,
  type SearchTab,
} from '@/lib/features/searchSlice';
import type { PlayableTrack, Track } from '@/lib/types';
import { isSonglinkTrack } from '@/lib/types';
import { parseTidalUrl } from '@/lib/utils/urlParser';

interface SearchInterfaceProps {
  onTrackSelect?: (track: PlayableTrack) => void;
}

interface AlbumDownloadState {
  downloading: boolean;
  completed: number;
  total: number;
  error: string | null;
}

export default function SearchInterface({ onTrackSelect }: SearchInterfaceProps) {
  const dispatch = useAppDispatch();
  const region = useAppSelector((state) => state.region.region);
  const search = useAppSelector((state) => state.search);
  const albumDownloadMode = useAppSelector((state) => state.downloadPreferences.mode);
  const albumDownloadQuality = useAppSelector((state) => state.player.quality);
  const convertAacToMp3Preference = useAppSelector((state) => state.userPreferences.convertAacToMp3);
  const downloadCoverSeperatelyPreference = useAppSelector((state) => state.userPreferences.downloadCoversSeperately);

  const [inputValue, setInputValue] = useState(search.query);
  const [albumDownloadStates, setAlbumDownloadStates] = useState<Record<number, AlbumDownloadState>>({});

  const canSearch = inputValue.trim().length >= 2;

  const filteredTrackResults = useMemo(
    () =>
      search.tracks.filter(
        (track): track is Track => !isSonglinkTrack(track)
      ),
    [search.tracks]
  );

  useEffect(() => {
    setInputValue(search.query);
  }, [search.query]);

  const runSearch = async (query: string, tab: SearchTab) => {
    const trimmed = query.trim();
    dispatch(setQuery(trimmed));

    if (trimmed.length < 2) {
      dispatch(setTracks([]));
      dispatch(setAlbums([]));
      dispatch(setArtists([]));
      dispatch(setPlaylists([]));
      dispatch(setError(null));
      return;
    }

    dispatch(setIsLoading(true));
    dispatch(setError(null));

    try {
      const parsed = parseTidalUrl(trimmed);
      if (parsed.type !== 'unknown') {
        const result = await losslessAPI.importFromUrl(trimmed);
        if (result.type === 'track') {
          const track = result.data as Track;
          dispatch(setTracks([track]));
          dispatch(setActiveTab('tracks'));
          onTrackSelect?.(track);
        } else if (result.type === 'album') {
          dispatch(setAlbums([result.data as any]));
          dispatch(setActiveTab('albums'));
        } else if (result.type === 'artist') {
          dispatch(setArtists([result.data as any]));
          dispatch(setActiveTab('artists'));
        } else if (result.type === 'playlist') {
          const playlistData = result.data as { playlist: any };
          dispatch(setPlaylists([playlistData.playlist]));
          dispatch(setActiveTab('playlists'));
        }
        return;
      }

      if (tab === 'tracks') {
        const response = await losslessAPI.searchTracks(trimmed, region);
        dispatch(setTracks(response.items));
      }
      if (tab === 'albums') {
        const response = await losslessAPI.searchAlbums(trimmed, region);
        dispatch(setAlbums(response.items));
      }
      if (tab === 'artists') {
        const response = await losslessAPI.searchArtists(trimmed, region);
        dispatch(setArtists(response.items));
      }
      if (tab === 'playlists') {
        const response = await losslessAPI.searchPlaylists(trimmed, region);
        dispatch(setPlaylists(response.items));
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Search failed. Please try again.';
      dispatch(setError(message));
    } finally {
      dispatch(setIsLoading(false));
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    await runSearch(inputValue, search.activeTab);
  };

  const selectTab = async (tab: SearchTab) => {
    dispatch(setActiveTab(tab));
    if (search.query.trim().length >= 2) {
      await runSearch(search.query, tab);
    }
  };

  const patchAlbumDownloadState = (albumId: number, patch: Partial<AlbumDownloadState>) => {
    setAlbumDownloadStates((prev) => {
      const existing = prev[albumId] ?? {
        downloading: false,
        completed: 0,
        total: 0,
        error: null,
      };

      return {
        ...prev,
        [albumId]: {
          ...existing,
          ...patch,
        },
      };
    });
  };

  const handleAlbumDownloadClick = async (album: (typeof search.albums)[number], event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();

    if (albumDownloadStates[album.id]?.downloading) {
      return;
    }

    patchAlbumDownloadState(album.id, {
      downloading: true,
      completed: 0,
      total: album.numberOfTracks ?? 0,
      error: null,
    });

    try {
      await downloadAlbum(
        album,
        albumDownloadQuality,
        {
          onTotalResolved: (total) => {
            patchAlbumDownloadState(album.id, { total });
          },
          onTrackDownloaded: (completed, total) => {
            patchAlbumDownloadState(album.id, { completed, total });
          },
        },
        album.artist?.name,
        {
          mode: albumDownloadMode,
          convertAacToMp3: convertAacToMp3Preference,
          downloadCoverSeperately: downloadCoverSeperatelyPreference,
        }
      );

      setAlbumDownloadStates((prev) => {
        const existing = prev[album.id];
        if (!existing) return prev;
        return {
          ...prev,
          [album.id]: {
            ...existing,
            downloading: false,
            completed: existing.total || existing.completed,
            error: null,
          },
        };
      });
    } catch (error) {
      console.error('Failed to download album:', error);
      const message =
        error instanceof Error && error.message
          ? error.message
          : 'Failed to download album. Please try again.';
      patchAlbumDownloadState(album.id, { downloading: false, error: message });
    }
  };

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit} className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
        <input
          value={inputValue}
          onChange={(event) => setInputValue(event.target.value)}
          placeholder="Search tracks, albums, artists, playlists, or paste a TIDAL link"
          className="w-full rounded-xl border border-slate-700 bg-slate-900/80 py-3 pr-4 pl-11 text-slate-100 outline-none transition focus:border-blue-500"
        />
      </form>

      <div className="flex flex-wrap gap-2">
        {(['tracks', 'albums', 'artists', 'playlists'] as SearchTab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => void selectTab(tab)}
            className={`rounded-full px-4 py-2 text-sm font-medium transition ${
              search.activeTab === tab
                ? 'bg-blue-600 text-white'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            {tab[0]?.toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {search.isLoading && (
        <div className="flex items-center gap-2 text-slate-300">
          <LoaderCircle className="h-4 w-4 animate-spin" />
          <span>Searching…</span>
        </div>
      )}

      {search.error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {search.error}
        </div>
      )}

      {!search.isLoading && !search.error && search.activeTab === 'tracks' && (
        <TrackList
          tracks={filteredTrackResults}
          showAlbum={true}
          showArtist={true}
          showCover={true}
        />
      )}

      {!search.isLoading && !search.error && search.activeTab === 'albums' && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {search.albums.map((album) => (
            <div key={album.id} className="group relative text-left">
              <button
                onClick={(event) => void handleAlbumDownloadClick(album, event)}
                type="button"
                className="absolute top-3 right-3 z-10 flex items-center justify-center rounded-full bg-black/50 p-2 text-gray-200 backdrop-blur-md transition-colors hover:bg-blue-600/80 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                disabled={albumDownloadStates[album.id]?.downloading}
                aria-label={`Download ${album.title}`}
              >
                {albumDownloadStates[album.id]?.downloading ? (
                  <LoaderCircle size={16} className="animate-spin" />
                ) : (
                  <Download size={16} />
                )}
              </button>

              <a
                href={`/album/${album.id}`}
                className="block rounded-xl border border-slate-800 bg-slate-900/50 p-4 transition hover:border-blue-600"
              >
                <img
                  src={losslessAPI.getCoverUrl(album.cover, '320')}
                  alt={album.title}
                  className="mb-3 aspect-square w-full rounded-lg object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                />
                <div className="truncate text-sm font-semibold text-slate-100">{album.title}</div>
                <div className="truncate text-xs text-slate-400">{album.artist?.name ?? 'Unknown Artist'}</div>
              </a>

              {albumDownloadStates[album.id]?.downloading ? (
                <p className="mt-2 text-xs text-blue-300">
                  Downloading {albumDownloadStates[album.id]?.completed ?? 0}/
                  {albumDownloadStates[album.id]?.total || album.numberOfTracks || '?'} tracks…
                </p>
              ) : albumDownloadStates[album.id]?.error ? (
                <p className="mt-2 text-xs text-red-400" role="alert">
                  {albumDownloadStates[album.id]?.error}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {!search.isLoading && !search.error && search.activeTab === 'artists' && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {search.artists.map((artist) => (
            <a
              key={artist.id}
              href={`/artist/${artist.id}`}
              className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 transition hover:border-blue-600"
            >
              {artist.picture ? (
                <img
                  src={losslessAPI.getArtistPictureUrl(artist.picture)}
                  alt={artist.name}
                  className="mb-3 aspect-square w-full rounded-full object-cover"
                />
              ) : null}
              <div className="truncate text-sm font-semibold text-slate-100">{artist.name}</div>
            </a>
          ))}
        </div>
      )}

      {!search.isLoading && !search.error && search.activeTab === 'playlists' && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {search.playlists.map((playlist) => (
            <a
              key={playlist.uuid}
              href={`/playlist/${playlist.uuid}`}
              className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 transition hover:border-blue-600"
            >
              <img
                src={playlist.squareImage || playlist.image}
                alt={playlist.title}
                className="mb-3 aspect-square w-full rounded-lg object-cover"
              />
              <div className="truncate text-sm font-semibold text-slate-100">{playlist.title}</div>
              <div className="truncate text-xs text-slate-400">
                {playlist.numberOfTracks} tracks
              </div>
            </a>
          ))}
        </div>
      )}

      {!search.isLoading && !search.error && !canSearch && (
        <p className="text-sm text-slate-400">Enter at least 2 characters to search.</p>
      )}
    </div>
  );
}
