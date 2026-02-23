import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import type { PlayableTrack } from '@/lib/types';
import { isSonglinkTrack } from '@/lib/types';
import { formatArtists } from '@/lib/utils';
import { generateUUID } from '@/lib/uuid';

export type FfmpegPhase = 'idle' | 'countdown' | 'loading' | 'ready' | 'error';

export interface FfmpegBannerState {
	phase: FfmpegPhase;
	countdownSeconds: number;
	totalBytes?: number;
	progress: number;
	dismissible: boolean;
	autoTriggered: boolean;
	error?: string;
	startedAt?: number;
	updatedAt?: number;
}

export type TrackDownloadStatus = 'pending' | 'running' | 'completed' | 'error' | 'cancelled';

export interface TrackDownloadTask {
	id: string;
	trackId: number | string;
	title: string;
	subtitle?: string;
	filename: string;
	status: TrackDownloadStatus;
	receivedBytes: number;
	totalBytes?: number;
	progress: number;
	error?: string;
	startedAt: number;
	updatedAt: number;
	cancellable: boolean;
}

export interface DownloadUiState {
	ffmpeg: FfmpegBannerState;
	tasks: TrackDownloadTask[];
}

const trackDownloadControllers = new Map<string, AbortController>();

export function registerTrackDownloadController(taskId: string, controller: AbortController): void {
	trackDownloadControllers.set(taskId, controller);
}

export function abortTrackDownloadController(taskId: string): void {
	const controller = trackDownloadControllers.get(taskId);
	if (!controller) return;
	controller.abort();
	trackDownloadControllers.delete(taskId);
}

export function releaseTrackDownloadController(taskId: string): void {
	trackDownloadControllers.delete(taskId);
}

const MAX_VISIBLE_TASKS = 4;
const COUNTDOWN_DEFAULT_SECONDS = 5;

const initialState: DownloadUiState = {
	ffmpeg: {
		phase: 'idle',
		countdownSeconds: COUNTDOWN_DEFAULT_SECONDS,
		totalBytes: undefined,
		progress: 0,
		dismissible: true,
		autoTriggered: true,
		startedAt: undefined,
		updatedAt: undefined
	},
	tasks: []
};

function clampProgress(value: number | null | undefined): number {
	if (!Number.isFinite(value ?? NaN)) return 0;
	return Math.max(0, Math.min(1, Number(value)));
}

function upsertTask(state: DownloadUiState, task: TrackDownloadTask): void {
	const existingIndex = state.tasks.findIndex((entry) => entry.id === task.id);
	if (existingIndex >= 0) {
		state.tasks[existingIndex] = {
			...state.tasks[existingIndex]!,
			...task,
			updatedAt: Date.now()
		};
	} else {
		state.tasks.unshift({ ...task, updatedAt: Date.now() });
	}
	state.tasks = state.tasks.slice(0, MAX_VISIBLE_TASKS);
}

function mutateTask(
	state: DownloadUiState,
	id: string,
	changes: Partial<TrackDownloadTask>
): void {
	const index = state.tasks.findIndex((entry) => entry.id === id);
	if (index === -1) return;
	state.tasks[index] = {
		...state.tasks[index]!,
		...changes,
		updatedAt: Date.now()
	};
}

