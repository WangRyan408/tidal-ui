import { configureStore } from '@reduxjs/toolkit';
import playerReducer from './features/playerSlice.ts';
import downloadUiReducer from './features/downloadUiSlice.ts';
import downloadPreferencesReducer from './features/downloadPreferencesSlice.ts';
import lyricsReducer from './features/lyricsSlice.ts';
import performanceReducer from './features/performanceSlice.ts';
import regionReducer from './features/regionSlice.ts';
import searchReducer from './features/searchSlice.ts';
import userPreferencesReducer from './features/userPreferencesSlice.ts';

const PLAYER_STORAGE_KEY = 'tidal-player-store';

export const store = configureStore({
	reducer: {
		player: playerReducer,
		downloadUi: downloadUiReducer,
		downloadPreferences: downloadPreferencesReducer,
		lyrics: lyricsReducer,
		performance: performanceReducer,
		region: regionReducer,
		search: searchReducer,
		userPreferences: userPreferencesReducer,
	},
	middleware: (getDefaultMiddleware) =>
		getDefaultMiddleware({
			serializableCheck: {
				// Track objects contain nested structures that trigger false positives
				ignoredActions: [
					'downloadUi/beginTrackDownload',
					'player/setTrack',
					'player/setQueue',
					'player/enqueue',
					'player/enqueueNext',
				],
				ignoredPaths: [
					'player.currentTrack',
					'player.queue',
					'downloadUi.tasks',
				],
			},
		}),
});

// Persist player state to sessionStorage on every change (matches Svelte's store.subscribe pattern)
if (typeof window !== 'undefined') {
	let lastSerializedPlayer = '';
	store.subscribe(() => {
		const { player } = store.getState();
		try {
			const serialized = JSON.stringify(player);
			if (serialized !== lastSerializedPlayer) {
				lastSerializedPlayer = serialized;
				sessionStorage.setItem(PLAYER_STORAGE_KEY, serialized);
			}
		} catch (error) {
			console.warn('Failed to persist player state to sessionStorage', error);
		}
	});
}

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
