import React, { useState, useEffect, useMemo } from 'react';
import { motion } from 'motion/react';
import { 
  Users,
  DollarSign,
  BarChart3,
  TrendingUp,
  Loader2,
  UserPlus,
  Wallet,
  Target,
  Banknote
} from 'lucide-react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  Legend
} from 'recharts';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { cn } from '../lib/utils';
import { fetchAffiliates, fetchAllResults, fetchAllResultsByCampaign, fetchAffiliateConfigs, calcAffiliatePayout, CampaignRow } from '../services/affiliateService';
import DateRangePicker from '../components/DateRangePicker';
import CampaignBreakdown from '../components/CampaignBreakdown';
import InfoTooltip from '../components/InfoTooltip';
import BrandFilter from '../components/BrandFilter';
import { getBrandName, uniqueBrands, ALL_BRANDS } from '../lib/brand';
import { DateRange, getDefaultRange } from '../lib/dateRange';

export default function AdminDashboard() {
  const { profile } = useAuth();
  const { theme } = useTheme();
  const [results, setResults] = useState<any[]>([]);
  const [configs, setConfigs] = useState<Record<string, any>>({});
  const [affiliates, setAffiliates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<DateRange>(() => getDefaultRange());
  // Por Campanha — desempenho agregado da rede por campanha (groupBy=campaign).
  const [campaignRows, setCampaignRows] = useState<CampaignRow[]>([]);
  // Filtro multi-marca (só aparece com ≥2 marcas; hoje, só Superbet → oculto).
  const [brandFilter, setBrandFilter] = useState<string>(ALL_BRANDS);

  // Lista de afiliados (com brand) — base do filtro e do mapa id→marca.
  useEffect(() => {
    fetchAffiliates()
      .then((list) => setAffiliates(Array.isArray(list) ? list : []))
      .catch((err) => console.error('Error fetching affiliates for dashboard:', err));
  }, []);

  // Mapa affiliateId → nome da marca (results não trazem marca; cruzamos aqui).
  const brandById = useMemo(() => {
    const map: Record<string, string | null> = {};
    for (const a of affiliates) map[String(a.id ?? a._id ?? '')] = getBrandName(a);
    return map;
  }, [affiliates]);

  const availableBrands = useMemo(() => uniqueBrands(affiliates), [affiliates]);

  // IDs da marca selecionada (CSV) para reescopar a busca de campanhas. null = todas.
  const brandAffiliateIds = useMemo(() => {
    if (brandFilter === ALL_BRANDS) return null;
    return affiliates
      .filter((a) => getBrandName(a) === brandFilter)
      .map((a) => String(a.id ?? a._id ?? ''))
      .filter(Boolean)
      .join(',');
  }, [affiliates, brandFilter]);

  // Resultados/comissões respeitam o intervalo de datas (B2) e a marca (multi-marca).
  // Campanhas refazem fetch por marca; results/configs ficam crus e são filtrados via useMemo.
  useEffect(() => {
    async function getResults() {
      try {
        setLoading(true);
        const [allResults, cfgs, campaigns] = await Promise.all([
          fetchAllResults(range),
          fetchAffiliateConfigs(),
          fetchAllResultsByCampaign(range, brandAffiliateIds ?? undefined),
        ]);
        setResults(Array.isArray(allResults) ? allResults : []);
        setConfigs(cfgs || {});
        setCampaignRows(campaigns);
      } catch (err) {
        console.error('Error fetching dashboard data:', err);
        setResults([]);
        setConfigs({});
        setCampaignRows([]);
      } finally {
        setLoading(false);
      }
    }
    getResults();
  }, [range.startDate, range.endDate, brandAffiliateIds]);

  // Results da marca selecionada (filtro client-side via mapa id→marca).
  const scopedResults = useMemo(() => {
    if (brandFilter === ALL_BRANDS) return results;
    return results.filter((r) => brandById[String(r.affiliate_id ?? r.id ?? '')] === brandFilter);
  }, [results, brandFilter, brandById]);

  // Totais (financeiro + funil) derivados dos results no escopo da marca.
  const totals = useMemo(() => scopedResults.reduce((acc, curr) => ({
    commission: acc.commission + (curr.total_commission || 0),
    cpa: acc.cpa + (curr.cpa || 0),
    rev: acc.rev + (curr.rvs || 0),
    registrations: acc.registrations + (curr.registrations || 0),
    firstDeposits: acc.firstDeposits + (curr.first_deposits || 0),
    qualifiedCpa: acc.qualifiedCpa + (curr.qualified_cpa || 0),
    // valor depositado (R$). Campo `deposit` do results (ver BACKLOG · Depósitos).
    deposit: acc.deposit + (curr.deposit || 0)
  }), { commission: 0, cpa: 0, rev: 0, registrations: 0, firstDeposits: 0, qualifiedCpa: 0, deposit: 0 }),
  [scopedResults]);

  // B1 · lucro líquido = Σ comissão das casas − Σ repasse aos afiliados (por config).
  const netProfit = useMemo(() => {
    const payout = scopedResults.reduce(
      (sum, r) => sum + calcAffiliatePayout(r, configs[String(r.affiliate_id ?? r.id ?? '')]),
      0
    );
    return totals.commission - payout;
  }, [scopedResults, configs, totals.commission]);

  // Contagem de afiliados respeita o filtro de marca.
  const affiliatesCount = useMemo(
    () => (brandFilter === ALL_BRANDS ? affiliates.length : affiliates.filter((a) => getBrandName(a) === brandFilter).length),
    [affiliates, brandFilter]
  );

  const metrics = [
    { label: 'Total de Afiliados', value: affiliatesCount.toString(), icon: Users, color: 'brand' },
    { label: 'Total comissão', value: `R$ ${totals.commission.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, icon: DollarSign, color: 'green' },
    { label: 'Total CPA', value: `R$ ${totals.cpa.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, icon: BarChart3, color: 'blue' },
    { label: 'Total REV', value: `R$ ${totals.rev.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, icon: TrendingUp, color: 'purple' },
  ];

  // Funil agregado da rede — soma dos dados que antes só apareciam ao abrir um afiliado.
  const funnel = [
    { label: 'Cadastros', value: totals.registrations.toLocaleString('pt-BR'), icon: UserPlus },
    { label: 'Primeiros Depósitos', value: totals.firstDeposits.toLocaleString('pt-BR'), icon: Wallet },
    { label: 'Valor Depositado', value: `R$ ${totals.deposit.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, icon: Banknote },
    { label: 'CPA Qualificado', value: totals.qualifiedCpa.toLocaleString('pt-BR'), icon: Target },
  ];

  // Prepare data for the chart - top affiliates by commission (no escopo da marca)
  const chartData = [...scopedResults]
    .sort((a, b) => (b.total_commission || 0) - (a.total_commission || 0))
    .map(item => {
      const label = String(item.affiliate_name || item.name || item.affiliate_id || '---');
      return {
        name: label,
        Comissão: item.total_commission || 0,
        CPA: item.cpa || 0,
        REV: item.rvs || 0,
      };
    });

  const [chartPage, setChartPage] = useState(0);
  const pageSize = 5;
  const pageCount = Math.ceil(chartData.length / pageSize);
  const visibleChartData = chartData.slice(chartPage * pageSize, chartPage * pageSize + pageSize);

  useEffect(() => {
    if (chartPage > pageCount - 1) {
      setChartPage(Math.max(pageCount - 1, 0));
    }
  }, [chartPage, pageCount]);

  const CustomizedAxisTick = ({ x, y, payload }: any) => {
    const label = String(payload.value);
    return (
      <text
        x={x}
        y={y + 15}
        textAnchor="end"
        fill={theme === 'dark' ? '#CBD5E1' : '#475569'}
        fontSize={11}
        fontWeight={700}
        transform={`rotate(-45, ${x}, ${y + 15})`}
      >
        <title>{label}</title>
        {label}
      </text>
    );
  };

  return (
    <div className="space-y-8 pb-20">
      <header className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <div>
          <span className="inline-flex items-center gap-2 px-3 py-1 mb-3 rounded-full bg-slate-900/5 dark:bg-white/5 border border-slate-900/10 dark:border-white/10 text-slate-500 dark:text-neutral-300 text-[10px] font-bold uppercase tracking-widest">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Visão geral
          </span>
          <h1 className="text-3xl md:text-4xl font-bold text-slate-900 dark:text-white tracking-tighter">Dashboard</h1>
          <p className="text-slate-500 dark:text-neutral-400 text-sm mt-2">Bem-vindo de volta, {profile?.name}. Visão geral do desempenho da rede.</p>
        </div>
        <div className="flex flex-col items-start md:items-end gap-3">
          <DateRangePicker value={range} onChange={setRange} />
          <BrandFilter brands={availableBrands} value={brandFilter} onChange={setBrandFilter} />
        </div>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {metrics.map((metric, idx) => (
          <motion.div
            key={idx}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.05 }}
            className={cn(
              "group p-6 rounded-2xl border transition-all relative overflow-hidden",
              idx === 0
                ? "bg-slate-900 dark:bg-neutral-900 text-white border-slate-800 dark:border-neutral-800 shadow-xl shadow-slate-900/10 dark:shadow-black/30"
                : "bg-white dark:bg-neutral-900/60 border-slate-200/70 dark:border-neutral-800 shadow-sm hover:border-slate-300 dark:hover:border-neutral-700"
            )}
          >
            {idx === 0 && (
              <div className="absolute top-0 right-0 w-40 h-40 bg-white/5 rounded-full blur-3xl -mr-10 -mt-10 pointer-events-none" />
            )}
            {loading ? (
              <div className="flex items-center justify-center h-20">
                <Loader2 className="animate-spin text-brand dark:text-white" />
              </div>
            ) : (
              <>
                <div className="flex justify-between items-start mb-4 relative">
                  <div className={cn(
                    "p-2.5 rounded-xl border transition-transform group-hover:scale-105",
                    idx === 0
                      ? "bg-white/5 border-white/10"
                      : "bg-slate-50 dark:bg-neutral-800/60 border-slate-100 dark:border-neutral-700/60"
                  )}>
                    <metric.icon size={20} className={cn(
                      idx === 0 ? "text-white" : "text-slate-900 dark:text-neutral-100"
                    )} />
                  </div>
                </div>

                <div className="relative">
                  <p className={cn(
                    "text-[10px] uppercase font-bold tracking-widest mb-1.5",
                    idx === 0 ? "text-neutral-400" : "text-slate-400 dark:text-neutral-500"
                  )}>
                    {metric.label}
                  </p>
                  <h3 className={cn(
                    "text-2xl font-bold tracking-tight truncate",
                    idx === 0 ? "text-white" : "text-slate-900 dark:text-white"
                  )}>{metric.value}</h3>
                </div>
              </>
            )}
          </motion.div>
        ))}
      </div>

      {/* Funil agregado da rede — dados (Cadastros, Depósitos, CPA) de TODOS os afiliados
          do master, somados; antes só apareciam ao abrir um afiliado individual. */}
      <section>
        <h3 className="text-[10px] uppercase font-bold tracking-widest text-slate-400 dark:text-neutral-500 mb-3 px-1">
          Funil da rede (todos os afiliados)
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {funnel.map((item, idx) => (
            <motion.div
              key={item.label}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.05 }}
              className="group p-6 rounded-2xl border bg-white dark:bg-neutral-900/60 border-slate-200/70 dark:border-neutral-800 shadow-sm hover:border-slate-300 dark:hover:border-neutral-700 transition-all"
            >
              {loading ? (
                <div className="flex items-center justify-center h-20">
                  <Loader2 className="animate-spin text-brand dark:text-white" />
                </div>
              ) : (
                <>
                  <div className="flex justify-between items-start mb-4">
                    <div className="p-2.5 rounded-xl border bg-slate-50 dark:bg-neutral-800/60 border-slate-100 dark:border-neutral-700/60 transition-transform group-hover:scale-105">
                      <item.icon size={20} className="text-slate-900 dark:text-neutral-100" />
                    </div>
                  </div>
                  <p className="text-[10px] uppercase font-bold tracking-widest mb-1.5 text-slate-400 dark:text-neutral-500">
                    {item.label}
                  </p>
                  <h3 className="text-2xl font-bold tracking-tight truncate text-slate-900 dark:text-white">
                    {item.value}
                  </h3>
                </>
              )}
            </motion.div>
          ))}
        </div>
      </section>

      {/* B1 · Lucro líquido (regra provisória — ver comentário em affiliateService.calcNetProfit) */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden p-6 md:p-7 rounded-2xl border border-emerald-200/70 dark:border-emerald-900/40 bg-emerald-50/60 dark:bg-emerald-950/20 shadow-sm flex items-center justify-between gap-4"
      >
        <div className="absolute top-0 right-0 w-56 h-56 bg-emerald-500/10 rounded-full blur-3xl -mr-16 -mt-16 pointer-events-none" />
        {loading ? (
          <div className="flex items-center justify-center h-16 w-full">
            <Loader2 className="animate-spin text-emerald-500" />
          </div>
        ) : (
          <>
            <div className="relative">
              <span className="inline-flex items-center gap-2 px-2.5 py-1 mb-3 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-[10px] font-bold uppercase tracking-widest">
                Lucro líquido da agência (período)
              </span>
              <h3 className="text-3xl md:text-4xl font-bold tracking-tighter text-emerald-700 dark:text-emerald-400">
                R$ {netProfit.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </h3>
              <p className="text-[11px] font-medium text-slate-500 dark:text-neutral-400 mt-2 max-w-2xl">
                Comissão recebida das casas − repasse aos afiliados.{' '}
                <span className="italic">Regra provisória (a confirmar): sem custos fixos e usando o total reportado pela casa.</span>
              </p>
            </div>
            <div className="relative shrink-0 p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-500">
              <DollarSign size={24} />
            </div>
          </>
        )}
      </motion.div>

      {/* Chart Section */}
      <section className="relative overflow-hidden bg-white dark:bg-neutral-900/60 p-6 md:p-8 rounded-3xl border border-slate-200/70 dark:border-neutral-800 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
              Desempenho por Afiliado <InfoTooltip text="Top afiliados por volume de comissão no período. Use os controles abaixo para navegar entre as páginas." align="left" />
            </h3>
            <p className="text-xs text-slate-500 dark:text-neutral-400 font-medium mt-1">Top parceiros por volume de comissão — mostra 5 por vez, use o controle para ver os próximos.</p>
          </div>
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-50 dark:bg-white/5 border border-slate-200/70 dark:border-white/10">
             <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
             <span className="text-[10px] font-bold text-slate-500 dark:text-neutral-300 uppercase tracking-widest">Performance em tempo real</span>
          </div>
        </div>

        <div className="h-[400px] w-full">
          {chartData.length > 5 && !loading && (
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div className="text-xs uppercase tracking-[0.25em] text-slate-500 dark:text-slate-400 font-bold">
                Mostrando {chartPage * pageSize + 1} - {Math.min((chartPage + 1) * pageSize, chartData.length)} de {chartData.length}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setChartPage((prev) => Math.max(prev - 1, 0))}
                  disabled={chartPage === 0}
                  className="px-4 py-2 rounded-full text-xs font-bold uppercase tracking-wider border border-slate-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-slate-700 dark:text-neutral-200 hover:border-slate-300 dark:hover:border-neutral-600 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Anterior
                </button>
                <button
                  type="button"
                  onClick={() => setChartPage((prev) => Math.min(prev + 1, pageCount - 1))}
                  disabled={chartPage === pageCount - 1}
                  className="px-4 py-2 rounded-full text-xs font-bold uppercase tracking-wider border border-slate-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-slate-700 dark:text-neutral-200 hover:border-slate-300 dark:hover:border-neutral-600 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Próximo
                </button>
              </div>
            </div>
          )}
          {loading ? (
            <div className="w-full h-full flex items-center justify-center text-slate-400 font-medium">
              Carregando dados do gráfico...
            </div>
          ) : chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={visibleChartData}
                margin={{ top: 20, right: 30, left: 20, bottom: 60 }}
              >
                <defs>
                  <linearGradient id="commissionGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#7C3AED" stopOpacity={0.95} />
                    <stop offset="95%" stopColor="#C084FC" stopOpacity={0.7} />
                  </linearGradient>
                  <linearGradient id="cpaGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#F97316" stopOpacity={0.95} />
                    <stop offset="95%" stopColor="#FDBA74" stopOpacity={0.7} />
                  </linearGradient>
                  <linearGradient id="revGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0EA5E9" stopOpacity={0.95} />
                    <stop offset="95%" stopColor="#7DD3FC" stopOpacity={0.7} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={theme === 'dark' ? '#334155' : '#E2E8F0'} opacity={0.65} />
                <XAxis 
                  dataKey="name" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={<CustomizedAxisTick />} 
                  interval={0}
                />
                <YAxis 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fontSize: 10, fontWeight: 700, fill: theme === 'dark' ? '#CBD5E1' : '#475569' }}
                  tickFormatter={(value) => `R$ ${value >= 1000 ? `${(value / 1000).toFixed(1)}k` : value}`}
                />
                <Tooltip
                  cursor={{ fill: theme === 'dark' ? 'rgba(148, 163, 184, 0.12)' : '#F1F5F9', radius: 10 }}
                  contentStyle={{
                    borderRadius: '16px',
                    border: theme === 'dark' ? '1px solid #1E293B' : 'none',
                    backgroundColor: theme === 'dark' ? '#0F172A' : '#FFFFFF',
                    boxShadow: theme === 'dark' ? '0 10px 25px -5px rgb(0 0 0 / 0.6)' : '0 10px 15px -3px rgb(0 0 0 / 0.1)',
                    padding: '12px'
                  }}
                  itemStyle={{ fontSize: '12px', fontWeight: 700, color: theme === 'dark' ? '#E2E8F0' : '#334155' }}
                  labelStyle={{ fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', color: theme === 'dark' ? '#94A3B8' : '#64748B', marginBottom: '8px' }}
                  formatter={(value: any, name: any) => [
                    `R$ ${Number(value).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
                    name
                  ]}
                />
                <Legend 
                  verticalAlign="top" 
                  align="right" 
                  iconType="circle" 
                  wrapperStyle={{ paddingBottom: '20px', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase' }} 
                />
                <Bar name="Comissão" dataKey="Comissão" fill="url(#commissionGradient)" radius={[6, 6, 0, 0]} barSize={22} />
                <Bar name="CPA" dataKey="CPA" fill="url(#cpaGradient)" radius={[6, 6, 0, 0]} barSize={22} />
                <Bar name="REV" dataKey="REV" fill="url(#revGradient)" radius={[6, 6, 0, 0]} barSize={22} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 gap-4">
              <BarChart3 size={48} className="opacity-20" />
              <p className="font-bold text-sm uppercase tracking-widest">Sem dados disponíveis</p>
            </div>
          )}
        </div>
      </section>

      {/* Por Campanha — desempenho agregado da rede (groupBy=campaign).
          Comissão exibida = total reportado pelas casas (visão do master). */}
      <section>
        <h3 className="text-[10px] uppercase font-bold tracking-widest text-slate-400 dark:text-neutral-500 mb-3 px-1">
          Desempenho por campanha (rede)
        </h3>
        {loading ? (
          <div className="flex items-center justify-center h-32 rounded-3xl border border-slate-200/70 dark:border-neutral-800 bg-white dark:bg-neutral-900/60">
            <Loader2 className="animate-spin text-brand dark:text-white" />
          </div>
        ) : (
          <CampaignBreakdown
            commissionLabel="Comissão (casa)"
            subtitle="Soma de todos os afiliados do master no período"
            infoText="Desempenho agregado da rede por campanha. 'Comissão (casa)' é o total reportado pelas casas (antes do repasse aos afiliados)."
            rows={campaignRows.map((c) => ({
              name: c.name,
              registrations: c.registrations,
              firstDeposits: c.first_deposits,
              deposit: c.deposit,
              qualifiedCpa: c.qualified_cpa,
              commission: c.total_commission,
            }))}
          />
        )}
      </section>

    </div>
  );
}
