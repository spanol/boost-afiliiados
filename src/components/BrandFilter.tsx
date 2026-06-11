import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Check, Layers } from 'lucide-react';
import { ALL_BRANDS } from '../lib/brand';
import { cn } from '../lib/utils';
import BrandLogo from './BrandLogo';

interface BrandFilterProps {
  brands: string[];
  value: string; // ALL_BRANDS ou o nome de uma marca
  onChange: (value: string) => void;
}

const ALL_LABEL = 'Todas as casas';

// Seletor de casa (multi-marca) — dropdown com a logo inline, espelhando o portal
// da OTG: "Todas as casas" + uma opção por casa (logo + nome). Some quando há 0/1
// casa (não há o que filtrar). A marca selecionada aparece no gatilho com a logo.
export default function BrandFilter({ brands, value, onChange }: BrandFilterProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Fecha ao clicar fora ou apertar Esc.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!Array.isArray(brands) || brands.length < 2) return null;

  const isAll = value === ALL_BRANDS;
  const options = [ALL_BRANDS, ...brands];

  const select = (key: string) => {
    onChange(key);
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          'flex items-center gap-2 pl-2.5 pr-2 py-1.5 rounded-xl text-sm font-bold border transition-all min-w-[10rem]',
          'bg-white dark:bg-neutral-900 text-slate-700 dark:text-neutral-200',
          open
            ? 'border-slate-300 dark:border-neutral-700 shadow-sm'
            : 'border-slate-200 dark:border-neutral-800 hover:border-slate-300 dark:hover:border-neutral-700'
        )}
      >
        {isAll ? (
          <Layers size={18} className="text-slate-400 dark:text-neutral-500 shrink-0" />
        ) : (
          <BrandLogo name={value} size={20} />
        )}
        <span className="flex-1 text-left truncate">{isAll ? ALL_LABEL : value}</span>
        <ChevronDown
          size={16}
          className={cn('text-slate-400 shrink-0 transition-transform', open && 'rotate-180')}
        />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute z-30 mt-1.5 min-w-full w-max max-w-[16rem] rounded-xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-lg shadow-slate-900/5 dark:shadow-black/40 p-1.5"
        >
          {options.map((key) => {
            const all = key === ALL_BRANDS;
            const selected = value === key;
            return (
              <button
                key={key}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => select(key)}
                className={cn(
                  'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-bold text-left transition-colors',
                  selected
                    ? 'bg-slate-100 dark:bg-neutral-800 text-slate-900 dark:text-white'
                    : 'text-slate-600 dark:text-neutral-300 hover:bg-slate-50 dark:hover:bg-neutral-800/60'
                )}
              >
                {all ? (
                  <Layers size={20} className="text-slate-400 dark:text-neutral-500 shrink-0" />
                ) : (
                  <BrandLogo name={key} size={20} />
                )}
                <span className="flex-1 truncate">{all ? ALL_LABEL : key}</span>
                {selected && <Check size={15} className="text-slate-500 dark:text-neutral-300 shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
