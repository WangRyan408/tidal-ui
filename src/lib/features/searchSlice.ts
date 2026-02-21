import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import type { Track, Album, Artist, Playlist, SonglinkTrack } from '@/lib/types';

export type SearchTab = 'tracks' | 'albums' | 'artists' | 'playlists';

export interface SearchState {
	query: string;
	activeTab: SearchTab;
	isLoading: boolean;
	tracks: (Track | SonglinkTrack)[];
	albums: Album[];
	artists: Artist[];
	playlists: Playlist[];
	error: string | null;
	isPlaylistConversionMode: boolean;
	playlistConversionTotal: number;
	playlistLoadingMessage: string | null;
}

const initialState: SearchState = {
	query: '',
	activeTab: 'tracks',
	isLoading: false,
	tracks: [],
	albums: [],
	artists: [],
	playlists: [],
	error: null,
	isPlaylistConversionMode: false,
	playlistConversionTotal: 0,
	playlistLoadingMessage: null
};

const loadState = (): SearchState => {
	if (typeof window !== 'undefined') {
		try {
			const stored = sessionStorage.getItem('tidal-ui-search-store');
			if (stored) {
				const data = JSON.parse(stored);
				return {
					...initialState,
					query: data.query ?? '',
					activeTab: data.activeTab ?? 'tracks',
					tracks: data.tracks ?? [],
					albums: data.albums ?? [],
					artists: data.artists ?? [],
					playlists: data.playlists ?? [],
					isPlaylistConversionMode: data.isPlaylistConversionMode ?? false,
					playlistConversionTotal: data.playlistConversionTotal ?? 0
				};
			}
		} catch (e) {
			console.error('Failed to restore search state:', e);
		}
	}
	return initialState;
};

export const searchSlice = createSlice({
	name: 'search',
	initialState: loadState(),
	reducers: {
		setQuery: (state, action: PayloadAction<string>) => {
			state.query = action.payload;
		},
		setActiveTab: (state, action: PayloadAction<SearchTab>) => {
			state.activeTab = action.payload;
		},
		setIsLoading: (state, action: PayloadAction<boolean>) => {
			state.isLoading = action.payload;
		},
		setTracks: (state, action: PayloadAction<(Track | SonglinkTrack)[]>) => {
			state.tracks = action.payload;
		},
		setAlbums: (state, action: PayloadAction<Album[]>) => {
			state.albums = action.payload;
		},
		setArtists: (state, action: PayloadAction<Artist[]>) => {
			state.artists = action.payload;
		},
		setPlaylists: (state, action: PayloadAction<Playlist[]>) => {
			state.playlists = action.payload;
		},
		setError: (state, action: PayloadAction<string | null>) => {
			state.error = action.payload;
		},
		setPlaylistConversionMode: (state, action: PayloadAction<boolean>) => {
			state.isPlaylistConversionMode = action.payload;
		},
		setPlaylistConversionTotal: (state, action: PayloadAction<number>) => {
			state.playlistConversionTotal = action.payload;
		},
		setPlaylistLoadingMessage: (state, action: PayloadAction<string | null>) => {
			state.playlistLoadingMessage = action.payload;
		},
		resetSearch: () => initialState
	}
});

export const {
	setQuery,
	setActiveTab,
	setIsLoading,
	setTracks,
	setAlbums,
	setArtists,
	setPlaylists,
	setError,
	setPlaylistConversionMode,
	setPlaylistConversionTotal,
	setPlaylistLoadingMessage,
	resetSearch
} = searchSlice.actions;

export default searchSlice.reducer;
