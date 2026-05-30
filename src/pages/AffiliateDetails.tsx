import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router';
import { 
  ArrowLeft, 
  Mail, 
  Phone, 
  Calendar, 
  Globe, 
  TrendingUp, 
  Shield, 
  ExternalLink,
  Loader2,
  AlertCircle,
  Clock,
  User,
  Building,
  Activity,
  HelpCircle,
  ArrowDownRight,
  UserPlus,
  Link,
  Copy,
  Check,
  X,
  CheckCircle
} from 'lucide-react';
import {
  fetchAffiliateById,
  fetchAffiliateResults,
  fetchAffiliateResultsByBrand,
  fetchAffiliateResultsByCampaign,
  fetchAffiliateDailyResults,
  fetchAffiliateConfigs,
  calcAffiliatePayout,
  AffiliateConfig,
  CampaignRow,
  createUser,
  createAccessInvite,
  isUserRegistered
} from '../services/affiliateService';
import { useAuth } from '../contexts/AuthContext';
import BrandBreakdown from '../components/BrandBreakdown';
import CampaignBreakdown from '../components/CampaignBreakdown';
import DailyPerformanceChart from '../components/DailyPerformanceChart';
import DateRangePicker from '../components/DateRangePicker';
import { DateRange, getDefaultRange } from '../lib/dateRange';
import { cn } from '../lib/utils';
import { motion } from 'motion/react';

