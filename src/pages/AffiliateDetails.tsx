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
  CheckCircle,
  Crown,
  Wallet,
  Eye,
  EyeOff,
  Users
} from 'lucide-react';
import {
  fetchAffiliateById,
  fetchAffiliateResults,
  fetchResultsForAffiliates,
  fetchAffiliateResultsByBrand,
  fetchAffiliateResultsByCampaign,
  fetchAffiliateDailyResults,
  fetchAffiliateConfigs,
  calcAffiliatePayout,
  resolveBrandRates,
  rateStatus,
  AffiliateConfig,
  CampaignRow,
  createUser,
  createAccessInvite,
  linkAffiliateUser,
  isUserRegistered,
  fetchAffiliates,
  fetchSpecialAffiliates,
  fetchRegisteredUsers,
  fetchPaymentProfile,
  PaymentProfile,
  SpecialAffiliate
} from '../services/affiliateService';
import { useAuth } from '../contexts/AuthContext';
import SpecialAffiliateModal from '../components/SpecialAffiliateModal';
import BrandBreakdown from '../components/BrandBreakdown';
import BrandFilter from '../components/BrandFilter';
import BrandConfigEditor from '../components/BrandConfigEditor';
import CampaignBreakdown from '../components/CampaignBreakdown';
import DailyPerformanceChart from '../components/DailyPerformanceChart';
import DateRangePicker from '../components/DateRangePicker';
import InfoTooltip from '../components/InfoTooltip';
import TrendBadge from '../components/TrendBadge';
import { DateRange, getDefaultRange, getPreviousRange, percentChange } from '../lib/dateRange';
import { ALL_BRANDS, getKnownBrandName } from '../lib/brand';
import { withKnownBrandNames } from '../lib/knownHouses';
import { cn, humanizeName } from '../lib/utils';
import { motion } from 'motion/react';

// B4 · mascara dados sensíveis (PIX, documento) — só os últimos dígitos.
const maskSensitive = (v?: string) => {
  if (!v) return '—';
  const s = String(v).trim();
  if (!s) return '—';
  if (s.length <= 4) return '•'.repeat(Math.max(1, s.length - 1)) + s.slice(-1);
  return '•••• ' + s.slice(-4);
};

