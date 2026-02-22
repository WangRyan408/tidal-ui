import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import type { Track, AudioQuality, PlayableTrack } from '@/lib/types';
import { deriveTrackQuality } from '@/lib/utils/audioQuality';

export interface PlayerState {
	currentTrack: PlayableTrack | null;
	isPlaying: boolean;
	currentTime: number;
	duration: number;
	volume: number;
	quality: AudioQuality;
	qualitySource: 'auto' | 'manual';
	isLoading: boolean;
	queue: PlayableTrack[];
	queueIndex: number;
	sampleRate: number | null;
	bitDepth: number | null;
	replayGain: number | null;
}

const getInitialQuality = (): AudioQuality => {
	if (typeof window !== 'undefined') {
		try {
			const stored = localStorage.getItem('tidal-ui.userPreferences');
			if (stored) {
				const parsed = JSON.parse(stored);
				if (parsed.playbackQuality) {
					return parsed.playbackQuality;
				}
			}
		} catch (e) {
			// Ignore
		}
	}
	return 'HI_RES_LOSSLESS';
};

const initialState: PlayerState = {
	currentTrack: null,
	isPlaying: false,
	currentTime: 0,
	duration: 0,
	volume: 0.8,
	quality: getInitialQuality(),
	qualitySource: 'manual',
	isLoading: false,
	queue: [],
	queueIndex: -1,
	sampleRate: null,
	bitDepth: null,
	replayGain: null
};

const loadState = (): PlayerState => {
	if (typeof window !== 'undefined') {
		try {
			const stored = sessionStorage.getItem('tidal-player-store');
			if (stored) {
				const parsed = JSON.parse(stored);
				return {
					...initialState,
					...parsed,
					isPlaying: false,
					isLoading: false
				};
			}
		} catch (e) {
			console.warn('Failed to restore player state', e);
		}
	}
	return initialState;
};

const applyAutoQuality = (state: PlayerState, track: PlayableTrack | null) => {
	if (state.qualitySource === 'manual') {
		return;
	}
	if (track && 'isSonglinkTrack' in track && track.isSonglinkTrack) {
		const nextQuality: AudioQuality = 'LOSSLESS';
		if (state.quality !== nextQuality) {
			state.quality = nextQuality;
		}
		return;
	}
	const derived = deriveTrackQuality(track as Track | null);
	const nextQuality: AudioQuality = derived ?? 'LOSSLESS';
	if (state.quality !== nextQuality) {
		state.quality = nextQuality;
	}
};

const resolveSampleRate = (state: PlayerState, track: PlayableTrack | null): number | null => {
	if (track && 'isSonglinkTrack' in track && track.isSonglinkTrack) {
		return null;
	}
	if (state.currentTrack && track && 'id' in state.currentTrack && 'id' in track && state.currentTrack.id === track.id) {
		return state.sampleRate;
	}
	return null;
};

