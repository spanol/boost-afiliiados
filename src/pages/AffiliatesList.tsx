import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  Users,
  Search,
  Filter,
  RefreshCw,
  AlertCircle,
  Loader2,
  Save,
  CheckCircle,
  Percent,
  DownloadCloud,
  Crown
} from 'lucide-react';
import { fetchAffiliates, fetchAffiliateConfigs, fetchAffiliateStatuses, saveAffiliateConfig, updateAffiliateStatus, createAuditLog, fetchRegisteredUsers, updateUserRole, syncAffiliates, AffiliateConfig, fetchSpecialAffiliates, SpecialAffiliate } from '../services/affiliateService';
import SpecialAffiliateModal from '../components/SpecialAffiliateModal';
import { useToast } from '../contexts/ToastContext';
import { cn, humanizeName } from '../lib/utils';
import BrandFilter from '../components/BrandFilter';
import { getBrandName, uniqueBrands, ALL_BRANDS } from '../lib/brand';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate, Navigate } from 'react-router-dom';

interface Affiliate {
  id: string;
  name: string;
  email: string;
  status: string;
  brand?: {
    id: string;
    name: string;
  };
  createdAt: string;
  userUid?: string;
  role?: 'admin' | 'client';
}

export default function AffiliatesList() {
  const { profile } = useAuth();
  const { push } = useToast();
  const navigate = useNavigate();
  const [syncing, setSyncing] = useState(false);
  const [affiliates, setAffiliates] = useState<Affiliate[]>([]);
  const [configs, setConfigs] = useState<Record<string, AffiliateConfig>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [brandFilter, setBrandFilter] = useState<string>(ALL_BRANDS);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [updatingStatusId, setUpdatingStatusId] = useState<string | null>(null);
  const [confirmModal, setConfirmModal] = useState<{ open: boolean; affiliateId?: string; name?: string; pendingStatus?: 'active' | 'inactive' }>({ open: false });

  // B3 · Afiliado especial (Fase 1 — setup do master)
  const [specials, setSpecials] = useState<Record<string, SpecialAffiliate>>({});
  const [specialModal, setSpecialModal] = useState<{ open: boolean; affiliate?: Affiliate }>({ open: false });

  const isAdmin = profile?.role === 'admin';
  const pageTitle = isAdmin ? 'Gestão de Afiliados' : 'Meus Clientes';
  const pageSubTitle = isAdmin 
    ? 'Visualize e gerencie todos os parceiros conectados à rede.' 
    : 'Lista de clientes vinculados à sua conta de afiliado.';

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      if (!isAdmin) {
        setAffiliates([]);
        setConfigs({});
        return;
      }

      const [affData, configData, statusData, registeredUsers, specialData] = await Promise.all([
        fetchAffiliates(),
        fetchAffiliateConfigs(),
        fetchAffiliateStatuses(),
        fetchRegisteredUsers(),
        fetchSpecialAffiliates()
      ]);
      setSpecials(specialData);

      // Admins (afiliados master) NÃO devem aparecer na listagem de afiliados.
      const affiliateUsers = registeredUsers.filter(u => u.role !== 'admin');

      // Create a lookup of registered affiliate IDs for quick checks
      const regLookup = new Set(affiliateUsers.map(u => String(u.affiliateId || u.uid)));

      // Prioritize registered affiliates: map registered users to affiliate objects if present
      const registeredAffiliates: Affiliate[] = affiliateUsers.map(u => {
        const affiliateKey = String(u.affiliateId || u.uid);
        const found = affData.find((a: any) => String(a.id) === affiliateKey || String(a._id) === affiliateKey);
        if (found) {
          return { ...found, status: found.status || 'active', userUid: u.uid, role: (u.role as 'admin'|'client') || 'client' } as Affiliate;
        }
        return { id: affiliateKey, name: u.name || u.email || 'Sem Nome', email: u.email || '', status: 'active', userUid: u.uid, role: 'client' } as Affiliate;
      });

      // Remaining affiliates from API that are not registered
      const remaining = affData.filter((a: any) => !regLookup.has(String(a.id ?? a._id ?? ''))).map((a: any) => ({
        ...a,
        status: 'inactive'
      } as Affiliate));

      const mergedAffiliates = [...registeredAffiliates, ...remaining].map((affiliate) => ({
        ...affiliate,
        status: statusData[affiliate.id]?.status || affiliate.status || 'inactive'
      }));

      // Deduplica por id (mantém a 1ª ocorrência → registrados vêm primeiro).
      // Sem isso, dois usuários com o mesmo affiliateId (ou ids repetidos na API)
      // geram chaves React duplicadas e linhas repetidas na lista.
      const seenIds = new Set<string>();
      const uniqueAffiliates = mergedAffiliates.filter((a) => {
        const key = String(a.id ?? (a as any)._id ?? '');
        if (!key) return true; // sem id: não dá para deduplicar, mantém
        if (seenIds.has(key)) return false;
        seenIds.add(key);
        return true;
      });

      setAffiliates(uniqueAffiliates);
      setConfigs(configData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar dados da API');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [isAdmin]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const result = await syncAffiliates();
      push({ type: 'success', message: `${result.synced} afiliados sincronizados da API externa.` });
      await loadData();
    } catch (err) {
      push({ type: 'error', message: err instanceof Error ? err.message : 'Falha ao sincronizar afiliados.' });
    } finally {
      setSyncing(false);
    }
  };

  const handleConfigChange = (affiliateId: string, field: 'cpaValue' | 'revPercentage', value: string) => {
    // allow empty string for easier typing, but convert to 0 for the state if needed
    // Actually, it's better to keep it as string if we want to allow typing freely, 
    // but the current state expects a number.
    // Keep the raw string while editing so the field can be cleared (delete the 0)
    // and retyped. Values are coerced to numbers on save (handleSaveConfig).
    const next = value === '' ? '' : Math.max(0, parseFloat(value) || 0);

    setConfigs(prev => ({
      ...prev,
      [affiliateId]: {
        ...(prev[affiliateId] || { affiliateId, cpaValue: 0, revPercentage: 0 }),
        [field]: next as any
      }
    }));
  };

  const handleSaveConfig = async (affiliateId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSavingId(affiliateId);
    try {
      const raw = configs[affiliateId] || { affiliateId, cpaValue: 0, revPercentage: 0 };
      const config = {
        affiliateId,
        cpaValue: Number(raw.cpaValue) || 0,
        revPercentage: Number(raw.revPercentage) || 0,
      };
      await saveAffiliateConfig(config);
      setSavedId(affiliateId);
      setTimeout(() => setSavedId(null), 2000);
    } catch (err) {
      console.error('Failed to save config:', err);
    } finally {
      setSavingId(null);
    }
  };

  const availableBrands = uniqueBrands(affiliates);
  const filteredAffiliates = Array.isArray(affiliates)
    ? affiliates.filter(item => {
        const matchesSearch =
          item.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
          item.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
          item.id?.toString().includes(searchTerm);
        const matchesBrand = brandFilter === ALL_BRANDS || getBrandName(item) === brandFilter;
        return matchesSearch && matchesBrand;
      })
    : [];
  const visibleAffiliates = isAdmin ? filteredAffiliates : [];

  // Mapa sub-afiliado → afiliado especial dono (só especiais ATIVOS). Usado para
  // exibir o badge "Pertence a <especial>" em cada parceiro vinculado a uma rede.
  const ownerBySubId = useMemo(() => {
    const nameById: Record<string, string> = {};
    affiliates.forEach((a: any) => { nameById[String(a.id ?? a._id ?? '')] = a.name || a.label || ''; });
    const map: Record<string, { id: string; name: string }> = {};
    Object.values(specials).forEach((sp) => {
      if (!sp?.active) return;
      const ownerName = humanizeName(nameById[String(sp.affiliateId)] || `#${sp.affiliateId}`);
      (sp.subAffiliateIds || []).forEach((subId) => {
        map[String(subId)] = { id: String(sp.affiliateId), name: ownerName };
      });
    });
    return map;
  }, [specials, affiliates]);

  const handleOpenDetails = (affiliate: any) => {
    navigate(`/affiliates/${affiliate.id}`);
  };

  const handleToggleStatus = async (affiliateId: string, value: 'active' | 'inactive', reason?: string) => {
    // value expected 'active' or 'inactive'
    setUpdatingStatusId(affiliateId);
    try {
      await updateAffiliateStatus(affiliateId, value);
      setAffiliates(prev => prev.map(a => (a.id === affiliateId ? { ...a, status: value } : a)));
      // create audit log
      try {
        await createAuditLog({ affiliateId, actorId: profile?.uid, actorName: profile?.name, action: value === 'active' ? 'activated' : 'deactivated', reason });
      } catch (logErr) {
        console.error('Falha ao criar log de auditoria', logErr);
      }
    } catch (err) {
      console.error('Erro ao atualizar status do afiliado', err);
    } finally {
      setUpdatingStatusId(null);
    }
  };

  const handleRoleChange = async (userUid: string | undefined, newRole: 'admin' | 'client') => {
    if (!userUid) return;
    try {
      await updateUserRole(userUid, newRole);
      setAffiliates(prev => prev.map(a => a.userUid === userUid ? { ...a, role: newRole } : a));
    } catch (err) {
      console.error('Erro atualizando role do usuário', err);
    }
  };

  // --- B3 · Afiliado especial -------------------------------------------------
  // O modal foi extraído para <SpecialAffiliateModal>; aqui só abrimos.
  const handleOpenSpecial = (affiliate: Affiliate) => setSpecialModal({ open: true, affiliate });

  // A lista de afiliados é exclusiva do master. Não-admin (afiliado comum ou
  // especial) é redirecionado pra própria home — o "módulo clientes" não é usado.
  if (profile && !isAdmin) return <Navigate to="/dashboard" replace />;

  return (
    <div className="space-y-8 pb-12">
      {/* Confirmation Modal */}
      {confirmModal.open && (
        <div onClick={() => setConfirmModal({ open: false })} className="fixed inset-0 z-50 overflow-y-auto bg-black/50 backdrop-blur-sm p-4">
          <div className="flex min-h-full items-center justify-center">
          <motion.div
            onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="w-full max-w-md p-6 bg-white dark:bg-neutral-900 rounded-3xl shadow-2xl border border-slate-200/70 dark:border-neutral-800"
          >
            <h3 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">Confirmar ação</h3>
            <p className="text-sm text-slate-500 dark:text-neutral-400 mt-2">Tem certeza que deseja desativar o afiliado <span className="font-semibold text-slate-700 dark:text-neutral-200">{confirmModal.name}</span>? Isso impedirá o acesso ao sistema.</p>
            <div className="mt-6 flex justify-end gap-2">
              <button className="px-4 py-2 rounded-xl bg-white dark:bg-neutral-800 border border-slate-200 dark:border-neutral-700 text-xs font-bold text-slate-600 dark:text-neutral-200 hover:border-slate-300 dark:hover:border-neutral-600 transition-all" onClick={() => setConfirmModal({ open: false })}>Cancelar</button>
              <button className="px-4 py-2 rounded-xl bg-red-600 text-white text-xs font-bold hover:bg-red-500 transition-all shadow-sm shadow-red-600/20" onClick={async () => {
                if (!confirmModal.affiliateId) return;
                await handleToggleStatus(confirmModal.affiliateId, 'inactive');
                setConfirmModal({ open: false });
              }}>Confirmar Desativação</button>
            </div>
          </motion.div>
          </div>
        </div>
      )}
      {/* B3 · Modal de gestão do afiliado especial (componente compartilhado) */}
      {specialModal.open && specialModal.affiliate && (
        <SpecialAffiliateModal
          affiliate={specialModal.affiliate}
          allAffiliates={affiliates}
          specials={specials}
          onClose={() => setSpecialModal({ open: false })}
          onSaved={loadData}
        />
      )}

      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <span className="inline-flex items-center gap-2 px-3 py-1 mb-3 rounded-full bg-slate-900/5 dark:bg-white/5 border border-slate-900/10 dark:border-white/10 text-slate-500 dark:text-neutral-300 text-[10px] font-bold uppercase tracking-widest">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            {isAdmin ? 'Rede de parceiros' : 'Sua carteira'}
          </span>
          <h1 className="text-3xl md:text-4xl font-bold text-slate-900 dark:text-white tracking-tighter flex items-center gap-3">
            <span className="p-2 rounded-xl bg-slate-50 dark:bg-neutral-800/60 border border-slate-100 dark:border-neutral-700/60">
              <Users size={24} className="text-slate-900 dark:text-white" />
            </span>
            {pageTitle}
          </h1>
          <p className="text-slate-500 dark:text-neutral-400 text-sm mt-2">{pageSubTitle}</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Sincronizar é admin-only (o endpoint /api/affiliates/sync exige admin);
              o afiliado especial não tem acesso, então o botão nem aparece pra ele. */}
          {isAdmin && (
            <button
              onClick={handleSync}
              disabled={syncing || loading}
              className="flex items-center gap-2 px-4 py-2.5 bg-slate-900 dark:bg-white text-white dark:text-neutral-900 rounded-full text-xs font-bold hover:opacity-90 transition-all shadow-sm disabled:opacity-50"
            >
              <DownloadCloud size={14} className={cn(syncing && "animate-spin")} />
              {syncing ? 'Sincronizando...' : 'Sincronizar afiliados'}
            </button>
          )}
          <button
            onClick={loadData}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2.5 bg-white dark:bg-neutral-900 border border-slate-200 dark:border-neutral-800 rounded-full text-xs font-bold text-slate-600 dark:text-neutral-300 hover:border-slate-300 dark:hover:border-neutral-700 transition-all shadow-sm disabled:opacity-50"
          >
            <RefreshCw size={14} className={cn(loading && "animate-spin")} />
            Atualizar Lista
          </button>
        </div>
      </header>

      <div className="bg-white dark:bg-neutral-900/60 border border-slate-200/70 dark:border-neutral-800 rounded-3xl shadow-sm overflow-hidden transition-colors">
        <div className="p-4 border-b border-slate-100 dark:border-neutral-800 flex flex-col sm:flex-row gap-4 items-center justify-between">
          <div className="relative w-full sm:max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-neutral-400" size={16} />
            <input
              type="text"
              placeholder="Buscar por nome, e-mail ou ID..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-neutral-800/60 border border-slate-200 dark:border-neutral-700 rounded-full text-xs outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-all dark:text-white"
            />
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <BrandFilter brands={availableBrands} value={brandFilter} onChange={setBrandFilter} />
            <button className="p-2.5 rounded-full border border-slate-200 dark:border-neutral-700 text-slate-500 dark:text-neutral-300 hover:text-amber-500 hover:border-amber-500/40 transition-colors">
              <Filter size={16} />
            </button>
          </div>
        </div>

        {error ? (
          <div className="p-12 text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl border border-red-200/70 dark:border-red-900/40 bg-red-50 dark:bg-red-950/30 text-red-500 mb-4">
              <AlertCircle size={24} />
            </div>
            <h3 className="text-sm font-bold text-slate-800 dark:text-neutral-100 mb-2">Erro de Conexão</h3>
            <p className="text-xs text-slate-500 dark:text-neutral-400 max-w-xs mx-auto mb-6">
              {error}
            </p>
            <button
              onClick={loadData}
              className="px-6 py-2.5 bg-slate-900 dark:bg-white text-white dark:text-neutral-900 rounded-full text-xs font-bold hover:opacity-90 transition-all"
            >
              Tentar Novamente
            </button>
          </div>
        ) : loading ? (
          <div className="p-24 flex flex-col items-center justify-center gap-4">
            <Loader2 size={40} className="text-amber-500 animate-spin" />
            <p className="text-xs font-bold text-slate-400 dark:text-neutral-500 uppercase tracking-widest animate-pulse">Sincronizando com a API...</p>
          </div>
        ) : visibleAffiliates.length === 0 ? (
          <div className="p-24 text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl border border-slate-100 dark:border-neutral-700/60 bg-slate-50 dark:bg-neutral-800/60 text-slate-500 dark:text-neutral-300 mb-4">
              <Users size={24} />
            </div>
            <h3 className="text-sm font-bold text-slate-800 dark:text-neutral-100 mb-1">Nenhum cliente associado</h3>
            <p className="text-xs text-slate-500 dark:text-neutral-400">
              A lista ficará disponível quando os clientes forem vinculados ao seu ID de afiliado.
            </p>
          </div>
        ) : (
          <>
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/80 dark:bg-neutral-800/40 text-[10px] text-slate-400 dark:text-neutral-500 font-bold uppercase tracking-widest border-b border-slate-100 dark:border-neutral-800">
                  <th className="px-6 py-4">Nome / Empresa</th>
                    {isAdmin && (
                    <>
                        <th className="px-6 py-4">Cargo</th>
                      <th className="px-6 py-4">Ativo</th>
                      <th className="px-6 py-4">Config. CPA (R$)</th>
                      <th className="px-6 py-4">Config. REV (%)</th>
                      <th className="px-6 py-4 text-right">Ação</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-neutral-800 text-xs">
                {visibleAffiliates.map((item: any) => {
                  const affiliateId = item.id || item._id;
                  const config = configs[affiliateId] || { affiliateId, cpaValue: 0, revPercentage: 0 };

                  return (
                    <tr
                      key={affiliateId || Math.random()}
                      className="hover:bg-slate-50/70 dark:hover:bg-white/[0.03] transition-colors group cursor-pointer"
                      onClick={() => handleOpenDetails(item)}
                    >
                      <td className="px-6 py-4">
                        <div className="flex flex-col gap-1">
                          <span className="font-bold text-slate-800 dark:text-neutral-100">
                            {humanizeName(item.name || item.fullName || item.nome) || 'Sem Nome'}
                          </span>
                          {getBrandName(item) && (
                            <span className="inline-flex w-fit items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 dark:bg-neutral-800 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-neutral-400">
                              {getBrandName(item)}
                            </span>
                          )}
                          {ownerBySubId[String(affiliateId)] && (
                            <span className="inline-flex w-fit items-center gap-1 px-2 py-0.5 rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200/60 dark:border-amber-900/40 text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                              <Crown size={10} /> Pertence a {ownerBySubId[String(affiliateId)].name}
                            </span>
                          )}
                        </div>
                      </td>
                      {isAdmin && (
                        <>
                          <td className="px-6 py-4" onClick={(e) => e.stopPropagation()}>
                            <div className="max-w-[160px]">
                              <select
                                value={item.role || 'client'}
                                onChange={async (e) => { e.stopPropagation(); const newRole = e.target.value as 'admin'|'client'; await handleRoleChange(item.userUid, newRole); }}
                                className="w-full py-1.5 px-3 bg-white dark:bg-neutral-800 border border-slate-200 dark:border-neutral-700 rounded-lg text-sm font-semibold text-slate-700 dark:text-neutral-200 outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-all"
                              >
                                <option value="client">Cliente</option>
                                <option value="admin">Administrador</option>
                              </select>
                            </div>
                          </td>
                          <td className="px-6 py-4" onClick={(e) => e.stopPropagation()}>
                            <select
                              value={item.status || 'active'}
                              onChange={(e) => { 
                                e.stopPropagation(); 
                                const chosen = e.target.value as 'active' | 'inactive';
                                // if deactivating, ask confirmation
                                if (chosen === 'inactive' && (item.status || 'active') === 'active') {
                                  setConfirmModal({ open: true, affiliateId, name: item.name, pendingStatus: 'inactive' });
                                } else {
                                  handleToggleStatus(affiliateId, chosen);
                                }
                              }}
                              disabled={updatingStatusId === affiliateId}
                              className="w-28 py-1.5 px-3 bg-white dark:bg-neutral-800 border border-slate-200 dark:border-neutral-700 rounded-lg text-sm font-semibold text-slate-700 dark:text-neutral-200 outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-all disabled:opacity-50"
                            >
                              <option value="active">Ativo</option>
                              <option value="inactive">Desativado</option>
                            </select>
                          </td>
                          <td className="px-6 py-4" onClick={(e) => e.stopPropagation()}>
                            <div className="relative group/input">
                              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] font-black text-slate-400 dark:text-neutral-500">R$</span>
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={config.cpaValue}
                                onChange={(e) => handleConfigChange(affiliateId, 'cpaValue', e.target.value)}
                                className="w-24 pl-7 pr-2 py-1.5 bg-slate-50 dark:bg-neutral-800/60 border border-slate-200 dark:border-neutral-700 rounded-lg text-[11px] font-bold outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-all dark:text-white"
                              />
                            </div>
                          </td>
                          <td className="px-6 py-4" onClick={(e) => e.stopPropagation()}>
                            <div className="relative group/input">
                              <Percent size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-300 dark:text-neutral-500" />
                              <input
                                type="number"
                                min="0"
                                max="100"
                                step="0.1"
                                value={config.revPercentage}
                                onChange={(e) => handleConfigChange(affiliateId, 'revPercentage', e.target.value)}
                                className="w-24 pl-6 pr-2 py-1.5 bg-slate-50 dark:bg-neutral-800/60 border border-slate-200 dark:border-neutral-700 rounded-lg text-[11px] font-bold outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-all dark:text-white"
                              />
                            </div>
                          </td>
                          <td className="px-6 py-4 text-right" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-end gap-2">
                              <button
                                onClick={(e) => { e.stopPropagation(); handleOpenSpecial(item); }}
                                title={specials[affiliateId]?.active ? 'Afiliado especial — gerir sub-rede' : 'Tornar afiliado especial'}
                                className={cn(
                                  "p-2 rounded-lg transition-all",
                                  specials[affiliateId]?.active
                                    ? "bg-amber-500 text-white"
                                    : "bg-slate-50 text-slate-400 hover:text-amber-500 dark:bg-neutral-800/60 dark:text-neutral-500 dark:hover:text-amber-400"
                                )}
                              >
                                <Crown size={14} />
                              </button>
                              <button
                                onClick={(e) => handleSaveConfig(affiliateId, e)}
                                disabled={savingId === affiliateId}
                                className={cn(
                                  "p-2 rounded-lg transition-all",
                                  savedId === affiliateId
                                    ? "bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400"
                                    : "bg-amber-50 text-amber-600 hover:bg-amber-500 hover:text-white dark:bg-amber-900/10 dark:text-amber-400 dark:hover:bg-amber-500 dark:hover:text-white"
                                )}
                              >
                                {savingId === affiliateId ? (
                                  <Loader2 size={14} className="animate-spin" />
                                ) : savedId === affiliateId ? (
                                  <CheckCircle size={14} />
                                ) : (
                                  <Save size={14} />
                                )}
                              </button>
                            </div>
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* mobile : cards (todos os controles do admin) */}
          <div className="md:hidden divide-y divide-slate-100 dark:divide-neutral-800">
            {visibleAffiliates.map((item: any) => {
              const affiliateId = item.id || item._id;
              const config = configs[affiliateId] || { affiliateId, cpaValue: 0, revPercentage: 0 };
              return (
                <div key={affiliateId || Math.random()} className="p-4 space-y-4">
                  <div className="cursor-pointer" onClick={() => handleOpenDetails(item)}>
                    <span className="block font-bold text-sm text-slate-800 dark:text-neutral-100">
                      {humanizeName(item.name || item.fullName || item.nome) || 'Sem Nome'}
                    </span>
                    {getBrandName(item) && (
                      <span className="inline-flex mt-1 items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 dark:bg-neutral-800 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-neutral-400">
                        {getBrandName(item)}
                      </span>
                    )}
                    {ownerBySubId[String(affiliateId)] && (
                      <span className="inline-flex mt-1 ml-1 items-center gap-1 px-2 py-0.5 rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200/60 dark:border-amber-900/40 text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                        <Crown size={10} /> Pertence a {ownerBySubId[String(affiliateId)].name}
                      </span>
                    )}
                  </div>
                  {isAdmin && (
                    <>
                      <div className="grid grid-cols-2 gap-3">
                        <label className="block">
                          <span className="text-[10px] font-bold text-slate-400 dark:text-neutral-500 uppercase tracking-widest mb-1 block">Cargo</span>
                          <select
                            value={item.role || 'client'}
                            onChange={async (e) => { const nr = e.target.value as 'admin' | 'client'; await handleRoleChange(item.userUid, nr); }}
                            className="w-full py-2 px-3 bg-white dark:bg-neutral-800 border border-slate-200 dark:border-neutral-700 rounded-lg text-sm font-semibold text-slate-700 dark:text-neutral-200 outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-all"
                          >
                            <option value="client">Cliente</option>
                            <option value="admin">Administrador</option>
                          </select>
                        </label>
                        <label className="block">
                          <span className="text-[10px] font-bold text-slate-400 dark:text-neutral-500 uppercase tracking-widest mb-1 block">Status</span>
                          <select
                            value={item.status || 'active'}
                            onChange={(e) => {
                              const chosen = e.target.value as 'active' | 'inactive';
                              if (chosen === 'inactive' && (item.status || 'active') === 'active') {
                                setConfirmModal({ open: true, affiliateId, name: item.name, pendingStatus: 'inactive' });
                              } else {
                                handleToggleStatus(affiliateId, chosen);
                              }
                            }}
                            disabled={updatingStatusId === affiliateId}
                            className="w-full py-2 px-3 bg-white dark:bg-neutral-800 border border-slate-200 dark:border-neutral-700 rounded-lg text-sm font-semibold text-slate-700 dark:text-neutral-200 outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-all disabled:opacity-50"
                          >
                            <option value="active">Ativo</option>
                            <option value="inactive">Desativado</option>
                          </select>
                        </label>
                        <label className="block">
                          <span className="text-[10px] font-bold text-slate-400 dark:text-neutral-500 uppercase tracking-widest mb-1 block">Config. CPA (R$)</span>
                          <div className="relative">
                            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] font-black text-slate-400 dark:text-neutral-500">R$</span>
                            <input
                              type="number" min="0" step="0.01"
                              value={config.cpaValue}
                              onChange={(e) => handleConfigChange(affiliateId, 'cpaValue', e.target.value)}
                              className="w-full pl-7 pr-2 py-2 bg-slate-50 dark:bg-neutral-800/60 border border-slate-200 dark:border-neutral-700 rounded-lg text-xs font-bold outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-all dark:text-white"
                            />
                          </div>
                        </label>
                        <label className="block">
                          <span className="text-[10px] font-bold text-slate-400 dark:text-neutral-500 uppercase tracking-widest mb-1 block">Config. REV (%)</span>
                          <div className="relative">
                            <Percent size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-300 dark:text-neutral-500" />
                            <input
                              type="number" min="0" max="100" step="0.1"
                              value={config.revPercentage}
                              onChange={(e) => handleConfigChange(affiliateId, 'revPercentage', e.target.value)}
                              className="w-full pl-6 pr-2 py-2 bg-slate-50 dark:bg-neutral-800/60 border border-slate-200 dark:border-neutral-700 rounded-lg text-xs font-bold outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-all dark:text-white"
                            />
                          </div>
                        </label>
                      </div>
                      <button
                        onClick={(e) => handleSaveConfig(affiliateId, e)}
                        disabled={savingId === affiliateId}
                        className={cn(
                          "w-full py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all",
                          savedId === affiliateId
                            ? "bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400"
                            : "bg-amber-50 text-amber-600 hover:bg-amber-500 hover:text-white dark:bg-amber-900/10 dark:text-amber-400 dark:hover:bg-amber-500 dark:hover:text-white"
                        )}
                      >
                        {savingId === affiliateId ? <Loader2 size={14} className="animate-spin" /> : savedId === affiliateId ? <CheckCircle size={14} /> : <Save size={14} />}
                        {savedId === affiliateId ? 'Salvo!' : 'Salvar configuração'}
                      </button>
                      <button
                        onClick={() => handleOpenSpecial(item)}
                        className={cn(
                          "w-full py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 border transition-all",
                          specials[affiliateId]?.active
                            ? "bg-amber-500 text-white border-amber-500"
                            : "bg-white dark:bg-neutral-900 border-slate-200 dark:border-neutral-700 text-slate-600 dark:text-neutral-300 hover:border-amber-500/40"
                        )}
                      >
                        <Crown size={14} />
                        {specials[affiliateId]?.active ? 'Afiliado especial' : 'Tornar especial'}
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
          </>
        )}
        
        <div className="p-4 bg-slate-50/60 dark:bg-neutral-800/20 border-t border-slate-100 dark:border-neutral-800 flex items-center justify-between">
          <p className="text-[10px] text-slate-400 dark:text-neutral-500 font-bold uppercase tracking-widest">
            Exibindo {visibleAffiliates.length} de {isAdmin ? affiliates.length : 0} registros
          </p>
          <div className="flex gap-2">
            <button className="px-4 py-1.5 bg-white dark:bg-neutral-900 border border-slate-200 dark:border-neutral-700 rounded-full text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-neutral-400 disabled:opacity-30" disabled>Anterior</button>
            <button className="px-4 py-1.5 bg-white dark:bg-neutral-900 border border-slate-200 dark:border-neutral-700 rounded-full text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-neutral-400 disabled:opacity-30" disabled>Próxima</button>
          </div>
        </div>
      </div>
    </div>
  );
}
