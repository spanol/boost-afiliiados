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
  Banknote,
  Crown
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { cn, humanizeName } from '../lib/utils';
import { fetchAffiliates, fetchAllResults, fetchAllResultsByBrand, fetchAllResultsByCampaign, fetchAffiliateConfigs, fetchSpecialAffiliates, fetchManualResults, buildSubToSpecialConfig, composeAdminProfit, deriveManualRowsCommission, CampaignRow, SpecialAffiliate } from '../services/affiliateService';
import DateRangePicker from '../components/DateRangePicker';
import CampaignBreakdown from '../components/CampaignBreakdown';
import AffiliatePerformanceChart from '../components/AffiliatePerformanceChart';
import BrandFilter from '../components/BrandFilter';
import BrandLogo from '../components/BrandLogo';
import { getBrandName, uniqueBrands, ALL_BRANDS, getKnownBrandName, getBrandMeta, getKnownBrands } from '../lib/brand';
import { withKnownBrandNames } from '../lib/knownHouses';
import { StoredManualRow, aggregateByHouse, emptyMetrics, addMetrics } from '../lib/houseResults';
import { fetchHouses, syncKnownBrandsFrom } from '../services/houseService';
import { fetchEurBrlRate, getCachedEurBrlRate } from '../lib/currency';
import { DateRange, getDefaultRange } from '../lib/dateRange';

