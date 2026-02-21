import React, { useState, useEffect, useRef } from 'react';
import { Settings, Check } from 'lucide-react';
import { useAppDispatch, useAppSelector } from '@/lib/hooks';
import { setQuality } from '@/lib/features/playerSlice';
import type { AudioQuality } from '@/lib/types';

const QualitySelector: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const disabledQualities = new Set<AudioQuality>();
  const dispatch = useAppDispatch();
  const quality = useAppSelector((state) => state.player.quality);
  const selectorRef = useRef<HTMLDivElement>(null);

  const qualities: { value: AudioQuality; label: string; description: string }[] = [
    {
      value: 'HI_RES_LOSSLESS',
      label: 'Hi-Res',
      description: '24-bit FLAC up to 192 kHz'
    },
    { value: 'LOSSLESS', label: 'Lossless', description: '16-bit/44.1 kHz FLAC' },
    { value: 'HIGH', label: 'High', description: '320k AAC' },
    { value: 'LOW', label: 'Low', description: '96k AAC' }
  ];

  const isQualityDisabled = (q: AudioQuality): boolean => {
    return disabledQualities.has(q);
  };

  const selectQuality = (q: AudioQuality) => {
    if (isQualityDisabled(q)) {
      return;
    }
    dispatch(setQuality(q));
    setIsOpen(false);
  };

  const toggleDropdown = () => {
    setIsOpen(!isOpen);
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (isOpen && selectorRef.current && !selectorRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    window.addEventListener('click', handleClickOutside);
    return () => {
      window.removeEventListener('click', handleClickOutside);
    };
  }, [isOpen]);

  return (
    <div className="quality-selector relative" ref={selectorRef}>
      <button
        onClick={toggleDropdown}
        className="flex items-center gap-2 rounded-lg bg-gray-800 px-4 py-2 text-white transition-colors hover:bg-gray-700"
        aria-label="Select audio quality"
      >
        <Settings size={18} />
        <span className="text-sm">
          {qualities.find((q) => q.value === quality)?.label || 'Quality'}
        </span>
      </button>

      {isOpen && (
        <div className="absolute right-0 z-50 mt-2 w-64 overflow-hidden rounded-lg border border-gray-700 bg-gray-800 shadow-lg">
          <div className="border-b border-gray-700 p-2">
            <h3 className="text-sm font-semibold text-white">Audio Quality</h3>
          </div>
          <div className="py-1">
            {qualities.map((q) => (
              <button
                key={q.value}
                onClick={() => selectQuality(q.value)}
                className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-700 disabled:cursor-not-allowed disabled:text-gray-500 disabled:opacity-60 disabled:hover:bg-gray-800"
                disabled={isQualityDisabled(q.value)}
                aria-disabled={isQualityDisabled(q.value)}
                title={isQualityDisabled(q.value) ? 'Not available in this build' : undefined}
              >
                <div className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center">
                  {quality === q.value && <Check size={18} className="text-blue-500" />}
                </div>
                <div className="flex-1">
                  <div className="text-sm font-medium text-white">{q.label}</div>
                  <div className={`text-xs ${isQualityDisabled(q.value) ? 'text-gray-500' : 'text-gray-400'}`}>
                    {q.description}
                    {isQualityDisabled(q.value) && (
                      <span className="ml-1 text-[10px] tracking-wide text-gray-500 uppercase">
                        Unavailable
                      </span>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default QualitySelector;
