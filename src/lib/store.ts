import { configureStore } from '@reduxjs/toolkit';
import playerReducer from './features/playerSlice.ts';
import downloadUiReducer from './features/downloadUiSlice.ts';
import downloadPreferencesReducer from './features/downloadPreferencesSlice.ts';
import lyricsReducer from './features/lyricsSlice.ts';
import performanceReducer from './features/performanceSlice.ts';
import regionReducer from './features/regionSlice.ts';
import searchReducer from './features/searchSlice.ts';
import userPreferencesReducer from './features/userPreferencesSlice.ts';

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
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
