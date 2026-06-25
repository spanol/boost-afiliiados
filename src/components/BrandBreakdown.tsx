import React from 'react';
import { Store } from 'lucide-react';
import { resolveBrandRates, type AffiliateConfig } from '../services/affiliateService';
import { num } from '../lib/commission';
import { getKnownBrandName } from '../lib/brand';
import InfoTooltip from './InfoTooltip';
import BrandLogo from './BrandLogo';

interface BrandBreakdownProps {
  data: any[];
  config: AffiliateConfig | null;
}

const formatBRL = (value: number) =>
  `R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Per-house breakdown of the affiliate's earnings, driven by the external API's
// `groupBy=brand` results and the affiliate's CPA/REV config. Bar widths are
// proportional to the largest value across houses.
export default function BrandBreakdown({ data, config }: BrandBreakdownProps) {
  // B6 · cada casa usa a taxa POR CASA do afiliado (override de byBrand, com
  // fallback no default). A linha de marca traz o brandId em `id`.
  const brands = (Array.isArray(data) ? data : []).map((row: any) => {
    const id = String(row.id ?? '');
    const raw = String(row.label || row.name || row.id || 'Casa');
    const name = getKnownBrandName(id, raw) ?? raw;
    const { cpaValue, revPercentage } = resolveBrandRates(config, id);
    // num() é a coerção-padrão de métrica dos dashboards (guarda NaN/Infinity → 0):
    // mantém o BrandBreakdown consistente com calcAffiliatePayout em vez de um
    // `Number()||0` solto. (num NÃO parseia vírgula pt-BR — a OTG manda número parseável.)
    const rev = num(row.rvs) * (revPercentage / 100);
    const cpa = num(row.qualified_cpa) * cpaValue;
    return { id, name, rev, cpa };
  });

  const maxRev = Math.max(1, ...brands.map((b) => b.rev));
  const maxCpa = Math.max(1, ...brands.map((b) => b.cpa));

  const renderCard = (title: string, metric: 'rev' | 'cpa', max: number) => (
    <div className="bg-white dark:bg-neutral-900 p-8 rounded-3xl border border-slate-100 dark:border-neutral-800 shadow-sm">
      <div className="flex items-center gap-2 mb-8">
        <div className="p-2 rounded-xl bg-slate-100 dark:bg-neutral-800 text-slate-500 dark:text-neutral-300">
          <Store size={16} />
        </div>
        <div className="flex items-center gap-1 text-xs font-black text-slate-900 dark:text-white uppercase tracking-widest">
          {title} <InfoTooltip text="Distribuição da sua comissão por casa de aposta no período, calculada com os valores do seu contrato (CPA/REV)." align="left" />
        </div>
      </div>
      {brands.length === 0 ? (
        <p className="text-xs font-bold text-slate-400 dark:text-neutral-400 uppercase tracking-widest py-6 text-center opacity-50">Sem dados por casa</p>
      ) : (
        <div className="space-y-6">
          {brands.map((b, idx) => {
            const value = metric === 'rev' ? b.rev : b.cpa;
            const pct = Math.max(2, Math.round((value / max) * 100));
            return (
              <div key={idx} className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <BrandLogo name={b.name} brandId={b.id} size={24} />
                    <span className="text-xs font-bold text-slate-700 dark:text-neutral-300">{b.name}</span>
                  </div>
                  <span className="text-xs font-bold text-slate-400 dark:text-neutral-400">{formatBRL(value)}</span>
                </div>
                <div className="h-6 bg-slate-100 dark:bg-neutral-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-brand dark:bg-neutral-600 rounded-full transition-all"
                    style={{ width: `${pct}%` }}
                  ></div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-8">
      {renderCard('REV (R$) por Casa', 'rev', maxRev)}
      {renderCard('CPA (R$) por Casa', 'cpa', maxCpa)}
    </div>
  );
}
