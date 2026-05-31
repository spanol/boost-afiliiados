import React from 'react';
import { Store } from 'lucide-react';
import { ALL_BRANDS } from '../lib/brand';
import { cn } from '../lib/utils';

interface BrandFilterProps {
  brands: string[];
  value: string; // ALL_BRANDS ou o nome de uma marca
  onChange: (value: string) => void;
}

// Filtro por marca (multi-marca). Pílulas: "Todas" + uma por marca presente.
// Some quando há 0 ou 1 marca (não há o que filtrar) — então hoje, com só
// Superbet, não polui a tela; aparece automaticamente quando surgir a 2ª marca.
export default function BrandFilter({ brands, value, onChange }: BrandFilterProps) {
  if (!Array.isArray(brands) || brands.length < 2) return null;

  const options = [{ key: ALL_BRANDS, label: 'Todas as marcas' }, ...brands.map((b) => ({ key: b, label: b }))];

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-neutral-500">
        <Store size={12} /> Marca
      </span>
      <div className="flex items-center gap-1.5 flex-wrap">
        {options.map((opt) => {
          const active = value === opt.key;
          return (
            <button
              key={opt.key}
              type="button"
              onClick={() => onChange(opt.key)}
              className={cn(
                'px-3 py-1.5 rounded-full text-xs font-bold transition-all border',
                active
                  ? 'bg-slate-900 dark:bg-white text-white dark:text-neutral-900 border-transparent shadow-sm'
                  : 'bg-white dark:bg-neutral-900 text-slate-600 dark:text-neutral-300 border-slate-200 dark:border-neutral-800 hover:border-slate-300 dark:hover:border-neutral-700'
              )}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
