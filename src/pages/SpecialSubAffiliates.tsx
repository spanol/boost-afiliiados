import React, { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { Loader2, Users, ArrowUpRight, UserPlus, Wallet, Target, Crown, Save, Percent } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import {
  fetchSpecialAffiliates,
  fetchAllResults,
  fetchAffiliateConfigs,
  saveSubAffiliateConfig,
  calcAffiliatePayout,
  SpecialAffiliate,
  AffiliateConfig,
} from '../services/affiliateService';
import DateRangePicker from '../components/DateRangePicker';
import { DateRange, getDefaultRange } from '../lib/dateRange';
import { humanizeName } from '../lib/utils';

const brl = (n: number) => `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Passo 3 · Lista de sub-afiliados do afiliado especial — espelha o "Afiliados" do
// master, capado à própria rede. Cada sub abre a AffiliateDetails escopada
// (/affiliates/:id) — o proxy libera o especial a ler os subs, e as rules liberam
// nome (affiliates) e config (affiliate_configs) a signed-in.
export default function SpecialSubAffiliates() {
  const { profile } = useAuth();
  const { push } = useToast();
  const navigate = useNavigate();
  const [range, setRange] = useState<DateRange>(() => getDefaultRange());
  const [loading, setLoading] = useState(true);
  const [special, setSpecial] = useState<SpecialAffiliate | null>(null);
  const [results, setResults] = useState<any[]>([]);
  const [configs, setConfigs] = useState<Record<string, AffiliateConfig>>({});
  // Edição da comissão de cada sub (CPA/REV), com teto = taxa própria do especial.
  const [subEdits, setSubEdits] = useState<Record<string, { cpaValue: number | string; revPercentage: number | string }>>({});
  const [savingSub, setSavingSub] = useState<string | null>(null);

  const ownId = profile?.affiliateId ? String(profile.affiliateId) : '';

  const load = async () => {
    if (!ownId) return;
    try {
      setLoading(true);
      const [specials, rows, cfgs] = await Promise.all([
        fetchSpecialAffiliates(),
        fetchAllResults(range),
        fetchAffiliateConfigs(),
      ]);
      const mine = specials[ownId] || null;
      setSpecial(mine);
      setResults(Array.isArray(rows) ? rows : []);
      setConfigs(cfgs);
      // semente dos inputs editáveis a partir dos configs salvos
      const seed: Record<string, { cpaValue: number | string; revPercentage: number | string }> = {};
      (mine?.subAffiliateIds || []).forEach((id) => {
        const c = cfgs[String(id)];
        seed[String(id)] = { cpaValue: c?.cpaValue ?? 0, revPercentage: c?.revPercentage ?? 0 };
      });
      setSubEdits(seed);
    } catch (e) {
      console.error('Erro ao carregar sub-afiliados:', e);
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (ownId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownId, range.startDate, range.endDate]);

  const ownConfig = useMemo<AffiliateConfig>(() => ({
    affiliateId: ownId,
    cpaValue: configs[ownId]?.cpaValue || 0,
    revPercentage: configs[ownId]?.revPercentage || 0,
  }), [ownId, configs]);

  const rowById = (id: string) => results.find((r) => String(r.affiliate_id ?? r.id ?? '') === String(id));
  const subIds = special?.subAffiliateIds?.map(String) || [];

  // Teto = taxa própria do especial: a comissão do sub não passa dela (spread ≥ 0).
  const handleSubChange = (id: string, field: 'cpaValue' | 'revPercentage', value: string) => {
    const teto = field === 'cpaValue' ? (ownConfig.cpaValue || 0) : (ownConfig.revPercentage || 0);
    const next = value === '' ? '' : Math.min(teto, Math.max(0, parseFloat(value) || 0));
    setSubEdits((prev) => ({ ...prev, [id]: { ...(prev[id] || { cpaValue: 0, revPercentage: 0 }), [field]: next } }));
  };

  const handleSaveSub = async (id: string) => {
    const edit = subEdits[id] || { cpaValue: 0, revPercentage: 0 };
    setSavingSub(id);
    try {
      await saveSubAffiliateConfig(id, Number(edit.cpaValue) || 0, Number(edit.revPercentage) || 0);
      push({ type: 'success', message: 'Comissão do sub-afiliado atualizada.' });
      await load();
    } catch (err) {
      push({ type: 'error', message: err instanceof Error ? err.message : 'Falha ao salvar comissão.' });
    } finally {
      setSavingSub(null);
    }
  };

  if (profile && !profile.isSpecial) return <Navigate to="/dashboard" replace />;

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <Loader2 size={40} className="text-amber-500 animate-spin" />
        <p className="text-xs font-bold text-slate-400 dark:text-neutral-500 uppercase tracking-widest animate-pulse">Carregando seus afiliados...</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-20">
      <header className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <div>
          <span className="inline-flex items-center gap-1.5 px-3 py-1 mb-3 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-[10px] font-bold uppercase tracking-widest">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
            Sua rede
          </span>
          <h1 className="text-3xl md:text-4xl font-bold text-slate-900 dark:text-white tracking-tighter flex items-center gap-3">
            <span className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/20">
              <Users size={24} className="text-amber-500" />
            </span>
            Meus afiliados
          </h1>
          <p className="text-slate-500 dark:text-neutral-400 text-sm mt-2">{subIds.length} sub-afiliado(s) vinculado(s). Defina a comissão de cada um e abra os dados individuais.</p>
        </div>
        <DateRangePicker value={range} onChange={setRange} />
      </header>

      {subIds.length === 0 ? (
        <div className="p-16 text-center rounded-3xl border border-slate-200/70 dark:border-neutral-800 bg-white dark:bg-neutral-900/60">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl border border-slate-100 dark:border-neutral-700/60 bg-slate-50 dark:bg-neutral-800/60 text-slate-500 dark:text-neutral-300 mb-4">
            <Users size={24} />
          </div>
          <h3 className="text-sm font-bold text-slate-800 dark:text-neutral-100 mb-1">Nenhum sub-afiliado vinculado</h3>
          <p className="text-xs text-slate-500 dark:text-neutral-400">Fale com o administrador para vincular afiliados à sua rede.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {subIds.map((id, idx) => {
            const r = rowById(id) || {};
            const name = humanizeName(r.affiliate_name || r.name || r.label || `#${id}`);
            // Seu ganho com este sub = spread (taxa própria − taxa do sub) sobre a produção dele.
            const spread = calcAffiliatePayout(r, ownConfig) - calcAffiliatePayout(r, configs[id]);
            const stats = [
              { label: 'Cadastros', value: (r.registrations || 0).toLocaleString('pt-BR'), icon: UserPlus },
              { label: 'Depósitos', value: (r.first_deposits || 0).toLocaleString('pt-BR'), icon: Wallet },
              { label: 'CPA Qualif.', value: (r.qualified_cpa || 0).toLocaleString('pt-BR'), icon: Target },
            ];
            return (
              <motion.div
                key={id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.05 }}
                className="group relative overflow-hidden p-6 rounded-2xl border bg-white dark:bg-neutral-900/60 border-slate-200/70 dark:border-neutral-800 shadow-sm hover:border-slate-300 dark:hover:border-neutral-700 transition-all"
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{name}</p>
                    <p className="text-[10px] font-mono uppercase tracking-widest text-slate-400 dark:text-neutral-500 mt-0.5 truncate">Sub #{id}</p>
                  </div>
                  <button
                    onClick={() => navigate(`/affiliates/${id}`)}
                    title="Ver dados do afiliado"
                    className="shrink-0 p-2 rounded-xl border bg-slate-50 dark:bg-neutral-800/60 border-slate-100 dark:border-neutral-700/60 text-slate-400 dark:text-neutral-500 hover:text-amber-500 hover:border-amber-500/30 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40"
                  >
                    <ArrowUpRight size={16} />
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-3 mb-4">
                  {stats.map((s) => (
                    <div key={s.label}>
                      <span className="text-[9px] uppercase font-bold tracking-widest text-slate-400 dark:text-neutral-500">{s.label}</span>
                      <p className="font-bold text-base text-slate-800 dark:text-white mt-0.5 truncate">{s.value}</p>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between mb-3">
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-emerald-600 dark:text-emerald-400">
                    <Crown size={11} /> Seu ganho
                  </span>
                  <span className="text-sm font-black text-emerald-700 dark:text-emerald-400 tabular-nums">{brl(spread)}</span>
                </div>
                {/* Edição da comissão do sub (teto = taxa própria do especial). */}
                <div className="pt-4 border-t border-slate-100 dark:border-neutral-800">
                  <p className="text-[10px] font-bold text-slate-400 dark:text-neutral-500 uppercase tracking-widest mb-2">
                    Comissão do sub <span className="normal-case font-medium">(teto: R$ {ownConfig.cpaValue}/CPA · {ownConfig.revPercentage}% REV)</span>
                  </p>
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] font-black text-slate-400 dark:text-neutral-500">R$</span>
                      <input
                        type="number" min="0" max={ownConfig.cpaValue || 0} step="0.01"
                        value={subEdits[id]?.cpaValue ?? 0}
                        onChange={(e) => handleSubChange(id, 'cpaValue', e.target.value)}
                        className="w-full pl-7 pr-2 py-2 bg-slate-50 dark:bg-neutral-800/60 border border-slate-200 dark:border-neutral-700 rounded-lg text-[11px] font-bold outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-all dark:text-white"
                      />
                    </div>
                    <div className="relative flex-1">
                      <Percent size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-300 dark:text-neutral-500" />
                      <input
                        type="number" min="0" max={ownConfig.revPercentage || 0} step="0.1"
                        value={subEdits[id]?.revPercentage ?? 0}
                        onChange={(e) => handleSubChange(id, 'revPercentage', e.target.value)}
                        className="w-full pl-6 pr-2 py-2 bg-slate-50 dark:bg-neutral-800/60 border border-slate-200 dark:border-neutral-700 rounded-lg text-[11px] font-bold outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-all dark:text-white"
                      />
                    </div>
                    <button
                      onClick={() => handleSaveSub(id)}
                      disabled={savingSub === id}
                      className="p-2 rounded-lg bg-amber-50 text-amber-600 hover:bg-amber-500 hover:text-white dark:bg-amber-900/10 dark:text-amber-400 dark:hover:bg-amber-500 dark:hover:text-white transition-all disabled:opacity-50"
                    >
                      {savingSub === id ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                    </button>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
