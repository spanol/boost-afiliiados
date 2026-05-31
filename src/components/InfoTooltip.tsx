import React from 'react';
import { HelpCircle } from 'lucide-react';
import { cn } from '../lib/utils';

interface InfoTooltipProps {
  // Texto explicativo (pt-BR) exibido ao passar o mouse ou focar via teclado.
  text: string;
  size?: number;
  // Alinhamento do balão. 'center' usa fallback mobile (right-0) para não cortar
  // na borda direita; 'right'/'left' fixam o lado.
  align?: 'left' | 'center' | 'right';
  className?: string;
}

// Tooltip de ajuda reutilizável. Substitui os ícones HelpCircle que antes eram
// puramente decorativos — agora cada um explica a métrica. Acessível (foco via
// teclado abre o balão) e mobile-safe (não vaza na borda direita).
export default function InfoTooltip({ text, size = 14, align = 'center', className }: InfoTooltipProps) {
  const position =
    align === 'right'
      ? 'right-0'
      : align === 'left'
      ? 'left-0'
      : 'right-0 sm:left-1/2 sm:right-auto sm:-translate-x-1/2';

  return (
    <span className="relative group/info inline-flex align-middle">
      <button
        type="button"
        aria-label="Mais informações"
        className={cn('text-slate-400 hover:text-brand focus:text-brand outline-none transition-colors', className)}
      >
        <HelpCircle size={size} />
      </button>
      <span
        role="tooltip"
        className={cn(
          'pointer-events-none absolute top-full z-30 mt-2 w-56 max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-3 text-[11px] font-medium normal-case tracking-normal leading-relaxed text-slate-600 dark:text-neutral-300 shadow-xl opacity-0 group-hover/info:opacity-100 group-focus-within/info:opacity-100 transition-opacity',
          position
        )}
      >
        {text}
      </span>
    </span>
  );
}
