import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import type { PlayableTrack } from '@/lib/types';

export interface LyricsState {
	open: boolean;
	maximized: boolean;
	track: PlayableTrack | null;
	refreshToken: number;
}

const initialState: LyricsState = {
	open: false,
	maximized: false,
	track: null,
	refreshToken: 0
};

export const lyricsSlice = createSlice({
	name: 'lyrics',
	initialState,
	reducers: {
		openLyrics: (state, action: PayloadAction<PlayableTrack | null | undefined>) => {
			const targetTrack = action.payload;
			const nextTrack = targetTrack !== undefined ? targetTrack : state.track;
			state.open = true;
			state.track = nextTrack;
			state.maximized = typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches ? true : state.maximized;
			if (nextTrack && state.track?.id !== nextTrack.id) {
				state.refreshToken += 1;
			}
		},
		closeLyrics: (state) => {
			state.open = false;
			state.maximized = false;
		},
		toggleLyrics: (state) => {
			if (state.open) {
				state.open = false;
				state.maximized = false;
			} else {
				state.open = true;
				state.maximized = typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches ? true : state.maximized;
			}
		},
		toggleMaximize: (state) => {
			state.maximized = !state.maximized;
		},
		refreshLyrics: (state) => {
			state.refreshToken += 1;
		},
		setLyricsTrack: (state, action: PayloadAction<PlayableTrack | null>) => {
			const trackChanged = state.track?.id !== action.payload?.id;
			state.track = action.payload;
			if (trackChanged) {
				state.refreshToken += 1;
			}
		}
	}
});

export const {
	openLyrics,
	closeLyrics,
	toggleLyrics,
	toggleMaximize,
	refreshLyrics,
	setLyricsTrack
} = lyricsSlice.actions;

export default lyricsSlice.reducer;
