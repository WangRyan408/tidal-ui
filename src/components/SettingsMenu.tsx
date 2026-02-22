import { useState, useEffect, useRef } from 'react';
import { Settings, Check, ChevronDown, ChevronUp, Download, Link as LinkIcon, FileArchive, FileJson } from 'lucide-react';
import { useAppDispatch, useAppSelector } from '@/lib/hooks';
import { setQuality } from '@/lib/features/playerSlice';
import { setConvertAacToMp3, setDownloadCoversSeperately, setPerformanceMode } from '@/lib/features/userPreferencesSlice';
import { setMode as setDownloadMode } from '@/lib/features/downloadPreferencesSlice';
import type { AudioQuality } from '@/lib/types';

const SettingsMenu: React.FC = () => {
	const [isOpen, setIsOpen] = useState(false);
	const dispatch = useAppDispatch();
	const selectorRef = useRef<HTMLDivElement>(null);

	// Redux State
	const quality = useAppSelector((state) => state.player.quality);
	const convertAacToMp3 = useAppSelector((state) => state.userPreferences.convertAacToMp3);
	const downloadCoversSeperately = useAppSelector((state) => state.userPreferences.downloadCoversSeperately);
	const performanceMode = useAppSelector((state) => state.userPreferences.performanceMode);
	const downloadMode = useAppSelector((state) => state.downloadPreferences.mode);

	const disabledQualities = new Set<AudioQuality>();

	const qualities: { value: AudioQuality; label: string; description: string }[] = [
		{ value: 'HI_RES_LOSSLESS', label: 'Hi-Res', description: '24-bit FLAC (DASH) up to 192 kHz' },
		{ value: 'LOSSLESS', label: 'CD Lossless', description: '16-bit / 44.1 kHz FLAC' },
		{ value: 'HIGH', label: '320kbps AAC', description: 'High quality AAC streaming' },
		{ value: 'LOW', label: '96kbps AAC', description: 'Data saver AAC streaming' }
	];

	const isQualityDisabled = (q: AudioQuality) => disabledQualities.has(q);

	const selectQuality = (q: AudioQuality) => {
		if (!isQualityDisabled(q)) dispatch(setQuality(q));
	};

	const toggleDropdown = () => setIsOpen(!isOpen);

	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (isOpen && selectorRef.current && !selectorRef.current.contains(event.target as Node)) {
				setIsOpen(false);
			}
		};
		window.addEventListener('click', handleClickOutside);
		return () => window.removeEventListener('click', handleClickOutside);
	}, [isOpen]);

	return (
		<div className="relative" ref={selectorRef}>
			{/* Settings Toggle Button */}
			<button
				onClick={toggleDropdown}
				className="flex items-center gap-2 rounded-full border border-gray-700/50 bg-slate-900/80 px-4 py-2 text-white shadow-sm backdrop-blur-md transition-all hover:bg-slate-800 hover:border-blue-500/50"
				aria-label="Settings and Downloads"
			>
				<Settings size={16} />
				<span className="text-sm font-semibold">Settings</span>
				<span className="text-sm text-gray-400">
					{qualities.find((q) => q.value === quality)?.label.split(' ')[0] || 'Quality'}
				</span>
				{isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
			</button>

			{/* Dropdown Menu */}
			{isOpen && (
				<div className="absolute right-0 z-50 mt-3 w-[420px] max-h-[85vh] overflow-y-auto rounded-xl border border-gray-700 bg-[#121622] p-5 shadow-2xl custom-scrollbar animate-in slide-in-from-top-2 opacity-100 duration-200">
					
					{/* STREAMING & DOWNLOADS */}
					<div className="mb-6">
						<h3 className="mb-3 text-xs font-bold tracking-wider text-gray-400">STREAMING & DOWNLOADS</h3>
						<div className="flex flex-col gap-2">
							{qualities.map((q) => (
								<button
									key={q.value}
									onClick={() => selectQuality(q.value)}
									className={`group flex w-full items-center justify-between rounded-lg border p-3 text-left transition-colors ${
										quality === q.value
											? 'border-blue-500 bg-blue-500/10'
											: 'border-transparent bg-[#1A1F2E] hover:border-gray-600'
									} disabled:cursor-not-allowed disabled:opacity-50`}
									disabled={isQualityDisabled(q.value)}
								>
									<div>
										<div className={`text-sm font-bold ${quality === q.value ? 'text-white' : 'text-gray-200'}`}>
											{q.label}
										</div>
										<div className="text-xs text-gray-400">{q.description}</div>
									</div>
									{quality === q.value && <Check size={18} className="text-blue-500" />}
								</button>
							))}
						</div>
					</div>

					{/* CONVERSIONS */}
					<div className="mb-6">
						<h3 className="mb-3 text-xs font-bold tracking-wider text-gray-400">CONVERSIONS</h3>
						<div className="flex flex-col gap-2">
							<div className="flex items-center justify-between rounded-lg bg-[#1A1F2E] p-3">
								<div>
									<div className="text-sm font-bold text-gray-200">Convert AAC downloads to MP3</div>
									<div className="text-xs text-gray-400">Applies to 320kbps and 96kbps downloads.</div>
								</div>
								<button
									onClick={() => dispatch(setConvertAacToMp3(!convertAacToMp3))}
									className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${convertAacToMp3 ? 'bg-blue-500' : 'bg-gray-700'}`}
								>
									<span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${convertAacToMp3 ? 'translate-x-6' : 'translate-x-1'}`} />
								</button>
							</div>
							<div className="flex items-center justify-between rounded-lg bg-[#1A1F2E] p-3">
								<div>
									<div className="text-sm font-bold text-gray-200">Download covers separately</div>
									<div className="text-xs text-gray-400">Save cover.jpg alongside audio files.</div>
								</div>
								<button
									onClick={() => dispatch(setDownloadCoversSeperately(!downloadCoversSeperately))}
									className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${downloadCoversSeperately ? 'bg-blue-500' : 'bg-gray-700'}`}
								>
									<span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${downloadCoversSeperately ? 'translate-x-6' : 'translate-x-1'}`} />
								</button>
							</div>
						</div>
					</div>

					{/* QUEUE EXPORTS */}
					<div className="mb-6">
						<h3 className="mb-3 text-xs font-bold tracking-wider text-gray-400">QUEUE EXPORTS</h3>
						<div className="flex gap-2">
							<button
								onClick={() => dispatch(setDownloadMode('individual'))}
								className={`flex flex-1 flex-col items-center justify-center gap-2 rounded-lg border p-3 transition-colors ${
									downloadMode === 'individual' ? 'border-blue-500 bg-blue-500/10 text-white' : 'border-transparent bg-[#1A1F2E] text-gray-400 hover:border-gray-600'
								}`}
							>
								<Download size={20} className={downloadMode === 'individual' ? 'text-blue-500' : ''} />
								<span className="text-xs font-bold text-center">Individual files</span>
							</button>
							<button
								onClick={() => dispatch(setDownloadMode('zip'))}
								className={`flex flex-1 flex-col items-center justify-center gap-2 rounded-lg border p-3 transition-colors ${
									downloadMode === 'zip' ? 'border-blue-500 bg-blue-500/10 text-white' : 'border-transparent bg-[#1A1F2E] text-gray-400 hover:border-gray-600'
								}`}
							>
								<FileArchive size={20} className={downloadMode === 'zip' ? 'text-blue-500' : ''} />
								<span className="text-xs font-bold text-center">ZIP archive</span>
							</button>
							<button
								onClick={() => dispatch(setDownloadMode('csv'))}
								className={`flex flex-1 flex-col items-center justify-center gap-2 rounded-lg border p-3 transition-colors ${
									downloadMode === 'csv' ? 'border-blue-500 bg-blue-500/10 text-white' : 'border-transparent bg-[#1A1F2E] text-gray-400 hover:border-gray-600'
								}`}
							>
								<LinkIcon size={20} className={downloadMode === 'csv' ? 'text-blue-500' : ''} />
								<span className="text-xs font-bold text-center">Export links</span>
							</button>
						</div>
					</div>

					{/* PERFORMANCE MODE */}
					<div className="mb-6">
						<h3 className="mb-3 text-xs font-bold tracking-wider text-gray-400">PERFORMANCE MODE</h3>
						<div className="flex rounded-lg border border-gray-700 bg-[#1A1F2E] p-1">
							<button
								onClick={() => dispatch(setPerformanceMode('medium'))}
								className={`flex-1 rounded-md py-2 text-sm font-bold transition-colors ${performanceMode === 'medium' ? 'bg-[#2A3142] text-white shadow' : 'text-gray-400 hover:text-gray-200'}`}
							>
								Balanced
							</button>
							<button
								onClick={() => dispatch(setPerformanceMode('low'))}
								className={`flex-1 rounded-md py-2 text-sm font-bold transition-colors ${performanceMode === 'low' ? 'bg-[#2A3142] text-white shadow' : 'text-gray-400 hover:text-gray-200'}`}
							>
								Performance
							</button>
						</div>
					</div>

					{/* QUEUE ACTIONS */}
					<div>
						<h3 className="mb-3 text-xs font-bold tracking-wider text-gray-400">QUEUE ACTIONS</h3>
						<div className="flex flex-col gap-2">
							<button className="flex items-center gap-3 rounded-lg border border-transparent bg-[#1A1F2E] p-3 text-left transition-colors hover:border-gray-600">
								<div className="rounded-md bg-gray-800 p-2">
									<Download size={16} className="text-gray-300" />
								</div>
								<span className="text-sm font-bold text-gray-200">Download queue</span>
							</button>
							<button className="flex items-center gap-3 rounded-lg border border-transparent bg-[#1A1F2E] p-3 text-left transition-colors hover:border-gray-600">
								<div className="rounded-md bg-gray-800 p-2">
									<FileJson size={16} className="text-gray-300" />
								</div>
								<span className="text-sm font-bold text-gray-200">Export links as CSV</span>
							</button>
						</div>
						<p className="mt-3 text-[11px] leading-relaxed text-gray-500">
							Queue actions follow your selection above. ZIP bundles require at least two tracks, while CSV exports capture the track links without downloading audio.
						</p>
					</div>

				</div>
			)}
		</div>
	);
};

export default SettingsMenu;
