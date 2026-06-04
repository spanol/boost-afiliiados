import React, { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { Loader2, DollarSign, UserPlus, Wallet, Target, Crown, HelpCircle, Users, BarChart3, TrendingUp } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
  fetchSpecialAffiliates,
  fetchAllResults,
  fetchAllResultsByBrand,
  fetchAllResultsByCampaign,
  fetchAllDailyResults,
  fetchAffiliateConfigs,
  calcAffiliatePayout,
  SpecialAffiliate,
  AffiliateConfig,
  CampaignRow,
} from '../services/affiliateService';
import DateRangePicker from '../components/DateRangePicker';
import BrandBreakdown from '../components/BrandBreakdown';
import CampaignBreakdown from '../components/CampaignBreakdown';
import DailyPerformanceChart from '../components/DailyPerformanceChart';
import { DateRange, getDefaultRange } from '../lib/dateRange';
import { cn, humanizeName } from '../lib/utils';

const brl = (n: number) => `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// B3 · Painel do afiliado especial — vê a própria sub-rede (own + subs vinculados),
// o ganho dele (spread sobre os subs + produção própria) e edita a comissão dos subs
// (limitada ao teto que o master definiu). Dados via proxy escopado (server B3 Fase 2).
export default function SpecialDashboard() {
  const { profile } = useAuth();
  const [range, setRange] = useState<DateRange>(() => getDefaultRange());
  const [loading, setLoading] = useState(true);
  const [special, setSpecial] = useState<SpecialAffiliate | null>(null);
  const [results, setResults] = useState<any[]>([]);
  // Visões analíticas da rede (own + subs), escopadas pelo proxy (B3 Fase 2).
  const [brandResults, setBrandResults] = useState<any[]>([]);
  const [campaignResults, setCampaignResults] = useState<CampaignRow[]>([]);
  const [dailyResults, setDailyResults] = useState<any[]>([]);
  const [configs, setConfigs] = useState<Record<string, AffiliateConfig>>({});

  const ownId = profile?.affiliateId ? String(profile.affiliateId) : '';

  const load = async () => {
    if (!ownId) return;
    try {
      setLoading(true);
      // brand/campaign/daily vão SEM affiliateIds — o proxy escopa à sub-rede do
      // especial (own + subs). Agregados pela API por casa/campanha/dia.
      const [specials, rows, byBrand, byCampaign, byDay, cfgs] = await Promise.all([
        fetchSpecialAffiliates(),
        fetchAllResults(range),
        fetchAllResultsByBrand(range),
        fetchAllResultsByCampaign(range),
        fetchAllDailyResults(range),
        fetchAffiliateConfigs(),
      ]);
      const mine = specials[ownId] || null;
      setSpecial(mine);
      setResults(Array.isArray(rows) ? rows : []);
      setBrandResults(Array.isArray(byBrand) ? byBrand : []);
      setCampaignResults(Array.isArray(byCampaign) ? byCampaign : []);
      setDailyResults(Array.isArray(byDay) ? byDay : []);
      setConfigs(cfgs);
    } catch (err) {
      console.error('Erro ao carregar painel da sub-rede:', err);
      setResults([]);
      setBrandResults([]);
      setCampaignResults([]);
      setDailyResults([]);
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

  // Comissão total do especial = taxa PRÓPRIA aplicada sobre TODA a rede (própria + subs).
  // É o que a agência paga ao especial; o lucro líquido = comissão total − repasse aos subs.
  // Mantém a regra do lucro líquido: tudo à taxa do especial, nunca a comissão bruta da casa.
  const comissaoTotal = results.reduce((sum, r) => sum + calcAffiliatePayout(r, ownConfig), 0);
  const cpaPortion = results.reduce((sum, r) => sum + (r.qualified_cpa || 0) * (ownConfig.cpaValue || 0), 0);
  const revPortion = results.reduce((sum, r) => sum + (r.rvs || 0) * ((ownConfig.revPercentage || 0) / 100), 0);
  const repasse = comissaoTotal - earnings;

  // Cards de métrica (espelham o /admin, capados à rede do especial).
  const metrics = [
    { label: 'Afiliados na rede', value: String(subIds.length), icon: Users },
    { label: 'Comissão total', value: brl(comissaoTotal), icon: DollarSign },
    { label: 'Total CPA', value: brl(cpaPortion), icon: BarChart3 },
    { label: 'Total REV', value: brl(revPortion), icon: TrendingUp },
  ];

  // Série diária: a API agrega own+subs por dia. Substituímos a comissão da CASA
  // (total_commission cru) pela comissão DO ESPECIAL à taxa própria, mantendo a
  // regra do lucro líquido (nunca expor a margem/receita bruta da agência).
  const dailyChartData = useMemo(
    () => dailyResults.map((r) => ({ ...r, total_commission: calcAffiliatePayout(r, ownConfig) })),
    [dailyResults, ownConfig]
  );

  // Mesma lógica para "Por casa": o BrandBreakdown calcula a comissão a partir do
  // config informado — passamos a taxa própria do especial (o que ele recebe).

  const funnel = [
    { label: 'Cadastros', value: funnelTotals.registrations.toLocaleString('pt-BR'), icon: UserPlus },
    { label: 'Primeiros Depósitos', value: funnelTotals.firstDeposits.toLocaleString('pt-BR'), icon: Wallet },
    { label: 'Valor Depositado', value: brl(funnelTotals.deposit), icon: DollarSign },
    { label: 'CPA Qualificado', value: funnelTotals.qualifiedCpa.toLocaleString('pt-BR'), icon: Target },
  ];

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
            {humanizeName(profile?.name || '') || 'Sua rede'}
          </h1>
          <p className="text-slate-500 dark:text-neutral-400 text-sm mt-2">{subIds.length} sub-afiliado(s) + sua produção.</p>
        </div>
        <DateRangePicker value={range} onChange={setRange} />
      </header>

      {/* Cards de métrica — espelham o /admin (capados à rede): nº de afiliados,
          comissão total (taxa própria sobre a rede), CPA e REV. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {metrics.map((metric, idx) => (
          <motion.div
            key={metric.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.05 }}
            className={cn(
              'group p-6 rounded-2xl border transition-all relative overflow-hidden',
              idx === 0
                ? 'bg-slate-900 dark:bg-neutral-900 text-white border-slate-800 dark:border-neutral-800 shadow-xl shadow-slate-900/10 dark:shadow-black/30'
                : 'bg-white dark:bg-neutral-900/60 border-slate-200/70 dark:border-neutral-800 shadow-sm hover:border-slate-300 dark:hover:border-neutral-700'
            )}
          >
            {idx === 0 && (
              <div className="absolute top-0 right-0 w-40 h-40 bg-white/5 rounded-full blur-3xl -mr-10 -mt-10 pointer-events-none" />
            )}
            <div className="flex justify-between items-start mb-4 relative">
              <div className={cn(
                'p-2.5 rounded-xl border transition-transform group-hover:scale-105',
                idx === 0 ? 'bg-white/5 border-white/10' : 'bg-slate-50 dark:bg-neutral-800/60 border-slate-100 dark:border-neutral-700/60'
              )}>
                <metric.icon size={20} className={cn(idx === 0 ? 'text-white' : 'text-slate-900 dark:text-neutral-100')} />
              </div>
            </div>
            <p className={cn('text-[10px] uppercase font-bold tracking-widest mb-1.5', idx === 0 ? 'text-neutral-400' : 'text-slate-400 dark:text-neutral-500')}>{metric.label}</p>
            <h3 className={cn('text-2xl font-bold tracking-tight truncate', idx === 0 ? 'text-white' : 'text-slate-900 dark:text-white')}>{metric.value}</h3>
          </motion.div>
        ))}
      </div>

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
            Comissão total ({brl(comissaoTotal)}) − repasses aos sub-afiliados ({brl(repasse)}). Inclui sua produção própria ({brl(ownPayout)}) + o spread sobre a rede.
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

      {/* Por casa — distribuição da comissão da rede (own + subs) por casa de aposta,
          calculada à TAXA PRÓPRIA do especial (o que ele recebe da agência). */}
      <section>
        <h3 className="text-[10px] uppercase font-bold tracking-widest text-slate-400 dark:text-neutral-500 mb-3 px-1">
          Por casa (sua rede)
        </h3>
        <BrandBreakdown data={brandResults} config={ownConfig} />
      </section>

      {/* Por campanha — desempenho da rede por campanha. "Sua comissão" = repasse à
          taxa própria do especial; a margem da agência continua só no master. */}
      <section>
        <h3 className="text-[10px] uppercase font-bold tracking-widest text-slate-400 dark:text-neutral-500 mb-3 px-1">
          Top 5 campanhas (sua rede)
        </h3>
        <CampaignBreakdown
          commissionLabel="Sua comissão"
          subtitle="Top 5 campanhas da sua rede (sua produção + sub-afiliados) no período"
          infoText="As 5 campanhas com maior comissão sua na rede. 'Sua comissão' é o seu ganho à sua taxa (CPA + REV) sobre toda a rede no período."
          rows={campaignResults
            .map((c) => ({
              name: c.name,
              registrations: c.registrations,
              firstDeposits: c.first_deposits,
              deposit: c.deposit,
              qualifiedCpa: c.qualified_cpa,
              commission: calcAffiliatePayout(c, ownConfig),
            }))
            .sort((a, b) => b.commission - a.commission)
            .slice(0, 5)}
        />
      </section>

      {/* Evolução diária da rede (own + subs) — comissão exibida à taxa própria. */}
      <section>
        <div className="bg-white dark:bg-neutral-900 border border-slate-100 dark:border-neutral-800 rounded-3xl flex flex-col shadow-sm overflow-hidden">
          <div className="p-6 border-b border-slate-50 dark:border-neutral-800 flex justify-between items-center bg-slate-50/50 dark:bg-neutral-800/30">
            <h3 className="font-black text-xs text-slate-800 dark:text-white uppercase tracking-widest">Evolução Diária (sua rede)</h3>
            <div className="flex items-center gap-2 px-3 py-1 bg-slate-100 dark:bg-neutral-800 rounded-lg text-[10px] font-bold text-slate-400 uppercase tracking-widest">
              Cadastros · Comissão
            </div>
          </div>
          <DailyPerformanceChart data={dailyChartData} />
        </div>
      </section>
    </div>
  );
}