export default function AffiliateDetails() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { profile } = useAuth();
  // Admin vê a página como gestão (voltar p/ lista, cadastrar usuário, gerar convite).
  // O afiliado vê a MESMA página como seu próprio painel — sem esses controles.
  const isAdmin = profile?.role === 'admin';
  const [affiliate, setAffiliate] = useState<any>(null);
  const [results, setResults] = useState<any[]>([]);
  const [brandResults, setBrandResults] = useState<any[]>([]);
  const [campaignResults, setCampaignResults] = useState<CampaignRow[]>([]);
  const [dailyResults, setDailyResults] = useState<any[]>([]);
  const [config, setConfig] = useState<AffiliateConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<DateRange>(() => getDefaultRange());
  // Cadastro próprio: o afiliado já criou acesso (existe users/{uid} com este affiliateId)?
  const [hasAccount, setHasAccount] = useState(false);

  // User Modal State
  const [isUserModalOpen, setIsUserModalOpen] = useState(false);
  const [userEmail, setUserEmail] = useState('');
  const [userPassword, setUserPassword] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [registerSuccess, setRegisterSuccess] = useState(false);
  const [registerError, setRegisterError] = useState<string | null>(null);

  // Link Modal State
  const [isLinkModalOpen, setIsLinkModalOpen] = useState(false);
  const [affiliateLink, setAffiliateLink] = useState('');
  const [isCopied, setIsCopied] = useState(false);
  const [isGeneratingLink, setIsGeneratingLink] = useState(false);

  useEffect(() => {
    if (id) {
      loadDetails(id);
    }
  }, [id, range.startDate, range.endDate]);

  const loadDetails = async (affId: string) => {
    try {
      setLoading(true);
      const [detailsData, resultsData, allConfigs, brandData, campaignData, dailyData] = await Promise.all([
        fetchAffiliateById(affId),
        fetchAffiliateResults(affId, range).catch(err => {
          console.error('Error fetching results:', err);
          return [];
        }),
        fetchAffiliateConfigs(),
        fetchAffiliateResultsByBrand(affId, range),
        fetchAffiliateResultsByCampaign(affId, range),
        fetchAffiliateDailyResults(affId, range.startDate, range.endDate)
      ]);
      setAffiliate(detailsData);
      setResults(Array.isArray(resultsData) ? resultsData : []);
      setBrandResults(Array.isArray(brandData) ? brandData : []);
      setCampaignResults(Array.isArray(campaignData) ? campaignData : []);
      setDailyResults(Array.isArray(dailyData) ? dailyData : []);
      setConfig(allConfigs[affId] || null);

      // Cadastro próprio: para admin, consultamos se existe conta vinculada ao
      // affiliateId (a query em `users` exige admin nas regras). Para o próprio
      // afiliado vendo seu painel, ele está logado → por definição já é cadastrado.
      if (isAdmin) {
        setHasAccount(await isUserRegistered(affId).catch(() => false));
      } else {
        setHasAccount(true);
      }

      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar detalhes');
    } finally {
      setLoading(false);
    }
  };

  const generateTemporaryPassword = () => {
    const randomString = Math.random().toString(36).substring(2).toUpperCase();
    const password = `${randomString.slice(0, 4)}-${randomString.slice(4, 8)}`;
    setUserPassword(password);
    return password;
  };

  const handleOpenUserModal = () => {
    generateTemporaryPassword();
    setRegisterError(null);
    setIsUserModalOpen(true);
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!affiliate || !userEmail) return;

    try {
      setRegisterError(null);
      setIsRegistering(true);
      const password = userPassword || generateTemporaryPassword();

      await createUser({
        name: affiliate.name || affiliate.label || 'Sem Nome',
        email: userEmail.trim().toLowerCase(),
        role: 'client',
        password,
        mustChangePassword: true,
        affiliateId: String(affiliate.id)
      });

      setRegisterSuccess(true);
    } catch (err: any) {
      console.error('Error creating user:', err);
      setRegisterError(err?.message || 'Erro ao cadastrar usuário.');
    } finally {
      setIsRegistering(false);
    }
  };

  const handleGenerateLink = async () => {
    if (!affiliate) return;
    try {
      setIsGeneratingLink(true);
      const invite = await createAccessInvite(String(affiliate.id), affiliate.name || affiliate.label);
      setAffiliateLink(invite.url);
      setIsLinkModalOpen(true);
    } catch (err) {
      console.error('Error generating invite:', err);
    } finally {
      setIsGeneratingLink(false);
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(affiliateLink);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <Loader2 className="w-10 h-10 text-brand animate-spin" />
        <p className="text-slate-500 font-medium">Carregando informações realistas...</p>
      </div>
    );
  }

  if (error || !affiliate) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 text-center">
        <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 text-red-500 rounded-full flex items-center justify-center">
          <AlertCircle size={32} />
        </div>
        <div className="space-y-2">
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">Ops! Algo deu errado</h2>
          <p className="text-slate-500 max-w-md">{error || 'Afiliado não encontrado'}</p>
        </div>
        <button 
          onClick={() => navigate('/affiliates')}
          className="flex items-center gap-2 px-6 py-2 bg-slate-900 dark:bg-neutral-800 text-white rounded-xl hover:bg-slate-800 transition-all font-medium"
        >
          <ArrowLeft size={18} /> Voltar para lista
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-20">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="flex items-center gap-4 min-w-0">
          {isAdmin && (
            <button
              onClick={() => navigate('/affiliates')}
              className="shrink-0 p-3 bg-white dark:bg-neutral-900 border border-slate-200 dark:border-neutral-800 rounded-xl text-slate-500 hover:text-brand transition-all shadow-sm"
            >
              <ArrowLeft size={20} />
            </button>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-3 min-w-0">
              <h1 className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white tracking-tight truncate">
                {affiliate.name || affiliate.label || 'Sem Nome'}
              </h1>
              <div className="flex items-center gap-1.5 shrink-0">
                <span className={cn(
                  "px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider",
                  hasAccount
                    ? "bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400"
                    : "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400"
                )}>
                  {hasAccount ? 'Cadastrado' : 'Pendente'}
                </span>
                <span className="relative group inline-flex">
                  <button
                    type="button"
                    aria-label="O que significa esta etiqueta?"
                    className="text-slate-400 hover:text-brand focus:text-brand outline-none transition-colors"
                  >
                    <HelpCircle size={14} />
                  </button>
                  <span
                    role="tooltip"
                    className="pointer-events-none absolute top-full z-30 mt-2 w-64 max-w-[calc(100vw-2rem)] right-0 translate-x-0 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 rounded-xl border border-slate-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-3 text-[11px] font-medium normal-case leading-relaxed text-slate-600 dark:text-neutral-300 shadow-xl opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity"
                  >
                    <strong className="text-green-600 dark:text-green-400">Cadastrado</strong>: o afiliado já criou o próprio acesso à plataforma.{' '}
                    <strong className="text-yellow-600 dark:text-yellow-400">Pendente</strong>: ainda não se registrou — gere um convite ou cadastre o usuário.
                  </span>
                </span>
              </div>
            </div>
            <p className="text-slate-500 font-mono text-xs uppercase tracking-widest mt-1 break-all">ID Externo: #{affiliate.id}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <DateRangePicker value={range} onChange={setRange} />
          {isAdmin && (
            <>
              <button
                onClick={handleOpenUserModal}
                className="flex items-center gap-2 px-4 py-2.5 bg-brand text-white rounded-xl hover:bg-brand-dark transition-all font-bold text-xs uppercase tracking-wider shadow-sm shadow-brand/20"
              >
                <UserPlus size={16} /> Cadastrar Usuário
              </button>
              <button
                onClick={handleGenerateLink}
                disabled={isGeneratingLink}
                className="flex items-center gap-2 px-4 py-2.5 bg-white dark:bg-neutral-900 border border-slate-200 dark:border-neutral-800 text-slate-700 dark:text-neutral-300 rounded-xl hover:border-brand/40 transition-all font-bold text-xs uppercase tracking-wider shadow-sm"
              >
                {isGeneratingLink ? <Loader2 size={16} className="animate-spin" /> : <Link size={16} />}
                Gerar Convite
              </button>
            </>
          )}
        </div>
      </header>

      <div className="grid grid-cols-1 gap-8">
        <div className="space-y-8">
          {results.length > 0 ? (
            results.map((res: any, idx: number) => {
              // Calculate custom commissions based on config
              const calculatedCpa = (res.qualified_cpa || 0) * (config?.cpaValue || 0);
              const calculatedRev = (res.rvs || 0) * ((config?.revPercentage || 0) / 100);
              const totalCommission = calculatedCpa + calculatedRev;

              return (
                <div key={idx} className="space-y-8">
                  {/* Commissions Overview */}
                  <div className="bg-white dark:bg-neutral-900 p-8 rounded-3xl border border-slate-100 dark:border-neutral-800 shadow-sm space-y-6">
                    <div>
                      <div className="flex items-center gap-1 text-xs font-bold text-slate-500 mb-2">
                        Comissão total <HelpCircle size={14} className="text-slate-500 dark:text-neutral-300" />
                      </div>
                      <div className="flex items-baseline gap-4">
                        <h2 className="text-3xl sm:text-4xl font-black text-slate-900 dark:text-white break-words">
                          R$ {totalCommission.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </h2>
                        <div className="flex items-center gap-1 text-brand font-bold text-sm bg-brand/5 px-2 py-0.5 rounded-lg">
                          <TrendingUp size={16} /> Configurado
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="p-6 bg-slate-50 dark:bg-neutral-800/50 rounded-2xl border border-slate-100 dark:border-neutral-800 flex items-center justify-between group hover:border-brand/20 transition-all">
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 rounded-xl bg-white dark:bg-neutral-800 flex items-center justify-center text-slate-400 group-hover:text-brand transition-colors shadow-sm text-xs font-black">
                            R$
                          </div>
                          <div>
                            <div className="flex items-center gap-1 text-[10px] font-bold text-slate-500 dark:text-neutral-300 uppercase tracking-widest mb-1">
                              CPA Calculado (R$ {config?.cpaValue || 0}/CPA) <HelpCircle size={10} />
                            </div>
                            <p className="text-xl font-black text-slate-800 dark:text-white">
                              R$ {calculatedCpa.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="p-6 bg-slate-50 dark:bg-neutral-800/50 rounded-2xl border border-slate-100 dark:border-neutral-800 flex items-center justify-between group hover:border-brand/20 transition-all">
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 rounded-xl bg-white dark:bg-neutral-800 flex items-center justify-center text-slate-400 group-hover:text-brand transition-colors shadow-sm">
                            <TrendingUp size={20} />
                          </div>
                          <div>
                            <div className="flex items-center gap-1 text-[10px] font-bold text-slate-500 dark:text-neutral-300 uppercase tracking-widest mb-1">
                              REV Share ({config?.revPercentage || 0}%) <HelpCircle size={10} />
                            </div>
                            <p className="text-xl font-black text-slate-800 dark:text-white">
                              R$ {calculatedRev.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Lucro líquido NÃO aparece na view de afiliado (decisão do Carlos, 2026-05-29):
                      a margem da agência fica só no dashboard do master (/admin · AdminDashboard).
                      O afiliado vê apenas o próprio ganho ("Comissão total"). */}

                  {/* Primary Performance Metrics */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {/* Stage 1: Registrations */}
                    <motion.div 
                      initial={{ opacity: 0, y: 20 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      className="bg-white dark:bg-neutral-900 p-8 rounded-[2.5rem] border border-slate-100 dark:border-neutral-800 shadow-sm group hover:border-brand/20 transition-all duration-500"
                    >
                      <div className="flex items-center justify-between mb-4">
                        <div className="p-3 bg-slate-50 dark:bg-neutral-800 rounded-2xl text-slate-400 group-hover:text-brand transition-colors">
                          <UserPlus size={20} />
                        </div>
                        <div className="flex items-center gap-1 text-[10px] font-black text-green-500 bg-green-500/10 px-2 py-1 rounded-lg">
                          <TrendingUp size={10} /> +12%
                        </div>
                      </div>
                      <div className="space-y-1">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Cadastros</p>
                        <h4 className="text-4xl font-black text-slate-900 dark:text-white tracking-tighter">{res.registrations || 0}</h4>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-2">Leads Qualificados</p>
                      </div>
                    </motion.div>

                    {/* Stage 2: FTDs */}
                    <motion.div 
                      initial={{ opacity: 0, y: 20 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.1 }}
                      className="bg-white dark:bg-neutral-900 p-8 rounded-[2.5rem] border border-slate-100 dark:border-neutral-800 shadow-sm group hover:border-brand/20 transition-all duration-500"
                    >
                      <div className="flex items-center justify-between mb-4">
                        <div className="p-3 bg-slate-50 dark:bg-neutral-800 rounded-2xl text-slate-400 group-hover:text-brand transition-colors">
                          <Building size={20} />
                        </div>
                        <div className="flex items-center gap-2">
                           <div className="bg-slate-100 dark:bg-neutral-800 px-2 py-1 rounded-lg">
                             <span className="text-[10px] font-black text-slate-500">
                               {res.registrations > 0 ? ((res.first_deposits / res.registrations) * 100).toFixed(1) : 0}% conv.
                             </span>
                           </div>
                        </div>
                      </div>
                      <div className="space-y-1">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Primeiros Depósitos</p>
                        <h4 className="text-4xl font-black text-slate-900 dark:text-white tracking-tighter">{res.first_deposits || 0}</h4>
                        <div className="flex items-center gap-1.5 mt-2">
                          <div className="w-1.5 h-1.5 rounded-full bg-brand animate-pulse"></div>
                          <p className="text-[10px] font-bold text-brand uppercase tracking-widest leading-none">Contas Ativas</p>
                        </div>
                      </div>
                    </motion.div>

                    {/* Stage 3: Qualified CPA */}
                    <motion.div 
                      initial={{ opacity: 0, y: 20 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.2 }}
                      className="bg-white dark:bg-neutral-900 p-8 rounded-[2.5rem] border border-slate-100 dark:border-neutral-800 shadow-sm group hover:border-brand/20 transition-all duration-500"
                    >
                      <div className="flex items-center justify-between mb-4">
                        <div className="p-3 bg-slate-50 dark:bg-neutral-800 rounded-2xl text-slate-400 group-hover:text-brand transition-colors">
                          <Shield size={20} />
                        </div>
                        <div className="bg-slate-100 dark:bg-neutral-800 px-2 py-1 rounded-lg">
                           <span className="text-[10px] font-black text-slate-500">
                             {res.first_deposits > 0 ? ((res.qualified_cpa / res.first_deposits) * 100).toFixed(1) : 0}% conv.
                           </span>
                        </div>
                      </div>
                      <div className="space-y-1">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">CPA Qualificado</p>
                        <h4 className="text-4xl font-black text-slate-900 dark:text-white tracking-tighter">{res.qualified_cpa || 0}</h4>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-2 opacity-60">Meta Alcançada</p>
                      </div>
                    </motion.div>
                  </div>

                  {/* Per-house breakdown (real data from groupBy=brand) */}
                  <BrandBreakdown data={brandResults} config={config} />

                  {/* Por Campanha (dados reais da API externa, groupBy=campaign).
                      O afiliado vê a PRÓPRIA comissão (CPA+REV via config), nunca a margem da agência. */}
                  <CampaignBreakdown
                    commissionLabel="Sua comissão"
                    subtitle="Resultados por campanha no período selecionado"
                    rows={campaignResults.map((c) => ({
                      name: c.name,
                      registrations: c.registrations,
                      firstDeposits: c.first_deposits,
                      deposit: c.deposit,
                      qualifiedCpa: c.qualified_cpa,
                      commission: calcAffiliatePayout(c, config),
                    }))}
                  />

                  {/* Evolução diária (dados reais da API externa, groupBy=date) */}
                  <div className="bg-white dark:bg-neutral-900 border border-slate-100 dark:border-neutral-800 rounded-3xl flex flex-col shadow-sm overflow-hidden mb-20">
                    <div className="p-6 border-b border-slate-50 dark:border-neutral-800 flex justify-between items-center bg-slate-50/50">
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
                    <div className="p-6 border-b border-slate-50 dark:border-neutral-800 flex justify-between items-center bg-slate-50/50">
                      <h3 className="font-black text-xs text-slate-800 dark:text-white uppercase tracking-widest">Lista de Clientes</h3>
                      <div className="flex items-center gap-2 px-3 py-1 bg-slate-100 dark:bg-neutral-800 rounded-lg text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                        Filtrar por Casa
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
                          <tr>
                            <td colSpan={3} className="px-8 py-20 text-center">
                              <div className="flex flex-col items-center gap-2 opacity-30">
                                <User size={32} />
                                <p className="text-xs font-bold uppercase tracking-widest">Nenhum cliente registrado</p>
                              </div>
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                  */}
                </div>
              );
            })
          ) : (
            <div className="flex flex-col items-center justify-center py-20 text-center bg-white dark:bg-neutral-900 rounded-3xl border border-dashed border-slate-200 dark:border-neutral-800">
              <div className="w-16 h-16 bg-slate-50 dark:bg-neutral-800 rounded-full flex items-center justify-center text-slate-300 mb-4 shadow-sm">
                <Clock size={32} />
              </div>
              <p className="text-lg text-slate-500 font-bold max-w-sm px-6">
                Nenhum dado de performance disponível para este afiliado no momento.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* User Registration Modal */}
      {isUserModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white dark:bg-neutral-900 w-full max-w-md rounded-3xl shadow-2xl border border-slate-100 dark:border-neutral-800 overflow-hidden"
          >
            <div className="p-6 border-b border-slate-50 dark:border-neutral-800 flex justify-between items-center">
              <h3 className="font-black text-slate-900 dark:text-white uppercase tracking-widest text-sm">Cadastrar Usuário</h3>
              <button 
                onClick={() => {
                  setIsUserModalOpen(false);
                  setRegisterSuccess(false);
                  setUserEmail('');
                  setUserPassword('');
                  setRegisterError(null);
                }}
                className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-neutral-200 transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            
            {!registerSuccess ? (
              <form onSubmit={handleCreateUser} className="p-8 space-y-6">
                <div className="space-y-4">
                  <div className="p-4 bg-slate-50 dark:bg-neutral-800/50 rounded-2xl border border-slate-100 dark:border-neutral-800">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Nome do Afiliado</p>
                    <p className="text-sm font-bold text-slate-900 dark:text-white">{affiliate.name || affiliate.label}</p>
                    <p className="text-[10px] text-slate-400 font-mono mt-1">ID: #{affiliate.id}</p>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">E-mail para Login</label>
                    <div className="relative">
                      <Mail size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-600 dark:text-neutral-300" />
                      <input 
                        type="email"
                        required
                        placeholder="afiliado@exemplo.com"
                        value={userEmail}
                        onChange={(e) => setUserEmail(e.target.value)}
                        className="w-full pl-12 pr-4 py-3.5 bg-slate-50 dark:bg-neutral-800 border border-slate-100 dark:border-neutral-700 rounded-2xl text-sm font-bold outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand transition-all dark:text-white"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Senha Temporária</label>
                      <button 
                        type="button"
                        onClick={generateTemporaryPassword}
                        className="text-[10px] uppercase tracking-widest font-bold text-brand hover:text-brand-dark transition-colors"
                      >
                        Gerar nova senha
                      </button>
                    </div>
                    <div className="relative rounded-2xl bg-slate-50 dark:bg-neutral-800 border border-slate-100 dark:border-neutral-700 p-3 font-mono text-sm text-slate-700 dark:text-neutral-200 flex items-center justify-between gap-3">
                      <span className="break-all">{userPassword || 'Clique em gerar senha'}</span>
                      <button 
                        type="button"
                        disabled={!userPassword}
                        onClick={() => userPassword && navigator.clipboard.writeText(userPassword)}
                        className="rounded-xl bg-slate-900 text-white p-2 disabled:opacity-40 transition-all hover:bg-slate-800"
                      >
                        <Copy size={16} />
                      </button>
                    </div>
                  </div>
                </div>

                {registerError && (
                  <div className="rounded-2xl bg-red-50 dark:bg-red-900/30 border border-red-100 dark:border-red-800 p-4 text-sm text-red-700 dark:text-red-200">
                    {registerError}
                  </div>
                )}

                <button 
                  type="submit"
                  disabled={isRegistering || !userPassword}
                  className="w-full py-4 bg-slate-900 text-white font-black text-xs uppercase tracking-[0.2em] rounded-2xl shadow-xl shadow-slate-900/10 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3 dark:bg-gradient-to-r dark:from-cyan-300 dark:via-sky-300 dark:to-brand dark:text-neutral-950 dark:ring-1 dark:ring-white/20 dark:shadow-[0_18px_50px_rgba(56,189,248,0.28)] dark:hover:brightness-105"
                >
                  {isRegistering ? <Loader2 size={18} className="animate-spin" /> : <UserPlus size={18} />}
                  Confirmar Cadastro
                </button>
              </form>
            ) : (
              <div className="p-10 text-center space-y-6">
                <div className="w-20 h-20 bg-green-100 dark:bg-green-900/30 text-green-500 rounded-full flex items-center justify-center mx-auto mb-2 animate-bounce">
                  <CheckCircle size={40} />
                </div>
                <div className="space-y-2">
                  <h4 className="text-xl font-black text-slate-900 dark:text-white">Usuário Criado!</h4>
                  <p className="text-sm text-slate-500">O afiliado agora pode acessar o sistema com as credenciais abaixo:</p>
                </div>
                
                <div className="p-6 bg-slate-50 dark:bg-neutral-800 rounded-2xl border border-dashed border-slate-200 dark:border-neutral-700 space-y-4">
                  <div className="flex justify-between items-center text-left">
                    <div>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">E-mail</p>
                      <p className="text-sm font-bold text-slate-900 dark:text-white">{userEmail}</p>
                    </div>
                  </div>
                  <div className="flex justify-between items-center text-left">
                    <div>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Senha Inicial</p>
                      <p className="text-lg font-mono font-black text-brand tracking-widest">{userPassword}</p>
                    </div>
                    <button 
                      onClick={() => navigator.clipboard.writeText(userPassword)}
                      className="p-2 text-slate-400 hover:text-brand transition-colors"
                    >
                      <Copy size={16} />
                    </button>
                  </div>
                </div>

                <p className="text-[10px] text-slate-400 font-bold uppercase py-2">
                  * Recomendamos que o afiliado altere a senha no primeiro acesso.
                </p>

                <button 
                  onClick={() => setIsUserModalOpen(false)}
                  className="w-full py-4 bg-slate-100 dark:bg-neutral-800 text-slate-600 dark:text-neutral-300 font-bold text-xs uppercase tracking-widest rounded-2xl border border-slate-200 dark:border-neutral-700"
                >
                  Fechar
                </button>
              </div>
            )}
          </motion.div>
        </div>
      )}

      {/* Affiliate Link Modal */}
      {isLinkModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white dark:bg-neutral-900 w-full max-w-lg rounded-3xl shadow-2xl border border-slate-100 dark:border-neutral-800 overflow-hidden"
          >
            <div className="p-6 border-b border-slate-50 dark:border-neutral-800 flex justify-between items-center">
              <h3 className="font-black text-slate-900 dark:text-white uppercase tracking-widest text-sm">Convite de Acesso Gerado</h3>
              <button 
                onClick={() => setIsLinkModalOpen(false)}
                className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-neutral-200 transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            
            <div className="p-8 space-y-6">
              <div className="text-center space-y-2 mb-4">
                <div className="w-16 h-16 bg-brand/10 text-brand rounded-full flex items-center justify-center mx-auto mb-4">
                  <Link size={32} />
                </div>
                <h4 className="text-lg font-black text-slate-900 dark:text-white">Link de Ativação</h4>
                <p className="text-sm text-slate-500">Envie este link ao afiliado. Ele cria a própria senha e o acesso já fica vinculado a este ID.</p>
              </div>

              <div className="space-y-4">
                <div className="p-6 bg-slate-50 dark:bg-neutral-800/50 rounded-2xl border border-slate-100 dark:border-neutral-800 relative group">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Link de Convite</p>
                  <div className="flex items-center gap-4">
                    <div className="flex-1 font-mono text-xs text-slate-600 dark:text-neutral-400 break-all leading-relaxed bg-white dark:bg-neutral-900 p-3 rounded-xl border border-slate-100 dark:border-neutral-800">
                      {affiliateLink}
                    </div>
                    <button 
                      onClick={copyToClipboard}
                      className={cn(
                        "p-4 rounded-xl transition-all shadow-md flex items-center justify-center group-hover:scale-110 border",
                        isCopied ? "bg-green-500 text-white border-green-600" : "bg-slate-900 text-white border-slate-900 dark:bg-white dark:text-neutral-900 dark:border-neutral-200"
                      )}
                      title="Copiar link para a área de transferência"
                    >
                      {isCopied ? <Check size={20} /> : <Copy size={20} />}
                    </button>
                  </div>
                  {isCopied && (
                    <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 bg-green-500 text-white text-[10px] font-bold px-3 py-1 rounded-full animate-bounce">
                      Copiado com sucesso!
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-slate-50 dark:bg-neutral-800/50 rounded-2xl border border-slate-100 dark:border-neutral-800">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Status</p>
                    <div className="flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></div>
                      <span className="text-xs font-bold text-slate-700 dark:text-neutral-300">Pendente</span>
                    </div>
                  </div>
                  <div className="p-4 bg-slate-50 dark:bg-neutral-800/50 rounded-2xl border border-slate-100 dark:border-neutral-800">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Validade</p>
                    <span className="text-xs font-bold text-slate-700 dark:text-neutral-300">Uso único · 7 dias</span>
                  </div>
                </div>
              </div>

              <button 
                onClick={() => setIsLinkModalOpen(false)}
                className="w-full py-4 bg-slate-100 dark:bg-neutral-800 text-slate-600 dark:text-neutral-300 font-bold text-xs uppercase tracking-widest rounded-2xl border border-slate-200 dark:border-neutral-700 mt-4"
              >
                Concluir
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