export default function AdminDashboard() {
  const { profile } = useAuth();
  const [results, setResults] = useState<any[]>([]);
  const [configs, setConfigs] = useState<Record<string, any>>({});
  const [affiliates, setAffiliates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<DateRange>(() => getDefaultRange());
  // Por Campanha — desempenho agregado da rede por campanha (groupBy=campaign).
  const [campaignRows, setCampaignRows] = useState<CampaignRow[]>([]);
  // Por casa (groupBy=brand) — comparação entre casas. Hoje só Superbet; a seção
  // só aparece com ≥2 casas (acende sozinha quando a OTG liberar a 2ª na API).
  const [brandRows, setBrandRows] = useState<any[]>([]);
  // Filtro multi-marca (só aparece com ≥2 marcas; hoje, só Superbet → oculto).
  const [brandFilter, setBrandFilter] = useState<string>(ALL_BRANDS);
  // Afiliados especiais (p/ os rankings "Top especiais" e "Top subs").
  const [specials, setSpecials] = useState<Record<string, SpecialAffiliate>>({});
  // Resultados MANUAIS (casas 'manual', via upload) — incorporados aos totais e ao
  // lucro por casa sem contaminar a atribuição da OTG.
  const [manualRows, setManualRows] = useState<StoredManualRow[]>([]);
  // Cotação EUR→BRL (AwesomeAPI) — converte o CPA das casas (gravado em EUR) p/ R$.
  const [eurRate, setEurRate] = useState<number>(() => getCachedEurBrlRate());

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

  // Casas conhecidas (ex.: SportingBet vazia) entram no filtro mesmo sem afiliados
  // — espelha o portal OTG. No-op em produção (só Superbet). [[B6]]
  const availableBrands = useMemo(() => withKnownBrandNames(uniqueBrands(affiliates)), [affiliates]);

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
        // O registro de casas (defaultCpa) e a cotação EUR→BRL PRECISAM estar prontos
        // ANTES de buscar/derivar a comissão das casas manuais: `fetchAllResultsByBrand`
        // (fonte do card "COMISSÃO (CASA)") deriva a comissão manual via getKnownBrands()
        // + cotação em cache. Em cold load (prod), esse registro ainda só tem as sementes
        // OTG (o DashboardLayout o popula em paralelo, async) → casa manual saía R$ 0,00
        // na comissão enquanto o lucro (reativo) vinha certo. Carregamos aqui de forma
        // DETERMINÍSTICA. [[boost-house-cpa-eur]]
        const [houses, eur] = await Promise.all([fetchHouses(), fetchEurBrlRate()]);
        if (houses.length) syncKnownBrandsFrom(houses);
        setEurRate(eur.rate);

        const [allResults, cfgs, campaigns, specialData, byBrand, manual] = await Promise.all([
          fetchAllResults(range),
          fetchAffiliateConfigs(),
          fetchAllResultsByCampaign(range, brandAffiliateIds ?? undefined),
          fetchSpecialAffiliates(),
          fetchAllResultsByBrand(range),
          fetchManualResults(range),
        ]);
        setResults(Array.isArray(allResults) ? allResults : []);
        setConfigs(cfgs || {});
        setCampaignRows(campaigns);
        setSpecials(specialData || {});
        setBrandRows(Array.isArray(byBrand) ? byBrand : []);
        setManualRows(Array.isArray(manual) ? manual : []);
      } catch (err) {
        console.error('Error fetching dashboard data:', err);
        setResults([]);
        setConfigs({});
        setCampaignRows([]);
        setSpecials({});
        setBrandRows([]);
        setManualRows([]);
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

  // Comissão da casa DERIVADA da taxa padrão (defaultCpa/defaultRev) quando a planilha
  // não trouxe `comissao` (total_commission=0). Sem isto, casa manual só com contagem
  // de CPA dá comissão 0 e o lucro do master fica NEGATIVO (0 − repasse). Enriquecemos
  // num ÚNICO ponto p/ que headline (manualAgg) e cards por casa (composeAdminProfit)
  // saiam da MESMA base. [[houseCommissionForRow]]
  const manualRowsD = useMemo(() => deriveManualRowsCommission(manualRows, eurRate), [manualRows, eurRate]);

  // Linhas manuais no escopo da marca (ALL = todas; senão só as casas manuais cujo
  // nome canônico bate com o filtro). Casa OTG selecionada → nenhuma manual.
  const manualScoped = useMemo(() => {
    if (brandFilter === ALL_BRANDS) return manualRowsD;
    const slugs = new Set(getKnownBrands().filter((b) => b.name === brandFilter).map((b) => b.slug));
    return manualRowsD.filter((r) => slugs.has(r.houseSlug));
  }, [manualRowsD, brandFilter]);

  // Agregado total das casas manuais no escopo (somado nas métricas do topo/funil).
  const manualAgg = useMemo(() => {
    const byHouse = aggregateByHouse(manualScoped);
    const total = emptyMetrics();
    for (const slug of Object.keys(byHouse)) addMetrics(total, byHouse[slug]);
    return total;
  }, [manualScoped]);

  // Mapa id → nome (fallback p/ afiliados sem linha em results).
  const nameById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const a of affiliates) m[String(a.id ?? a._id ?? '')] = a.name || a.label || '';
    return m;
  }, [affiliates]);

  // Rankings de afiliados (comissão da casa = total_commission, visão do master).
  // Top especiais → por comissão da REDE (própria + subs). Top subs → comissão própria,
  // com o especial a que pertencem.
  const { topSpecials, topSubs } = useMemo(() => {
    const byId: Record<string, any> = {};
    scopedResults.forEach((r) => { byId[String(r.affiliate_id ?? r.id ?? '')] = r; });
    const nameOf = (id: string) => humanizeName(byId[id]?.label || byId[id]?.name || nameById[id] || `#${id}`);
    const comm = (id: string) => Number(byId[id]?.total_commission || 0);
    const active = Object.values(specials).filter((s) => s.active);

    const topSpecials = active
      .map((s) => {
        const ids = [String(s.affiliateId), ...(s.subAffiliateIds || []).map(String)];
        return {
          id: String(s.affiliateId),
          name: nameOf(String(s.affiliateId)),
          commission: ids.reduce((sum, id) => sum + comm(id), 0),
          subs: (s.subAffiliateIds || []).length,
        };
      })
      .sort((a, b) => b.commission - a.commission)
      .slice(0, 5);

    const subToSpecial: Record<string, string> = {};
    active.forEach((s) => (s.subAffiliateIds || []).forEach((sid) => { subToSpecial[String(sid)] = nameOf(String(s.affiliateId)); }));
    const topSubs = Object.keys(subToSpecial)
      .map((sid) => ({ id: sid, name: nameOf(sid), commission: comm(sid), special: subToSpecial[sid] }))
      .sort((a, b) => b.commission - a.commission)
      .slice(0, 5);

    return { topSpecials, topSubs };
  }, [scopedResults, specials, nameById]);

  // Totais (financeiro + funil) derivados dos results no escopo da marca + o
  // agregado das casas MANUAIS (que não estão em `results` p/ não contaminar a
  // atribuição por casa). `cpa` (R$) manual = 0 no v1 (não é coletado no upload).
  const totals = useMemo(() => {
    const base = scopedResults.reduce((acc, curr) => ({
      commission: acc.commission + (curr.total_commission || 0),
      cpa: acc.cpa + (curr.cpa || 0),
      rev: acc.rev + (curr.rvs || 0),
      registrations: acc.registrations + (curr.registrations || 0),
      firstDeposits: acc.firstDeposits + (curr.first_deposits || 0),
      qualifiedCpa: acc.qualifiedCpa + (curr.qualified_cpa || 0),
      // valor depositado (R$). Campo `deposit` do results (ver BACKLOG · Depósitos).
      deposit: acc.deposit + (curr.deposit || 0)
    }), { commission: 0, cpa: 0, rev: 0, registrations: 0, firstDeposits: 0, qualifiedCpa: 0, deposit: 0 });
    return {
      commission: base.commission + manualAgg.total_commission,
      cpa: base.cpa,
      rev: base.rev + manualAgg.rvs,
      registrations: base.registrations + manualAgg.registrations,
      firstDeposits: base.firstDeposits + manualAgg.first_deposits,
      qualifiedCpa: base.qualifiedCpa + manualAgg.qualified_cpa,
      deposit: base.deposit + manualAgg.deposit,
    };
  }, [scopedResults, manualAgg]);

  // B1 · lucro líquido = Σ comissão das casas − Σ repasse aos afiliados.
  // O repasse de um SUB de especial usa a taxa do ESPECIAL-pai (a agência paga o
  // especial sobre a rede toda; o especial repassa os subs e fica com o spread) —
  // senão o /admin subestima o repasse e SUPERESTIMA o lucro. [[boost-special-as-scoped-master]]
  const subToSpecialConfig = useMemo(
    () => buildSubToSpecialConfig(specials, configs, { activeOnly: true }),
    [specials, configs]
  );

  // Resolve a casa de um afiliado (id → { nome canônico, brandId real }). É a
  // ponte compartilhada pelo LUCRO AGREGADO (card de cima) e pelo detalhamento
  // por casa, p/ os DOIS aplicarem a MESMA taxa por casa (byBrand). Sem isso o
  // card "lucro da agência" usava a taxa de topo e divergia da Σ dos cards quando
  // havia override por casa (ex.: especial com topo R$300 e SportingBet R$200). [[B6]]
  const houseOf = useMemo(() => {
    const brandIdByName: Record<string, string> = {};
    for (const r of Array.isArray(brandRows) ? brandRows : []) {
      const id = String(r.id ?? '');
      const raw = String(r.label || r.name || r.id || 'Casa');
      const name = getKnownBrandName(id, raw) ?? humanizeName(raw);
      if (name && id) brandIdByName[name] = id;
    }
    return (affiliateId: string) => {
      const rawBrand = brandById[String(affiliateId)];
      if (!rawBrand) return null;
      const key = getKnownBrandName(rawBrand) ?? humanizeName(rawBrand);
      return { key, brandId: brandIdByName[key] };
    };
  }, [brandRows, brandById]);

  // Lucro da agência (headline) + detalhamento por casa saindo da MESMA base
  // ESCOPADA pelo filtro de marca — antes o headline escopava (scopedResults) mas os
  // cards por casa somavam TODAS as casas (results cru), e ao filtrar uma marca os dois
  // divergiam (mesma classe do 7c1c830, no eixo do filtro). [[boost-net-profit-per-house]]
  const profit = useMemo(
    () => composeAdminProfit(scopedResults, manualScoped, configs, subToSpecialConfig, houseOf),
    [scopedResults, manualScoped, configs, subToSpecialConfig, houseOf]
  );
  const netProfit = profit.netProfit;

  // Por casa (agência) — comissão da casa + funil por marca (groupBy=brand) +
  // LUCRO LÍQUIDO daquela casa. O funil/comissão vêm do groupBy=brand; o lucro NÃO
  // dá pra derivar do agregado de marca (cada afiliado tem taxa própria), então é
  // calculado cruzando afiliado×casa: somamos comissão e repasse das linhas
  // groupBy=affiliate particionadas pela casa do afiliado (`brandById`), aplicando
  // a taxa por casa (byBrand via brandId real da OTG) e a regra do especial-pai.
  // [[boost-net-profit-per-house]] [[boost-net-profit-rule]]
  const houseBreakdown = useMemo(() => {
    // Cards das casas escopados pelo MESMO filtro de marca do headline — senão, ao
    // filtrar uma marca, o card de cima encolhe mas os cards somam todas as casas.
    const base = (Array.isArray(brandRows) ? brandRows : [])
      .map((r: any) => {
        const id = String(r.id ?? '');
        const raw = String(r.label || r.name || r.id || 'Casa');
        return {
          id,
          // casa conhecida → nome canônico do registro; senão humaniza o cru.
          name: getKnownBrandName(id, raw) ?? humanizeName(raw),
          commission: Number(r.total_commission) || 0,
          registrations: Number(r.registrations) || 0,
          firstDeposits: Number(r.first_deposits) || 0,
          qualifiedCpa: Number(r.qualified_cpa) || 0,
          deposit: Number(r.deposit) || 0,
        };
      })
      .filter((h) => brandFilter === ALL_BRANDS || h.name === brandFilter);

    // `profit.byHouse` (OTG afiliado×casa + manual) vem da MESMA base escopada do
    // headline → o card de cima bate com a Σ dos cards visíveis. [[boost-net-profit-per-house]]
    return base
      .map((h) => {
        const p = profit.byHouse[h.name];
        return { ...h, payout: p?.payout ?? 0, netProfit: p?.netProfit ?? 0 };
      })
      .sort((a, b) => b.commission - a.commission);
  }, [brandRows, brandFilter, profit]);

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
      // A API externa nomeia o afiliado em `label` (e o id em `id`); sem isso as
      // barras do gráfico ficavam rotuladas "---".
      const label = humanizeName(String(item.affiliate_name || item.name || item.label || item.affiliate_id || item.id || '---'));
      return {
        name: label,
        Comissão: item.total_commission || 0,
        CPA: item.cpa || 0,
        REV: item.rvs || 0,
      };
    });

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

      {/* B1 · Lucro líquido (regra confirmada pelo Carlos — ver affiliateService.calcNetProfit) */}
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
                <span className="italic">Sem custos fixos, usando o total reportado pela casa.</span>
              </p>
            </div>
            <div className="relative shrink-0 p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-500">
              <DollarSign size={24} />
            </div>
          </>
        )}
      </motion.div>

      {/* Desempenho por casa — comparação entre casas (groupBy=brand). Só aparece
          com ≥2 casas: hoje (só Superbet) fica oculto e ACENDE sozinho quando a OTG
          liberar a 2ª casa na nossa API. */}
      {!loading && houseBreakdown.length >= 2 && (
        <section>
          <h3 className="text-[10px] uppercase font-bold tracking-widest text-slate-400 dark:text-neutral-500 mb-3 px-1">
            Desempenho por casa
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {houseBreakdown.map((h) => (
              <motion.div
                key={h.name}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-6 rounded-2xl border bg-white dark:bg-neutral-900/60 border-slate-200/70 dark:border-neutral-800 shadow-sm"
              >
                <div className="flex items-center gap-2 mb-4">
                  <BrandLogo name={h.name} brandId={h.id} size={28} />
                  <span className="text-sm font-bold text-slate-900 dark:text-white truncate">{h.name}</span>
                </div>
                <p className="text-[10px] uppercase font-bold tracking-widest text-slate-400 dark:text-neutral-500">Comissão (casa)</p>
                <h4 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight mb-3">R$ {h.commission.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</h4>
                {/* Lucro líquido da casa = comissão − repasse cruzado afiliado×casa.
                    Margem da agência só no master (regra do lucro líquido). */}
                <div className="flex items-center justify-between gap-2 mb-3 px-3 py-2.5 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/20 border border-emerald-200/60 dark:border-emerald-900/40">
                  <div className="min-w-0">
                    <p className="text-[9px] uppercase font-bold tracking-widest text-emerald-700/70 dark:text-emerald-400/70">Lucro líquido (casa)</p>
                    <p className="text-lg font-bold text-emerald-700 dark:text-emerald-400 tracking-tight tabular-nums">R$ {h.netProfit.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-[9px] uppercase font-bold tracking-widest text-slate-400 dark:text-neutral-500">Repasse</p>
                    <p className="text-xs font-semibold text-slate-500 dark:text-neutral-400 tabular-nums">R$ {h.payout.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center pt-3 border-t border-slate-100 dark:border-neutral-800">
                  <div><p className="text-sm font-bold text-slate-800 dark:text-white tabular-nums">{h.registrations.toLocaleString('pt-BR')}</p><p className="text-[9px] uppercase font-bold text-slate-400 dark:text-neutral-500 tracking-wider">Cadastros</p></div>
                  <div><p className="text-sm font-bold text-slate-800 dark:text-white tabular-nums">{h.firstDeposits.toLocaleString('pt-BR')}</p><p className="text-[9px] uppercase font-bold text-slate-400 dark:text-neutral-500 tracking-wider">FTD</p></div>
                  <div><p className="text-sm font-bold text-slate-800 dark:text-white tabular-nums">{h.qualifiedCpa.toLocaleString('pt-BR')}</p><p className="text-[9px] uppercase font-bold text-slate-400 dark:text-neutral-500 tracking-wider">CPA</p></div>
                </div>
              </motion.div>
            ))}
          </div>
        </section>
      )}

      {/* Desempenho por Afiliado — componente compartilhado com o /network do
          especial (lá escopado à rede, à taxa própria). Aqui: toda a rede do master. */}
      <AffiliatePerformanceChart data={chartData} loading={loading} />

      {/* Top afiliados especiais + Top afiliados sub — rankings por comissão da casa. */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top especiais (por comissão da rede: própria + subs) */}
        <div className="bg-white dark:bg-neutral-900/60 border border-slate-200/70 dark:border-neutral-800 rounded-3xl shadow-sm overflow-hidden">
          <div className="p-6 border-b border-slate-100 dark:border-neutral-800 flex items-center gap-3">
            <span className="shrink-0 p-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-500"><Crown size={16} /></span>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white tracking-tight">Top afiliados especiais</h3>
              <p className="text-[11px] text-slate-400 dark:text-neutral-500">Por comissão da rede (própria + subs) no período</p>
            </div>
          </div>
          <div className="divide-y divide-slate-50 dark:divide-neutral-800">
            {loading ? (
              <div className="flex items-center justify-center py-10"><Loader2 className="animate-spin text-brand dark:text-white" /></div>
            ) : topSpecials.length === 0 ? (
              <p className="px-6 py-10 text-center text-xs font-bold text-slate-400 dark:text-neutral-500 uppercase tracking-widest opacity-60">Nenhum afiliado especial ativo</p>
            ) : topSpecials.map((s, i) => (
              <div key={s.id} className="px-6 py-3.5 flex items-center justify-between gap-3 hover:bg-slate-50/60 dark:hover:bg-neutral-800/30 transition-colors">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="shrink-0 w-6 h-6 rounded-lg bg-slate-100 dark:bg-neutral-800 text-slate-500 dark:text-neutral-400 text-[11px] font-black flex items-center justify-center">{i + 1}</span>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-800 dark:text-white truncate">{s.name}</p>
                    <p className="text-[10px] text-slate-400 dark:text-neutral-500">{s.subs} sub-afiliado(s)</p>
                  </div>
                </div>
                <span className="shrink-0 text-sm font-black text-slate-900 dark:text-white tabular-nums">R$ {s.commission.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Top subs (comissão própria, com o especial a que pertencem) */}
        <div className="bg-white dark:bg-neutral-900/60 border border-slate-200/70 dark:border-neutral-800 rounded-3xl shadow-sm overflow-hidden">
          <div className="p-6 border-b border-slate-100 dark:border-neutral-800 flex items-center gap-3">
            <span className="shrink-0 p-2 rounded-xl bg-slate-100 dark:bg-neutral-800 text-slate-500 dark:text-neutral-300"><Users size={16} /></span>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white tracking-tight">Top afiliados sub</h3>
              <p className="text-[11px] text-slate-400 dark:text-neutral-500">Por comissão no período, com o especial a que pertencem</p>
            </div>
          </div>
          <div className="divide-y divide-slate-50 dark:divide-neutral-800">
            {loading ? (
              <div className="flex items-center justify-center py-10"><Loader2 className="animate-spin text-brand dark:text-white" /></div>
            ) : topSubs.length === 0 ? (
              <p className="px-6 py-10 text-center text-xs font-bold text-slate-400 dark:text-neutral-500 uppercase tracking-widest opacity-60">Nenhum sub-afiliado vinculado</p>
            ) : topSubs.map((s, i) => (
              <div key={s.id} className="px-6 py-3.5 flex items-center justify-between gap-3 hover:bg-slate-50/60 dark:hover:bg-neutral-800/30 transition-colors">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="shrink-0 w-6 h-6 rounded-lg bg-slate-100 dark:bg-neutral-800 text-slate-500 dark:text-neutral-400 text-[11px] font-black flex items-center justify-center">{i + 1}</span>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-800 dark:text-white truncate">{s.name}</p>
                    <p className="text-[10px] text-amber-600 dark:text-amber-400 truncate">Pertence a {s.special}</p>
                  </div>
                </div>
                <span className="shrink-0 text-sm font-black text-slate-900 dark:text-white tabular-nums">R$ {s.commission.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
              </div>
            ))}
          </div>
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
