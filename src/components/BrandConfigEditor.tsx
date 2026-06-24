import React, { useMemo, useState } from 'react';
import { Store, Save, Loader2, Check, Tag } from 'lucide-react';
import {
  resolveBrandRates,
  saveAffiliateBrandRates,
  saveAffiliateConfig,
  type AffiliateConfig,
  type BrandRates,
} from '../services/affiliateService';
import { humanizeName } from '../lib/utils';
import InfoTooltip from './InfoTooltip';
import BrandLogo from './BrandLogo';

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

// B6 · Editor de comissão do afiliado. Topo "Padrão do contrato" (taxa-base que
// TODAS as telas leem — inclusive o lucro da agência) + overrides POR CASA
// (byBrand, prioridade só naquela casa). Antes o padrão aqui era só TEXTO e só
// dava p/ editar por casa — então setar a taxa pela tela do afiliado ia só pro
// byBrand, e a manchete/Gestão (que leem o topo) "não atualizavam". Agora os
// dois são editáveis e gravam no MESMO doc. [[B6]] [[boost-net-profit-per-house]]
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

  // Padrão do contrato (taxa de TOPO) — agora EDITÁVEL. Prefill com o valor salvo
  // (mantém 0 explícito; vazio = ainda não configurado).
  const [base, setBase] = useState<{ cpa: string; rev: string }>(() => ({
    cpa: config?.cpaValue != null ? String(config.cpaValue) : '',
    rev: config?.revPercentage != null ? String(config.revPercentage) : '',
  }));

  // Estado dos inputs por casa. Pré-preenche com o override existente; quando a
  // casa não tem override, deixa vazio (placeholder mostra o padrão ATUAL).
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

  // Padrão "ao vivo": o que está digitado no topo (fallback = salvo). É a base dos
  // placeholders das casas e do preenchimento parcial de um override.
  const saved0 = resolveBrandRates(config);
  const liveDef: BrandRates = {
    cpaValue: base.cpa.trim() !== '' ? Number(base.cpa) || 0 : saved0.cpaValue,
    revPercentage: base.rev.trim() !== '' ? Number(base.rev) || 0 : saved0.revPercentage,
  };

  if (houses.length < 2) return null; // dev-gated: só multi-casa

  const setBaseField = (field: 'cpa' | 'rev', value: string) => {
    setSaved(false);
    setBase((prev) => ({ ...prev, [field]: value }));
  };

  const setField = (id: string, field: 'cpa' | 'rev', value: string) => {
    setSaved(false);
    setRates((prev) => ({ ...prev, [id]: { ...(prev[id] || { cpa: '', rev: '' }), [field]: value } }));
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      // Topo: grava o padrão do contrato (vazio = mantém o salvo, não zera).
      const baseRates = {
        cpaValue: base.cpa.trim() !== '' ? Number(base.cpa) || 0 : (Number(config?.cpaValue) || 0),
        revPercentage: base.rev.trim() !== '' ? Number(base.rev) || 0 : (Number(config?.revPercentage) || 0),
      };
      // byBrand: só casas com ALGUM override preenchido; preenchimento parcial
      // herda o padrão (o que está sendo salvo agora). Casa vazia = herda o topo.
      const byBrand: Record<string, BrandRates> = {};
      for (const h of houses) {
        const v = rates[h.id] || { cpa: '', rev: '' };
        const hasCpa = v.cpa.trim() !== '';
        const hasRev = v.rev.trim() !== '';
        if (!hasCpa && !hasRev) continue;
        byBrand[h.id] = {
          cpaValue: hasCpa ? Number(v.cpa) || 0 : baseRates.cpaValue,
          revPercentage: hasRev ? Number(v.rev) || 0 : baseRates.revPercentage,
        };
      }
      // Mesmo doc (merge): o topo é o que a manchete de lucro e a view "Todas as
      // casas" leem; o byBrand é o override por casa. Gravar os dois aqui faz a
      // tela do afiliado ficar consistente com a Gestão de Afiliados.
      // Só grava o topo se o admin preencheu o Padrão OU já existia um topo — assim
      // editar SÓ um override por casa não cria um topo 0/0 "fantasma" num afiliado
      // que nunca teve taxa de contrato (preserva o selo "CPA não configurado").
      const baseTouched = base.cpa.trim() !== '' || base.rev.trim() !== '';
      const hadTopLevel = config?.cpaValue != null || config?.revPercentage != null;
      if (baseTouched || hadTopLevel) {
        await saveAffiliateConfig({ affiliateId, cpaValue: baseRates.cpaValue, revPercentage: baseRates.revPercentage });
      }
      await saveAffiliateBrandRates(affiliateId, byBrand);
      setSaved(true);
      onSaved?.();
    } catch (e: any) {
      setError(e?.message || 'Erro ao salvar comissão');
    } finally {
      setSaving(false);
    }
  };

  const inputCls =
    'mt-1 w-full px-3 py-2 bg-white dark:bg-neutral-800 border border-slate-200 dark:border-neutral-700 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand dark:focus:border-white/30 transition-all dark:text-white';
  const labelCls = 'text-[10px] uppercase tracking-widest font-bold text-slate-400 dark:text-neutral-400';

  return (
    <div className="bg-white dark:bg-neutral-900 p-8 rounded-3xl border border-slate-100 dark:border-neutral-800 shadow-sm mb-8">
      <div className="flex items-center gap-2 mb-2">
        <div className="p-2 rounded-xl bg-slate-100 dark:bg-neutral-800 text-slate-500 dark:text-neutral-300">
          <Store size={16} />
        </div>
        <div className="flex items-center gap-1 text-xs font-black text-slate-900 dark:text-white uppercase tracking-widest">
          Comissão do afiliado
          <InfoTooltip
            text="O Padrão do contrato é a taxa-base, lida por todas as telas (inclusive o lucro da agência). Os overrides por casa têm prioridade só naquela casa. Em branco = usa o padrão."
            align="left"
          />
        </div>
      </div>
      <p className="text-[11px] text-slate-400 dark:text-neutral-400 mb-6">
        O <span className="font-bold">Padrão do contrato</span> vale para todas as casas. Defina um{' '}
        <span className="font-bold">override por casa</span> só quando o acordo daquela casa for diferente.
      </p>

      {/* #1 · Padrão do contrato (taxa de topo) — EDITÁVEL (antes era só texto) */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 mb-5 bg-amber-50/60 dark:bg-amber-900/10 rounded-2xl border border-amber-200/70 dark:border-amber-900/40">
        <div className="flex items-center gap-3 sm:w-40 shrink-0">
          <div className="w-7 h-7 rounded-lg bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center text-amber-600 dark:text-amber-400">
            <Tag size={15} />
          </div>
          <span className="text-xs font-bold text-slate-700 dark:text-neutral-200">Padrão do contrato</span>
        </div>
        <div className="flex-1 grid grid-cols-2 gap-3">
          <label className="block">
            <span className={labelCls}>CPA (R$)</span>
            <input type="number" min={0} inputMode="decimal" value={base.cpa} onChange={(e) => setBaseField('cpa', e.target.value)} placeholder="0" className={inputCls} />
          </label>
          <label className="block">
            <span className={labelCls}>REV (%)</span>
            <input type="number" min={0} max={100} inputMode="decimal" value={base.rev} onChange={(e) => setBaseField('rev', e.target.value)} placeholder="0" className={inputCls} />
          </label>
        </div>
      </div>

      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-neutral-500 mb-3">
        Overrides por casa (opcional)
      </p>
      <div className="space-y-4">
        {houses.map((h) => (
          <div
            key={h.id}
            className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 bg-slate-50 dark:bg-neutral-800/50 rounded-2xl border border-slate-100 dark:border-neutral-800"
          >
            <div className="flex items-center gap-3 sm:w-40 shrink-0">
              <BrandLogo name={h.name} brandId={h.id} size={28} />
              <span className="text-xs font-bold text-slate-700 dark:text-neutral-300">{h.name}</span>
            </div>
            <div className="flex-1 grid grid-cols-2 gap-3">
              <label className="block">
                <span className={labelCls}>CPA (R$)</span>
                <input
                  type="number"
                  min={0}
                  inputMode="decimal"
                  value={rates[h.id]?.cpa ?? ''}
                  onChange={(e) => setField(h.id, 'cpa', e.target.value)}
                  placeholder={String(liveDef.cpaValue)}
                  className={inputCls}
                />
              </label>
              <label className="block">
                <span className={labelCls}>REV (%)</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  inputMode="decimal"
                  value={rates[h.id]?.rev ?? ''}
                  onChange={(e) => setField(h.id, 'rev', e.target.value)}
                  placeholder={String(liveDef.revPercentage)}
                  className={inputCls}
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
          Salvar comissão
        </button>
      </div>
    </div>
  );
}
