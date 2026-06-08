import React, { useMemo, useState } from 'react';
import { Store, Save, Loader2, Check } from 'lucide-react';
import {
  resolveBrandRates,
  saveAffiliateBrandRates,
  type AffiliateConfig,
  type BrandRates,
} from '../services/affiliateService';
import { humanizeName } from '../lib/utils';
import InfoTooltip from './InfoTooltip';

interface BrandRow {
  id?: string;
  label?: string;
  name?: string;
}

interface BrandConfigEditorProps {
  affiliateId: string;
  // Linhas por casa do afiliado (groupBy=brand) — define QUAIS casas editar.
  brandRows: BrandRow[];
  config: AffiliateConfig | null;
  onSaved?: () => void;
}

// B6 · Editor de comissão POR CASA (afiliado × casa). Admin define CPA/REV
// específicos por casa; vazio = usa o default do contrato (taxa de topo).
// Dev-gated: só renderiza quando o afiliado tem ≥2 casas (hoje, via mock
// multi-casa — em produção, com só Superbet, fica oculto). [[B6]]
export default function BrandConfigEditor({ affiliateId, brandRows, config, onSaved }: BrandConfigEditorProps) {
  // Casas únicas por brandId (a linha de marca traz o brandId em `id`).
  const houses = useMemo(() => {
    const seen = new Map<string, { id: string; name: string }>();
    for (const r of Array.isArray(brandRows) ? brandRows : []) {
      const id = String(r?.id ?? '');
      if (!id || seen.has(id)) continue;
      seen.set(id, { id, name: humanizeName(String(r?.label || r?.name || id)) });
    }
    return Array.from(seen.values());
  }, [brandRows]);

  const def = resolveBrandRates(config); // default de topo (placeholder)

  // Estado dos inputs por casa. Pré-preenche com o override existente; quando a
  // casa não tem override, deixa vazio (placeholder mostra o default).
  const [rates, setRates] = useState<Record<string, { cpa: string; rev: string }>>(() => {
    const init: Record<string, { cpa: string; rev: string }> = {};
    for (const h of houses) {
      const o = config?.byBrand?.[h.id];
      init[h.id] = {
        cpa: o && Number.isFinite(Number(o.cpaValue)) ? String(o.cpaValue) : '',
        rev: o && Number.isFinite(Number(o.revPercentage)) ? String(o.revPercentage) : '',
      };
    }
    return init;
  });

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (houses.length < 2) return null; // dev-gated: só multi-casa

  const setField = (id: string, field: 'cpa' | 'rev', value: string) => {
    setSaved(false);
    setRates((prev) => ({ ...prev, [id]: { ...(prev[id] || { cpa: '', rev: '' }), [field]: value } }));
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      // Monta byBrand só com casas que têm ALGUM override preenchido. Casa com
      // ambos vazios = sem override (herda o default).
      const byBrand: Record<string, BrandRates> = {};
      for (const h of houses) {
        const v = rates[h.id] || { cpa: '', rev: '' };
        const hasCpa = v.cpa.trim() !== '';
        const hasRev = v.rev.trim() !== '';
        if (!hasCpa && !hasRev) continue;
        byBrand[h.id] = {
          cpaValue: hasCpa ? Number(v.cpa) || 0 : def.cpaValue,
          revPercentage: hasRev ? Number(v.rev) || 0 : def.revPercentage,
        };
      }
      await saveAffiliateBrandRates(affiliateId, byBrand);
      setSaved(true);
      onSaved?.();
    } catch (e: any) {
      setError(e?.message || 'Erro ao salvar comissão por casa');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white dark:bg-neutral-900 p-8 rounded-3xl border border-slate-100 dark:border-neutral-800 shadow-sm mb-8">
      <div className="flex items-center gap-2 mb-2">
        <div className="p-2 rounded-xl bg-slate-100 dark:bg-neutral-800 text-slate-500 dark:text-neutral-300">
          <Store size={16} />
        </div>
        <div className="flex items-center gap-1 text-xs font-black text-slate-900 dark:text-white uppercase tracking-widest">
          Comissão por casa
          <InfoTooltip
            text="Defina CPA (R$) e REV (%) específicos por casa de aposta. Deixe em branco para usar o valor padrão do contrato do afiliado."
            align="left"
          />
        </div>
      </div>
      <p className="text-[11px] text-slate-400 mb-6">
        Padrão do contrato: <span className="font-bold">R$ {def.cpaValue}/CPA</span> ·{' '}
        <span className="font-bold">{def.revPercentage}% REV</span>. Em branco = usa o padrão.
      </p>

      <div className="space-y-4">
        {houses.map((h) => (
          <div
            key={h.id}
            className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 bg-slate-50 dark:bg-neutral-800/50 rounded-2xl border border-slate-100 dark:border-neutral-800"
          >
            <div className="flex items-center gap-3 sm:w-40 shrink-0">
              <div className="w-7 h-7 rounded bg-brand flex items-center justify-center text-white font-black text-[10px]">
                {h.name.charAt(0).toUpperCase()}
              </div>
              <span className="text-xs font-bold text-slate-700 dark:text-neutral-300">{h.name}</span>
            </div>
            <div className="flex-1 grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-[10px] uppercase tracking-widest font-bold text-slate-400">CPA (R$)</span>
                <input
                  type="number"
                  min={0}
                  inputMode="decimal"
                  value={rates[h.id]?.cpa ?? ''}
                  onChange={(e) => setField(h.id, 'cpa', e.target.value)}
                  placeholder={String(def.cpaValue)}
                  className="mt-1 w-full px-3 py-2 bg-white dark:bg-neutral-800 border border-slate-200 dark:border-neutral-700 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand transition-all dark:text-white"
                />
              </label>
              <label className="block">
                <span className="text-[10px] uppercase tracking-widest font-bold text-slate-400">REV (%)</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  inputMode="decimal"
                  value={rates[h.id]?.rev ?? ''}
                  onChange={(e) => setField(h.id, 'rev', e.target.value)}
                  placeholder={String(def.revPercentage)}
                  className="mt-1 w-full px-3 py-2 bg-white dark:bg-neutral-800 border border-slate-200 dark:border-neutral-700 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand transition-all dark:text-white"
                />
              </label>
            </div>
          </div>
        ))}
      </div>

      {error && <p className="text-xs font-bold text-rose-500 mt-4">{error}</p>}

      <div className="flex items-center justify-end gap-3 mt-6">
        {saved && !saving && (
          <span className="flex items-center gap-1 text-xs font-bold text-emerald-500">
            <Check size={14} /> Salvo
          </span>
        )}
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-5 py-2.5 bg-slate-900 dark:bg-white text-white dark:text-neutral-950 rounded-xl hover:scale-[1.02] active:scale-[0.98] transition-all font-bold text-xs uppercase tracking-wider shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Salvar comissão por casa
        </button>
      </div>
    </div>
  );
}
