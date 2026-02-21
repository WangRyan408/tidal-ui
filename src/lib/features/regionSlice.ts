import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';

export type RegionOption = 'auto' | 'us' | 'eu';

export interface RegionState {
	region: RegionOption;
}

const STORAGE_KEY = 'tidal-ui.region';

const readInitialRegion = (): RegionOption => {
	if (typeof window === 'undefined') {
		return 'auto';
	}

	try {
		const stored = localStorage.getItem(STORAGE_KEY);
		if (stored === 'us' || stored === 'eu' || stored === 'auto') {
			return stored;
		}
	} catch (e) {
		// Ignore
	}

	return 'auto';
};

const initialState: RegionState = {
	region: readInitialRegion()
};

export const regionSlice = createSlice({
	name: 'region',
	initialState,
	reducers: {
		setRegion: (state, action: PayloadAction<RegionOption>) => {
			state.region = action.payload;
			if (typeof window !== 'undefined') {
				try {
					localStorage.setItem(STORAGE_KEY, action.payload);
				} catch (error) {
					console.warn('Failed to persist region preference', error);
				}
			}
		}
	}
});

export const { setRegion } = regionSlice.actions;

export default regionSlice.reducer;
