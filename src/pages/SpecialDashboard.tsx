import React, { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { Loader2, DollarSign, UserPlus, Wallet, Target, Crown, Save, Percent, HelpCircle, Users } from 'lucide-react';
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
import { cn } from '../lib/utils';

const brl = (n: number) => `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// B3 · Painel do afiliado especial — vê a própria sub-rede (own + subs vinculados),
// o ganho dele (spread sobre os subs + produção própria) e edita a comissão dos subs
// (limitada ao teto que o master definiu). Dados via proxy escopado (server B3 Fase 2).
export default function SpecialDashboard() {
  const { profile } = useAuth();
  const { push } = useToast();
  const [range, setRange] = useState<DateRange>(() => getDefaultRange());
  const [loading, setLoading] = useState(true);
  const [special, setSpecial] = useState<SpecialAffiliate | null>(null);
  const [results, setResults] = useState<any[]>([]);
  const [configs, setConfigs] = useState<Record<string, AffiliateConfig>>({});
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
    } catch (err) {
      console.error('Erro ao carregar painel da sub-rede:', err);
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (ownId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownId, range.startDate, range.endDate]);

  // Taxa PRÓPRIA do especial (o CPA/REV que o master configurou pra ele). É a
  // referência do ganho: a agência paga o especial por essa taxa sobre toda a
  // rede; ele repassa cada sub pela taxa que define e fica com o spread.
  const ownConfig = useMemo<AffiliateConfig>(() => ({
    affiliateId: ownId,
    cpaValue: configs[ownId]?.cpaValue || 0,
    revPercentage: configs[ownId]?.revPercentage || 0,
  }), [ownId, configs]);

  const rowById = (id: string) => results.find((r) => String(r.affiliate_id ?? r.id ?? '') === String(id));
  const ownRow = rowById(ownId);
  const subIds = special?.subAffiliateIds?.map(String) || [];

  // Funil agregado da sub-rede (own + subs).
  const funnelTotals = results.reduce((acc, r) => ({
    registrations: acc.registrations + (r.registrations || 0),
    firstDeposits: acc.firstDeposits + (r.first_deposits || 0),
    deposit: acc.deposit + (r.deposit || 0),
    qualifiedCpa: acc.qualifiedCpa + (r.qualified_cpa || 0),
  }), { registrations: 0, firstDeposits: 0, deposit: 0, qualifiedCpa: 0 });

  // Lucro líquido do especial = link dele (produção própria) + lucro da rede (spread).
  // Spread por sub = taxa própria do especial − taxa que ele definiu pro sub.
  const ownPayout = calcAffiliatePayout(ownRow, ownConfig);
  const spreadTotal = subIds.reduce((sum, id) => {
    const r = rowById(id);
    if (!r) return sum;
    return sum + (calcAffiliatePayout(r, ownConfig) - calcAffiliatePayout(r, configs[id]));
  }, 0);
  const earnings = ownPayout + spreadTotal;

  const funnel = [
    { label: 'Cadastros', value: funnelTotals.registrations.toLocaleString('pt-BR'), icon: UserPlus },
    { label: 'Primeiros Depósitos', value: funnelTotals.firstDeposits.toLocaleString('pt-BR'), icon: Wallet },
    { label: 'Valor Depositado', value: brl(funnelTotals.deposit), icon: DollarSign },
    { label: 'CPA Qualificado', value: funnelTotals.qualifiedCpa.toLocaleString('pt-BR'), icon: Target },
  ];

  const handleSubChange = (id: string, field: 'cpaValue' | 'revPercentage', value: string) => {
    const next = value === '' ? '' : Math.max(0, parseFloat(value) || 0);
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

  // Guard: só afiliado especial acessa esta rota.
  if (profile && !profile.isSpecial) return <Navigate to="/dashboard" replace />;

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <Loader2 size={40} className="text-amber-500 animate-spin" />
        <p className="text-xs font-bold text-slate-400 dark:text-neutral-500 uppercase tracking-widest animate-pulse">Carregando sua rede...</p>
      </div>
    );
  }

  const renderAffiliateCard = (id: string, isOwn: boolean, idx: number) => {
    const r = rowById(id) || {};
    // A API externa traz o nome do afiliado no campo `label` (não em affiliate_name);
    // sem checá-lo, o card do sub aparecia como o ID cru (#cmovjh...).
    const name = isOwn ? (profile?.name || 'Você') : (r.affiliate_name || r.name || r.label || `#${id}`);
    const stats = [
      { label: 'Cadastros', value: r.registrations || 0 },
      { label: 'Depósitos', value: r.first_deposits || 0 },
      { label: 'CPA Qualif.', value: r.qualified_cpa || 0 },
      { label: 'Valor Depos.', value: brl(r.deposit || 0) },
    ];
    return (
      <motion.div
        key={id}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: idx * 0.05 }}
        className={cn(
          'group relative overflow-hidden p-6 rounded-2xl border shadow-sm transition-all',
          isOwn
            ? 'bg-white dark:bg-neutral-900/60 border-amber-200/70 dark:border-amber-900/40 hover:border-amber-300 dark:hover:border-amber-800'
            : 'bg-white dark:bg-neutral-900/60 border-slate-200/70 dark:border-neutral-800 hover:border-slate-300 dark:hover:border-neutral-700'
        )}
      >
        {isOwn && (
          <div className="absolute top-0 right-0 w-40 h-40 bg-amber-500/10 rounded-full blur-3xl -mr-12 -mt-12 pointer-events-none" />
        )}
        <div className="relative flex items-center justify-between mb-4">
          <div className="min-w-0">
            <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{name}</p>
            <p className="text-[10px] font-mono uppercase tracking-widest text-slate-400 dark:text-neutral-500 mt-0.5">
              {isOwn ? 'Sua produção' : `Sub #${id}`}
            </p>
          </div>
          <span
            className={cn(
              'shrink-0 p-2 rounded-xl border transition-transform group-hover:scale-105',
              isOwn
                ? 'bg-amber-500/10 border-amber-500/20 text-amber-500'
                : 'bg-slate-50 dark:bg-neutral-800/60 border-slate-100 dark:border-neutral-700/60 text-slate-400 dark:text-neutral-500'
            )}
          >
            {isOwn ? <Crown size={16} /> : <Users size={16} />}
          </span>
        </div>
        <div className="relative grid grid-cols-2 gap-3">
          {stats.map((s) => (
            <div key={s.label}>
              <span className="text-[10px] uppercase font-bold tracking-widest text-slate-400 dark:text-neutral-500">{s.label}</span>
              <p className="font-bold text-base text-slate-800 dark:text-white mt-0.5 truncate">{s.value}</p>
            </div>
          ))}
        </div>

        {!isOwn && (
          <div className="relative mt-5 pt-4 border-t border-slate-100 dark:border-neutral-800">
            <p className="text-[10px] font-bold text-slate-400 dark:text-neutral-500 uppercase tracking-widest mb-2">
              Comissão do sub <span className="normal-case font-medium">(sua taxa: R$ {ownConfig.cpaValue}/CPA · {ownConfig.revPercentage}% REV)</span>
            </p>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] font-black text-slate-400 dark:text-neutral-500">R$</span>
                <input
                  type="number" min="0" step="0.01"
                  value={subEdits[id]?.cpaValue ?? 0}
                  onChange={(e) => handleSubChange(id, 'cpaValue', e.target.value)}
                  className="w-full pl-7 pr-2 py-2 bg-slate-50 dark:bg-neutral-800/60 border border-slate-200 dark:border-neutral-700 rounded-lg text-[11px] font-bold outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-all dark:text-white"
                />
              </div>
              <div className="relative flex-1">
                <Percent size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-300 dark:text-neutral-500" />
                <input
                  type="number" min="0" step="0.1"
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
        )}
      </motion.div>
    );
  };

  return (
    <div className="space-y-8 pb-20">
      <header className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <div>
          <span className="inline-flex items-center gap-1.5 px-3 py-1 mb-3 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-[10px] font-bold uppercase tracking-widest">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
            Afiliado especial
          </span>
          <h1 className="text-3xl md:text-4xl font-bold text-slate-900 dark:text-white tracking-tighter flex items-center gap-3">
            <span className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/20">
              <Crown size={24} className="text-amber-500" />
            </span>
            Sua rede
          </h1>
          <p className="text-slate-500 dark:text-neutral-400 text-sm mt-2">{subIds.length} sub-afiliado(s) + sua produção.</p>
        </div>
        <DateRangePicker value={range} onChange={setRange} />
      </header>

      {/* Ganho do especial (spread sobre subs + produção própria) */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden p-6 md:p-7 rounded-2xl border border-emerald-200/70 dark:border-emerald-900/40 bg-emerald-50/60 dark:bg-emerald-950/20 shadow-sm flex items-center justify-between gap-4"
      >
        <div className="absolute top-0 right-0 w-56 h-56 bg-emerald-500/10 rounded-full blur-3xl -mr-16 -mt-16 pointer-events-none" />
        <div className="relative">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 mb-3 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-[10px] font-bold uppercase tracking-widest">
            Lucro líquido no período <HelpCircle size={12} />
          </span>
          <h3 className="text-3xl md:text-4xl font-bold tracking-tighter text-emerald-700 dark:text-emerald-400">{brl(earnings)}</h3>
          <p className="text-[11px] font-medium text-slate-500 dark:text-neutral-400 mt-2 max-w-2xl">
            Seu link ({brl(ownPayout)}) + lucro da rede ({brl(spreadTotal)}) — já com os repasses aos sub-afiliados descontados.
          </p>
        </div>
        <div className="relative shrink-0 p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-500">
          <DollarSign size={24} />
        </div>
      </motion.div>

      {/* Funil agregado da sub-rede */}
      <section>
        <h3 className="text-[10px] uppercase font-bold tracking-widest text-slate-400 dark:text-neutral-500 mb-3 px-1">Funil da rede</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {funnel.map((item, idx) => (
            <motion.div
              key={item.label}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.05 }}
              className="group p-6 rounded-2xl border bg-white dark:bg-neutral-900/60 border-slate-200/70 dark:border-neutral-800 shadow-sm hover:border-slate-300 dark:hover:border-neutral-700 transition-all"
            >
              <div className="p-2.5 mb-4 w-fit rounded-xl border bg-slate-50 dark:bg-neutral-800/60 border-slate-100 dark:border-neutral-700/60 transition-transform group-hover:scale-105">
                <item.icon size={20} className="text-slate-900 dark:text-neutral-100" />
              </div>
              <p className="text-[10px] uppercase font-bold tracking-widest mb-1.5 text-slate-400 dark:text-neutral-500">{item.label}</p>
              <h3 className="text-2xl font-bold tracking-tight truncate text-slate-900 dark:text-white">{item.value}</h3>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Cards por afiliado (própria produção + cada sub, com edição de comissão) */}
      <section>
        <h3 className="text-[10px] uppercase font-bold tracking-widest text-slate-400 dark:text-neutral-500 mb-3 px-1">Por afiliado</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {ownId && renderAffiliateCard(ownId, true, 0)}
          {subIds.map((id, i) => renderAffiliateCard(id, false, i + 1))}
        </div>
      </section>
    </div>
  );
}
