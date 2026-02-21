import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import type { AudioQuality } from '@/lib/types';

export type PerformanceMode = 'medium' | 'low';

export interface UserPreferencesState {
	playbackQuality: AudioQuality;
	convertAacToMp3: boolean;
	downloadCoversSeperately: boolean;
	performanceMode: PerformanceMode;
}

const STORAGE_KEY = 'tidal-ui.userPreferences';

const DEFAULT_STATE: UserPreferencesState = {
	playbackQuality: 'HI_RES_LOSSLESS',
	convertAacToMp3: false,
	downloadCoversSeperately: false,
	performanceMode: 'medium'
};

function detectIsMobileDevice(): boolean {
	if (typeof window === 'undefined') return false;

	const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
	const isSmallScreen = window.innerWidth <= 768;
	const mobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
		navigator.userAgent
	);

	return hasTouch && (isSmallScreen || mobileUA);
}

function parseStoredPreferences(raw: string | null): UserPreferencesState {
	if (!raw) {
		return DEFAULT_STATE;
	}

	try {
		const parsed = JSON.parse(raw) as Partial<UserPreferencesState>;
		const quality = parsed?.playbackQuality;
		const convertFlag = parsed?.convertAacToMp3;
		const downloadCoversFlag = parsed?.downloadCoversSeperately;
		const perfMode = parsed?.performanceMode;
		return {
			playbackQuality:
				quality === 'HI_RES_LOSSLESS' ||
				quality === 'LOSSLESS' ||
				quality === 'HIGH' ||
				quality === 'LOW'
					? quality
					: DEFAULT_STATE.playbackQuality,
			convertAacToMp3:
				typeof convertFlag === 'boolean' ? convertFlag : DEFAULT_STATE.convertAacToMp3,
			downloadCoversSeperately:
				typeof downloadCoversFlag === 'boolean'
					? downloadCoversFlag
					: DEFAULT_STATE.downloadCoversSeperately,
			performanceMode:
				perfMode === 'medium' || perfMode === 'low' ? perfMode : DEFAULT_STATE.performanceMode
		};
	} catch (error) {
		console.warn('Failed to parse stored user preferences', error);
		return DEFAULT_STATE;
	}
}

const readInitialPreferences = (): UserPreferencesState => {
	if (typeof window === 'undefined') {
		return DEFAULT_STATE;
	}

	try {
		const storedRaw = localStorage.getItem(STORAGE_KEY);

		if (!storedRaw) {
			const isMobile = detectIsMobileDevice();
			const initialState: UserPreferencesState = {
				...DEFAULT_STATE,
				performanceMode: isMobile ? 'medium' : 'medium'
			};

			try {
				localStorage.setItem(STORAGE_KEY, JSON.stringify(initialState));
			} catch {
				// Ignore storage errors
			}

			return initialState;
		}

		return parseStoredPreferences(storedRaw);
	} catch (error) {
		console.warn('Failed to read user preferences from storage', error);
		return DEFAULT_STATE;
	}
};

const initialState: UserPreferencesState = readInitialPreferences();

export const userPreferencesSlice = createSlice({
	name: 'userPreferences',
	initialState,
	reducers: {
		setPlaybackQuality: (state, action: PayloadAction<AudioQuality>) => {
			state.playbackQuality = action.payload;
			if (typeof window !== 'undefined') {
				try {
					localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
				} catch (error) {
					console.warn('Failed to persist user preferences', error);
				}
			}
		},
		setConvertAacToMp3: (state, action: PayloadAction<boolean>) => {
			state.convertAacToMp3 = action.payload;
			if (typeof window !== 'undefined') {
				try {
					localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
				} catch (error) {
					console.warn('Failed to persist user preferences', error);
				}
			}
		},
		setDownloadCoversSeperately: (state, action: PayloadAction<boolean>) => {
			state.downloadCoversSeperately = action.payload;
			if (typeof window !== 'undefined') {
				try {
					localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
				} catch (error) {
					console.warn('Failed to persist user preferences', error);
				}
			}
		},
		setPerformanceMode: (state, action: PayloadAction<PerformanceMode>) => {
			state.performanceMode = action.payload;
			if (typeof window !== 'undefined') {
				try {
					localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
				} catch (error) {
					console.warn('Failed to persist user preferences', error);
				}
			}
		}
	}
});

export const {
	setPlaybackQuality,
	setConvertAacToMp3,
	setDownloadCoversSeperately,
	setPerformanceMode
} = userPreferencesSlice.actions;

export default userPreferencesSlice.reducer;