// Soma N linhas (groupBy=affiliate) numa linha agregada. Usado quando o afiliado
// é um especial com rede: a página deve contabilizar own + subs, não só a
// produção própria do especial (que costuma ser zero). [[boost-special-as-scoped-master]]
const sumResultRows = (rows: any[]) =>
  (Array.isArray(rows) ? rows : []).reduce(
    (acc, r) => ({
      registrations: acc.registrations + (r?.registrations || 0),
      first_deposits: acc.first_deposits + (r?.first_deposits || 0),
      qualified_cpa: acc.qualified_cpa + (r?.qualified_cpa || 0),
      rvs: acc.rvs + (r?.rvs || 0),
      deposit: acc.deposit + (r?.deposit || 0),
      total_commission: acc.total_commission + (r?.total_commission || 0),
    }),
    { registrations: 0, first_deposits: 0, qualified_cpa: 0, rvs: 0, deposit: 0, total_commission: 0 }
  );

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
  // Cadastros do período anterior (mesma duração) → crescimento real no card.
  const [prevRegistrations, setPrevRegistrations] = useState<number | null>(null);
  const [config, setConfig] = useState<AffiliateConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<DateRange>(() => getDefaultRange());
  // Filtro por casa na própria view do afiliado (espelha o ClientDashboard).
  const [selectedBrand, setSelectedBrand] = useState<string>(ALL_BRANDS);
  // Cadastro próprio: o afiliado já criou acesso (existe users/{uid} com este affiliateId)?
  const [hasAccount, setHasAccount] = useState(false);

  // B3 · gestão de afiliado especial a partir desta página (reusa o modal compartilhado)
  const [specialOpen, setSpecialOpen] = useState(false);
  const [specialPool, setSpecialPool] = useState<any[]>([]);
  const [specials, setSpecials] = useState<Record<string, SpecialAffiliate>>({});
  const [specialAffiliate, setSpecialAffiliate] = useState<{ id: string; name?: string; userUid?: string } | null>(null);
  const [loadingSpecial, setLoadingSpecial] = useState(false);

  // B4 · Dados de pagamento do afiliado (admin visualiza, mascarado).
  const [paymentProfile, setPaymentProfile] = useState<PaymentProfile | null>(null);
  const [revealPayment, setRevealPayment] = useState(false);

  // Cadastros da rede de um afiliado especial — modal aberto pelo card "Cadastros".
  // Mostra cada afiliado vinculado (own + subs) com seus cadastros/métricas.
  const [cadastrosOpen, setCadastrosOpen] = useState(false);
  const [networkRows, setNetworkRows] = useState<any[]>([]);
  const [networkNames, setNetworkNames] = useState<Record<string, string>>({});
  const [loadingNetwork, setLoadingNetwork] = useState(false);
  // Quando o afiliado é um especial com rede, os cards agregam own + subs.
  const [isNetworkView, setIsNetworkView] = useState(false);
  // Linhas POR afiliado (own + subs) e configs completos — base do card de
  // lucro líquido do afiliado (ganho dele: direto + spread da rede).
  const [perAffiliateRows, setPerAffiliateRows] = useState<any[]>([]);
  const [allConfigs, setAllConfigs] = useState<Record<string, AffiliateConfig>>({});

  const openSpecial = async () => {
    if (!affiliate) return;
    setLoadingSpecial(true);
    try {
      const [pool, sp, users] = await Promise.all([fetchAffiliates(), fetchSpecialAffiliates(), fetchRegisteredUsers()]);
      setSpecialPool(pool);
      setSpecials(sp);
      const uid = users.find((u) => String(u.affiliateId) === String(affiliate.id))?.uid;
      setSpecialAffiliate({ id: String(affiliate.id), name: affiliate.name || affiliate.label, userUid: uid });
      setSpecialOpen(true);
    } catch (e) {
      console.error('Erro ao abrir gestão de especial:', e);
    } finally {
      setLoadingSpecial(false);
    }
  };

  const isCurrentSpecialActive = !!specials[String(id)]?.active;

  // Estado de "é especial?" só p/ refletir no botão (admin).
  useEffect(() => {
    if (isAdmin && id) fetchSpecialAffiliates().then(setSpecials).catch(() => {});
  }, [id, isAdmin]);

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

  // Vincular login existente (corrige login órfão sem affiliateId).
  const [isLinkUserModalOpen, setIsLinkUserModalOpen] = useState(false);
  const [linkEmail, setLinkEmail] = useState('');
  const [isLinking, setIsLinking] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkSuccess, setLinkSuccess] = useState(false);

  const closeLinkUserModal = () => {
    setIsLinkUserModalOpen(false);
    setLinkEmail('');
    setLinkError(null);
    setLinkSuccess(false);
  };

  const handleLinkUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!affiliate || isLinking) return;
    setIsLinking(true);
    setLinkError(null);
    try {
      await linkAffiliateUser(linkEmail.trim(), String(affiliate.id));
      setLinkSuccess(true);
      // Reflete que agora há conta vinculada (atualiza o badge da página).
      setHasAccount(true);
    } catch (err: any) {
      setLinkError(err?.message || 'Erro ao vincular login.');
    } finally {
      setIsLinking(false);
    }
  };

  useEffect(() => {
    if (id) {
      loadDetails(id);
    }
  }, [id, range.startDate, range.endDate]);

  const loadDetails = async (affId: string) => {
    try {
      setLoading(true);
      const prevRange = getPreviousRange(range);

      // Afiliado especial COM rede → o master vê a página contabilizando own + subs
      // (a produção própria do especial costuma ser zero; sem isto os cards zeravam).
      // O proxy expande o CSV de affiliateIds em params repetidos. [[boost-special-as-scoped-master]]
      const specialsMap = await fetchSpecialAffiliates().catch(() => ({} as Record<string, SpecialAffiliate>));
      setSpecials(specialsMap);
      const subIds = (specialsMap[String(affId)]?.subAffiliateIds || []).map(String);
      const isNetwork = subIds.length > 0;
      const networkIds = [String(affId), ...subIds];
      const idsCsv = networkIds.join(',');
      setIsNetworkView(isNetwork);

      const [detailsData, resultsData, allConfigs, brandData, campaignData, dailyData, prevResults] = await Promise.all([
        fetchAffiliateById(affId),
        (isNetwork ? fetchResultsForAffiliates(networkIds, range) : fetchAffiliateResults(affId, range)).catch(err => {
          console.error('Error fetching results:', err);
          return [];
        }),
        fetchAffiliateConfigs(),
        fetchAffiliateResultsByBrand(isNetwork ? idsCsv : affId, range),
        fetchAffiliateResultsByCampaign(isNetwork ? idsCsv : affId, range),
        fetchAffiliateDailyResults(isNetwork ? idsCsv : affId, range.startDate, range.endDate),
        (isNetwork ? fetchResultsForAffiliates(networkIds, prevRange) : fetchAffiliateResults(affId, prevRange)).catch(() => [])
      ]);
      setAffiliate(detailsData);
      // groupBy=affiliate devolve 1 linha por afiliado; p/ a rede somamos numa linha só
      // (a página renderiza um conjunto de cards por linha de `results`).
      const resultsArr = Array.isArray(resultsData) ? resultsData : (resultsData ? [resultsData] : []);
      setResults(isNetwork ? [sumResultRows(resultsArr)] : resultsArr);
      setPerAffiliateRows(resultsArr); // linhas cruas por afiliado (own + subs) p/ o lucro líquido
      setAllConfigs(allConfigs || {});
      setBrandResults(Array.isArray(brandData) ? brandData : []);
      setCampaignResults(Array.isArray(campaignData) ? campaignData : []);
      setDailyResults(Array.isArray(dailyData) ? dailyData : []);
      // Soma de cadastros do período anterior (a API pode devolver 1+ linhas).
      const prevArr = Array.isArray(prevResults) ? prevResults : [];
      setPrevRegistrations(prevArr.reduce((sum: number, r: any) => sum + (r.registrations || 0), 0));
      setConfig(allConfigs[affId] || null);

      // Cadastro próprio: para admin, consultamos se existe conta vinculada ao
      // affiliateId (a query em `users` exige admin nas regras). Para o próprio
      // afiliado vendo seu painel, ele está logado → por definição já é cadastrado.
      if (isAdmin) {
        setHasAccount(await isUserRegistered(affId).catch(() => false));
        fetchPaymentProfile(affId).then(setPaymentProfile).catch(() => setPaymentProfile(null));
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

  // Abre o modal e carrega os resultados por afiliado da rede do especial
  // (own + subs). Admin não sofre auto-escopo no proxy → passamos os ids da rede.
  const openCadastros = async () => {
    if (!id) return;
    setCadastrosOpen(true);
    setLoadingNetwork(true);
    try {
      const sp = specials[String(id)];
      const subIds = (sp?.subAffiliateIds || []).map(String);
      const allIds = [String(id), ...subIds];
      const [rows, list] = await Promise.all([
        fetchResultsForAffiliates(allIds, { startDate: range.startDate, endDate: range.endDate }),
        fetchAffiliates().catch(() => []),
      ]);
      setNetworkRows(Array.isArray(rows) ? rows : []);
      const names: Record<string, string> = {};
      (Array.isArray(list) ? list : []).forEach((a: any) => {
        const aid = String(a.id ?? a._id ?? '');
        if (aid) names[aid] = a.name || a.label || aid;
      });
      setNetworkNames(names);
    } catch (e) {
      console.error('Erro ao carregar cadastros da rede:', e);
      setNetworkRows([]);
    } finally {
      setLoadingNetwork(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <Loader2 className="w-10 h-10 text-brand dark:text-white animate-spin" />
        <p className="text-slate-500 dark:text-neutral-400 font-medium">Carregando informações realistas...</p>
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
          <p className="text-slate-500 dark:text-neutral-400 max-w-md">{error || 'Afiliado não encontrado'}</p>
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

  // Linhas do modal "CPA da rede": own (produção própria) + cada sub vinculado,
  // com CPA/métricas; subs sem produção aparecem zerados (nome do mirror).
  const networkCadastros = (() => {
    const sp = specials[String(id)];
    const ids = [String(id), ...((sp?.subAffiliateIds || []).map(String))];
    const byId: Record<string, any> = {};
    networkRows.forEach((r) => { byId[String(r.id ?? r.affiliate_id ?? '')] = r; });
    return ids.map((aid, idx) => {
      const r = byId[aid] || {};
      const fallback = idx === 0 ? (affiliate?.name || affiliate?.label) : '';
      return {
        id: aid,
        isOwn: idx === 0,
        name: humanizeName(r.label || r.name || networkNames[aid] || fallback || `#${aid}`),
        registrations: r.registrations || 0,
        firstDeposits: r.first_deposits || 0,
        qualifiedCpa: r.qualified_cpa || 0,
        deposit: r.deposit || 0,
      };
    });
  })();
  const networkTotalCpa = networkCadastros.reduce((s, x) => s + x.qualifiedCpa, 0);

  // Card de lucro líquido do AFILIADO — visível só a superiores (admin, ou especial
  // vendo um sub da rede dele). É o GANHO do próprio afiliado, NÃO a margem da
  // agência (essa segue só no /admin · [[boost-net-profit-rule]]):
  //   direto = produção própria × taxa dele;
  //   rede   = spread sobre os subs (taxa do especial − taxa do sub), p/ especiais.
  const isSuperiorView = isAdmin || (!!profile?.isSpecial && String(id) !== String(profile?.affiliateId));
  const lucro = (() => {
    const rowFor = (tid: string) => perAffiliateRows.find((r) => String(r?.id ?? r?.affiliate_id ?? '') === String(tid));
    const subIds = (specials[String(id)]?.subAffiliateIds || []).map(String);
    const direto = calcAffiliatePayout(rowFor(String(id)), config);
    const rede = subIds.reduce((sum, sid) => {
      const r = rowFor(sid);
      return r ? sum + (calcAffiliatePayout(r, config) - calcAffiliatePayout(r, allConfigs[sid])) : sum;
    }, 0);
    return { direto, rede, total: direto + rede, hasRede: subIds.length > 0 };
  })();

  // Casas disponíveis pro filtro: casas reais das linhas + casas conhecidas SEMPRE
  // listadas (modelo OTG), pra o dropdown aparecer mesmo com 1 casa real. Selecionar
  // uma casa escopa os cards de métrica àquela casa (linha do groupBy=brand + taxa
  // por-casa). "Todas as casas" usa o agregado e a taxa de topo.
  const brandNameOf = (r: any) =>
    getKnownBrandName(String(r?.id ?? ''), String(r?.label || r?.name || '')) ?? String(r?.label || r?.name || 'Casa');
  const availableBrands = withKnownBrandNames(
    Array.from(new Set(brandResults.map(brandNameOf))).filter(Boolean)
  );
  const isAllBrands = selectedBrand === ALL_BRANDS;
  const selectedBrandRow = isAllBrands ? null : brandResults.find((r) => brandNameOf(r) === selectedBrand);

  return (
    <div className="space-y-8 pb-20">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="flex items-center gap-4 min-w-0">
          {isAdmin ? (
            <button
              onClick={() => navigate('/affiliates')}
              className="shrink-0 p-3 bg-white dark:bg-neutral-900 border border-slate-200 dark:border-neutral-800 rounded-xl text-slate-500 hover:text-brand dark:hover:text-white transition-all shadow-sm"
            >
              <ArrowLeft size={20} />
            </button>
          ) : profile?.isSpecial && id !== String(profile?.affiliateId) ? (
            // Especial vendo um sub da própria rede: volta pra lista de afiliados dele.
            <button
              onClick={() => navigate('/network/afiliados')}
              className="shrink-0 p-3 bg-white dark:bg-neutral-900 border border-slate-200 dark:border-neutral-800 rounded-xl text-slate-500 hover:text-amber-500 transition-all shadow-sm"
            >
              <ArrowLeft size={20} />
            </button>
          ) : null}
          <div className="min-w-0">
            <div className="flex items-center gap-3 min-w-0">
              <h1 className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white tracking-tight truncate">
                {humanizeName(affiliate.name || affiliate.label) || 'Sem Nome'}
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
                    className="text-slate-400 hover:text-brand focus:text-brand dark:hover:text-white dark:focus:text-white outline-none transition-colors"
                  >
                    <HelpCircle size={14} />
                  </button>
                  <span
                    role="tooltip"
                    className="pointer-events-none absolute top-full z-30 mt-2 w-64 max-w-[calc(100vw_-_2rem)] right-0 translate-x-0 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 rounded-xl border border-slate-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-3 text-[11px] font-medium normal-case leading-relaxed text-slate-600 dark:text-neutral-300 shadow-xl opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity"
                  >
                    <strong className="text-green-600 dark:text-green-400">Cadastrado</strong>: o afiliado já criou o próprio acesso à plataforma.{' '}
                    <strong className="text-yellow-600 dark:text-yellow-400">Pendente</strong>: ainda não se registrou — gere um convite ou cadastre o usuário.
                  </span>
                </span>
              </div>
            </div>
            <p className="text-slate-500 dark:text-neutral-400 font-mono text-xs uppercase tracking-widest mt-1 break-all">ID Externo: #{affiliate.id}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <DateRangePicker value={range} onChange={setRange} />
          <BrandFilter brands={availableBrands} value={selectedBrand} onChange={setSelectedBrand} />
          {isAdmin && (
            <>
              <button
                onClick={handleOpenUserModal}
                className="flex items-center gap-2 px-4 py-2.5 bg-brand text-white rounded-xl hover:bg-brand-dark transition-all font-bold text-xs uppercase tracking-wider shadow-sm shadow-brand/20"
              >
                <UserPlus size={16} /> Cadastrar Usuário
              </button>
              <button
                onClick={() => setIsLinkUserModalOpen(true)}
                className="flex items-center gap-2 px-4 py-2.5 bg-white dark:bg-neutral-900 border border-slate-200 dark:border-neutral-800 text-slate-700 dark:text-neutral-300 rounded-xl hover:border-brand/40 dark:hover:border-white/15 transition-all font-bold text-xs uppercase tracking-wider shadow-sm"
              >
                <Link size={16} /> Vincular Login
              </button>
              <button
                onClick={handleGenerateLink}
                disabled={isGeneratingLink}
                className="flex items-center gap-2 px-4 py-2.5 bg-white dark:bg-neutral-900 border border-slate-200 dark:border-neutral-800 text-slate-700 dark:text-neutral-300 rounded-xl hover:border-brand/40 dark:hover:border-white/15 transition-all font-bold text-xs uppercase tracking-wider shadow-sm"
              >
                {isGeneratingLink ? <Loader2 size={16} className="animate-spin" /> : <Link size={16} />}
                Gerar Convite
              </button>
              <button
                onClick={openSpecial}
                disabled={loadingSpecial}
                className={cn(
                  "flex items-center gap-2 px-4 py-2.5 rounded-xl transition-all font-bold text-xs uppercase tracking-wider shadow-sm border disabled:opacity-50",
                  isCurrentSpecialActive
                    ? "bg-amber-500 text-white border-amber-500 hover:bg-amber-400"
                    : "bg-white dark:bg-neutral-900 border-slate-200 dark:border-neutral-800 text-slate-700 dark:text-neutral-300 hover:border-amber-500/40"
                )}
              >
                {loadingSpecial ? <Loader2 size={16} className="animate-spin" /> : <Crown size={16} />}
                {isCurrentSpecialActive ? 'Afiliado Especial' : 'Tornar Especial'}
              </button>
              {isCurrentSpecialActive && (
                <button
                  onClick={openCadastros}
                  className="flex items-center gap-2 px-4 py-2.5 bg-white dark:bg-neutral-900 border border-slate-200 dark:border-neutral-800 text-slate-700 dark:text-neutral-300 rounded-xl hover:border-amber-500/40 transition-all font-bold text-xs uppercase tracking-wider shadow-sm"
                >
                  <Users size={16} /> Afiliados Vinculados
                </button>
              )}
            </>
          )}
        </div>
      </header>

      {isAdmin && specialOpen && specialAffiliate && (
        <SpecialAffiliateModal
          affiliate={specialAffiliate}
          allAffiliates={specialPool}
          specials={specials}
          onClose={() => setSpecialOpen(false)}
          onSaved={() => fetchSpecialAffiliates().then(setSpecials).catch(() => {})}
        />
      )}

      <div className="grid grid-cols-1 gap-8">
        <div className="space-y-8">
          {/* Lucro líquido do afiliado — só p/ superiores (admin/especial). Ganho do
              próprio afiliado: total à esquerda + composição (direto + rede) à direita.
              NÃO é a margem da agência. */}
          {isSuperiorView && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="relative overflow-hidden p-6 md:p-7 rounded-3xl border border-emerald-200/70 dark:border-emerald-900/40 bg-emerald-50/60 dark:bg-emerald-950/20 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
            >
              <div className="absolute top-0 right-0 w-56 h-56 bg-emerald-500/10 rounded-full blur-3xl -mr-16 -mt-16 pointer-events-none" />
              <div className="relative">
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 mb-3 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-[10px] font-bold uppercase tracking-widest">
                  Lucro líquido do afiliado <InfoTooltip text="Ganho do próprio afiliado no período (não a margem da agência): produção própria à taxa dele + spread sobre a rede de sub-afiliados." size={12} align="left" />
                </div>
                <h3 className="text-3xl md:text-4xl font-bold tracking-tighter text-emerald-700 dark:text-emerald-400">
                  R$ {lucro.total.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </h3>
              </div>
              {lucro.hasRede && (
                <div className="relative shrink-0 text-sm md:text-base text-slate-600 dark:text-neutral-300 font-medium tabular-nums">
                  <span className="text-slate-400 dark:text-neutral-500">(</span>
                  <span className="font-bold text-slate-700 dark:text-neutral-200">direto</span> R$ {lucro.direto.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  <span className="mx-1 text-slate-400 dark:text-neutral-500">+</span>
                  <span className="font-bold text-slate-700 dark:text-neutral-200">rede</span> R$ {lucro.rede.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  <span className="text-slate-400 dark:text-neutral-500">)</span>
                </div>
              )}
            </motion.div>
          )}

          {/* Sem dados: renderiza os cards zerados (em vez de um aviso de vazio). */}
          {(results.length > 0
            ? results
            : [{ registrations: 0, first_deposits: 0, qualified_cpa: 0, rvs: 0, total_commission: 0, deposit: 0 }]
          ).map((res: any, idx: number) => {
              // Casa selecionada → usa a linha daquela casa (groupBy=brand) e a taxa
              // por-casa; "Todas as casas" → agregado do afiliado e a taxa de topo.
              const row = isAllBrands
                ? res
                : (selectedBrandRow ?? { registrations: 0, first_deposits: 0, qualified_cpa: 0, rvs: 0, total_commission: 0, deposit: 0 });
              const rates = isAllBrands
                ? { cpaValue: config?.cpaValue || 0, revPercentage: config?.revPercentage || 0 }
                : resolveBrandRates(config, String(selectedBrandRow?.id ?? ''));
              // "Configurado como 0" ≠ "ainda não configurado": rateStatus detecta a
              // AUSÊNCIA do valor de CPA (config sem `cpaValue` de topo e sem override
              // por casa) p/ não exibir R$0 como se fosse uma taxa real. Caso clássico:
              // afiliado só com `byBrand` e sem default de topo → "Todas as casas" cai no
              // topo ausente. Fonte única compartilhada com o ClientDashboard.
              const { cpaConfigured } = rateStatus(config, isAllBrands ? undefined : String(selectedBrandRow?.id ?? ''));
              const calculatedCpa = (row.qualified_cpa || 0) * rates.cpaValue;
              const calculatedRev = (row.rvs || 0) * (rates.revPercentage / 100);
              const totalCommission = calculatedCpa + calculatedRev;

              return (
                <div key={idx} className="space-y-8">
                  {/* Commissions Overview */}
                  <div className="bg-white dark:bg-neutral-900 p-8 rounded-3xl border border-slate-100 dark:border-neutral-800 shadow-sm space-y-6">
                    <div>
                      <div className="flex items-center gap-1 text-xs font-bold text-slate-500 dark:text-neutral-400 mb-2">
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
                          <div className="flex items-center gap-1 text-amber-700 dark:text-amber-400 font-bold text-sm bg-amber-500/10 px-2 py-0.5 rounded-lg" title="O valor de CPA deste afiliado ainda não foi configurado nas taxas do contrato.">
                            <AlertCircle size={16} /> CPA não configurado
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="p-6 bg-slate-50 dark:bg-neutral-800/50 rounded-2xl border border-slate-100 dark:border-neutral-800 flex items-center justify-between group hover:border-brand/20 dark:hover:border-white/10 transition-all">
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
                              <p className="text-sm font-bold text-amber-600 dark:text-amber-400">
                                Não configurado{isAdmin ? ' — defina o valor de CPA nas taxas do afiliado' : ''}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="p-6 bg-slate-50 dark:bg-neutral-800/50 rounded-2xl border border-slate-100 dark:border-neutral-800 flex items-center justify-between group hover:border-brand/20 dark:hover:border-white/10 transition-all">
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 rounded-xl bg-white dark:bg-neutral-800 flex items-center justify-center text-slate-400 group-hover:text-brand dark:group-hover:text-white transition-colors shadow-sm">
                            <TrendingUp size={20} />
                          </div>
                          <div>
                            <div className="flex items-center gap-1 text-[10px] font-bold text-slate-500 dark:text-neutral-300 uppercase tracking-widest mb-1">
                              REV Share ({rates.revPercentage}%) <InfoTooltip text="Participação na receita: percentual do seu contrato aplicado sobre o RVS (receita compartilhada) do período." size={10} align="left" />
                            </div>
                            <p className="text-xl font-black text-slate-800 dark:text-white">
                              R$ {calculatedRev.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* A MARGEM DA AGÊNCIA continua só no /admin (decisão do Carlos, 2026-05-29).
                      O card "Lucro líquido do afiliado" acima é o GANHO DO PRÓPRIO afiliado
                      (direto + rede), exibido só a superiores (admin/especial) — não a margem
                      da agência. O afiliado, vendo a si mesmo, não vê esse card. */}

                  {/* Aviso: afiliado especial → os números abaixo contabilizam a REDE
                      (produção própria + sub-afiliados vinculados), não só o link dele. */}
                  {isNetworkView && (
                    <div className="flex items-center gap-2.5 px-4 py-3 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400">
                      <Users size={15} className="shrink-0" />
                      <p className="text-[11px] font-bold">
                        Afiliado especial — os números abaixo somam a <strong>rede inteira</strong> (produção própria + sub-afiliados vinculados).
                      </p>
                    </div>
                  )}

                  {/* Primary Performance Metrics */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {/* Stage 1: Registrations (clientes que se cadastraram para o afiliado) */}
                    <motion.div
                      initial={{ opacity: 0, y: 20 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      className="bg-white dark:bg-neutral-900 p-8 rounded-[2.5rem] border border-slate-100 dark:border-neutral-800 shadow-sm group hover:border-brand/20 dark:hover:border-white/10 transition-all duration-500"
                    >
                      <div className="flex items-center justify-between mb-4">
                        <div className="p-3 bg-slate-50 dark:bg-neutral-800 rounded-2xl text-slate-400 group-hover:text-brand dark:group-hover:text-white transition-colors">
                          <UserPlus size={20} />
                        </div>
                        <TrendBadge change={isAllBrands ? percentChange(row.registrations || 0, prevRegistrations ?? 0) : 0} />
                      </div>
                      <div className="space-y-1">
                        <p className="text-[10px] font-black text-slate-400 dark:text-neutral-400 uppercase tracking-[0.2em]">Cadastros</p>
                        <h4 className="text-4xl font-black text-slate-900 dark:text-white tracking-tighter">{row.registrations || 0}</h4>
                        <p className="text-[10px] font-bold text-slate-400 dark:text-neutral-400 uppercase tracking-widest mt-2">{isNetworkView ? 'Clientes cadastrados na rede' : 'Clientes cadastrados'}</p>
                      </div>
                    </motion.div>

                    {/* Stage 2: FTDs */}
                    <motion.div 
                      initial={{ opacity: 0, y: 20 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.1 }}
                      className="bg-white dark:bg-neutral-900 p-8 rounded-[2.5rem] border border-slate-100 dark:border-neutral-800 shadow-sm group hover:border-brand/20 dark:hover:border-white/10 transition-all duration-500"
                    >
                      <div className="flex items-center justify-between mb-4">
                        <div className="p-3 bg-slate-50 dark:bg-neutral-800 rounded-2xl text-slate-400 group-hover:text-brand dark:group-hover:text-white transition-colors">
                          <Building size={20} />
                        </div>
                        <div className="flex items-center gap-2">
                           <div className="bg-slate-100 dark:bg-neutral-800 px-2 py-1 rounded-lg">
                             <span className="text-[10px] font-black text-slate-500 dark:text-neutral-400">
                               {row.registrations > 0 ? ((row.first_deposits / row.registrations) * 100).toFixed(1) : 0}% conv.
                             </span>
                           </div>
                        </div>
                      </div>
                      <div className="space-y-1">
                        <p className="text-[10px] font-black text-slate-400 dark:text-neutral-400 uppercase tracking-[0.2em]">Primeiros Depósitos</p>
                        <h4 className="text-4xl font-black text-slate-900 dark:text-white tracking-tighter">{row.first_deposits || 0}</h4>
                        <div className="flex items-center gap-1.5 mt-2">
                          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
                          <p className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-widest leading-none">Contas Ativas</p>
                        </div>
                      </div>
                    </motion.div>

                    {/* Stage 3: Qualified CPA */}
                    <motion.div 
                      initial={{ opacity: 0, y: 20 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.2 }}
                      className="bg-white dark:bg-neutral-900 p-8 rounded-[2.5rem] border border-slate-100 dark:border-neutral-800 shadow-sm group hover:border-brand/20 dark:hover:border-white/10 transition-all duration-500"
                    >
                      <div className="flex items-center justify-between mb-4">
                        <div className="p-3 bg-slate-50 dark:bg-neutral-800 rounded-2xl text-slate-400 group-hover:text-brand dark:group-hover:text-white transition-colors">
                          <Shield size={20} />
                        </div>
                        <div className="bg-slate-100 dark:bg-neutral-800 px-2 py-1 rounded-lg">
                           <span className="text-[10px] font-black text-slate-500 dark:text-neutral-400">
                             {row.first_deposits > 0 ? ((row.qualified_cpa / row.first_deposits) * 100).toFixed(1) : 0}% conv.
                           </span>
                        </div>
                      </div>
                      <div className="space-y-1">
                        <p className="text-[10px] font-black text-slate-400 dark:text-neutral-400 uppercase tracking-[0.2em]">CPA Qualificado</p>
                        <h4 className="text-4xl font-black text-slate-900 dark:text-white tracking-tighter">{row.qualified_cpa || 0}</h4>
                        <p className="text-[10px] font-bold text-slate-400 dark:text-neutral-400 uppercase tracking-widest mt-2 opacity-60">Meta Alcançada</p>
                      </div>
                    </motion.div>
                  </div>

                  {/* Per-house breakdown (real data from groupBy=brand) */}
                  <BrandBreakdown data={brandResults} config={config} />

                  {/* B6 · editor de comissão por casa — admin, dev-gated (≥2 casas). */}
                  {isAdmin && id && (
                    <BrandConfigEditor
                      affiliateId={id}
                      brandRows={brandResults}
                      config={config}
                      onSaved={() => loadDetails(id)}
                    />
                  )}

                  {/* B4 · Dados de pagamento do afiliado — admin visualiza (mascarado). */}
                  {isAdmin && (
                    <div className="bg-white dark:bg-neutral-900 border border-slate-100 dark:border-neutral-800 rounded-3xl shadow-sm overflow-hidden">
                      <div className="p-6 border-b border-slate-50 dark:border-neutral-800 flex justify-between items-center bg-slate-50/50 dark:bg-neutral-800/30">
                        <h3 className="flex items-center gap-2 font-black text-xs text-slate-800 dark:text-white uppercase tracking-widest">
                          <Wallet size={14} className="text-amber-500" /> Dados de Pagamento
                        </h3>
                        {paymentProfile?.pixKey && (
                          <button
                            onClick={() => setRevealPayment((v) => !v)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-100 dark:bg-neutral-800 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-neutral-300 hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
                          >
                            {revealPayment ? <EyeOff size={12} /> : <Eye size={12} />}
                            {revealPayment ? 'Ocultar' : 'Revelar'}
                          </button>
                        )}
                      </div>
                      {paymentProfile?.pixKey ? (
                        <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-5">
                          <div>
                            <p className="text-[10px] font-black text-slate-400 dark:text-neutral-400 uppercase tracking-[0.2em] mb-1">PIX · {(paymentProfile.pixKeyType || '—').toUpperCase()}</p>
                            <p className="text-sm font-bold text-slate-800 dark:text-white break-words">{revealPayment ? paymentProfile.pixKey : maskSensitive(paymentProfile.pixKey)}</p>
                          </div>
                          <div>
                            <p className="text-[10px] font-black text-slate-400 dark:text-neutral-400 uppercase tracking-[0.2em] mb-1">{(paymentProfile.documentType || 'cpf').toUpperCase()}</p>
                            <p className="text-sm font-bold text-slate-800 dark:text-white break-words">{paymentProfile.document ? (revealPayment ? paymentProfile.document : maskSensitive(paymentProfile.document)) : '—'}</p>
                          </div>
                          <div>
                            <p className="text-[10px] font-black text-slate-400 dark:text-neutral-400 uppercase tracking-[0.2em] mb-1">Razão social / Nome</p>
                            <p className="text-sm font-bold text-slate-800 dark:text-white break-words">{paymentProfile.legalName || '—'}</p>
                          </div>
                          <div>
                            <p className="text-[10px] font-black text-slate-400 dark:text-neutral-400 uppercase tracking-[0.2em] mb-1">Endereço</p>
                            <p className="text-sm font-bold text-slate-800 dark:text-white break-words">{paymentProfile.address || '—'}</p>
                          </div>
                        </div>
                      ) : (
                        <div className="p-8 text-center">
                          <p className="text-xs text-slate-400 dark:text-neutral-500">O afiliado ainda não cadastrou os dados de pagamento.</p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Por Campanha (dados reais da API externa, groupBy=campaign).
                      O afiliado vê a PRÓPRIA comissão (CPA+REV via config), nunca a margem da agência. */}
                  <CampaignBreakdown
                    title="Top 5 campanhas"
                    commissionLabel="Sua comissão"
                    subtitle="As 5 campanhas com maior comissão no período"
                    infoText="As 5 campanhas com maior comissão sua. 'Sua comissão' é o repasse a você (CPA + REV) referente a cada campanha no período."
                    rows={campaignResults
                      .map((c) => ({
                        name: c.name,
                        registrations: c.registrations,
                        firstDeposits: c.first_deposits,
                        deposit: c.deposit,
                        qualifiedCpa: c.qualified_cpa,
                        commission: calcAffiliatePayout(c, config),
                      }))
                      .sort((a, b) => b.commission - a.commission)
                      .slice(0, 5)}
                  />

                  {/* Evolução diária (dados reais da API externa, groupBy=date) */}
                  <div className="bg-white dark:bg-neutral-900 border border-slate-100 dark:border-neutral-800 rounded-3xl flex flex-col shadow-sm overflow-hidden mb-20">
                    <div className="p-6 border-b border-slate-50 dark:border-neutral-800 flex justify-between items-center bg-slate-50/50 dark:bg-neutral-800/30">
                      <h3 className="font-black text-xs text-slate-800 dark:text-white uppercase tracking-widest">Evolução Diária</h3>
                      <div className="flex items-center gap-2 px-3 py-1 bg-slate-100 dark:bg-neutral-800 rounded-lg text-[10px] font-bold text-slate-400 dark:text-neutral-400 uppercase tracking-widest">
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
                      <div className="flex items-center gap-2 px-3 py-1 bg-slate-100 dark:bg-neutral-800 rounded-lg text-[10px] font-bold text-slate-400 dark:text-neutral-400 uppercase tracking-widest">
                        Filtrar por Casa
                      </div>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left">
                        <thead className="bg-slate-50 dark:bg-neutral-800/50 text-[10px] text-slate-400 dark:text-neutral-400 uppercase tracking-widest sticky top-0 backdrop-blur-sm z-10 border-b border-slate-100 dark:border-neutral-800">
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
            })}
        </div>
      </div>

      {/* User Registration Modal */}
      {isUserModalOpen && (
        <div
          onClick={() => { setIsUserModalOpen(false); setRegisterSuccess(false); setUserEmail(''); setUserPassword(''); setRegisterError(null); }}
          className="fixed inset-0 z-50 overflow-y-auto p-4 bg-slate-900/60 backdrop-blur-sm"
        >
          <div className="flex min-h-full items-center justify-center">
          <motion.div
            onClick={(e) => e.stopPropagation()}
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
                    <p className="text-[10px] font-black text-slate-400 dark:text-neutral-400 uppercase tracking-widest mb-1">Nome do Afiliado</p>
                    <p className="text-sm font-bold text-slate-900 dark:text-white">{humanizeName(affiliate.name || affiliate.label)}</p>
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
                        className="w-full pl-12 pr-4 py-3.5 bg-slate-50 dark:bg-neutral-800 border border-slate-100 dark:border-neutral-700 rounded-2xl text-sm font-bold outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand dark:focus:border-white/30 transition-all dark:text-white"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Senha Temporária</label>
                      <button 
                        type="button"
                        onClick={generateTemporaryPassword}
                        className="text-[10px] uppercase tracking-widest font-bold text-brand dark:text-white hover:text-brand-dark transition-colors"
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
                      <p className="text-[10px] font-black text-slate-400 dark:text-neutral-400 uppercase tracking-widest">E-mail</p>
                      <p className="text-sm font-bold text-slate-900 dark:text-white">{userEmail}</p>
                    </div>
                  </div>
                  <div className="flex justify-between items-center text-left">
                    <div>
                      <p className="text-[10px] font-black text-slate-400 dark:text-neutral-400 uppercase tracking-widest">Senha Inicial</p>
                      <p className="text-lg font-mono font-black text-brand dark:text-white tracking-widest">{userPassword}</p>
                    </div>
                    <button 
                      onClick={() => navigator.clipboard.writeText(userPassword)}
                      className="p-2 text-slate-400 hover:text-brand dark:hover:text-white transition-colors"
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
        </div>
      )}

      {/* Vincular Login Existente — corrige login órfão (users/{uid} sem affiliateId
          que prende o afiliado no /profile). Liga o login (por e-mail) a ESTE afiliado. */}
      {isLinkUserModalOpen && (
        <div onClick={closeLinkUserModal} className="fixed inset-0 z-50 overflow-y-auto p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="flex min-h-full items-center justify-center">
            <motion.div
              onClick={(e) => e.stopPropagation()}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-white dark:bg-neutral-900 w-full max-w-md rounded-3xl shadow-2xl border border-slate-100 dark:border-neutral-800 overflow-hidden"
            >
              <div className="p-6 border-b border-slate-50 dark:border-neutral-800 flex justify-between items-center">
                <h3 className="font-black text-slate-900 dark:text-white uppercase tracking-widest text-sm">Vincular Login Existente</h3>
                <button onClick={closeLinkUserModal} className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-neutral-200 transition-colors">
                  <X size={20} />
                </button>
              </div>

              {!linkSuccess ? (
                <form onSubmit={handleLinkUser} className="p-8 space-y-6">
                  <div className="p-4 bg-slate-50 dark:bg-neutral-800/50 rounded-2xl border border-slate-100 dark:border-neutral-800">
                    <p className="text-[10px] font-black text-slate-400 dark:text-neutral-400 uppercase tracking-widest mb-1">Vincular a</p>
                    <p className="text-sm font-bold text-slate-900 dark:text-white">{humanizeName(affiliate.name || affiliate.label)}</p>
                    <p className="text-[10px] text-slate-400 font-mono mt-1">ID: #{affiliate.id}</p>
                  </div>

                  <p className="text-xs text-slate-500 dark:text-neutral-400">
                    Use quando o afiliado <span className="font-bold">já tem login</span> mas não consegue sair do perfil
                    (conta sem vínculo). Informe o e-mail do login dele.
                  </p>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">E-mail do login</label>
                    <div className="relative">
                      <Mail size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-600 dark:text-neutral-300" />
                      <input
                        type="email"
                        required
                        placeholder="afiliado@exemplo.com"
                        value={linkEmail}
                        onChange={(e) => setLinkEmail(e.target.value)}
                        className="w-full pl-12 pr-4 py-3.5 bg-slate-50 dark:bg-neutral-800 border border-slate-100 dark:border-neutral-700 rounded-2xl text-sm font-bold outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand dark:focus:border-white/30 transition-all dark:text-white"
                      />
                    </div>
                  </div>

                  {linkError && (
                    <div className="rounded-2xl bg-red-50 dark:bg-red-900/30 border border-red-100 dark:border-red-800 p-4 text-sm text-red-700 dark:text-red-200">
                      {linkError}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={isLinking || !linkEmail.trim()}
                    className="w-full py-4 bg-slate-900 text-white font-black text-xs uppercase tracking-[0.2em] rounded-2xl shadow-xl shadow-slate-900/10 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3 dark:bg-white dark:text-neutral-950"
                  >
                    {isLinking ? <Loader2 size={18} className="animate-spin" /> : <Link size={18} />}
                    Vincular
                  </button>
                </form>
              ) : (
                <div className="p-10 text-center space-y-6">
                  <div className="w-20 h-20 bg-green-100 dark:bg-green-900/30 text-green-500 rounded-full flex items-center justify-center mx-auto">
                    <CheckCircle size={40} />
                  </div>
                  <div className="space-y-2">
                    <h4 className="text-xl font-black text-slate-900 dark:text-white">Login vinculado!</h4>
                    <p className="text-sm text-slate-500">O afiliado já pode acessar o painel. Peça pra ele sair e entrar novamente.</p>
                  </div>
                  <button
                    onClick={closeLinkUserModal}
                    className="w-full py-4 bg-slate-100 dark:bg-neutral-800 text-slate-600 dark:text-neutral-300 font-bold text-xs uppercase tracking-widest rounded-2xl border border-slate-200 dark:border-neutral-700"
                  >
                    Fechar
                  </button>
                </div>
              )}
            </motion.div>
          </div>
        </div>
      )}

      {/* Affiliate Link Modal */}
      {isLinkModalOpen && (
        <div onClick={() => setIsLinkModalOpen(false)} className="fixed inset-0 z-50 overflow-y-auto p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="flex min-h-full items-center justify-center">
          <motion.div
            onClick={(e) => e.stopPropagation()}
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
                <div className="w-16 h-16 bg-brand/10 text-brand dark:bg-white/10 dark:text-white rounded-full flex items-center justify-center mx-auto mb-4">
                  <Link size={32} />
                </div>
                <h4 className="text-lg font-black text-slate-900 dark:text-white">Link de Ativação</h4>
                <p className="text-sm text-slate-500">Envie este link ao afiliado. Ele cria a própria senha e o acesso já fica vinculado a este ID.</p>
              </div>

              <div className="space-y-4">
                <div className="p-6 bg-slate-50 dark:bg-neutral-800/50 rounded-2xl border border-slate-100 dark:border-neutral-800 relative group">
                  <p className="text-[10px] font-black text-slate-400 dark:text-neutral-400 uppercase tracking-widest mb-3">Link de Convite</p>
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
                    <p className="text-[10px] font-black text-slate-400 dark:text-neutral-400 uppercase tracking-widest mb-1">Status</p>
                    <div className="flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></div>
                      <span className="text-xs font-bold text-slate-700 dark:text-neutral-300">Pendente</span>
                    </div>
                  </div>
                  <div className="p-4 bg-slate-50 dark:bg-neutral-800/50 rounded-2xl border border-slate-100 dark:border-neutral-800">
                    <p className="text-[10px] font-black text-slate-400 dark:text-neutral-400 uppercase tracking-widest mb-1">Validade</p>
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
        </div>
      )}

      {/* Modal · CPA da rede do afiliado especial (own + subs vinculados).
          A API não expõe jogadores; listamos os afiliados da rede do especial
          com seu CPA qualificado (decisão do Carlos: CPA, não cadastros). */}
      {cadastrosOpen && (
        <div onClick={() => setCadastrosOpen(false)} className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-sm">
          <div className="flex min-h-full items-center justify-center p-4">
          <motion.div
            onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white dark:bg-neutral-900 w-full max-w-2xl rounded-3xl shadow-2xl border border-slate-100 dark:border-neutral-800 overflow-hidden flex flex-col max-h-[calc(100vh_-_2rem)]"
          >
            <div className="shrink-0 p-6 border-b border-slate-50 dark:border-neutral-800 flex justify-between items-center gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <span className="shrink-0 p-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-500"><Users size={18} /></span>
                <div className="min-w-0">
                  <h3 className="font-black text-slate-900 dark:text-white uppercase tracking-widest text-sm truncate">CPA da rede</h3>
                  <p className="text-[11px] text-slate-400 dark:text-neutral-500 truncate">
                    {humanizeName(affiliate.name || affiliate.label)} · {Math.max(0, networkCadastros.length - 1)} sub-afiliado(s) vinculado(s)
                  </p>
                </div>
              </div>
              <button onClick={() => setCadastrosOpen(false)} className="shrink-0 p-2 text-slate-400 hover:text-slate-600 dark:hover:text-neutral-200 transition-colors"><X size={20} /></button>
            </div>

            {loadingNetwork ? (
              <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 text-amber-500 animate-spin" /></div>
            ) : (
              <>
                <div className="shrink-0 px-6 py-4 bg-slate-50/60 dark:bg-neutral-800/30 border-b border-slate-50 dark:border-neutral-800 flex items-center justify-between">
                  <span className="text-[10px] font-black text-slate-400 dark:text-neutral-400 uppercase tracking-widest">Total de CPA na rede</span>
                  <span className="text-lg font-black text-slate-900 dark:text-white tabular-nums">{networkTotalCpa.toLocaleString('pt-BR')}</span>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-slate-50 dark:divide-neutral-800">
                  {networkCadastros.map((n) => (
                    <div key={n.id} className="px-6 py-4 flex items-center justify-between gap-4 hover:bg-slate-50/50 dark:hover:bg-neutral-800/30 transition-colors">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className={cn(
                          "shrink-0 w-9 h-9 rounded-xl flex items-center justify-center text-[11px] font-black border",
                          n.isOwn
                            ? "bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400"
                            : "bg-slate-50 dark:bg-neutral-800/60 border-slate-100 dark:border-neutral-700/60 text-slate-500 dark:text-neutral-400"
                        )}>
                          {n.isOwn ? <Crown size={15} /> : n.name.charAt(0).toUpperCase()}
                        </span>
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-slate-800 dark:text-white truncate">{n.name}</p>
                          <p className="text-[10px] font-mono uppercase tracking-widest text-slate-400 dark:text-neutral-500 truncate">
                            {n.isOwn ? 'Produção própria' : `${n.firstDeposits} FTD`}
                          </p>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-xl font-black text-slate-900 dark:text-white tabular-nums">{n.qualifiedCpa.toLocaleString('pt-BR')}</p>
                        <p className="text-[9px] font-bold text-slate-400 dark:text-neutral-400 uppercase tracking-widest">CPA</p>
                      </div>
                    </div>
                  ))}
                  {networkCadastros.length === 0 && (
                    <div className="px-6 py-16 text-center text-xs font-bold text-slate-400 dark:text-neutral-400 uppercase tracking-widest opacity-60">Nenhum afiliado vinculado</div>
                  )}
                </div>
              </>
            )}
          </motion.div>
          </div>
        </div>
      )}
    </div>
  );
}
