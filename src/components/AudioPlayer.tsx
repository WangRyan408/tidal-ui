import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useAppDispatch, useAppSelector } from '@/lib/hooks';
import { losslessAPI, DASH_MANIFEST_UNAVAILABLE_CODE, type TrackDownloadProgress } from '@/lib/api';
import type { DashManifestResult, DashManifestWithMetadata } from '@/lib/api';
import { getProxiedUrl } from '@/lib/config';
import { buildTrackFilename } from '@/lib/downloads';
import { generateUUID } from '@/lib/uuid';
import { formatArtists } from '@/lib/utils';
import { deriveTrackQuality } from '@/lib/utils/audioQuality';
import type { Track, AudioQuality, SonglinkTrack, PlayableTrack } from '@/lib/types';
import { isSonglinkTrack } from '@/lib/types';
import { convertToTidal, extractTidalInfo } from '@/lib/utils/songlink';
import {
	Play,
	Pause,
	SkipForward,
	SkipBack,
	Volume2,
	VolumeX,
	ListMusic,
	Trash2,
	X,
	Shuffle,
	ScrollText,
	Download,
	LoaderCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// Import actions
import {
	setTrack,
	play,
	pause,
	togglePlay,
	next,
	previous,
	setCurrentTime,
	setDuration,
	setVolume,
	setLoading,
	setReplayGain,
	setSampleRate,
	setBitDepth,
	playAtIndex,
	removeFromQueue,
	clearQueue,
	shuffleQueue
} from '@/lib/features/playerSlice';
import { toggleLyrics } from '@/lib/features/lyricsSlice';
import {
	beginTrackDownload,
	updateTrackProgress,
	updateTrackStage,
	startFfmpegCountdown,
	skipFfmpegCountdown,
	startFfmpegLoading,
	updateFfmpegProgress,
	completeFfmpeg,
	errorFfmpeg,
	completeTrackDownload,
	errorTrackDownload,
	cancelTrackDownload,
	dismissTrackTask,
	dismissFfmpeg,
	registerTrackDownloadController,
	abortTrackDownloadController,
	releaseTrackDownloadController
} from '@/lib/features/downloadUiSlice';

type ShakaPlayerInstance = {
	load: (uri: string) => Promise<void>;
	unload: () => Promise<void>;
	destroy: () => Promise<void>;
	getNetworkingEngine?: () => {
		registerRequestFilter: (
			callback: (type: unknown, request: { method: string; uris: string[] }) => void
		) => void;
	};
};

type ShakaNamespace = {
	Player: new (mediaElement: HTMLMediaElement) => ShakaPlayerInstance;
	polyfill?: {
		installAll?: () => void;
	};
};

type ShakaModule = { default: ShakaNamespace };

interface AudioPlayerProps {
	onHeightChange?: (height: number) => void;
	headless?: boolean;
}

const PRELOAD_THRESHOLD_SECONDS = 12;
const hiResQualities = new Set<AudioQuality>(['HI_RES_LOSSLESS']);

function getCacheKey(trackId: number, quality: AudioQuality) {
	return `${trackId}:${quality}`;
}

function isHiResQuality(quality: AudioQuality | undefined): boolean {
	return quality ? hiResQualities.has(quality) : false;
}

function formatSampleRate(value?: number | null): string | null {
	if (!Number.isFinite(value ?? NaN) || !value || value <= 0) {
		return null;
	}
	const kilohertz = value / 1000;
	const precision =
		kilohertz >= 100 || Math.abs(kilohertz - Math.round(kilohertz)) < 0.05 ? 0 : 1;
	const formatted = kilohertz.toFixed(precision).replace(/\.0$/, '');
	return `${formatted} kHz`;
}

function formatBitDepth(value?: number | null): string | null {
	if (!Number.isFinite(value ?? NaN) || !value || value <= 0) {
		return null;
	}
	return `${value}-bit`;
}

function formatMegabytes(bytes?: number | null): string | null {
	if (!Number.isFinite(bytes ?? NaN) || !bytes || bytes <= 0) {
		return null;
	}
	const value = bytes / (1024 * 1024);
	const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2;
	return `${value.toFixed(digits)} MB`;
}

function formatPercent(value: number | null | undefined): string {
	if (!Number.isFinite(value ?? NaN)) {
		return '0%';
	}
	const percent = Math.max(0, Math.min(100, Math.round((value ?? 0) * 100)));
	return `${percent}%`;
}

function formatTransferStatus(received: number, total?: number): string {
	const receivedLabel = formatMegabytes(received) ?? '0 MB';
	const totalLabel = formatMegabytes(total) ?? null;
	return totalLabel ? `${receivedLabel} / ${totalLabel}` : receivedLabel;
}

function formatTime(seconds: number): string {
	if (isNaN(seconds)) return '0:00';
	const mins = Math.floor(seconds / 60);
	const secs = Math.floor(seconds % 60);
	return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatQualityLabel(quality?: string): string {
	if (!quality) return '—';
	const normalized = quality.toUpperCase();
	if (normalized === 'LOSSLESS') {
		return 'CD';
	}
	if (normalized === 'HI_RES_LOSSLESS') {
		return 'Hi-Res';
	}
	return quality;
}

const AudioPlayer: React.FC<AudioPlayerProps> = ({ onHeightChange, headless = false }) => {
	const dispatch = useAppDispatch();
	const playerState = useAppSelector((state) => state.player);
	const lyricsState = useAppSelector((state) => state.lyrics);
	const downloadUiState = useAppSelector((state) => state.downloadUi);
	const userPreferencesState = useAppSelector((state) => state.userPreferences);

	const activeTrackDownloads = useMemo(() => {
		return downloadUiState.tasks.filter(t => t.status === 'running' || t.status === 'pending');
	}, [downloadUiState.tasks]);

	const audioElementRef = useRef<HTMLAudioElement>(null);
	const containerElementRef = useRef<HTMLDivElement>(null);
	const seekBarElementRef = useRef<HTMLButtonElement>(null);

	const [streamUrl, setStreamUrl] = useState('');
	const [isMuted, setIsMuted] = useState(false);
	const [previousVolume, setPreviousVolume] = useState(0.8);
	const [currentTrackId, setCurrentTrackId] = useState<number | null>(null);
	const loadSequenceRef = useRef(0);
	const [bufferedPercent, setBufferedPercent] = useState(0);
	const [lastQualityTrackId, setLastQualityTrackId] = useState<number | string | null>(null);
	const [lastQualityForTrack, setLastQualityForTrack] = useState<AudioQuality | null>(null);
	const [currentPlaybackQuality, setCurrentPlaybackQuality] = useState<AudioQuality | null>(null);
	const [isDownloadingCurrentTrack, setIsDownloadingCurrentTrack] = useState(false);
	const [showQueuePanel, setShowQueuePanel] = useState(false);
	const [dashPlaybackActive, setDashPlaybackActive] = useState(false);
	const [dashFallbackAttemptedTrackId, setDashFallbackAttemptedTrackId] = useState<number | string | null>(null);
	const [dashFallbackInFlight, setDashFallbackInFlight] = useState(false);

	const streamCacheRef = useRef(new Map<string, { url: string; replayGain: number | null; sampleRate: number | null; bitDepth: number | null }>());
	const preloadingCacheKeyRef = useRef<string | null>(null);
	const dashManifestCacheRef = useRef(new Map<string, DashManifestWithMetadata>());
	const shakaNamespaceRef = useRef<ShakaNamespace | null>(null);
	const shakaPlayerRef = useRef<ShakaPlayerInstance | null>(null);
	const hiResObjectUrlRef = useRef<string | null>(null);
	const shakaNetworkingConfiguredRef = useRef(false);
	const convertingTracksRef = useRef(new Set<string>());
	const mediaSessionTrackIdRef = useRef<number | string | null>(null);
	const lastKnownPlaybackStateRef = useRef<'none' | 'paused' | 'playing'>('none');
	const resizeObserverRef = useRef<ResizeObserver | null>(null);

	const sampleRateLabel = formatSampleRate(playerState.sampleRate);
	const bitDepthLabel = formatBitDepth(playerState.bitDepth);
	const isFirefox = typeof navigator !== 'undefined' && /firefox/i.test(navigator.userAgent);
	const canUseMediaSession = typeof navigator !== 'undefined' && 'mediaSession' in navigator;

	const revokeHiResObjectUrl = useCallback(() => {
		if (hiResObjectUrlRef.current) {
			URL.revokeObjectURL(hiResObjectUrlRef.current);
			hiResObjectUrlRef.current = null;
		}
	}, []);

	const destroyShakaPlayer = useCallback(async () => {
		revokeHiResObjectUrl();
		if (shakaPlayerRef.current) {
			try {
				await shakaPlayerRef.current.destroy();
			} catch (error) {
				console.debug('Failed to destroy Shaka player', error);
			}
			shakaPlayerRef.current = null;
		}
		shakaNetworkingConfiguredRef.current = false;
		setDashPlaybackActive(false);
	}, [revokeHiResObjectUrl]);

	const ensureShakaPlayer = useCallback(async (): Promise<ShakaPlayerInstance> => {
		if (!audioElementRef.current) {
			throw new Error('Audio element not ready for Shaka initialization');
		}
		if (!shakaNamespaceRef.current) {
			const module = await import('shaka-player/dist/shaka-player.compiled.js');
			const resolved =
				(module as ShakaModule | { default: ShakaNamespace }).default ??
				(module as unknown as ShakaNamespace);
			shakaNamespaceRef.current = resolved;
			if (shakaNamespaceRef.current?.polyfill?.installAll) {
				try {
					shakaNamespaceRef.current.polyfill.installAll();
				} catch (error) {
					console.debug('Shaka polyfill installation failed', error);
				}
			}
		}
		if (!shakaNamespaceRef.current) {
			throw new Error('Shaka namespace unavailable');
		}
		if (!shakaPlayerRef.current) {
			shakaPlayerRef.current = new shakaNamespaceRef.current.Player(audioElementRef.current);
			const networking = shakaPlayerRef.current.getNetworkingEngine?.();
			if (networking && !shakaNetworkingConfiguredRef.current) {
				networking.registerRequestFilter((_type, request) => {
					if (request.method === 'HEAD') {
						request.method = 'GET';
					}
					if (Array.isArray(request.uris)) {
						request.uris = request.uris.map((uri) => getProxiedUrl(uri));
					}
				});
				shakaNetworkingConfiguredRef.current = true;
			}
		}
		audioElementRef.current.crossOrigin = 'anonymous';
		return shakaPlayerRef.current!;
	}, []);

	const cacheFlacFallback = useCallback((trackId: number, result: DashManifestResult | DashManifestWithMetadata) => {
		const manifestResult = 'result' in result ? result.result : result;
		const trackInfo = 'trackInfo' in result ? result.trackInfo : null;

		if (manifestResult.kind !== 'flac') {
			return;
		}
		const fallbackUrl = manifestResult.urls.find(
			(candidate) => typeof candidate === 'string' && candidate.length > 0
		);
		if (!fallbackUrl) {
			return;
		}
		const proxied = getProxiedUrl(fallbackUrl);
		streamCacheRef.current.set(getCacheKey(trackId, 'LOSSLESS'), {
			url: proxied,
			replayGain: trackInfo?.replayGain ?? null,
			sampleRate: trackInfo?.sampleRate ?? null,
			bitDepth: trackInfo?.bitDepth ?? null
		});
	}, []);

	const pruneDashManifestCache = useCallback(() => {
		const keepKeys = new Set<string>();
		const dashQuality: AudioQuality = 'HI_RES_LOSSLESS';
		const current = playerState.currentTrack;
		if (current && !isSonglinkTrack(current)) {
			keepKeys.add(getCacheKey(current.id, dashQuality));
		}
		const { queue, queueIndex } = playerState;
		const nextTrack = queue[queueIndex + 1];
		if (nextTrack && !isSonglinkTrack(nextTrack)) {
			keepKeys.add(getCacheKey(nextTrack.id, dashQuality));
		}
		for (const key of dashManifestCacheRef.current.keys()) {
			if (!keepKeys.has(key)) {
				dashManifestCacheRef.current.delete(key);
			}
		}
	}, [playerState]);

	const resolveStream = useCallback(async (
		track: Track,
		overrideQuality?: AudioQuality
	): Promise<{
		url: string;
		replayGain: number | null;
		sampleRate: number | null;
		bitDepth: number | null;
	}> => {
		const quality = overrideQuality ?? playerState.quality;
		if (isHiResQuality(quality)) {
			throw new Error('Attempted to resolve hi-res stream via standard resolver');
		}
		const cacheKey = getCacheKey(track.id, quality);
		const cached = streamCacheRef.current.get(cacheKey);
		if (cached) {
			return cached;
		}

		const data = await losslessAPI.getStreamData(track.id, quality);
		const proxied = getProxiedUrl(data.url);
		const entry = {
			url: proxied,
			replayGain: data.replayGain,
			sampleRate: data.sampleRate,
			bitDepth: data.bitDepth
		};
		streamCacheRef.current.set(cacheKey, entry);
		return entry;
	}, [playerState.quality]);

	const pruneStreamCache = useCallback(() => {
		const quality = playerState.quality;
		const keepKeys = new Set<string>();
		const baseQualities: AudioQuality[] = isHiResQuality(quality) ? ['LOSSLESS'] : [quality];
		const current = playerState.currentTrack;
		if (current && !isSonglinkTrack(current)) {
			for (const base of baseQualities) {
				keepKeys.add(getCacheKey(current.id, base));
			}
		}
		const { queue, queueIndex } = playerState;
		const nextTrack = queue[queueIndex + 1];
		if (nextTrack && !isSonglinkTrack(nextTrack)) {
			for (const base of baseQualities) {
				keepKeys.add(getCacheKey(nextTrack.id, base));
			}
		}

		for (const key of streamCacheRef.current.keys()) {
			if (!keepKeys.has(key)) {
				streamCacheRef.current.delete(key);
			}
		}
	}, [playerState]);

	const preloadDashManifest = useCallback(async (track: Track) => {
		const cacheKey = getCacheKey(track.id, 'HI_RES_LOSSLESS');
		if (dashManifestCacheRef.current.has(cacheKey) || preloadingCacheKeyRef.current === cacheKey) {
			const cached = dashManifestCacheRef.current.get(cacheKey);
			if (cached) {
				cacheFlacFallback(track.id, cached.result);
			}
			return;
		}

		preloadingCacheKeyRef.current = cacheKey;
		try {
			const result = await losslessAPI.getDashManifestWithMetadata(track.id, 'HI_RES_LOSSLESS');
			dashManifestCacheRef.current.set(cacheKey, result);
			cacheFlacFallback(track.id, result.result);
			pruneDashManifestCache();
		} catch (error) {
			console.warn('Failed to preload dash manifest:', error);
		} finally {
			if (preloadingCacheKeyRef.current === cacheKey) {
				preloadingCacheKeyRef.current = null;
			}
		}
	}, [cacheFlacFallback, pruneDashManifestCache]);

	const preloadNextTrack = useCallback(async (track: Track) => {
		const cacheKey = getCacheKey(track.id, 'HI_RES_LOSSLESS');
		if (dashManifestCacheRef.current.has(cacheKey) || preloadingCacheKeyRef.current === cacheKey) {
			return;
		}
		await preloadDashManifest(track);
	}, [preloadDashManifest]);

	const maybePreloadNextTrack = useCallback((remainingSeconds: number) => {
		if (remainingSeconds > PRELOAD_THRESHOLD_SECONDS) {
			return;
		}
		const { queue, queueIndex } = playerState;
		const nextTrack = queue[queueIndex + 1];
		if (!nextTrack || isSonglinkTrack(nextTrack)) {
			return;
		}
		const dashKey = getCacheKey(nextTrack.id, 'HI_RES_LOSSLESS');
		if (dashManifestCacheRef.current.has(dashKey) || preloadingCacheKeyRef.current === dashKey) {
			return;
		}
		preloadNextTrack(nextTrack);
	}, [playerState, preloadNextTrack]);

	const convertSonglinkTrackToTidal = useCallback(async (songlinkTrack: SonglinkTrack): Promise<Track> => {
		console.log('Converting SonglinkTrack to TIDAL:', songlinkTrack.title);

		if (songlinkTrack.tidalId) {
			try {
				const trackLookup = await losslessAPI.getTrack(songlinkTrack.tidalId);
				if (trackLookup?.track) {
					return trackLookup.track;
				}
			} catch (e) {
				console.warn('Failed to fetch track using pre-calculated tidalId, falling back to extraction', e);
			}
		}

		const tidalInfo = extractTidalInfo(songlinkTrack.songlinkData);

		if (!tidalInfo || tidalInfo.type !== 'track') {
			console.warn('No TIDAL track in Songlink data, attempting conversion...');
			const fallbackTidalInfo = await convertToTidal(songlinkTrack.sourceUrl, {
				userCountry: 'US',
				songIfSingle: true
			});

			if (!fallbackTidalInfo || fallbackTidalInfo.type !== 'track') {
				throw new Error(`Could not find TIDAL equivalent for: ${songlinkTrack.title}`);
			}

			const trackId = Number(fallbackTidalInfo.id);
			if (!Number.isFinite(trackId) || trackId <= 0) {
				throw new Error(`Invalid TIDAL track ID for: ${songlinkTrack.title} (got: ${fallbackTidalInfo.id})`);
			}

			const trackLookup = await losslessAPI.getTrack(trackId);
			if (!trackLookup?.track) {
				throw new Error(`Failed to fetch TIDAL track for: ${songlinkTrack.title}`);
			}

			return trackLookup.track;
		}

		const trackId = Number(tidalInfo.id);
		if (!Number.isFinite(trackId) || trackId <= 0) {
			console.warn(`Non-numeric TIDAL ID (${tidalInfo.id}), attempting fallback conversion...`);
			const fallbackTidalInfo = await convertToTidal(songlinkTrack.sourceUrl, {
				userCountry: 'US',
				songIfSingle: true
			});

			if (!fallbackTidalInfo || fallbackTidalInfo.type !== 'track') {
				throw new Error(`Could not find TIDAL equivalent for: ${songlinkTrack.title}`);
			}

			const fallbackId = Number(fallbackTidalInfo.id);
			if (!Number.isFinite(fallbackId) || fallbackId <= 0) {
				throw new Error(`No valid TIDAL track found for: ${songlinkTrack.title}`);
			}

			const trackLookup = await losslessAPI.getTrack(fallbackId);
			if (!trackLookup?.track) {
				throw new Error(`Failed to fetch TIDAL track for: ${songlinkTrack.title}`);
			}

			return trackLookup.track;
		}

		const trackLookup = await losslessAPI.getTrack(trackId);
		if (!trackLookup?.track) {
			throw new Error(`Failed to fetch TIDAL track for: ${songlinkTrack.title}`);
		}

		console.log('Successfully converted to TIDAL track:', trackLookup.track.title);
		return trackLookup.track;
	}, []);

	const loadStandardTrack = useCallback(async (track: Track, quality: AudioQuality, sequence: number) => {
		await destroyShakaPlayer();
		setDashPlaybackActive(false);
		const { url, replayGain, sampleRate, bitDepth } = await resolveStream(track, quality);
		if (sequence !== loadSequenceRef.current) return;
		setStreamUrl(url);
		setCurrentPlaybackQuality(quality);
		dispatch(setReplayGain(replayGain));
		dispatch(setSampleRate(sampleRate));
		dispatch(setBitDepth(bitDepth));
		pruneStreamCache();
		if (audioElementRef.current) {
			audioElementRef.current.crossOrigin = 'anonymous';
			audioElementRef.current.load();
		}
	}, [destroyShakaPlayer, resolveStream, dispatch, pruneStreamCache]);

	const loadDashTrack = useCallback(async (
		track: Track,
		quality: AudioQuality,
		sequence: number
	): Promise<DashManifestWithMetadata> => {
		const cacheKey = getCacheKey(track.id, quality);
		let cached = dashManifestCacheRef.current.get(cacheKey);
		if (!cached) {
			cached = await losslessAPI.getDashManifestWithMetadata(track.id, quality);
			dashManifestCacheRef.current.set(cacheKey, cached);
		}
		const { result: manifestResult, trackInfo } = cached;
		cacheFlacFallback(track.id, manifestResult);
		if (manifestResult.kind === 'flac') {
			setDashPlaybackActive(false);
			return cached;
		}
		revokeHiResObjectUrl();
		const blob = new Blob([manifestResult.manifest], {
			type: manifestResult.contentType ?? 'application/dash+xml'
		});
		hiResObjectUrlRef.current = URL.createObjectURL(blob);
		const player = await ensureShakaPlayer();

		if (sequence !== loadSequenceRef.current) {
			return cached!;
		}
		if (audioElementRef.current) {
			audioElementRef.current.pause();
			audioElementRef.current.removeAttribute('src');
			audioElementRef.current.load();
		}
		await player.unload();
		await player.load(hiResObjectUrlRef.current!);
		setDashPlaybackActive(true);
		setStreamUrl('');
		setCurrentPlaybackQuality('HI_RES_LOSSLESS');

		if (currentTrackId === track.id) {
			dispatch(setSampleRate(trackInfo.sampleRate));
			dispatch(setBitDepth(trackInfo.bitDepth));
			if (trackInfo.replayGain !== null) {
				dispatch(setReplayGain(trackInfo.replayGain));
			}
		}

		pruneDashManifestCache();
		return cached!;
	}, [cacheFlacFallback, revokeHiResObjectUrl, ensureShakaPlayer, currentTrackId, dispatch, pruneDashManifestCache]);

	const loadTrack = useCallback(async (track: PlayableTrack) => {
		if (isSonglinkTrack(track)) {
			console.error('Attempted to load SonglinkTrack directly - this should not happen!', track);
			return;
		}
		const tidalTrack = track as Track;

		const trackId = Number(tidalTrack.id);
		if (!Number.isFinite(trackId) || trackId <= 0) {
			console.error('Invalid track ID - must be numeric:', tidalTrack.id);
			return;
		}

		loadSequenceRef.current += 1;
		const sequence = loadSequenceRef.current;

		dispatch(setLoading(true));
		setBufferedPercent(0);
		setCurrentPlaybackQuality(null);
		let requestedQuality = playerState.quality;

		const trackBestQuality = deriveTrackQuality(tidalTrack);
		if (isHiResQuality(requestedQuality) && trackBestQuality && !isHiResQuality(trackBestQuality)) {
			requestedQuality = trackBestQuality;
		}

		if (dashFallbackAttemptedTrackId && dashFallbackAttemptedTrackId !== tidalTrack.id) {
			setDashFallbackAttemptedTrackId(null);
		}

		try {
			if (isHiResQuality(requestedQuality)) {
				try {
					const hiResQuality: AudioQuality = 'HI_RES_LOSSLESS';
					const dashResult = await loadDashTrack(tidalTrack, hiResQuality, sequence!);
					if (dashResult.result.kind === 'dash') {
						return;
					}
					console.info('Dash endpoint returned FLAC fallback. Using lossless stream.');
				} catch (dashError) {
					const coded = dashError as { code?: string };
					if (coded?.code === DASH_MANIFEST_UNAVAILABLE_CODE) {
						dashManifestCacheRef.current.delete(getCacheKey(tidalTrack.id, 'HI_RES_LOSSLESS'));
					}
					console.warn('DASH playback failed, falling back to lossless stream.', dashError);
				}
				await loadStandardTrack(tidalTrack, 'LOSSLESS', sequence!);
				return;
			}

			await loadStandardTrack(tidalTrack, requestedQuality, sequence!);
		} catch (error) {
			console.error('Failed to load track:', error);
			if (sequence === loadSequenceRef.current && requestedQuality !== 'LOSSLESS' && !isHiResQuality(requestedQuality)) {
				loadStandardTrack(tidalTrack, 'LOSSLESS', sequence).catch(fallbackError => {
					console.error('Secondary lossless fallback failed:', fallbackError);
				});
			}
		} finally {
			if (sequence === loadSequenceRef.current) {
				dispatch(setLoading(false));
			}
		}
	}, [playerState.quality, dashFallbackAttemptedTrackId, loadDashTrack, loadStandardTrack, dispatch]);

	useEffect(() => {
		const current = playerState.currentTrack;
		if (current && isSonglinkTrack(current)) {
			console.log('[Conversion Effect] Detected SonglinkTrack:', current.title, 'ID:', current.id);

			if (convertingTracksRef.current.has(current.id)) {
				console.log('[Conversion Effect] Track already being converted, skipping');
				return;
			}

			convertingTracksRef.current.add(current.id);
			console.log('[Conversion Effect] Starting conversion for:', current.title);

			convertSonglinkTrackToTidal(current)
				.then((tidalTrack) => {
					console.log('[Conversion Effect] Conversion SUCCESS:', tidalTrack.title, 'TIDAL ID:', tidalTrack.id);
					// Need to check if it's still the current track, but we don't have a ref to the latest state here easily.
					// We'll just dispatch and let the reducer handle it if it's still relevant, or we can check the store state.
					// For simplicity, we'll just dispatch setTrack.
					dispatch(setTrack(tidalTrack));
				})
				.catch((error) => {
					console.error('[Conversion Effect] Conversion FAILED:', error);
					alert(`Failed to play track: ${error instanceof Error ? error.message : 'Unknown error'}`);
				})
				.finally(() => {
					convertingTracksRef.current.delete(current.id);
					console.log('[Conversion Effect] Finished conversion attempt for:', current.title);
				});
		}
	}, [playerState.currentTrack, convertSonglinkTrackToTidal, dispatch]);

	useEffect(() => {
		const current = playerState.currentTrack;
		if (!audioElementRef.current || !current) {
			if (!current) {
				setCurrentTrackId(null);
				setStreamUrl('');
				setBufferedPercent(0);
				setDashPlaybackActive(false);
				setDashFallbackAttemptedTrackId(null);
				setDashFallbackInFlight(false);
				setLastQualityTrackId(null);
				setLastQualityForTrack(null);
				setCurrentPlaybackQuality(null);
			}
		} else if (current.id !== currentTrackId) {
			if (isSonglinkTrack(current)) {
				return;
			}

			setCurrentTrackId(current.id as number);
			setStreamUrl('');
			setBufferedPercent(0);
			setDashPlaybackActive(false);
			setDashFallbackAttemptedTrackId(null);
			setDashFallbackInFlight(false);
			setLastQualityTrackId(current.id);
			setLastQualityForTrack(playerState.quality);
			setCurrentPlaybackQuality(null);
			loadTrack(current);
		}
	}, [playerState.currentTrack, currentTrackId, playerState.quality, loadTrack]);

	useEffect(() => {
		const track = playerState.currentTrack;
		if (!audioElementRef.current || !track) {
			return;
		}
		const quality = playerState.quality;
		if (lastQualityTrackId === track.id && lastQualityForTrack === quality) {
			return;
		}
		setLastQualityTrackId(track.id);
		setLastQualityForTrack(quality);
		loadTrack(track);
	}, [playerState.currentTrack, playerState.quality, lastQualityTrackId, lastQualityForTrack, loadTrack]);

	useEffect(() => {
		if (showQueuePanel && playerState.queue.length === 0) {
			setShowQueuePanel(false);
		}
	}, [showQueuePanel, playerState.queue.length]);

	const getMediaSessionArtwork = useCallback((track: PlayableTrack) => {
		if (isSonglinkTrack(track)) {
			if (track.thumbnailUrl) {
				return [{
					src: track.thumbnailUrl,
					sizes: '640x640',
					type: 'image/jpeg'
				}];
			}
			return [];
		}

		if (!track.album?.cover) {
			return [];
		}

		const sizes = ['80', '160', '320', '640', '1280'] as const;
		const artwork: MediaImage[] = [];

		for (const size of sizes) {
			const src = losslessAPI.getCoverUrl(track.album.cover, size);
			if (src) {
				artwork.push({
					src,
					sizes: `${size}x${size}`,
					type: 'image/jpeg'
				});
			}
		}

		return artwork;
	}, []);

	const updateMediaSessionPositionState = useCallback(() => {
		if (
			!canUseMediaSession ||
			!audioElementRef.current ||
			typeof navigator.mediaSession.setPositionState !== 'function'
		) {
			return;
		}

		const durationFromAudio = audioElementRef.current.duration;
		const duration = Number.isFinite(durationFromAudio) ? durationFromAudio : playerState.duration;

		try {
			navigator.mediaSession.setPositionState({
				duration: Number.isFinite(duration) ? duration : 0,
				playbackRate: audioElementRef.current.playbackRate ?? 1,
				position: audioElementRef.current.currentTime
			});
		} catch (error) {
			console.debug('Unable to set Media Session position state', error);
		}
	}, [canUseMediaSession, playerState.duration]);

	const updateMediaSessionMetadata = useCallback((track: PlayableTrack | null) => {
		if (!canUseMediaSession) {
			return;
		}

		if (!track) {
			mediaSessionTrackIdRef.current = null;
			lastKnownPlaybackStateRef.current = 'none';
			try {
				navigator.mediaSession.metadata = null;
				navigator.mediaSession.playbackState = 'none';
			} catch (error) {
				console.debug('Media Session reset failed', error);
			}
			return;
		}

		if (mediaSessionTrackIdRef.current === track.id) {
			return;
		}

		mediaSessionTrackIdRef.current = track.id;

		try {
			navigator.mediaSession.metadata = new MediaMetadata({
				title: track.title,
				artist: isSonglinkTrack(track) ? track.artistName : formatArtists(track.artists),
				album: isSonglinkTrack(track) ? '' : (track.album?.title ?? ''),
				artwork: getMediaSessionArtwork(track)
			});
		} catch (error) {
			console.debug('Unable to set Media Session metadata', error);
		}

		updateMediaSessionPositionState();
	}, [canUseMediaSession, getMediaSessionArtwork, updateMediaSessionPositionState]);

	const updateMediaSessionPlaybackState = useCallback((state: 'playing' | 'paused' | 'none') => {
		if (!canUseMediaSession) {
			return;
		}

		if (lastKnownPlaybackStateRef.current === state) {
			return;
		}
		lastKnownPlaybackStateRef.current = state;

		try {
			navigator.mediaSession.playbackState = state;
		} catch (error) {
			console.debug('Unable to set Media Session playback state', error);
		}
	}, [canUseMediaSession]);

	useEffect(() => {
		if (canUseMediaSession) {
			updateMediaSessionMetadata(playerState.currentTrack);
		}
	}, [playerState.currentTrack, canUseMediaSession, updateMediaSessionMetadata]);

	useEffect(() => {
		if (canUseMediaSession) {
			const hasTrack = Boolean(playerState.currentTrack);
			updateMediaSessionPlaybackState(
				hasTrack ? (playerState.isPlaying ? 'playing' : 'paused') : 'none'
			);
		}
	}, [playerState.currentTrack, playerState.isPlaying, canUseMediaSession, updateMediaSessionPlaybackState]);

	useEffect(() => {
		if (audioElementRef.current) {
			const baseVolume = playerState.volume;
			const replayGain = playerState.replayGain;

			if (replayGain !== null && typeof replayGain === 'number') {
				const gainFactor = Math.pow(10, replayGain / 20);
				const adjusted = baseVolume * gainFactor;
				audioElementRef.current.volume = Math.min(1, Math.max(0, adjusted));
			} else {
				audioElementRef.current.volume = baseVolume;
			}
		}
	}, [playerState.volume, playerState.replayGain]);

	useEffect(() => {
		if (playerState.isPlaying && audioElementRef.current) {
			audioElementRef.current.play().catch(console.error);
		} else if (!playerState.isPlaying && audioElementRef.current) {
			audioElementRef.current.pause();
		}
	}, [playerState.isPlaying]);

	useEffect(() => {
		if (!playerState.isPlaying || !playerState.currentTrack || !audioElementRef.current) {
			return;
		}
		if (isSonglinkTrack(playerState.currentTrack)) {
			return;
		}
		if (streamUrl || dashPlaybackActive || playerState.isLoading) {
			return;
		}
		void loadTrack(playerState.currentTrack);
	}, [
		playerState.isPlaying,
		playerState.currentTrack,
		playerState.isLoading,
		streamUrl,
		dashPlaybackActive,
		loadTrack
	]);

	useEffect(() => {
		if (!playerState.isPlaying || !audioElementRef.current) {
			return;
		}
		if (!streamUrl && !dashPlaybackActive) {
			return;
		}
		audioElementRef.current.play().catch((error) => {
			console.debug('Playback retry after stream readiness failed', error);
		});
	}, [playerState.isPlaying, streamUrl, dashPlaybackActive, playerState.currentTrack]);

	const updateBufferedPercent = useCallback(() => {
		if (!audioElementRef.current) {
			setBufferedPercent(0);
			return;
		}

		const { duration, buffered, currentTime } = audioElementRef.current;
		if (!Number.isFinite(duration) || duration <= 0 || buffered.length === 0) {
			setBufferedPercent(0);
			return;
		}

		let bufferedEnd = 0;
		for (let i = 0; i < buffered.length; i += 1) {
			const start = buffered.start(i);
			const end = buffered.end(i);
			if (start <= currentTime && end >= currentTime) {
				bufferedEnd = end;
				break;
			}
			bufferedEnd = Math.max(bufferedEnd, end);
		}

		setBufferedPercent(Math.max(0, Math.min(100, (bufferedEnd / duration) * 100)));
	}, []);

	const handleTimeUpdate = useCallback(() => {
		if (audioElementRef.current) {
			dispatch(setCurrentTime(audioElementRef.current.currentTime));
			updateBufferedPercent();
			const remaining = (playerState.duration ?? 0) - audioElementRef.current.currentTime;
			maybePreloadNextTrack(remaining);
			updateMediaSessionPositionState();
		}
	}, [dispatch, updateBufferedPercent, playerState.duration, maybePreloadNextTrack, updateMediaSessionPositionState]);

	const fallbackToLosslessAfterDashError = useCallback(async (reason: string) => {
		if (dashFallbackInFlight) {
			return;
		}
		const track = playerState.currentTrack;
		if (!track) {
			return;
		}
		if (dashFallbackAttemptedTrackId === track.id) {
			return;
		}
		setDashFallbackInFlight(true);
		setDashFallbackAttemptedTrackId(track.id);
		loadSequenceRef.current += 1;
		const sequence = loadSequenceRef.current;
		console.warn(`Attempting lossless fallback after DASH playback error (${reason}).`);
		try {
			setDashPlaybackActive(false);
			dispatch(setLoading(true));
			setBufferedPercent(0);
			await loadStandardTrack(track as Track, 'LOSSLESS', sequence!);
		} catch (fallbackError) {
			console.error('Lossless fallback after DASH playback error failed', fallbackError);
			if (sequence === loadSequenceRef.current) {
				dispatch(setLoading(false));
			}
		} finally {
			setDashFallbackInFlight(false);
		}
	}, [dashFallbackInFlight, playerState.currentTrack, dashFallbackAttemptedTrackId, dispatch, loadStandardTrack]);

	const handleAudioError = useCallback((event: React.SyntheticEvent<HTMLAudioElement, Event>) => {
		if (!dashPlaybackActive || !isFirefox) {
			return;
		}
		const element = event.currentTarget;
		const mediaError = element?.error ?? null;
		const code = mediaError?.code;
		const decodeConstant = mediaError?.MEDIA_ERR_DECODE;
		const isDecodeError =
			typeof code === 'number' && typeof decodeConstant === 'number'
				? code === decodeConstant
				: false;
		const reason = isDecodeError ? 'decode error' : code ? `code ${code}` : 'unknown error';
		void fallbackToLosslessAfterDashError(reason);
	}, [dashPlaybackActive, isFirefox, fallbackToLosslessAfterDashError]);

	const handleDurationChange = useCallback(() => {
		if (audioElementRef.current) {
			dispatch(setDuration(audioElementRef.current.duration));
			updateBufferedPercent();
			updateMediaSessionPositionState();
		}
	}, [dispatch, updateBufferedPercent, updateMediaSessionPositionState]);

	const handleProgress = useCallback(() => {
		updateBufferedPercent();
	}, [updateBufferedPercent]);

	const handleLoadedData = useCallback(() => {
		dispatch(setLoading(false));
		updateBufferedPercent();

		if (audioElementRef.current && playerState.currentTime > 0 && Math.abs(audioElementRef.current.currentTime - playerState.currentTime) > 1) {
			audioElementRef.current.currentTime = playerState.currentTime;
		}

		if (playerState.isPlaying && audioElementRef.current) {
			audioElementRef.current.play().catch((error) => {
				console.debug('Playback resume on loaded data failed', error);
			});
		}

		updateMediaSessionPositionState();
	}, [dispatch, updateBufferedPercent, playerState.currentTime, playerState.isPlaying, updateMediaSessionPositionState]);

	const getPercent = (current: number, total: number): number => {
		if (!Number.isFinite(total) || total <= 0) {
			return 0;
		}
		return Math.max(0, Math.min(100, (current / total) * 100));
	};

	const handlePrevious = useCallback(() => {
		if (audioElementRef.current && (audioElementRef.current.currentTime > 5 || playerState.queueIndex <= 0)) {
			audioElementRef.current.currentTime = 0;
			dispatch(setCurrentTime(0));
			updateMediaSessionPositionState();
		} else {
			dispatch(previous());
		}
	}, [dispatch, playerState.queueIndex, updateMediaSessionPositionState]);

	const handleEnded = useCallback(() => {
		dispatch(next());
		updateMediaSessionPositionState();
	}, [dispatch, updateMediaSessionPositionState]);

	const handleSeek = useCallback((event: MouseEvent | TouchEvent | React.MouseEvent | React.TouchEvent) => {
		if (!seekBarElementRef.current) return;

		const rect = seekBarElementRef.current.getBoundingClientRect();
		const clientX = 'touches' in event ? event.touches[0].clientX : (event as MouseEvent).clientX;
		const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
		const newTime = percent * playerState.duration;

		if (audioElementRef.current) {
			audioElementRef.current.currentTime = newTime;
			dispatch(setCurrentTime(newTime));
			updateMediaSessionPositionState();
		}
	}, [playerState.duration, dispatch, updateMediaSessionPositionState]);

	const handleSeekStart = useCallback((event: React.MouseEvent | React.TouchEvent) => {
		event.preventDefault();
		handleSeek(event);

		const handleMove = (e: MouseEvent | TouchEvent) => {
			handleSeek(e);
		};

		const handleEnd = () => {
			document.removeEventListener('mousemove', handleMove as EventListener);
			document.removeEventListener('mouseup', handleEnd);
			document.removeEventListener('touchmove', handleMove as EventListener);
			document.removeEventListener('touchend', handleEnd);
		};

		document.addEventListener('mousemove', handleMove as EventListener);
		document.addEventListener('mouseup', handleEnd);
		document.addEventListener('touchmove', handleMove as EventListener);
		document.addEventListener('touchend', handleEnd);
	}, [handleSeek]);

	const handleVolumeChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
		const newVolume = parseFloat(event.target.value);
		dispatch(setVolume(newVolume));
		if (newVolume > 0 && isMuted) {
			setIsMuted(false);
		}
	}, [dispatch, isMuted]);

	const handleLyricsSeekEvent = useCallback((event: Event) => {
		const customEvent = event as CustomEvent<{ timeSeconds?: number }>;
		const targetSeconds = customEvent.detail?.timeSeconds;
		if (typeof targetSeconds !== 'number' || !audioElementRef.current) {
			return;
		}

		const seekSeconds = Math.max(0, targetSeconds);
		audioElementRef.current.currentTime = seekSeconds;
		dispatch(setCurrentTime(seekSeconds));
		updateMediaSessionPositionState();

		if (!playerState.isPlaying) {
			dispatch(play());
		}

		audioElementRef.current.play().catch(() => { });
	}, [dispatch, playerState.isPlaying, updateMediaSessionPositionState]);

	const handleDownloadCurrentTrack = useCallback(async () => {
		const track = playerState.currentTrack;
		if (!track || isDownloadingCurrentTrack || isSonglinkTrack(track)) {
			return;
		}

		const quality = playerState.quality;
		const convertAacToMp3 = userPreferencesState.convertAacToMp3;
		const downloadCoverSeperately = userPreferencesState.downloadCoversSeperately;
		const filename = buildTrackFilename(
			track.album,
			track,
			quality,
			formatArtists(track.artists),
			convertAacToMp3
		);

		const taskId = generateUUID();
		const controller = new AbortController();
		registerTrackDownloadController(taskId, controller);

		dispatch(beginTrackDownload({
			track,
			filename,
			subtitle: track.album?.title ?? track.artist?.name,
			taskId
		}));

		setIsDownloadingCurrentTrack(true);
		dispatch(skipFfmpegCountdown());

		try {
			await losslessAPI.downloadTrack(track.id, quality, filename, {
				signal: controller.signal,
				onProgress: (progress: TrackDownloadProgress) => {
					if (progress.stage === 'downloading') {
						dispatch(updateTrackProgress({
							id: taskId,
							receivedBytes: progress.receivedBytes,
							totalBytes: progress.totalBytes
						}));
					} else {
						dispatch(updateTrackStage({
							id: taskId,
							progress: progress.progress
						}));
					}
				},
				onFfmpegCountdown: ({ totalBytes }) => {
					if (typeof totalBytes === 'number') {
						dispatch(startFfmpegCountdown({ totalBytes, autoTriggered: false }));
					} else {
						dispatch(startFfmpegCountdown({ totalBytes: 0, autoTriggered: false }));
					}
				},
				onFfmpegStart: () => dispatch(startFfmpegLoading()),
				onFfmpegProgress: (value) => dispatch(updateFfmpegProgress(value)),
				onFfmpegComplete: () => dispatch(completeFfmpeg()),
				onFfmpegError: (error) => dispatch(errorFfmpeg(error instanceof Error ? error.message : typeof error === 'string' ? error : 'Failed to load FFmpeg')),
				ffmpegAutoTriggered: false,
				convertAacToMp3,
				downloadCoverSeperately
			});
			dispatch(completeTrackDownload(taskId));
		} catch (error) {
			if (error instanceof DOMException && error.name === 'AbortError') {
				dispatch(completeTrackDownload(taskId));
			} else {
				console.error('Failed to download track:', error);
				const fallbackMessage = 'Failed to download track. Please try again.';
				const message = error instanceof Error && error.message ? error.message : fallbackMessage;
				dispatch(errorTrackDownload({ id: taskId, error: message }));
				alert(message);
			}
		} finally {
			releaseTrackDownloadController(taskId);
			setIsDownloadingCurrentTrack(false);
		}
	}, [playerState.currentTrack, isDownloadingCurrentTrack, playerState.quality, userPreferencesState.convertAacToMp3, userPreferencesState.downloadCoversSeperately, dispatch]);

	const toggleMute = useCallback(() => {
		if (isMuted) {
			dispatch(setVolume(previousVolume));
			setIsMuted(false);
		} else {
			setPreviousVolume(playerState.volume);
			dispatch(setVolume(0));
			setIsMuted(true);
		}
	}, [isMuted, previousVolume, playerState.volume, dispatch]);

	useEffect(() => {
		if (downloadUiState.ffmpeg.phase === 'ready') {
			const timeout = setTimeout(() => {
				dispatch(dismissFfmpeg());
			}, 3200);
			return () => clearTimeout(timeout);
		}
	}, [downloadUiState.ffmpeg.phase, dispatch]);

	const notifyContainerHeight = useCallback(() => {
		if (typeof onHeightChange === 'function' && containerElementRef.current) {
			const height = containerElementRef.current.offsetHeight ?? 0;
			onHeightChange(height);
			if (typeof document !== 'undefined') {
				document.documentElement.style.setProperty('--player-height', `${height}px`);
			}
		}
	}, [onHeightChange]);

	useEffect(() => {
		if (audioElementRef.current) {
			audioElementRef.current.volume = playerState.volume;
		}

		if (containerElementRef.current) {
			notifyContainerHeight();
			resizeObserverRef.current = new ResizeObserver(() => {
				notifyContainerHeight();
			});
			resizeObserverRef.current.observe(containerElementRef.current);
		}

		if (canUseMediaSession) {
			const safeSetActionHandler = (
				action: MediaSessionAction,
				handler: MediaSessionActionHandler | null
			) => {
				try {
					navigator.mediaSession.setActionHandler(action, handler);
				} catch (error) {
					console.debug(`Media Session action ${action} unsupported`, error);
				}
			};

			safeSetActionHandler('play', async () => {
				dispatch(play());
				if (!audioElementRef.current) return;
				try {
					await audioElementRef.current.play();
				} catch (error) {
					console.debug('Media Session play failed', error);
				}
				updateMediaSessionPlaybackState('playing');
				updateMediaSessionPositionState();
			});

			safeSetActionHandler('pause', () => {
				dispatch(pause());
				audioElementRef.current?.pause();
				updateMediaSessionPlaybackState('paused');
				updateMediaSessionPositionState();
			});

			safeSetActionHandler('previoustrack', () => {
				handlePrevious();
			});

			safeSetActionHandler('nexttrack', () => {
				dispatch(next());
			});

			const handleSeekDelta =
				(direction: 'forward' | 'backward') => (details: MediaSessionActionDetails) => {
					if (!audioElementRef.current) return;
					const offset = details.seekOffset ?? 10;
					const delta = direction === 'forward' ? offset : -offset;
					const tentative = audioElementRef.current.currentTime + delta;
					const duration = audioElementRef.current.duration;
					const bounded = Number.isFinite(duration)
						? Math.min(Math.max(0, tentative), Math.max(duration, 0))
						: Math.max(0, tentative);
					audioElementRef.current.currentTime = bounded;
					dispatch(setCurrentTime(bounded));
					updateMediaSessionPositionState();
				};

			safeSetActionHandler('seekforward', handleSeekDelta('forward'));
			safeSetActionHandler('seekbackward', handleSeekDelta('backward'));

			safeSetActionHandler('seekto', (details) => {
				if (!audioElementRef.current || details.seekTime === undefined) return;
				const nextTime = Math.max(0, details.seekTime);
				audioElementRef.current.currentTime = nextTime;
				dispatch(setCurrentTime(nextTime));
				updateMediaSessionPositionState();
			});

			safeSetActionHandler('stop', () => {
				dispatch(pause());
				if (audioElementRef.current) {
					audioElementRef.current.pause();
					audioElementRef.current.currentTime = 0;
				}
				dispatch(setCurrentTime(0));
				updateMediaSessionPlaybackState('paused');
				updateMediaSessionPositionState();
			});

			updateMediaSessionMetadata(playerState.currentTrack);
			updateMediaSessionPlaybackState(
				playerState.currentTrack ? (playerState.isPlaying ? 'playing' : 'paused') : 'none'
			);
			updateMediaSessionPositionState();
		}

		if (typeof window !== 'undefined') {
			window.addEventListener('lyrics:seek', handleLyricsSeekEvent as EventListener);
		}

		return () => {
			resizeObserverRef.current?.disconnect();
			if (typeof window !== 'undefined') {
				window.removeEventListener('lyrics:seek', handleLyricsSeekEvent as EventListener);
			}
			destroyShakaPlayer().catch((error) => {
				console.debug('Shaka cleanup failed', error);
			});
			if (canUseMediaSession) {
				try {
					navigator.mediaSession.metadata = null;
					navigator.mediaSession.playbackState = 'none';
					const actions: MediaSessionAction[] = [
						'play',
						'pause',
						'previoustrack',
						'nexttrack',
						'seekforward',
						'seekbackward',
						'seekto',
						'stop'
					];
					for (const action of actions) {
						navigator.mediaSession.setActionHandler(action, null);
					}
				} catch (error) {
					console.debug('Failed to clean up Media Session', error);
				}
			}
		};
	}, [dispatch, handlePrevious, updateMediaSessionPlaybackState, updateMediaSessionPositionState, updateMediaSessionMetadata, canUseMediaSession, handleLyricsSeekEvent, destroyShakaPlayer, playerState.volume, notifyContainerHeight, playerState.currentTrack, playerState.isPlaying]);

	const asTrack = (track: PlayableTrack): Track => {
		return track as Track;
	};

	return (
		<>
			<audio
				ref={audioElementRef}
				src={streamUrl || undefined}
				onTimeUpdate={handleTimeUpdate}
				onDurationChange={handleDurationChange}
				onEnded={handleEnded}
				onLoadedData={handleLoadedData}
				onLoadedMetadata={updateBufferedPercent}
				onProgress={handleProgress}
				onError={handleAudioError}
				className="hidden"
			></audio>

			{!headless && (
				<div
					className="audio-player-backdrop fixed inset-x-0 bottom-0 z-50 px-4 pt-16 pb-5 sm:px-6 sm:pt-16 sm:pb-6"
					ref={containerElementRef}
				>
					<div className="relative mx-auto w-full max-w-screen-2xl">
						{(downloadUiState.ffmpeg.phase !== 'idle' || activeTrackDownloads.length > 0) && (
							<div className="pointer-events-none absolute top-0 right-0 left-0 -translate-y-full transform pb-4">
								<div className="mx-auto flex w-full max-w-2xl flex-col gap-2 px-4">
									{downloadUiState.ffmpeg.phase !== 'idle' && (
										<div className="ffmpeg-banner pointer-events-auto rounded-2xl border px-4 py-3 text-sm text-blue-100 shadow-xl">
											<div className="flex items-start gap-3">
												<div className="min-w-0 flex-1">
													<p className="leading-5 font-semibold text-blue-50">
														Downloading FFmpeg
														{formatMegabytes(downloadUiState.ffmpeg.totalBytes) && (
															<span className="text-blue-100/80">
																({formatMegabytes(downloadUiState.ffmpeg.totalBytes)})
															</span>
														)}
													</p>
													{downloadUiState.ffmpeg.phase === 'countdown' ? (
														<p className="mt-1 text-xs text-blue-100/80">
															Starting in {downloadUiState.ffmpeg.countdownSeconds} seconds…
														</p>
													) : downloadUiState.ffmpeg.phase === 'loading' ? (
														<p className="mt-1 text-xs text-blue-100/80">
															Preparing encoder… {formatPercent(downloadUiState.ffmpeg.progress)}
														</p>
													) : downloadUiState.ffmpeg.phase === 'ready' ? (
														<p className="mt-1 text-xs text-blue-100/80">FFmpeg is ready to use.</p>
													) : downloadUiState.ffmpeg.phase === 'error' ? (
														<p className="mt-1 text-xs text-red-200">
															{downloadUiState.ffmpeg.error ?? 'Failed to load FFmpeg.'}
														</p>
													) : null}
												</div>
												{downloadUiState.ffmpeg.dismissible && (
													<button
														onClick={() => dispatch(dismissFfmpeg())}
														className="rounded-full p-1 text-blue-100/70 transition-colors hover:bg-blue-500/20 hover:text-blue-50"
														aria-label="Dismiss FFmpeg download"
													>
														<X size={16} />
													</button>
												)}
											</div>
											{downloadUiState.ffmpeg.phase === 'loading' && (
												<div className="mt-3 h-1.5 overflow-hidden rounded-full bg-blue-500/20">
													<div
														className="h-full rounded-full bg-blue-400 transition-all duration-200"
														style={{ width: `${Math.min(Math.max(downloadUiState.ffmpeg.progress * 100, 6), 100)}%` }}
													></div>
												</div>
											)}
										</div>
									)}

									{activeTrackDownloads.map((task) => (
										<div
											key={task.id}
											className="download-popup pointer-events-auto rounded-2xl border px-4 py-3 text-sm text-gray-100 shadow-xl"
										>
											<div className="flex items-start gap-3">
												<div className="flex min-w-0 flex-1 flex-col gap-1">
													<p className="flex items-center gap-2 text-sm font-semibold text-gray-50">
														{task.progress < 0.02 ? (
															<LoaderCircle size={16} className="animate-spin text-blue-300" />
														) : (
															<Download size={16} className="text-blue-300" />
														)}
														<span className="truncate">{task.title}</span>
													</p>
													{task.subtitle && (
														<p className="truncate text-xs text-gray-400">{task.subtitle}</p>
													)}
													<div className="flex flex-wrap items-center gap-2 text-xs text-gray-400">
														<span>{formatTransferStatus(task.receivedBytes, task.totalBytes)}</span>
														<span aria-hidden="true">•</span>
														<span>{formatPercent(task.progress)}</span>
													</div>
												</div>
												<button
													onClick={() => {
														if (task.cancellable) {
															abortTrackDownloadController(task.id);
															dispatch(cancelTrackDownload(task.id));
															return;
														}
														dispatch(dismissTrackTask(task.id));
													}}
													className="rounded-full p-1 text-gray-400 transition-colors hover:bg-gray-800 hover:text-white"
													aria-label={task.cancellable
														? `Cancel download for ${task.title}`
														: `Dismiss download for ${task.title}`}
												>
													<X size={16} />
												</button>
											</div>
											<div className="mt-3 h-1.5 overflow-hidden rounded-full bg-gray-800">
												<div
													className="h-full rounded-full bg-blue-500 transition-all duration-200"
													style={{ width: `${Math.min(Math.max(task.progress * 100, 4), 100)}%` }}
												></div>
											</div>
										</div>
									))}
								</div>
							</div>
						)}
						<div className="audio-player-glass overflow-hidden rounded-2xl border shadow-2xl">
							<div className="relative px-4 py-3">
								{playerState.currentTrack ? (
									<>
										{/* Progress Bar */}
										<div className="mb-3">
											<button
												ref={seekBarElementRef}
												onMouseDown={handleSeekStart}
												onTouchStart={handleSeekStart}
												className="group relative h-1 w-full cursor-pointer overflow-hidden rounded-full bg-gray-700"
												type="button"
												aria-label="Seek position"
											>
												<div
													className="pointer-events-none absolute inset-y-0 left-0 bg-blue-400/30 transition-all"
													style={{ width: `${bufferedPercent}%` }}
													aria-hidden="true"
												></div>
												<div
													className="pointer-events-none absolute inset-y-0 left-0 bg-blue-500 transition-all"
													style={{ width: `${getPercent(playerState.currentTime, playerState.duration)}%` }}
													aria-hidden="true"
												></div>
												<div
													className="pointer-events-none absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-blue-500 opacity-0 transition-opacity group-hover:opacity-100"
													style={{ left: `${getPercent(playerState.currentTime, playerState.duration)}%` }}
													aria-hidden="true"
												></div>
											</button>
											<div className="mt-1 flex justify-between text-xs text-gray-400">
												<span>{formatTime(playerState.currentTime)}</span>
												<span>{formatTime(playerState.duration)}</span>
											</div>
										</div>

										<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
											{/* Track Info */}
											<div className="flex min-w-0 items-center gap-3 sm:flex-1">
												{!isSonglinkTrack(playerState.currentTrack) && (
													<>
														{asTrack(playerState.currentTrack).album.videoCover ? (
															<video
																src={losslessAPI.getVideoCoverUrl(asTrack(playerState.currentTrack).album.videoCover!, '640')}
																autoPlay
																loop
																muted
																playsInline
																className="h-16 w-16 flex-shrink-0 rounded-md object-cover"
															></video>
														) : asTrack(playerState.currentTrack).album.cover ? (
															<img
																src={losslessAPI.getCoverUrl(asTrack(playerState.currentTrack).album.cover!, '640')}
																alt={playerState.currentTrack.title}
																className="h-16 w-16 flex-shrink-0 rounded-md object-cover"
															/>
														) : null}
													</>
												)}
												<div className="min-w-0 flex-1">
													<h3 className="truncate font-semibold text-white w-full">
														{playerState.currentTrack.title}
														{!isSonglinkTrack(playerState.currentTrack) && asTrack(playerState.currentTrack).version ? ` (${asTrack(playerState.currentTrack).version})` : ''}
													</h3>
													{isSonglinkTrack(playerState.currentTrack) ? (
														<p className="truncate text-sm text-gray-400 w-full">
															{playerState.currentTrack.artistName}
														</p>
													) : (
														<>
															<a
																href={`/artist/${asTrack(playerState.currentTrack).artist.id}`}
																className="truncate text-sm text-gray-400 hover:text-blue-400 hover:underline inline-block w-full"
															>
																{formatArtists(asTrack(playerState.currentTrack).artists)}
															</a>
															<p className="truncate text-xs text-gray-500 w-full">
																<a
																	href={`/album/${asTrack(playerState.currentTrack).album.id}`}
																	className="hover:text-blue-400 hover:underline"
																>
																	{asTrack(playerState.currentTrack).album.title}
																</a>
																{currentPlaybackQuality && (
																	<>
																		<span className="mx-1" aria-hidden="true">•</span>
																		<span>{formatQualityLabel(currentPlaybackQuality)}</span>
																	</>
																)}
																{currentPlaybackQuality && asTrack(playerState.currentTrack).audioQuality && currentPlaybackQuality !== asTrack(playerState.currentTrack).audioQuality && (
																	<>
																		<span className="mx-1 text-gray-600" aria-hidden="true">•</span>
																		<span className="text-gray-500">
																			({formatQualityLabel(asTrack(playerState.currentTrack).audioQuality)} available)
																		</span>
																	</>
																)}
																{bitDepthLabel && (
																	<>
																		<span className="mx-1 text-gray-600" aria-hidden="true">•</span>
																		<span>{bitDepthLabel}</span>
																	</>
																)}
																{sampleRateLabel && (
																	<>
																		<span className="mx-1 text-gray-600" aria-hidden="true">•</span>
																		<span>{sampleRateLabel}</span>
																	</>
																)}
															</p>
														</>
													)}
												</div>
											</div>

											<div className="flex flex-nowrap items-center justify-between gap-2 sm:gap-4">
												{/* Controls */}
												<div className="flex items-center justify-center gap-1 sm:gap-2">
													<button
														onClick={handlePrevious}
														className="p-1.5 sm:p-2 text-gray-400 transition-colors hover:text-white disabled:opacity-50"
														disabled={false}
														aria-label="Previous track"
													>
														<SkipBack size={18} className="sm:w-5 sm:h-5" />
													</button>

													<button
														onClick={() => dispatch(togglePlay())}
														className="rounded-full bg-white p-2.5 sm:p-3 text-gray-900 transition-transform hover:scale-105"
														aria-label={playerState.isPlaying ? 'Pause' : 'Play'}
													>
														{playerState.isPlaying ? (
															<Pause size={20} className="sm:w-6 sm:h-6" fill="currentColor" />
														) : (
															<Play size={20} className="sm:w-6 sm:h-6" fill="currentColor" />
														)}
													</button>

													<button
														onClick={() => dispatch(next())}
														className="p-1.5 sm:p-2 text-gray-400 transition-colors hover:text-white disabled:opacity-50"
														disabled={playerState.queueIndex >= playerState.queue.length - 1}
														aria-label="Next track"
													>
														<SkipForward size={18} className="sm:w-5 sm:h-5" />
													</button>
												</div>

												{/* Queue Toggle */}
												<div className="flex items-center gap-1 sm:gap-2">
													<button
														onClick={handleDownloadCurrentTrack}
														className="player-toggle-button p-1.5 sm:p-2"
														aria-label="Download current track"
														type="button"
														disabled={!playerState.currentTrack || isDownloadingCurrentTrack}
													>
														{isDownloadingCurrentTrack ? (
															<LoaderCircle size={16} className="sm:w-[18px] sm:h-[18px] animate-spin" />
														) : (
															<Download size={16} className="sm:w-[18px] sm:h-[18px]" />
														)}
														<span className="hidden sm:inline">Download</span>
													</button>
													<button
														onClick={() => dispatch(toggleLyrics())}
														className={`player-toggle-button p-1.5 sm:p-2 ${lyricsState.open ? 'player-toggle-button--active' : ''}`}
														aria-label={lyricsState.open ? 'Hide lyrics popup' : 'Show lyrics popup'}
														aria-expanded={lyricsState.open}
														type="button"
													>
														<ScrollText size={16} className="sm:w-[18px] sm:h-[18px]" />
														<span className="hidden sm:inline">Lyrics</span>
													</button>
													<button
														onClick={() => setShowQueuePanel(!showQueuePanel)}
														className={`player-toggle-button p-1.5 sm:p-2 ${showQueuePanel ? 'player-toggle-button--active' : ''}`}
														aria-label="Toggle queue panel"
														aria-expanded={showQueuePanel}
														type="button"
													>
														<ListMusic size={16} className="sm:w-[18px] sm:h-[18px]" />
														<span className="hidden sm:inline">Queue ({playerState.queue.length})</span>
													</button>
												</div>

												{/* Volume Control */}
												<div className="hidden sm:flex items-center gap-2">
													<button
														onClick={toggleMute}
														className="p-2 text-gray-400 transition-colors hover:text-white"
														aria-label={isMuted ? 'Unmute' : 'Mute'}
													>
														{isMuted || playerState.volume === 0 ? (
															<VolumeX size={20} />
														) : (
															<Volume2 size={20} />
														)}
													</button>
													<input
														type="range"
														min="0"
														max="1"
														step="0.01"
														value={playerState.volume}
														onChange={handleVolumeChange}
														className="h-1 w-24 cursor-pointer appearance-none rounded-lg bg-gray-700 accent-white"
														aria-label="Volume"
													/>
												</div>
											</div>
										</div>

										<AnimatePresence>
											{showQueuePanel && (
												<motion.div
													initial={{ height: 0, opacity: 0 }}
													animate={{ height: 'auto', opacity: 1 }}
													exit={{ height: 0, opacity: 0 }}
													transition={{ duration: 0.22, ease: "easeOut" }}
													className="queue-panel mt-4 space-y-3 rounded-2xl border p-4 text-sm shadow-inner overflow-hidden"
												>
													<div className="flex items-center justify-between gap-2">
														<div className="flex items-center gap-2 text-gray-300">
															<ListMusic size={18} />
															<span className="font-medium">Playback Queue</span>
															<span className="rounded-full bg-gray-800 px-2 py-0.5 text-xs text-gray-400">
																{playerState.queue.length}
															</span>
														</div>
														<div className="flex items-center gap-2">
															<button
																onClick={() => dispatch(shuffleQueue())}
																className="flex items-center gap-1 rounded-full border border-transparent px-3 py-1 text-xs tracking-wide text-gray-400 uppercase transition-colors hover:border-blue-500 hover:text-blue-200 disabled:opacity-40"
																type="button"
																disabled={playerState.queue.length <= 1}
															>
																<Shuffle size={14} />
																Shuffle
															</button>
															<button
																onClick={() => dispatch(clearQueue())}
																className="flex items-center gap-1 rounded-full border border-transparent px-3 py-1 text-xs tracking-wide text-gray-400 uppercase transition-colors hover:border-red-500 hover:text-red-400"
																type="button"
																disabled={playerState.queue.length === 0}
															>
																<Trash2 size={14} />
																Clear
															</button>
															<button
																onClick={() => setShowQueuePanel(false)}
																className="rounded-full p-1 text-gray-400 transition-colors hover:text-white"
																aria-label="Close queue panel"
															>
																<X size={16} />
															</button>
														</div>
													</div>

													{playerState.queue.length > 0 ? (
														<ul className="max-h-60 space-y-2 overflow-y-auto pr-1">
															{playerState.queue.map((queuedTrack, index) => (
																<li key={`${queuedTrack.id}-${index}`}>
																	<div
																		onClick={() => dispatch(playAtIndex(index))}
																		onKeyDown={(event) => {
																			if (event.key === 'Enter' || event.key === ' ') {
																				event.preventDefault();
																				dispatch(playAtIndex(index));
																			}
																		}}
																		tabIndex={0}
																		role="button"
																		className={`group flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors ${index === playerState.queueIndex ? 'bg-blue-500/10 text-white' : 'text-gray-200 hover:bg-gray-800/70'}`}
																	>
																		<span className="w-6 text-xs font-semibold text-gray-500 group-hover:text-gray-300">
																			{index + 1}
																		</span>
																		<div className="min-w-0 flex-1">
																			<p className="truncate text-sm font-medium">
																				{queuedTrack.title}
																				{!isSonglinkTrack(queuedTrack) && asTrack(queuedTrack).version ? ` (${asTrack(queuedTrack).version})` : ''}
																			</p>
																			{isSonglinkTrack(queuedTrack) ? (
																				<p className="truncate text-xs text-gray-400">
																					{queuedTrack.artistName}
																				</p>
																			) : (
																				<a
																					href={`/artist/${asTrack(queuedTrack).artist.id}`}
																					onClick={(e) => e.stopPropagation()}
																					className="truncate text-xs text-gray-400 hover:text-blue-400 hover:underline inline-block"
																				>
																					{formatArtists(asTrack(queuedTrack).artists)}
																				</a>
																			)}
																		</div>
																		<button
																			onClick={(event) => {
																				event.stopPropagation();
																				dispatch(removeFromQueue(index));
																			}}
																			className="rounded-full p-1 text-gray-500 transition-colors hover:text-red-400"
																			aria-label={`Remove ${queuedTrack.title} from queue`}
																			type="button"
																		>
																			<X size={14} />
																		</button>
																	</div>
																</li>
															))}
														</ul>
													) : (
														<p className="rounded-lg border border-dashed border-gray-700 bg-gray-900/70 px-3 py-8 text-center text-gray-400">
															Queue is empty
														</p>
													)}
												</motion.div>
											)}
										</AnimatePresence>

										{playerState.currentTrack && playerState.isLoading && (
											<div className="loading-overlay">
												<div className="loading-equalizer" aria-hidden="true">
													<span className="bar" style={{ animationDelay: '0ms' }}></span>
													<span className="bar" style={{ animationDelay: '150ms' }}></span>
													<span className="bar" style={{ animationDelay: '300ms' }}></span>
													<span className="bar" style={{ animationDelay: '450ms' }}></span>
												</div>
												<p className="text-sm font-medium text-gray-200">Loading track…</p>
											</div>
										)}
									</>
								) : (
									<div className="flex h-20 items-center justify-center text-sm text-gray-400">
										Nothing is playing
									</div>
								)}
							</div>
						</div>
					</div>
				</div>
			)}
		</>
	);
};

export default AudioPlayer;
