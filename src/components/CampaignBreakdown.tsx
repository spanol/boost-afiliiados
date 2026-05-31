import React from 'react';
import { Megaphone } from 'lucide-react';
import InfoTooltip from './InfoTooltip';

export interface CampaignDisplayRow {
  name: string;
  registrations: number;
  firstDeposits: number;
  deposit: number;
  qualifiedCpa: number;
  commission: number;
}

interface CampaignBreakdownProps {
  rows: CampaignDisplayRow[];
  // Rótulo da coluna de comissão — "Comissão (casa)" no admin, "Sua comissão" no afiliado.
  commissionLabel: string;
  title?: string;
  subtitle?: string;
  // Texto do tooltip do título (varia por contexto admin/afiliado).
  infoText?: string;
}

const formatBRL = (value: number) =>
  `R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const formatInt = (value: number) => value.toLocaleString('pt-BR');

// Tabela de desempenho por campanha (dados reais de results?groupBy=campaign).
// Presentational: recebe linhas já normalizadas/calculadas pelo chamador.
// Responsivo: tabela em sm+, cards empilhados no mobile (sem scroll horizontal).
export default function CampaignBreakdown({
  rows,
  commissionLabel,
  title = 'Desempenho por Campanha',
  subtitle,
  infoText = 'Resultados agrupados por campanha no período selecionado.',
}: CampaignBreakdownProps) {
  const data = Array.isArray(rows) ? rows : [];

  const avatar = (name: string) => (
    <div className="w-7 h-7 shrink-0 rounded-lg bg-brand/10 text-brand flex items-center justify-center font-black text-[11px]">
      {name.charAt(0).toUpperCase()}
    </div>
  );

  return (
    <div className="bg-white dark:bg-neutral-900 border border-slate-100 dark:border-neutral-800 rounded-3xl flex flex-col shadow-sm overflow-hidden">
      <div className="p-6 border-b border-slate-50 dark:border-neutral-800 flex flex-wrap justify-between items-center gap-3 bg-slate-50/50 dark:bg-transparent">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-xl bg-slate-100 dark:bg-neutral-800 text-slate-500 dark:text-neutral-300">
            <Megaphone size={16} />
          </div>
          <div>
            <h3 className="font-black text-xs text-slate-800 dark:text-white uppercase tracking-widest flex items-center gap-1">
              {title} <InfoTooltip text={infoText} size={12} align="left" />
            </h3>
            {subtitle && (
              <p className="text-[10px] font-bold text-slate-400 dark:text-neutral-500 mt-0.5">{subtitle}</p>
            )}
          </div>
        </div>
        <div className="px-3 py-1 bg-slate-100 dark:bg-neutral-800 rounded-lg text-[10px] font-bold text-slate-400 uppercase tracking-widest">
          {formatInt(data.length)} {data.length === 1 ? 'campanha' : 'campanhas'}
        </div>
      </div>

      {data.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center gap-3 text-slate-300 dark:text-neutral-600">
          <Megaphone size={40} className="opacity-30" />
          <p className="text-xs font-bold uppercase tracking-widest opacity-60">Sem dados por campanha no período</p>
        </div>
      ) : (
        <>
          {/* sm+ : tabela */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-slate-50 dark:bg-neutral-800/50 text-[10px] text-slate-400 uppercase tracking-widest border-b border-slate-100 dark:border-neutral-800">
                <tr>
                  <th className="px-6 py-4 font-black">Campanha</th>
                  <th className="px-6 py-4 font-black text-right">Cadastros</th>
                  <th className="px-6 py-4 font-black text-right">1ºs Depósitos</th>
                  <th className="px-6 py-4 font-black text-right">Valor Depositado</th>
                  <th className="px-6 py-4 font-black text-right">CPA Qualif.</th>
                  <th className="px-6 py-4 font-black text-right">{commissionLabel}</th>
                </tr>
              </thead>
              <tbody>
                {data.map((row, idx) => (
                  <tr
                    key={idx}
                    className="border-b border-slate-50 dark:border-neutral-800/60 last:border-0 hover:bg-slate-50/60 dark:hover:bg-neutral-800/30 transition-colors"
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        {avatar(row.name)}
                        <span className="text-xs font-bold text-slate-700 dark:text-neutral-200">{row.name}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right text-xs font-bold text-slate-600 dark:text-neutral-300">{formatInt(row.registrations)}</td>
                    <td className="px-6 py-4 text-right text-xs font-bold text-slate-600 dark:text-neutral-300">{formatInt(row.firstDeposits)}</td>
                    <td className="px-6 py-4 text-right text-xs font-bold text-slate-600 dark:text-neutral-300">{formatBRL(row.deposit)}</td>
                    <td className="px-6 py-4 text-right text-xs font-bold text-slate-600 dark:text-neutral-300">{formatInt(row.qualifiedCpa)}</td>
                    <td className="px-6 py-4 text-right text-xs font-black text-slate-900 dark:text-white">{formatBRL(row.commission)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* mobile : cards empilhados (sem scroll horizontal) */}
          <div className="sm:hidden divide-y divide-slate-100 dark:divide-neutral-800/60">
            {data.map((row, idx) => (
              <div key={idx} className="p-5 space-y-3">
                <div className="flex items-center gap-3">
                  {avatar(row.name)}
                  <span className="text-sm font-bold text-slate-700 dark:text-neutral-200">{row.name}</span>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                  <Cell label="Cadastros" value={formatInt(row.registrations)} />
                  <Cell label="1ºs Depósitos" value={formatInt(row.firstDeposits)} />
                  <Cell label="Valor Depositado" value={formatBRL(row.deposit)} />
                  <Cell label="CPA Qualif." value={formatInt(row.qualifiedCpa)} />
                </div>
                <div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-neutral-800/60">
                  <span className="text-[10px] font-bold text-slate-400 dark:text-neutral-500 uppercase tracking-widest">{commissionLabel}</span>
                  <span className="text-sm font-black text-slate-900 dark:text-white">{formatBRL(row.commission)}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-bold text-slate-400 dark:text-neutral-500 uppercase tracking-widest mb-0.5">{label}</p>
      <p className="text-sm font-bold text-slate-700 dark:text-neutral-200 truncate">{value}</p>
    </div>
  );
}
