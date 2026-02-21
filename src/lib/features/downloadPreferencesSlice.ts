import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';

export type DownloadMode = 'individual' | 'zip' | 'csv';

export interface DownloadPreferencesState {
	mode: DownloadMode;
}

const STORAGE_KEY = 'tidal-ui.downloadMode';

const readInitialMode = (): DownloadMode => {
	if (typeof window === 'undefined') {
		return 'individual';
	}

	try {
		const stored = localStorage.getItem(STORAGE_KEY);
		if (stored === 'individual' || stored === 'zip' || stored === 'csv') {
			return stored;
		}
	} catch (e) {
		// Ignore
	}
	return 'individual';
};

const initialState: DownloadPreferencesState = {
	mode: readInitialMode()
};

export const downloadPreferencesSlice = createSlice({
	name: 'downloadPreferences',
	initialState,
	reducers: {
		setMode: (state, action: PayloadAction<DownloadMode>) => {
			state.mode = action.payload;
			if (typeof window !== 'undefined') {
				try {
					localStorage.setItem(STORAGE_KEY, action.payload);
				} catch (error) {
					console.warn('Failed to persist download mode preference', error);
				}
			}
		}
	}
});

export const { setMode } = downloadPreferencesSlice.actions;

export default downloadPreferencesSlice.reducer;
