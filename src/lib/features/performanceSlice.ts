import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';

export interface PerformanceState {
	reducedMotion: boolean;
}

const getInitialReducedMotion = (): boolean => {
	if (typeof window !== 'undefined') {
		return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	}
	return false;
};

const initialState: PerformanceState = {
	reducedMotion: getInitialReducedMotion()
};

export const performanceSlice = createSlice({
	name: 'performance',
	initialState,
	reducers: {
		setReducedMotion: (state, action: PayloadAction<boolean>) => {
			state.reducedMotion = action.payload;
		}
	}
});

export const { setReducedMotion } = performanceSlice.actions;

export default performanceSlice.reducer;