export const playerSlice = createSlice({
	name: 'player',
	initialState: loadState(),
	reducers: {
		setTrack: (state, action: PayloadAction<PlayableTrack>) => {
			const track = action.payload;
			state.currentTrack = track;
			state.duration = track.duration;
			state.currentTime = 0;
			state.isLoading = true;
			state.sampleRate = resolveSampleRate(state, track);
			state.bitDepth = null;
			state.replayGain = null;
			applyAutoQuality(state, track);
		},
		play: (state) => {
			state.isPlaying = true;
		},
		pause: (state) => {
			state.isPlaying = false;
		},
		togglePlay: (state) => {
			state.isPlaying = !state.isPlaying;
		},
		setCurrentTime: (state, action: PayloadAction<number>) => {
			state.currentTime = action.payload;
		},
		setDuration: (state, action: PayloadAction<number>) => {
			state.duration = action.payload;
		},
		setSampleRate: (state, action: PayloadAction<number | null>) => {
			state.sampleRate = action.payload;
		},
		setBitDepth: (state, action: PayloadAction<number | null>) => {
			state.bitDepth = action.payload;
		},
		setReplayGain: (state, action: PayloadAction<number | null>) => {
			state.replayGain = action.payload;
		},
		setVolume: (state, action: PayloadAction<number>) => {
			state.volume = action.payload;
		},
		setQuality: (state, action: PayloadAction<AudioQuality>) => {
			state.quality = action.payload;
			state.qualitySource = 'manual';
			// Sync quality to userPreferences localStorage (matches Svelte's userPreferencesStore.setPlaybackQuality)
			if (typeof window !== 'undefined') {
				try {
					const stored = localStorage.getItem('tidal-ui.userPreferences');
					const prefs = stored ? JSON.parse(stored) : {};
					prefs.playbackQuality = action.payload;
					localStorage.setItem('tidal-ui.userPreferences', JSON.stringify(prefs));
				} catch (error) {
					console.warn('Failed to persist quality to user preferences', error);
				}
			}
		},
		setLoading: (state, action: PayloadAction<boolean>) => {
			state.isLoading = action.payload;
		},
		setQueue: (
			state,
			action: PayloadAction<{
				queue?: PlayableTrack[];
				tracks?: PlayableTrack[];
				startIndex?: number;
				index?: number;
			}>
		) => {
			const queue = action.payload.queue ?? action.payload.tracks ?? [];
			const startIndex = action.payload.startIndex ?? action.payload.index ?? 0;
			const hasTracks = queue.length > 0;
			const clampedIndex = hasTracks
				? Math.min(Math.max(startIndex, 0), queue.length - 1)
				: -1;
			const nextTrack = hasTracks ? queue[clampedIndex]! : null;

			const isSameTrack = state.currentTrack && nextTrack && state.currentTrack.id === nextTrack.id;

			state.queue = queue;
			state.queueIndex = clampedIndex;
			state.currentTrack = nextTrack;
			state.isPlaying = hasTracks ? state.isPlaying : false;
			state.isLoading = isSameTrack ? state.isLoading : hasTracks;
			state.currentTime = isSameTrack ? state.currentTime : 0;
			state.duration = isSameTrack ? state.duration : (nextTrack?.duration ?? 0);
			state.sampleRate = isSameTrack ? state.sampleRate : resolveSampleRate(state, nextTrack);
			state.bitDepth = isSameTrack ? state.bitDepth : null;
			state.replayGain = isSameTrack ? state.replayGain : null;

			if (!hasTracks) {
				state.queueIndex = -1;
				state.currentTrack = null;
				state.isPlaying = false;
				state.isLoading = false;
				state.currentTime = 0;
				state.duration = 0;
				state.sampleRate = null;
				state.bitDepth = null;
				state.replayGain = null;
			}

			applyAutoQuality(state, state.currentTrack);
		},
		enqueue: (state, action: PayloadAction<PlayableTrack>) => {
			const track = action.payload;
			if (state.queue.length === 0) {
				state.queue = [track];
				state.queueIndex = 0;
				state.currentTrack = track;
				state.isPlaying = true;
				state.isLoading = true;
				state.currentTime = 0;
				state.duration = track.duration;
				state.sampleRate = resolveSampleRate(state, track);
				state.bitDepth = null;
				state.replayGain = null;
				applyAutoQuality(state, track);
			} else {
				state.queue.push(track);
			}
		},
		enqueueNext: (state, action: PayloadAction<PlayableTrack>) => {
			const track = action.payload;
			if (state.queue.length === 0 || state.queueIndex === -1) {
				state.queue = [track];
				state.queueIndex = 0;
				state.currentTrack = track;
				state.isPlaying = true;
				state.isLoading = true;
				state.currentTime = 0;
				state.duration = track.duration;
				state.sampleRate = resolveSampleRate(state, track);
				state.bitDepth = null;
				state.replayGain = null;
				applyAutoQuality(state, track);
			} else {
				const insertIndex = Math.min(state.queueIndex + 1, state.queue.length);
				state.queue.splice(insertIndex, 0, track);
				if (insertIndex <= state.queueIndex) {
					state.queueIndex += 1;
				}
			}
		},
		next: (state) => {
			if (state.queueIndex < state.queue.length - 1) {
				const newIndex = state.queueIndex + 1;
				const nextTrack = state.queue[newIndex] ?? null;
				state.queueIndex = newIndex;
				state.currentTrack = nextTrack;
				state.currentTime = 0;
				state.duration = nextTrack?.duration ?? 0;
				state.sampleRate = resolveSampleRate(state, nextTrack);
				state.bitDepth = null;
				state.replayGain = null;
				applyAutoQuality(state, nextTrack);
			}
		},
		previous: (state) => {
			if (state.queueIndex > 0) {
				const newIndex = state.queueIndex - 1;
				const nextTrack = state.queue[newIndex] ?? null;
				state.queueIndex = newIndex;
				state.currentTrack = nextTrack;
				state.currentTime = 0;
				state.duration = nextTrack?.duration ?? 0;
				state.sampleRate = resolveSampleRate(state, nextTrack);
				state.bitDepth = null;
				state.replayGain = null;
				applyAutoQuality(state, nextTrack);
			}
		},
		shuffleQueue: (state) => {
			if (state.queue.length <= 1) {
				return;
			}

			const queue = [...state.queue];
			let pinnedTrack: PlayableTrack | null = null;

			if (state.currentTrack) {
				const locatedIndex = queue.findIndex((track) => track.id === state.currentTrack!.id);
				if (locatedIndex >= 0) {
					pinnedTrack = queue.splice(locatedIndex, 1)[0] ?? null;
				}
			}

			if (!pinnedTrack && state.queueIndex >= 0 && state.queueIndex < queue.length) {
				pinnedTrack = queue.splice(state.queueIndex, 1)[0] ?? null;
			}

			if (!pinnedTrack && state.currentTrack) {
				pinnedTrack = state.currentTrack;
			}

			for (let i = queue.length - 1; i > 0; i -= 1) {
				const j = Math.floor(Math.random() * (i + 1));
				[queue[i], queue[j]] = [queue[j]!, queue[i]!];
			}

			if (pinnedTrack) {
				queue.unshift(pinnedTrack);
			}

			const nextQueueIndex = queue.length > 0 ? 0 : -1;
			const nextCurrentTrack = queue.length > 0 ? (queue[0] ?? null) : null;

			state.queue = queue;
			state.queueIndex = nextQueueIndex;
			state.currentTrack = nextCurrentTrack;
			state.currentTime = 0;
			state.duration = nextCurrentTrack?.duration ?? 0;
			state.sampleRate = resolveSampleRate(state, nextCurrentTrack);
			state.bitDepth = null;
			state.replayGain = null;

			if (nextQueueIndex === -1) {
				state.currentTrack = null;
				state.currentTime = 0;
				state.duration = 0;
				state.sampleRate = null;
				state.bitDepth = null;
				state.replayGain = null;
			}

			applyAutoQuality(state, state.currentTrack);
		},
		playAtIndex: (state, action: PayloadAction<number>) => {
			const index = action.payload;
			if (index < 0 || index >= state.queue.length) {
				return;
			}

			const nextTrack = state.queue[index] ?? null;
			state.queueIndex = index;
			state.currentTrack = nextTrack;
			state.currentTime = 0;
			state.isPlaying = true;
			state.isLoading = true;
			state.duration = nextTrack?.duration ?? 0;
			state.sampleRate = resolveSampleRate(state, nextTrack);
			state.bitDepth = null;
			state.replayGain = null;
			applyAutoQuality(state, nextTrack);
		},
		removeFromQueue: (state, action: PayloadAction<number>) => {
			const index = action.payload;
			if (index < 0 || index >= state.queue.length) {
				return;
			}

			state.queue.splice(index, 1);

			if (state.queue.length === 0) {
				state.queueIndex = -1;
				state.currentTrack = null;
				state.isPlaying = false;
				state.isLoading = false;
				state.currentTime = 0;
				state.duration = 0;
				state.sampleRate = null;
				state.bitDepth = null;
				state.replayGain = null;
				applyAutoQuality(state, null);
				return;
			}

			if (index < state.queueIndex) {
				state.queueIndex -= 1;
			} else if (index === state.queueIndex) {
				if (state.queueIndex >= state.queue.length) {
					state.queueIndex = state.queue.length - 1;
				}
				const currentTrack = state.queue[state.queueIndex] ?? null;
				state.currentTrack = currentTrack;
				state.currentTime = 0;
				state.duration = currentTrack?.duration ?? 0;
				if (!currentTrack) {
					state.isPlaying = false;
					state.isLoading = false;
				} else {
					state.isLoading = true;
				}
				state.sampleRate = resolveSampleRate(state, currentTrack);
				applyAutoQuality(state, currentTrack);
			}
		},
		clearQueue: (state) => {
			state.queue = [];
			state.queueIndex = -1;
			state.currentTrack = null;
			state.isPlaying = false;
			state.isLoading = false;
			state.currentTime = 0;
			state.duration = 0;
			state.sampleRate = null;
			state.bitDepth = null;
			state.replayGain = null;
			applyAutoQuality(state, null);
		},
		reset: () => initialState
	}
});

export const {
	setTrack,
	play,
	pause,
	togglePlay,
	setCurrentTime,
	setDuration,
	setSampleRate,
	setBitDepth,
	setReplayGain,
	setVolume,
	setQuality,
	setLoading,
	setQueue,
	enqueue,
	enqueueNext,
	next,
	previous,
	shuffleQueue,
	playAtIndex,
	removeFromQueue,
	clearQueue,
	reset
} = playerSlice.actions;

export default playerSlice.reducer;
