import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
  AlertCircle,
  Building,
  Clock,
  Loader2,
  Shield,
  TrendingUp,
  User,
  UserPlus,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
  AffiliateConfig,
  fetchAffiliateById,
  fetchAffiliateConfigs,
  fetchAffiliateResults,
  fetchAffiliateResultsByBrand,
  fetchAffiliateDailyResults,
  fetchAffiliates,
  rateStatus,
  resolveBrandRates,
} from '../services/affiliateService';
import BrandBreakdown from '../components/BrandBreakdown';
import BrandFilter from '../components/BrandFilter';
import DailyPerformanceChart from '../components/DailyPerformanceChart';
import DateRangePicker from '../components/DateRangePicker';
import InfoTooltip from '../components/InfoTooltip';
import TrendBadge from '../components/TrendBadge';
import { DateRange, getDefaultRange, getPreviousRange, percentChange } from '../lib/dateRange';
import { ALL_BRANDS, getKnownBrandName } from '../lib/brand';
import { withKnownBrandNames } from '../lib/knownHouses';
import { cn } from '../lib/utils';

export default function ClientDashboard() {
  const { profile } = useAuth();
  const [affiliate, setAffiliate] = useState<any>(null);
  const [results, setResults] = useState<any[]>([]);
  const [brandResults, setBrandResults] = useState<any[]>([]);
  const [dailyResults, setDailyResults] = useState<any[]>([]);
  const [prevRegistrations, setPrevRegistrations] = useState<number | null>(null);
  const [config, setConfig] = useState<AffiliateConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<DateRange>(() => getDefaultRange());
  // Filtro por casa (client-side a partir do groupBy=brand já buscado).
  const [selectedBrand, setSelectedBrand] = useState<string>(ALL_BRANDS);

  useEffect(() => {
    if (profile?.affiliateId || profile?.email) {
      loadClientData();
    }
  }, [profile?.affiliateId, profile?.email, range.startDate, range.endDate]);

  const loadClientData = async () => {
    try {
      setLoading(true);

      let affiliateId = profile?.affiliateId || '';
      let affiliateDetails: any = null;
      let allConfigs: Record<string, AffiliateConfig> = {};
      let resultsData: any[] = [];
      let brandData: any[] = [];
      let dailyData: any[] = [];
      let prevData: any[] = [];

      if (affiliateId) {
        affiliateDetails = await fetchAffiliateById(affiliateId).catch(() => null);
      }

      if (!affiliateDetails && profile?.email) {
        const allAffiliates = await fetchAffiliates().catch(() => []);
        affiliateDetails = allAffiliates.find(
          (item: any) => item.email?.toLowerCase() === profile.email?.toLowerCase()
        );
        affiliateId = String(affiliateDetails?.id || affiliateDetails?._id || affiliateId || '');
      }

      if (affiliateId) {
        const prevRange = getPreviousRange(range);
        [resultsData, allConfigs, brandData, dailyData, prevData] = await Promise.all([
          fetchAffiliateResults(affiliateId, range).catch((err) => {
            console.error('Error fetching results:', err);
            return [];
          }),
          fetchAffiliateConfigs().catch((err) => {
            console.error('Error fetching configs:', err);
            return {};
          }),
          fetchAffiliateResultsByBrand(affiliateId, range),
          fetchAffiliateDailyResults(affiliateId, range.startDate, range.endDate),
          fetchAffiliateResults(affiliateId, prevRange).catch(() => []),
        ]);
      }

      const fallbackAffiliate = {
        id: affiliateId || profile?.affiliateId || profile?.uid || 'N/A',
        name: profile?.name || 'Sem Nome',
        label: profile?.name || 'Sem Nome',
        email: profile?.email || '',
        status: 'Ativo',
      };

      setAffiliate(affiliateDetails || fallbackAffiliate);
      setResults(Array.isArray(resultsData) ? resultsData : []);
      setBrandResults(Array.isArray(brandData) ? brandData : []);
      setDailyResults(Array.isArray(dailyData) ? dailyData : []);
      setPrevRegistrations((Array.isArray(prevData) ? prevData : []).reduce((sum: number, r: any) => sum + (r.registrations || 0), 0));
      setConfig(affiliateId ? allConfigs[affiliateId] || null : null);
      setError(null);
    } catch (err) {
      console.error('Error loading client dashboard data:', err);
      setAffiliate({
        id: profile?.affiliateId || profile?.uid || 'N/A',
        name: profile?.name || 'Sem Nome',
        label: profile?.name || 'Sem Nome',
        email: profile?.email || '',
        status: 'Ativo',
      });
      setResults([]);
      setBrandResults([]);
      setDailyResults([]);
      setPrevRegistrations(null);
      setConfig(null);
      setError(null);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <Loader2 className="w-10 h-10 text-brand dark:text-white animate-spin" />
        <p className="text-slate-500 font-medium">Carregando informações realistas...</p>
      </div>
    );
  }

  if (!affiliate) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <Loader2 className="w-10 h-10 text-brand dark:text-white animate-spin" />
        <p className="text-slate-500 font-medium">Preparando dashboard...</p>
      </div>
    );
  }

  const emptyResult = {
    registrations: 0,
    first_deposits: 0,
    qualified_cpa: 0,
    rvs: 0,
  };
  const clientRows: Array<{ name: string; firstDeposit: string; createdAt: string }> = [];
  const resultsToRender = results.length > 0 ? results : [emptyResult];

  // Casas disponíveis (nome canônico): casas reais das linhas + casas conhecidas
  // SEMPRE listadas (modelo do portal OTG), pra que o filtro apareça mesmo quando
  // a API só trouxe uma casa pro afiliado. Espelha o availableBrands do /admin —
  // antes o cliente derivava só do brandResults cru e o dropdown sumia com 1 casa.
  const brandNameOf = (r: any) =>
    getKnownBrandName(String(r?.id ?? ''), String(r?.label || r?.name || '')) ?? String(r?.label || r?.name || 'Casa');
  const availableBrands = withKnownBrandNames(
    Array.from(new Set(brandResults.map(brandNameOf))).filter(Boolean)
  );
  const isAllBrands = selectedBrand === ALL_BRANDS;
  const selectedBrandRow = isAllBrands ? null : brandResults.find((r) => brandNameOf(r) === selectedBrand);

  return (
    <div className="space-y-8 pb-20">
      <header className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-500 dark:text-neutral-400 truncate">
            Bem-vindo, {profile?.name || affiliate.name || affiliate.label || 'parceiro'}.
          </p>
          <div className="flex items-center gap-3 min-w-0">
            <h1 className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white tracking-tight truncate">
              {affiliate.name || affiliate.label || profile?.name || 'Sem Nome'}
            </h1>
            <span
              className={cn(
                'shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider',
                affiliate.status === 'active' || affiliate.status === 'Ativo' || affiliate.status === 1
                  ? 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400'
                  : 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400'
              )}
            >
              {affiliate.status || 'Pendente'}
            </span>
          </div>
          <p className="text-slate-500 font-mono text-xs uppercase tracking-widest mt-1 break-all">
            ID Externo: #{affiliate.id}
          </p>
        </div>
        <div className="flex flex-col items-start md:items-end gap-3">
          <DateRangePicker value={range} onChange={setRange} />
          <BrandFilter brands={availableBrands} value={selectedBrand} onChange={setSelectedBrand} />
        </div>
      </header>

      {/* Pré-cadastro: login ativo, mas ainda sem ID de relatório (id sintético
          pending_*). Os dados acendem quando o afiliado começa a produzir e o
          sync reconcilia o affiliateId real. */}
      {String(profile?.affiliateId || '').startsWith('pending_') && (
        <div className="flex items-start gap-3 p-4 rounded-2xl bg-amber-50 dark:bg-amber-900/15 border border-amber-200/70 dark:border-amber-900/40">
          <Clock size={18} className="mt-0.5 shrink-0 text-amber-500" />
          <div>
            <p className="text-sm font-bold text-amber-800 dark:text-amber-300">Cadastro aprovado — aguardando produção</p>
            <p className="text-xs text-amber-700/80 dark:text-amber-400/80 mt-0.5">Seu acesso já está ativo. Os resultados aparecem aqui assim que sua operação registrar atividade na casa.</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-8">
        <div className="space-y-8">
          {resultsToRender.map((res: any, idx: number) => {
            // Casa selecionada → usa a linha daquela casa e a taxa por-casa;
            // "Todas as casas" → agregado do afiliado e taxa de topo (atual).
            const row = isAllBrands ? res : (selectedBrandRow ?? emptyResult);
            const rates = isAllBrands
              ? { cpaValue: config?.cpaValue || 0, revPercentage: config?.revPercentage || 0 }
              : resolveBrandRates(config, String(selectedBrandRow?.id ?? ''));
            const calculatedCpa = (row.qualified_cpa || 0) * rates.cpaValue;
            const calculatedRev = (row.rvs || 0) * (rates.revPercentage / 100);
            const totalCommission = calculatedCpa + calculatedRev;
            // "Configurado como 0" ≠ "ainda não configurado": mesma regra (rateStatus)
            // da tela do admin — antes esta view do próprio afiliado mostrava R$0 como
            // taxa real e o selo "Configurado" fixo, mesmo sem taxa definida.
            const { cpaConfigured, revConfigured } = rateStatus(
              config,
              isAllBrands ? undefined : String(selectedBrandRow?.id ?? '')
            );

            return (
              <div key={idx} className="space-y-8">
                <div className="bg-white dark:bg-neutral-900 p-8 rounded-3xl border border-slate-100 dark:border-neutral-800 shadow-sm space-y-6">
                  <div>
                    <div className="flex items-center gap-1 text-xs font-bold text-slate-500 mb-2">
                      Comissão total <InfoTooltip text="Seu ganho no período: CPA Calculado + REV Share, conforme a configuração do seu contrato." align="left" />
                    </div>
                    <div className="flex items-baseline gap-4">
                      <h2 className="text-3xl sm:text-4xl font-black text-slate-900 dark:text-white break-words">
                        R$ {totalCommission.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </h2>
                      {cpaConfigured ? (
                        <div className="flex items-center gap-1 text-brand dark:text-white font-bold text-sm bg-brand/5 dark:bg-white/10 px-2 py-0.5 rounded-lg">
                          <TrendingUp size={16} /> Configurado
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 text-amber-700 dark:text-amber-400 font-bold text-sm bg-amber-500/10 px-2 py-0.5 rounded-lg" title="O valor de CPA do seu contrato ainda não foi configurado. Fale com a gerência.">
                          <AlertCircle size={16} /> CPA não configurado
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-6 bg-slate-50 dark:bg-neutral-800/50 rounded-2xl border border-slate-100 dark:border-neutral-800 flex items-center justify-between group hover:border-brand/20 transition-all">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-xl bg-white dark:bg-neutral-800 flex items-center justify-center text-slate-400 group-hover:text-brand dark:group-hover:text-white transition-colors shadow-sm text-xs font-black">
                          R$
                        </div>
                        <div>
                          <div className="flex items-center gap-1 text-[10px] font-bold text-slate-500 dark:text-neutral-300 uppercase tracking-widest mb-1">
                            CPA Calculado{cpaConfigured ? ` (R$ ${rates.cpaValue}/CPA)` : ''} <InfoTooltip text="CPA Qualificado × valor de CPA do seu contrato. Quantos cadastros qualificaram, multiplicado pelo valor por aquisição." size={10} align="left" />
                          </div>
                          {cpaConfigured ? (
                            <p className="text-xl font-black text-slate-800 dark:text-white">
                              R$ {calculatedCpa.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </p>
                          ) : (
                            <p className="text-sm font-bold text-amber-600 dark:text-amber-400">Não configurado</p>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="p-6 bg-slate-50 dark:bg-neutral-800/50 rounded-2xl border border-slate-100 dark:border-neutral-800 flex items-center justify-between group hover:border-brand/20 transition-all">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-xl bg-white dark:bg-neutral-800 flex items-center justify-center text-slate-400 group-hover:text-brand dark:group-hover:text-white transition-colors shadow-sm">
                          <TrendingUp size={20} />
                        </div>
                        <div>
                          <div className="flex items-center gap-1 text-[10px] font-bold text-slate-500 dark:text-neutral-300 uppercase tracking-widest mb-1">
                            REV Share{revConfigured ? ` (${rates.revPercentage}%)` : ''} <InfoTooltip text="Participação na receita: percentual do seu contrato aplicado sobre o RVS (receita compartilhada) do período." size={10} align="left" />
                          </div>
                          {revConfigured ? (
                            <p className="text-xl font-black text-slate-800 dark:text-white">
                              R$ {calculatedRev.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </p>
                          ) : (
                            <p className="text-sm font-bold text-amber-600 dark:text-amber-400">Não configurado</p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    className="bg-white dark:bg-neutral-900 p-8 rounded-[2.5rem] border border-slate-100 dark:border-neutral-800 shadow-sm group hover:border-brand/20 transition-all duration-500"
                  >
                    <div className="flex items-center justify-between mb-4">
                      <div className="p-3 bg-slate-50 dark:bg-neutral-800 rounded-2xl text-slate-400 group-hover:text-brand dark:group-hover:text-white transition-colors">
                        <UserPlus size={20} />
                      </div>
                      <TrendBadge change={isAllBrands ? percentChange(row.registrations || 0, prevRegistrations ?? 0) : 0} />
                    </div>
                    <div className="space-y-1">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Cadastros</p>
                      <h4 className="text-4xl font-black text-slate-900 dark:text-white tracking-tighter">{row.registrations || 0}</h4>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-2">Leads Qualificados</p>
                    </div>
                  </motion.div>

                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                    className="bg-white dark:bg-neutral-900 p-8 rounded-[2.5rem] border border-slate-100 dark:border-neutral-800 shadow-sm group hover:border-brand/20 transition-all duration-500"
                  >
                    <div className="flex items-center justify-between mb-4">
                      <div className="p-3 bg-slate-50 dark:bg-neutral-800 rounded-2xl text-slate-400 group-hover:text-brand dark:group-hover:text-white transition-colors">
                        <Building size={20} />
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="bg-slate-100 dark:bg-neutral-800 px-2 py-1 rounded-lg">
                          <span className="text-[10px] font-black text-slate-500">
                            {row.registrations > 0 ? ((row.first_deposits / row.registrations) * 100).toFixed(1) : 0}% conv.
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Primeiros Depósitos</p>
                      <h4 className="text-4xl font-black text-slate-900 dark:text-white tracking-tighter">{row.first_deposits || 0}</h4>
                      <div className="flex items-center gap-1.5 mt-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
                        <p className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-widest leading-none">Contas Ativas</p>
                      </div>
                    </div>
                  </motion.div>

                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                    className="bg-white dark:bg-neutral-900 p-8 rounded-[2.5rem] border border-slate-100 dark:border-neutral-800 shadow-sm group hover:border-brand/20 transition-all duration-500"
                  >
                    <div className="flex items-center justify-between mb-4">
                      <div className="p-3 bg-slate-50 dark:bg-neutral-800 rounded-2xl text-slate-400 group-hover:text-brand dark:group-hover:text-white transition-colors">
                        <Shield size={20} />
                      </div>
                      <div className="bg-slate-100 dark:bg-neutral-800 px-2 py-1 rounded-lg">
                        <span className="text-[10px] font-black text-slate-500">
                          {row.first_deposits > 0 ? ((row.qualified_cpa / row.first_deposits) * 100).toFixed(1) : 0}% conv.
                        </span>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">CPA Qualificado</p>
                      <h4 className="text-4xl font-black text-slate-900 dark:text-white tracking-tighter">{row.qualified_cpa || 0}</h4>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-2 opacity-60">Meta Alcançada</p>
                    </div>
                  </motion.div>
                </div>

                {/* Per-house breakdown (real data from groupBy=brand) */}
                <BrandBreakdown data={brandResults} config={config} />

              </div>
            );
          })}

          {/* Evolução diária (dados reais da API externa, groupBy=date) */}
          <div className="bg-white dark:bg-neutral-900 border border-slate-100 dark:border-neutral-800 rounded-3xl flex flex-col shadow-sm overflow-hidden mb-20">
            <div className="p-6 border-b border-slate-50 dark:border-neutral-800 flex justify-between items-center bg-slate-50/50 dark:bg-neutral-800/30">
              <h3 className="font-black text-xs text-slate-800 dark:text-white uppercase tracking-widest">Evolução Diária</h3>
              <div className="flex items-center gap-2 px-3 py-1 bg-slate-100 dark:bg-neutral-800 rounded-lg text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                Cadastros · Comissão
              </div>
            </div>
            <DailyPerformanceChart data={dailyResults} />
          </div>

          {/* Lista de Clientes — desativada: a API de afiliados não expõe dados por
              cliente/jogador. Mantida para reativar caso surja essa fonte de dados.
          <div className="bg-white dark:bg-neutral-900 border border-slate-100 dark:border-neutral-800 rounded-3xl flex flex-col shadow-sm overflow-hidden mb-20">
            <div className="p-6 border-b border-slate-50 dark:border-neutral-800 flex justify-between items-center bg-slate-50/50 dark:bg-neutral-800/30">
              <h3 className="font-black text-xs text-slate-800 dark:text-white uppercase tracking-widest">Lista de Clientes</h3>
              <div className="flex items-center gap-2 px-3 py-1 bg-slate-100 dark:bg-neutral-800 rounded-lg text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                {clientRows.length} registros
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-slate-50 dark:bg-neutral-800/50 text-[10px] text-slate-400 uppercase tracking-widest sticky top-0 backdrop-blur-sm z-10 border-b border-slate-100 dark:border-neutral-800">
                  <tr>
                    <th className="px-8 py-5 font-black">Nome</th>
                    <th className="px-8 py-5 font-black">Valor do primeiro depósito</th>
                    <th className="px-8 py-5 font-black">Data de cadastro</th>
                  </tr>
                </thead>
                <tbody>
                  {clientRows.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-8 py-20 text-center">
                        <div className="flex flex-col items-center gap-2 opacity-30">
                          <User size={32} />
                          <p className="text-xs font-bold uppercase tracking-widest">Lista zerada ate associar os clientes ao ID</p>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
          */}
        </div>
      </div>
    </div>
  );
}