export const downloadUiSlice = createSlice({
	name: 'downloadUi',
	initialState,
	reducers: {
		reset: () => initialState,
		beginTrackDownload: (
			state,
			action: PayloadAction<{
				track: PlayableTrack;
				filename: string;
				subtitle?: string;
				taskId?: string;
				id?: string;
			}>
		) => {
			const { track, filename, subtitle } = action.payload;
			const taskId =
				action.payload.taskId ?? action.payload.id ?? generateUUID();
			const resolvedSubtitle =
				subtitle ?? (isSonglinkTrack(track) ? track.artistName : formatArtists(track.artists));

			upsertTask(state, {
				id: taskId,
				trackId: track.id,
				title: track.title,
				subtitle: resolvedSubtitle,
				filename,
				status: 'running',
				receivedBytes: 0,
				totalBytes: undefined,
				progress: 0,
				error: undefined,
				startedAt: Date.now(),
				updatedAt: Date.now(),
				cancellable: true
			});
		},
		updateTrackProgress: (
			state,
			action: PayloadAction<{
				taskId?: string;
				id?: string;
				receivedBytes: number;
				totalBytes?: number;
			}>
		) => {
			const taskId = action.payload.taskId ?? action.payload.id;
			if (!taskId) return;
			const { receivedBytes, totalBytes } = action.payload;
			mutateTask(state, taskId, {
				receivedBytes,
				totalBytes,
				progress: totalBytes ? clampProgress(receivedBytes / totalBytes) : undefined
			});
		},
		updateTrackStage: (
			state,
			action: PayloadAction<{
				taskId?: string;
				id?: string;
				stage?: number;
				progress?: number;
			}>
		) => {
			const taskId = action.payload.taskId ?? action.payload.id;
			if (!taskId) return;
			const stage = action.payload.stage ?? action.payload.progress ?? 0;
			mutateTask(state, taskId, { progress: clampProgress(stage) });
		},
		completeTrackDownload: (state, action: PayloadAction<string>) => {
			const taskId = action.payload;
			const task = state.tasks.find((entry) => entry.id === taskId);
			mutateTask(state, taskId, {
				status: task?.status === 'cancelled' ? 'cancelled' : 'completed',
				progress: task?.status === 'cancelled' ? task.progress : 1,
				cancellable: false
			});
		},
		errorTrackDownload: (
			state,
			action: PayloadAction<{
				taskId?: string;
				id?: string;
				error: string;
			}>
		) => {
			const taskId = action.payload.taskId ?? action.payload.id;
			if (!taskId) return;
			mutateTask(state, taskId, {
				status: 'error',
				error: action.payload.error || 'Download failed',
				cancellable: false
			});
		},
		cancelTrackDownload: (state, action: PayloadAction<string>) => {
			const taskId = action.payload;
			mutateTask(state, taskId, {
				status: 'cancelled',
				error: undefined,
				cancellable: false
			});
		},
		dismissTrackTask: (state, action: PayloadAction<string>) => {
			state.tasks = state.tasks.filter((task) => task.id !== action.payload);
		},
		startFfmpegCountdown: (
			state,
			action: PayloadAction<{ totalBytes?: number; autoTriggered?: boolean }>
		) => {
			const autoTriggered = action.payload.autoTriggered ?? true;
			state.ffmpeg = {
				phase: autoTriggered ? 'countdown' : 'loading',
				countdownSeconds: autoTriggered ? COUNTDOWN_DEFAULT_SECONDS : 0,
				totalBytes: action.payload.totalBytes && action.payload.totalBytes > 0 ? action.payload.totalBytes : undefined,
				progress: 0,
				dismissible: autoTriggered,
				autoTriggered,
				error: undefined,
				startedAt: Date.now(),
				updatedAt: Date.now()
			};
		},
		skipFfmpegCountdown: (state) => {
			if (state.ffmpeg.phase !== 'countdown') return;
			state.ffmpeg = {
				...state.ffmpeg,
				phase: 'loading',
				countdownSeconds: 0,
				progress: 0,
				dismissible: false,
				updatedAt: Date.now()
			};
		},
		startFfmpegLoading: (state) => {
			state.ffmpeg = {
				...state.ffmpeg,
				phase: 'loading',
				countdownSeconds: 0,
				progress: 0,
				dismissible: false,
				updatedAt: Date.now()
			};
		},
		updateFfmpegProgress: (state, action: PayloadAction<number>) => {
			state.ffmpeg = {
				...state.ffmpeg,
				phase: 'loading',
				progress: clampProgress(action.payload),
				dismissible: false,
				updatedAt: Date.now()
			};
		},
		completeFfmpeg: (state) => {
			state.ffmpeg = {
				...state.ffmpeg,
				phase: 'ready',
				progress: 1,
				countdownSeconds: 0,
				dismissible: true,
				updatedAt: Date.now()
			};
		},
		errorFfmpeg: (state, action: PayloadAction<string>) => {
			state.ffmpeg = {
				...state.ffmpeg,
				phase: 'error',
				progress: 0,
				dismissible: true,
				error: action.payload || 'Failed to load FFmpeg',
				updatedAt: Date.now()
			};
		},
		dismissFfmpeg: (state) => {
			state.ffmpeg = {
				phase: 'idle',
				countdownSeconds: COUNTDOWN_DEFAULT_SECONDS,
				totalBytes: undefined,
				progress: 0,
				dismissible: true,
				autoTriggered: true,
				error: undefined,
				startedAt: undefined,
				updatedAt: Date.now()
			};
		}
	}
});

export const {
	reset,
	beginTrackDownload,
	updateTrackProgress,
	updateTrackStage,
	completeTrackDownload,
	errorTrackDownload,
	cancelTrackDownload,
	dismissTrackTask,
	startFfmpegCountdown,
	skipFfmpegCountdown,
	startFfmpegLoading,
	updateFfmpegProgress,
	completeFfmpeg,
	errorFfmpeg,
	dismissFfmpeg
} = downloadUiSlice.actions;

export default downloadUiSlice.reducer;
