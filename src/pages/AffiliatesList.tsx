import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  Users,
  Search,
  Filter,
  RefreshCw,
  AlertCircle,
  Info,
  Loader2,
  Save,
  CheckCircle,
  Percent,
  DownloadCloud,
  Crown,
  UploadCloud,
  UserPlus,
  Copy,
  Clock,
  X
} from 'lucide-react';
import { fetchAffiliates, fetchAffiliateConfigs, fetchAffiliateStatuses, saveAffiliateConfig, buildBrandConfigTopPayload, updateAffiliateStatus, fetchRegisteredUsers, updateUserRole, syncAffiliates, AffiliateConfig, fetchSpecialAffiliates, SpecialAffiliate, fetchPendingAffiliates, importPendingAffiliates, createAccessInvite } from '../services/affiliateService';
import SpecialAffiliateModal from '../components/SpecialAffiliateModal';
import { useToast } from '../contexts/ToastContext';
import { cn, humanizeName } from '../lib/utils';
import BrandFilter from '../components/BrandFilter';
import InfoTooltip from '../components/InfoTooltip';
import { getBrandName, uniqueBrands, ALL_BRANDS, getKnownBrandName } from '../lib/brand';
import { normalizeNameKey } from '../lib/affiliateName';
import { selectVisiblePending } from '../lib/pendingAffiliates';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate, Navigate, Link } from 'react-router-dom';

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
  // Pré-cadastro (aprovado na OTG, ainda fora do relatório). [[pre-cadastro]]
  isPending?: boolean;
  nameKey?: string;
  registerUrl?: string | null;
  phone?: string | null;
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

  // Pré-cadastro: import do snapshot de aprovados + geração de convite/acesso.
  const [importModal, setImportModal] = useState(false);
  const [importing, setImporting] = useState(false);
  const [invitingId, setInvitingId] = useState<string | null>(null);
  const [inviteModal, setInviteModal] = useState<{ open: boolean; name?: string; url?: string }>({ open: false });

  // Ênfase de setup: ids que JÁ têm doc de config persistido. Distingue "config
  // pendente" (sem doc) de um afiliado salvo de propósito em 0/0 — sem isso a
  // tela mostra 0/0 mudo p/ ambos e esconde quem ainda falta configurar (foi o
  // que mascarou o caso do especial superfaturado). Estável contra digitação
  // (handleConfigChange mexe em `configs`, não aqui); atualiza só no save.
  const [savedConfigIds, setSavedConfigIds] = useState<Set<string>>(new Set());
  const [onlyNeedsConfig, setOnlyNeedsConfig] = useState(false);

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

      const [affData, configData, statusData, registeredUsers, specialData, pendingData] = await Promise.all([
        fetchAffiliates(),
        fetchAffiliateConfigs(),
        fetchAffiliateStatuses(),
        fetchRegisteredUsers(),
        fetchSpecialAffiliates(),
        fetchPendingAffiliates()
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

      // Pré-cadastros (aprovados na OTG, ainda sem produção no relatório). Só os
      // 'pending'; deduplica por nameKey+CASA contra os já presentes (relatório/
      // login) — o afiliado é por casa na OTG, então o pendente SportingBet deve
      // aparecer mesmo que a pessoa já tenha um registro Superbet. Some quando o
      // afiliado real DAQUELA casa aparece. O id sintético (pending_<nameKey>_<casa>)
      // é o affiliateId que o convite/login usam até a reconciliação no servidor.
      const houseKey = (nameKey?: string, brand?: string | null) => `${normalizeNameKey(nameKey)}|${normalizeNameKey(brand)}`;
      // Suprime o pré-cadastro que JÁ tem representação: por ID (aceitou o convite →
      // o login carrega o id sintético, mas sem brand, então a dedup por nameKey+casa
      // falhava e o afiliado aparecia 2× — 1 com login + 1 "sem login") OU por
      // nameKey+casa (reconciliado pelo relatório). [[selectVisiblePending]]
      const presentIds = new Set(uniqueAffiliates.map((a: any) => String(a.id ?? a._id ?? '')));
      const presentKeys = new Set(
        uniqueAffiliates.map((a: any) => houseKey(a.name || a.label, getBrandName(a)))
      );
      const pendingItems: Affiliate[] = selectVisiblePending(pendingData, presentIds, presentKeys, houseKey)
        .map((p) => ({
          id: p.id,
          name: p.name,
          email: p.email || '',
          status: 'pending',
          brand: { id: p.house, name: getKnownBrandName(p.house) || p.house },
          createdAt: '',
          isPending: true,
          nameKey: p.nameKey,
          registerUrl: p.registerUrl ?? null,
          phone: p.phone ?? null,
          role: 'client',
        } as Affiliate));

      setAffiliates([...uniqueAffiliates, ...pendingItems]);
      setConfigs(configData);
      setSavedConfigIds(new Set(Object.keys(configData)));
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
      const extra = result.reconciled ? ` · ${result.reconciled} pré-cadastro(s) reconciliado(s)` : '';
      push({ type: 'success', message: `${result.synced} afiliados sincronizados da API externa.${extra}` });
      await loadData();
    } catch (err) {
      push({ type: 'error', message: err instanceof Error ? err.message : 'Falha ao sincronizar afiliados.' });
    } finally {
      setSyncing(false);
    }
  };

  // Import do snapshot de aprovados (scripts/otg-approved/snapshot-*.json).
  const handleImportFile = async (file: File) => {
    setImporting(true);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const rows = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.rows) ? parsed.rows : null);
      if (!rows || !rows.length) throw new Error('Snapshot inválido: esperado um array ou { rows: [...] }.');
      const clean = rows.map((r: any) => ({
        name: r.name, nameKey: r.nameKey, house: r.house,
        email: r.email ?? null, phone: r.phone ?? null, registerUrl: r.registerUrl ?? null,
      }));
      const result = await importPendingAffiliates(clean);
      push({ type: 'success', message: `${result.imported} importado(s) · ${result.reconciled} já no relatório.` });
      setImportModal(false);
      await loadData();
    } catch (err) {
      push({ type: 'error', message: err instanceof Error ? err.message : 'Falha ao importar snapshot.' });
    } finally {
      setImporting(false);
    }
  };

  // Gera o convite/acesso de um pré-cadastro (amarrado ao id sintético até a
  // reconciliação). Reaproveita o fluxo de convite existente.
  const handleGenerateInvite = async (item: Affiliate, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setInvitingId(item.id);
    try {
      const invite = await createAccessInvite(item.id, item.name);
      setInviteModal({ open: true, name: item.name, url: invite.url });
    } catch (err) {
      push({ type: 'error', message: err instanceof Error ? err.message : 'Falha ao gerar convite.' });
    } finally {
      setInvitingId(null);
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
        // default VAZIO (não 0): editar só um campo não pode plantar um 0 fantasma
        // no irmão — senão "Salvar" persistia {cpaValue:0,revPercentage:0} e o
        // rateStatus lia "configurado" (ausência ≠ R$0). [[buildBrandConfigTopPayload]]
        ...(prev[affiliateId] || ({ affiliateId, cpaValue: '', revPercentage: '' } as any)),
        [field]: next as any
      }
    }));
  };

  const handleSaveConfig = async (affiliateId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const raw = configs[affiliateId];
    const toStr = (v: unknown) => (v === '' || v == null ? '' : String(v));
    // Fonte ÚNICA da regra ausência-vs-zero: só grava um campo digitado AGORA ou já
    // existente como número. null = nada a gravar → NÃO cria doc fantasma (antes
    // gravava 0/0, que rateStatus via como "configurado"). Mesma pura do BrandConfigEditor.
    const top = buildBrandConfigTopPayload(
      { cpa: toStr(raw?.cpaValue), rev: toStr(raw?.revPercentage) },
      raw,
    );
    if (!top) return;
    setSavingId(affiliateId);
    try {
      await saveAffiliateConfig({ affiliateId, ...top });
      setSavedConfigIds((prev) => new Set(prev).add(affiliateId));
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
  // `visibleAffiliates` é calculado abaixo (depois de ownerBySubId), pois o
  // filtro "só pendentes" depende de needsConfig, que ignora subs de especial.

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

  // --- Ênfase de setup (A) ----------------------------------------------------
  const idOf = (item: any) => String(item.id ?? item._id ?? '');
  // "Config pendente": sem doc de config persistido. Exclui pré-cadastros (têm
  // fluxo próprio) e subs de especial ATIVO — o repasse do sub usa a taxa do
  // especial-pai, então a falta de config própria do sub NÃO é problema.
  const needsConfig = (item: any) =>
    !item.isPending && !ownerBySubId[idOf(item)] && !savedConfigIds.has(idOf(item));
  // "Sem acesso": sem login vinculado (ainda não cadastrou o próprio acesso).
  const needsAccess = (item: any) => !item.isPending && !item.userUid;

  const needsConfigCount = isAdmin ? filteredAffiliates.filter(needsConfig).length : 0;
  const visibleAffiliates = isAdmin
    ? (onlyNeedsConfig ? filteredAffiliates.filter(needsConfig) : filteredAffiliates)
    : [];

  const handleOpenDetails = (affiliate: any) => {
    navigate(`/affiliates/${affiliate.id}`);
  };

  const handleToggleStatus = async (affiliateId: string, value: 'active' | 'inactive', reason?: string) => {
    // value expected 'active' or 'inactive'
    setUpdatingStatusId(affiliateId);
    try {
      // O servidor registra a auditoria (autor carimbado pelo token); o cliente
      // só envia o motivo opcional — não grava mais o log direto.
      await updateAffiliateStatus(affiliateId, value, reason);
      setAffiliates(prev => prev.map(a => (a.id === affiliateId ? { ...a, status: value } : a)));
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
          allAffiliates={affiliates.filter((a) => !a.isPending)}
          specials={specials}
          onClose={() => setSpecialModal({ open: false })}
          onSaved={loadData}
        />
      )}

      {/* Pré-cadastro · Import do snapshot de aprovados */}
      {importModal && (
        <div onClick={() => !importing && setImportModal(false)} className="fixed inset-0 z-50 overflow-y-auto bg-black/50 backdrop-blur-sm p-4">
          <div className="flex min-h-full items-center justify-center">
            <motion.div onClick={(e) => e.stopPropagation()} initial={{ opacity: 0, scale: 0.96, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} className="w-full max-w-md p-6 bg-white dark:bg-neutral-900 rounded-3xl shadow-2xl border border-slate-200/70 dark:border-neutral-800">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">Importar aprovados</h3>
                  <p className="text-sm text-slate-500 dark:text-neutral-400 mt-2">Selecione o <span className="font-mono text-xs">snapshot-*.json</span> (afiliados aprovados na OTG). Eles entram como <span className="font-semibold">pré-cadastro</span> e saem da fila quando aparecem no relatório.</p>
                </div>
                <button onClick={() => !importing && setImportModal(false)} className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-neutral-200 transition-colors"><X size={18} /></button>
              </div>
              <label className={cn('mt-5 flex flex-col items-center justify-center gap-2 px-4 py-8 rounded-2xl border-2 border-dashed cursor-pointer transition-colors', importing ? 'opacity-60 pointer-events-none border-slate-200 dark:border-neutral-700' : 'border-slate-300 dark:border-neutral-700 hover:border-amber-500/60')}>
                {importing ? <Loader2 size={22} className="text-amber-500 animate-spin" /> : <UploadCloud size={22} className="text-slate-400 dark:text-neutral-500" />}
                <span className="text-xs font-bold text-slate-600 dark:text-neutral-300">{importing ? 'Importando...' : 'Clique para selecionar o arquivo'}</span>
                <span className="text-[10px] text-slate-400 dark:text-neutral-500">JSON do snapshot</span>
                <input type="file" accept="application/json,.json" disabled={importing} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImportFile(f); e.currentTarget.value = ''; }} />
              </label>
            </motion.div>
          </div>
        </div>
      )}

      {/* Pré-cadastro · Convite/acesso gerado */}
      {inviteModal.open && (
        <div onClick={() => setInviteModal({ open: false })} className="fixed inset-0 z-50 overflow-y-auto bg-black/50 backdrop-blur-sm p-4">
          <div className="flex min-h-full items-center justify-center">
            <motion.div onClick={(e) => e.stopPropagation()} initial={{ opacity: 0, scale: 0.96, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} className="w-full max-w-md p-6 bg-white dark:bg-neutral-900 rounded-3xl shadow-2xl border border-slate-200/70 dark:border-neutral-800">
              <h3 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">Convite gerado</h3>
              <p className="text-sm text-slate-500 dark:text-neutral-400 mt-2">Envie este link para <span className="font-semibold text-slate-700 dark:text-neutral-200">{inviteModal.name}</span> criar o próprio acesso. Válido por 7 dias.</p>
              <div className="mt-4 flex items-center gap-2">
                <input readOnly value={inviteModal.url || ''} className="flex-1 px-3 py-2.5 bg-slate-50 dark:bg-neutral-800/60 border border-slate-200 dark:border-neutral-700 rounded-xl text-xs font-mono outline-none dark:text-white" />
                <button onClick={() => { navigator.clipboard.writeText(inviteModal.url || ''); push({ type: 'success', message: 'Link copiado.' }); }} className="p-2.5 rounded-xl bg-amber-50 text-amber-600 hover:bg-amber-500 hover:text-white dark:bg-amber-900/10 dark:text-amber-400 dark:hover:bg-amber-500 dark:hover:text-white transition-all" title="Copiar link"><Copy size={16} /></button>
              </div>
              <div className="mt-6 flex justify-end">
                <button onClick={() => setInviteModal({ open: false })} className="px-4 py-2 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-neutral-900 text-xs font-bold hover:opacity-90 transition-all">Concluir</button>
              </div>
            </motion.div>
          </div>
        </div>
      )}

      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <span className="inline-flex items-center gap-2 px-3 py-1 mb-3 rounded-full bg-slate-900/5 dark:bg-white/5 border border-slate-900/10 dark:border-white/10 text-slate-500 dark:text-neutral-300 text-[10px] font-bold uppercase tracking-widest">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            {isAdmin ? 'Rede de parceiros' : 'Sua carteira'}
          </span>
          <div className="flex items-center gap-2">
            <h1 className="text-3xl md:text-4xl font-bold text-slate-900 dark:text-white tracking-tighter flex items-center gap-3">
              <span className="p-2 rounded-xl bg-slate-50 dark:bg-neutral-800/60 border border-slate-100 dark:border-neutral-700/60">
                <Users size={24} className="text-slate-900 dark:text-white" />
              </span>
              {pageTitle}
            </h1>
            {isAdmin && <ListingHelp />}
          </div>
          <p className="text-slate-500 dark:text-neutral-400 text-sm mt-2">{pageSubTitle}</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Sincronizar é admin-only (o endpoint /api/affiliates/sync exige admin);
              o afiliado especial não tem acesso, então o botão nem aparece pra ele. */}
          {/* {isAdmin && (
            <button
              onClick={() => setImportModal(true)}
              disabled={loading}
              title="Importar afiliados aprovados do snapshot da OTG (pré-cadastro)"
              className="flex items-center gap-2 px-4 py-2.5 bg-white dark:bg-neutral-900 border border-slate-200 dark:border-neutral-800 rounded-full text-xs font-bold text-slate-600 dark:text-neutral-300 hover:border-amber-500/40 hover:text-amber-500 transition-all shadow-sm disabled:opacity-50"
            >
              <UploadCloud size={14} />
              Importar aprovados
            </button>
          )} */}
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
            {isAdmin && needsConfigCount > 0 && (
              <button
                onClick={() => setOnlyNeedsConfig((v) => !v)}
                title="Afiliados sem comissão (CPA/REV) configurada — repasse fica R$ 0"
                className={cn(
                  'flex items-center gap-1.5 px-3 py-2 rounded-full text-[11px] font-bold uppercase tracking-wider border transition-all',
                  onlyNeedsConfig
                    ? 'bg-amber-500 text-white border-amber-500 shadow-sm'
                    : 'bg-amber-50 dark:bg-amber-900/10 text-amber-700 dark:text-amber-400 border-amber-200/70 dark:border-amber-900/40 hover:border-amber-400'
                )}
              >
                <AlertCircle size={13} />
                {needsConfigCount} sem configuração
              </button>
            )}
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
                      <th className="px-6 py-4">
                        <span className="inline-flex items-center gap-1">
                          Config. CPA (R$)
                          <InfoTooltip
                            text="Repasse PADRÃO ao afiliado, válido em TODAS as casas (o que a agência paga a ele). Taxa diferente em uma casa? Abra o afiliado → Override por casa. Não é a taxa de Casas (que é a receita da casa)."
                            size={12}
                          />
                        </span>
                      </th>
                      <th className="px-6 py-4">
                        <span className="inline-flex items-center gap-1">
                          Config. REV (%)
                          <InfoTooltip
                            text="REV Share PADRÃO do afiliado (% sobre o RVS), válido em todas as casas. O override por casa fica na ficha do afiliado."
                            size={12}
                          />
                        </span>
                      </th>
                      <th className="px-6 py-4 text-right">Ação</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-neutral-800 text-xs">
                {visibleAffiliates.map((item: any) => {
                  const affiliateId = item.id || item._id;
                  const config = configs[affiliateId] || ({ affiliateId, cpaValue: '', revPercentage: '' } as any);
                  const pendingCfg = needsConfig(item);

                  return (
                    <tr
                      key={affiliateId || Math.random()}
                      className={cn("transition-colors group", item.isPending ? "bg-amber-50/40 dark:bg-amber-900/[0.06]" : "hover:bg-slate-50/70 dark:hover:bg-white/[0.03] cursor-pointer")}
                      onClick={() => { if (!item.isPending) handleOpenDetails(item); }}
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
                          {item.isPending && (
                            <span className="inline-flex w-fit items-center gap-1 px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-900/30 border border-amber-200/70 dark:border-amber-900/50 text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                              <Clock size={10} /> Pré-cadastro
                            </span>
                          )}
                          {pendingCfg && (
                            <span className="inline-flex w-fit items-center gap-1 px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-900/30 border border-amber-200/70 dark:border-amber-900/50 text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                              <AlertCircle size={10} /> Config pendente
                            </span>
                          )}
                          {needsAccess(item) && (
                            <span className="inline-flex w-fit items-center gap-1 px-2 py-0.5 rounded-md border border-slate-300 dark:border-neutral-600 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-neutral-400">
                              <UserPlus size={10} /> Sem acesso
                            </span>
                          )}
                          {ownerBySubId[String(affiliateId)] && (
                            <span className="inline-flex w-fit items-center gap-1 px-2 py-0.5 rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200/60 dark:border-amber-900/40 text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                              <Crown size={10} /> Pertence a {ownerBySubId[String(affiliateId)].name}
                            </span>
                          )}
                        </div>
                      </td>
                      {isAdmin && (item.isPending ? (
                        <>
                          <td className="px-6 py-4" colSpan={4}>
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-50 dark:bg-amber-900/20 border border-amber-200/60 dark:border-amber-900/40 text-[10px] font-bold uppercase tracking-widest text-amber-700 dark:text-amber-400">
                              <Clock size={11} /> Aguardando produção · sem ID de relatório
                            </span>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <button
                              onClick={(e) => handleGenerateInvite(item, e)}
                              disabled={invitingId === affiliateId}
                              title="Gerar convite de acesso para o afiliado"
                              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-neutral-900 text-[11px] font-bold hover:opacity-90 transition-all disabled:opacity-50"
                            >
                              {invitingId === affiliateId ? <Loader2 size={13} className="animate-spin" /> : <UserPlus size={13} />}
                              Gerar acesso
                            </button>
                          </td>
                        </>
                      ) : (
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
                                className={cn(
                                  "w-24 pl-7 pr-2 py-1.5 border rounded-lg text-[11px] font-bold outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-all dark:text-white",
                                  pendingCfg ? "border-amber-400 dark:border-amber-500/60 bg-amber-50/60 dark:bg-amber-900/10" : "border-slate-200 dark:border-neutral-700 bg-slate-50 dark:bg-neutral-800/60"
                                )}
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
                                className={cn(
                                  "w-24 pl-6 pr-2 py-1.5 border rounded-lg text-[11px] font-bold outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-all dark:text-white",
                                  pendingCfg ? "border-amber-400 dark:border-amber-500/60 bg-amber-50/60 dark:bg-amber-900/10" : "border-slate-200 dark:border-neutral-700 bg-slate-50 dark:bg-neutral-800/60"
                                )}
                              />
                            </div>
                          </td>
                          <td className="px-6 py-4 text-right" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-end gap-2">
                              {needsAccess(item) && (
                                <button
                                  onClick={(e) => handleGenerateInvite(item, e)}
                                  disabled={invitingId === affiliateId}
                                  title="Gerar convite de acesso para o afiliado"
                                  className="p-2 rounded-lg bg-slate-50 text-slate-400 hover:text-amber-500 dark:bg-neutral-800/60 dark:text-neutral-500 dark:hover:text-amber-400 transition-all disabled:opacity-50"
                                >
                                  {invitingId === affiliateId ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
                                </button>
                              )}
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
                      ))}
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
              const config = configs[affiliateId] || ({ affiliateId, cpaValue: '', revPercentage: '' } as any);
              const pendingCfg = needsConfig(item);
              return (
                <div key={affiliateId || Math.random()} className={cn("p-4 space-y-4", item.isPending && "bg-amber-50/40 dark:bg-amber-900/[0.06]")}>
                  <div className={cn(!item.isPending && "cursor-pointer")} onClick={() => { if (!item.isPending) handleOpenDetails(item); }}>
                    <span className="block font-bold text-sm text-slate-800 dark:text-neutral-100">
                      {humanizeName(item.name || item.fullName || item.nome) || 'Sem Nome'}
                    </span>
                    {getBrandName(item) && (
                      <span className="inline-flex mt-1 items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 dark:bg-neutral-800 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-neutral-400">
                        {getBrandName(item)}
                      </span>
                    )}
                    {item.isPending && (
                      <span className="inline-flex mt-1 ml-1 items-center gap-1 px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-900/30 border border-amber-200/70 dark:border-amber-900/50 text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                        <Clock size={10} /> Pré-cadastro
                      </span>
                    )}
                    {pendingCfg && (
                      <span className="inline-flex mt-1 ml-1 items-center gap-1 px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-900/30 border border-amber-200/70 dark:border-amber-900/50 text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                        <AlertCircle size={10} /> Config pendente
                      </span>
                    )}
                    {needsAccess(item) && (
                      <span className="inline-flex mt-1 ml-1 items-center gap-1 px-2 py-0.5 rounded-md border border-slate-300 dark:border-neutral-600 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-neutral-400">
                        <UserPlus size={10} /> Sem acesso
                      </span>
                    )}
                    {ownerBySubId[String(affiliateId)] && (
                      <span className="inline-flex mt-1 ml-1 items-center gap-1 px-2 py-0.5 rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200/60 dark:border-amber-900/40 text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                        <Crown size={10} /> Pertence a {ownerBySubId[String(affiliateId)].name}
                      </span>
                    )}
                  </div>
                  {isAdmin && (item.isPending ? (
                    <div className="flex items-center justify-between gap-3">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-50 dark:bg-amber-900/20 border border-amber-200/60 dark:border-amber-900/40 text-[10px] font-bold uppercase tracking-widest text-amber-700 dark:text-amber-400">
                        <Clock size={11} /> Aguardando produção
                      </span>
                      <button
                        onClick={(e) => handleGenerateInvite(item, e)}
                        disabled={invitingId === affiliateId}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-neutral-900 text-xs font-bold hover:opacity-90 transition-all disabled:opacity-50"
                      >
                        {invitingId === affiliateId ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
                        Gerar acesso
                      </button>
                    </div>
                  ) : (
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
                          <span className="text-[10px] font-bold text-slate-400 dark:text-neutral-500 uppercase tracking-widest mb-1 flex items-center gap-1">
                            Config. CPA (R$)
                            <InfoTooltip
                              text="Repasse PADRÃO ao afiliado, válido em TODAS as casas (o que a agência paga a ele). Taxa diferente em uma casa? Abra o afiliado → Override por casa. Não é a taxa de Casas (que é a receita da casa)."
                              size={12}
                              align="left"
                            />
                          </span>
                          <div className="relative">
                            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] font-black text-slate-400 dark:text-neutral-500">R$</span>
                            <input
                              type="number" min="0" step="0.01"
                              value={config.cpaValue}
                              onChange={(e) => handleConfigChange(affiliateId, 'cpaValue', e.target.value)}
                              className={cn(
                                "w-full pl-7 pr-2 py-2 border rounded-lg text-xs font-bold outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-all dark:text-white",
                                pendingCfg ? "border-amber-400 dark:border-amber-500/60 bg-amber-50/60 dark:bg-amber-900/10" : "border-slate-200 dark:border-neutral-700 bg-slate-50 dark:bg-neutral-800/60"
                              )}
                            />
                          </div>
                        </label>
                        <label className="block">
                          <span className="text-[10px] font-bold text-slate-400 dark:text-neutral-500 uppercase tracking-widest mb-1 flex items-center gap-1">
                            Config. REV (%)
                            <InfoTooltip
                              text="REV Share PADRÃO do afiliado (% sobre o RVS), válido em todas as casas. O override por casa fica na ficha do afiliado."
                              size={12}
                              align="right"
                            />
                          </span>
                          <div className="relative">
                            <Percent size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-300 dark:text-neutral-500" />
                            <input
                              type="number" min="0" max="100" step="0.1"
                              value={config.revPercentage}
                              onChange={(e) => handleConfigChange(affiliateId, 'revPercentage', e.target.value)}
                              className={cn(
                                "w-full pl-6 pr-2 py-2 border rounded-lg text-xs font-bold outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-all dark:text-white",
                                pendingCfg ? "border-amber-400 dark:border-amber-500/60 bg-amber-50/60 dark:bg-amber-900/10" : "border-slate-200 dark:border-neutral-700 bg-slate-50 dark:bg-neutral-800/60"
                              )}
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
                      {needsAccess(item) && (
                        <button
                          onClick={(e) => handleGenerateInvite(item, e)}
                          disabled={invitingId === affiliateId}
                          className="w-full py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 border border-slate-200 dark:border-neutral-700 text-slate-600 dark:text-neutral-300 hover:border-amber-500/40 transition-all disabled:opacity-50"
                        >
                          {invitingId === affiliateId ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
                          Gerar acesso
                        </button>
                      )}
                    </>
                  ))}
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

// Popover de ajuda (i): explica os requisitos p/ um afiliado constar e ficar
// operacional nesta lista, e que aprovados sem produção ficam no Roster OTG.
// Click-toggle (conteúdo rico + link), fecha ao clicar fora. O InfoTooltip
// padrão é só texto/hover, por isso este é dedicado.
function ListingHelp() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <span ref={ref} className="relative inline-flex align-middle">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Como um afiliado fica operacional aqui"
        className="text-slate-400 hover:text-amber-500 dark:text-neutral-500 dark:hover:text-amber-400 transition-colors"
      >
        <Info size={18} />
      </button>
      {open && (
        <div className="fixed inset-x-4 top-20 z-40 rounded-2xl border border-slate-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-4 text-left shadow-xl normal-case tracking-normal sm:absolute sm:inset-x-auto sm:left-0 sm:top-full sm:mt-3 sm:w-[20rem] sm:max-w-[calc(100vw_-_2rem)]">
          <p className="text-xs font-bold text-slate-900 dark:text-white">Como um afiliado fica operacional aqui</p>
          <p className="mt-1.5 text-[11px] leading-relaxed font-medium text-slate-500 dark:text-neutral-400">
            Para constar nesta lista e gerar repasse correto, ele precisa de:
          </p>
          <ol className="mt-2 space-y-1.5 text-[11px] leading-relaxed font-medium text-slate-600 dark:text-neutral-300">
            <li className="flex gap-2"><span className="font-bold text-amber-600 dark:text-amber-400">1.</span><span><b>Produção</b> — aparecer no relatório da OTG (ou estar como pré-cadastro).</span></li>
            <li className="flex gap-2"><span className="font-bold text-amber-600 dark:text-amber-400">2.</span><span><b>Acesso</b> — um login gerado via convite.</span></li>
            <li className="flex gap-2"><span className="font-bold text-amber-600 dark:text-amber-400">3.</span><span><b>Comissão</b> — CPA/REV configurados. Sem isso, o repasse fica <b>R$&nbsp;0</b>.</span></li>
          </ol>
          <div className="mt-3 pt-3 border-t border-slate-100 dark:border-neutral-800">
            <p className="text-[11px] font-bold text-slate-700 dark:text-neutral-200">Onde se configura o CPA/REV</p>
            <ul className="mt-1.5 space-y-1.5 text-[11px] leading-relaxed font-medium text-slate-500 dark:text-neutral-400">
              <li className="flex gap-2"><span className="text-amber-600 dark:text-amber-400 font-bold">•</span><span><b>Aqui</b> — o repasse <b>padrão</b> do afiliado, válido em <b>todas as casas</b> (o que a agência paga a ele).</span></li>
              <li className="flex gap-2"><span className="text-amber-600 dark:text-amber-400 font-bold">•</span><span><b>Na ficha do afiliado</b> — um <b>override por casa</b> (prioridade só naquela casa) sobre o padrão acima.</span></li>
              <li className="flex gap-2"><span className="text-amber-600 dark:text-amber-400 font-bold">•</span><span>Em <Link to="/casas" className="font-bold text-amber-600 dark:text-amber-400 hover:underline">Casas</Link> — a <b>Taxa padrão da casa</b> é a <b>receita</b> (o que a casa paga à agência), <b>não</b> o repasse ao afiliado.</span></li>
            </ul>
          </div>
          <p className="mt-3 pt-3 border-t border-slate-100 dark:border-neutral-800 text-[11px] leading-relaxed font-medium text-slate-500 dark:text-neutral-400">
            Aprovados na OTG <b>sem produção</b> ainda não aparecem aqui — ficam em{' '}
            <Link to="/roster-otg" className="font-bold text-amber-600 dark:text-amber-400 hover:underline">Roster OTG</Link> até reconciliar.
          </p>
        </div>
      )}
    </span>
  );
}
