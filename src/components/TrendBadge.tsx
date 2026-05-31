import React from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { cn } from '../lib/utils';

interface TrendBadgeProps {
  // Variação percentual já calculada (ver lib/dateRange.percentChange).
  // null = sem base de comparação → o badge não renderiza.
  change: number | null;
}

// Badge de variação período-a-período. Verde para alta, vermelho para queda.
// Substitui o "+12%" hardcoded — agora reflete o período anterior real.
export default function TrendBadge({ change }: TrendBadgeProps) {
  if (change == null) return null;

  const up = change >= 0;
  const formatted = `${up ? '+' : ''}${change.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;

  return (
    <div
      className={cn(
        'flex items-center gap-1 text-[10px] font-black px-2 py-1 rounded-lg',
        up ? 'text-green-500 bg-green-500/10' : 'text-red-500 bg-red-500/10'
      )}
      title="Variação vs. período anterior de mesma duração"
    >
      {up ? <TrendingUp size={10} /> : <TrendingDown size={10} />} {formatted}
    </div>
  );
}
