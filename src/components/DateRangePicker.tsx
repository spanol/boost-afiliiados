import React, { useEffect, useRef, useState } from 'react';
import { Calendar, ChevronDown, Check } from 'lucide-react';
import {
  DateRange,
  DateRangePresetId,
  DATE_RANGE_PRESETS,
  formatRangeLabel,
  getPresetRange,
  matchPreset,
} from '../lib/dateRange';
import { cn } from '../lib/utils';

interface DateRangePickerProps {
  value: DateRange;
  onChange: (range: DateRange) => void;
  className?: string;
}

// Seletor de intervalo de datas com presets (B2). Emite { startDate, endDate }
// em 'YYYY-MM-DD' — formato consumido direto pelo proxy /api/external/results.
export default function DateRangePicker({ value, onChange, className }: DateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const [draftStart, setDraftStart] = useState(value.startDate);
  const [draftEnd, setDraftEnd] = useState(value.endDate);
  const containerRef = useRef<HTMLDivElement>(null);

  const activePreset = matchPreset(value);

  // Mantém os campos do modo personalizado sincronizados quando o valor muda externamente.
  useEffect(() => {
    setDraftStart(value.startDate);
    setDraftEnd(value.endDate);
  }, [value.startDate, value.endDate]);

  // Fecha o dropdown ao clicar fora.
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const handlePreset = (id: DateRangePresetId) => {
    if (id === 'custom') return; // 'custom' só aplica via campos abaixo
    onChange(getPresetRange(id));
    setOpen(false);
  };

  const applyCustom = () => {
    if (!draftStart || !draftEnd) return;
    // Garante start <= end.
    const start = draftStart <= draftEnd ? draftStart : draftEnd;
    const end = draftStart <= draftEnd ? draftEnd : draftStart;
    onChange({ startDate: start, endDate: end });
    setOpen(false);
  };

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 px-4 py-2.5 bg-white dark:bg-neutral-900 border border-slate-200 dark:border-neutral-800 rounded-xl text-slate-700 dark:text-neutral-300 hover:border-amber-500/40 transition-all font-bold text-xs uppercase tracking-wider shadow-sm"
      >
        <Calendar size={16} className="text-slate-500 dark:text-neutral-400" />
        <span className="normal-case tracking-normal font-semibold">{formatRangeLabel(value)}</span>
        <ChevronDown size={14} className={cn('text-slate-400 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute left-0 sm:left-auto sm:right-0 z-50 mt-2 w-72 max-w-[calc(100vw_-_2rem)] bg-white dark:bg-neutral-900 border border-slate-100 dark:border-neutral-800 rounded-2xl shadow-2xl p-3 space-y-1">
          {DATE_RANGE_PRESETS.filter((p) => p.id !== 'custom').map((preset) => {
            const isActive = activePreset === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => handlePreset(preset.id)}
                className={cn(
                  'w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-semibold transition-all text-left',
                  isActive
                    ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                    : 'text-slate-600 dark:text-neutral-300 hover:bg-slate-50 dark:hover:bg-white/5'
                )}
              >
                {preset.label}
                {isActive && <Check size={16} />}
              </button>
            );
          })}

          <div className="pt-2 mt-1 border-t border-slate-100 dark:border-neutral-800 space-y-2">
            <p className="px-1 text-[10px] font-black text-slate-400 dark:text-neutral-500 uppercase tracking-widest">Personalizado</p>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={draftStart}
                max={draftEnd || undefined}
                onChange={(e) => setDraftStart(e.target.value)}
                className="flex-1 min-w-0 px-2 py-2 bg-slate-50 dark:bg-neutral-800 border border-slate-100 dark:border-neutral-700 rounded-lg text-xs font-semibold outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 dark:text-white"
              />
              <span className="text-slate-400 dark:text-neutral-500 text-xs">–</span>
              <input
                type="date"
                value={draftEnd}
                min={draftStart || undefined}
                onChange={(e) => setDraftEnd(e.target.value)}
                className="flex-1 min-w-0 px-2 py-2 bg-slate-50 dark:bg-neutral-800 border border-slate-100 dark:border-neutral-700 rounded-lg text-xs font-semibold outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 dark:text-white"
              />
            </div>
            <button
              type="button"
              onClick={applyCustom}
              disabled={!draftStart || !draftEnd}
              className="w-full py-2.5 bg-slate-900 dark:bg-white text-white dark:text-neutral-900 font-black text-[10px] uppercase tracking-[0.2em] rounded-xl hover:opacity-90 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Aplicar intervalo
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
