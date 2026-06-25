import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  Database, RefreshCw, Loader2, Search, ExternalLink, Mail, Phone, AtSign,
  UserPlus, Copy, Check, X, CheckCircle2, Clock,
} from 'lucide-react';
import {
  fetchPendingAffiliates, refreshPendingAffiliates, createAccessInvite, PendingAffiliate,
} from '../services/affiliateService';
import { useToast } from '../contexts/ToastContext';
import { cn, humanizeName } from '../lib/utils';
import { getKnownBrandName } from '../lib/brand';
import { computeRosterStats } from '../lib/rosterStats';

// Tela INTERNA (admin) p/ consumir o roster de aprovados que puxamos da OTG
// (coleção pending_affiliates). Diferente do /affiliates (que mostra só os
// 'pending' inline, misturados ao relatório), aqui é o roster COMPLETO (pending
// + reconciled) com os campos ricos da OTG (registerUrl, contato) + o pull ao
// vivo ("Atualizar da OTG") + geração de convite por linha. Ver boost-partner-api.

type StatusFilter = '' | 'pending' | 'reconciled';

export default function OtgRoster() {
  const { push } = useToast();
  const [rows, setRows] = useState<PendingAffiliate[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [search, setSearch] = useState('');
  const [house, setHouse] = useState('');
  const [status, setStatus] = useState<StatusFilter>('');

  const [invitingId, setInvitingId] = useState<string | null>(null);
  const [inviteModal, setInviteModal] = useState<{ open: boolean; name?: string; url?: string }>({ open: false });
  const [copied, setCopied] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const data = await fetchPendingAffiliates();
      setRows(Array.isArray(data) ? data : []);
    } catch {
      push({ type: 'error', message: 'Falha ao carregar o roster.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const r = await refreshPendingAffiliates();
      push({
        type: 'success',
        message: `OTG: ${r.total} no roster · ${r.imported} gravados · ${r.reconciled} reconciliados.`,
      });
      await load();
    } catch (err) {
      push({ type: 'error', message: err instanceof Error ? err.message : 'Falha ao atualizar da OTG.' });
    } finally {
      setRefreshing(false);
    }
  };

  const handleInvite = async (item: PendingAffiliate) => {
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

  const copyUrl = async () => {
    if (!inviteModal.url) return;
    try { await navigator.clipboard.writeText(inviteModal.url); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* noop */ }
  };

  const houses = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => r.house && set.add(r.house));
    return Array.from(set).sort();
  }, [rows]);

  const stats = useMemo(() => computeRosterStats(rows), [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (house && r.house !== house) return false;
      if (status && (r.status || 'pending') !== status) return false;
      if (q && !humanizeName(r.name).toLowerCase().includes(q) && !(r.name || '').toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, search, house, status]);

  return (
    <div className="space-y-6 pb-20">
      {/* Header */}
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <span className="inline-flex items-center gap-2 px-3 py-1 mb-3 rounded-full bg-slate-900/5 dark:bg-white/5 border border-slate-900/10 dark:border-white/10 text-slate-500 dark:text-neutral-300 text-[10px] font-bold uppercase tracking-widest">
            <Database size={12} /> Dados da OTG
          </span>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white tracking-tighter">Roster de Aprovados</h1>
          <p className="text-slate-500 dark:text-neutral-400 text-sm mt-2 max-w-2xl">
            Afiliados aprovados no provisionamento da OTG (links.otgpartners), com link de cadastro e contato.
            Saem da fila quando aparecem no relatório (<span className="font-semibold">reconciliados</span>).
          </p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing || loading}
          title="Puxar o roster fresco direto da OTG e reconciliar"
          className="shrink-0 flex items-center gap-2 px-4 py-2.5 rounded-full bg-slate-900 dark:bg-amber-500 text-white dark:text-neutral-950 text-xs font-bold hover:opacity-90 disabled:opacity-50 transition-opacity shadow-sm"
        >
          {refreshing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          {refreshing ? 'Atualizando...' : 'Atualizar da OTG'}
        </button>
      </header>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Total no roster" value={stats.total} />
        <StatCard label="Aguardando produção" value={stats.pending} tone="amber" />
        <StatCard label="Reconciliados" value={stats.reconciled} tone="emerald" />
        <StatCard label="Casas" value={houses.length} sub={houses.map((h) => `${getKnownBrandName(h) || h}: ${stats.byHouse[h]}`).join(' · ')} />
      </div>

      {/* Filtros */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-neutral-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome..."
            className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 dark:border-neutral-700 bg-white dark:bg-neutral-900/60 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
          />
        </div>
        <select value={house} onChange={(e) => setHouse(e.target.value)} className={selectCls}>
          <option value="">Todas as casas</option>
          {houses.map((h) => <option key={h} value={h}>{getKnownBrandName(h) || h}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} className={selectCls}>
          <option value="">Todos os status</option>
          <option value="pending">Aguardando produção</option>
          <option value="reconciled">Reconciliados</option>
        </select>
      </div>

      {/* Lista */}
      <div className="rounded-2xl border border-slate-200/70 dark:border-neutral-800 bg-white dark:bg-neutral-900/60 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-slate-400 dark:text-neutral-500">
            <Loader2 size={22} className="animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 px-6">
            <Database size={28} className="mx-auto text-slate-300 dark:text-neutral-700 mb-3" />
            <p className="text-sm font-bold text-slate-600 dark:text-neutral-300">Nenhum afiliado no roster</p>
            <p className="text-xs text-slate-400 dark:text-neutral-500 mt-1">
              {rows.length === 0 ? 'Clique em "Atualizar da OTG" para puxar o roster.' : 'Nenhum resultado para os filtros.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-neutral-800 text-left text-[10px] uppercase tracking-widest text-slate-400 dark:text-neutral-500">
                  <th className="px-4 py-3 font-bold">Afiliado</th>
                  <th className="px-4 py-3 font-bold">Casa</th>
                  <th className="px-4 py-3 font-bold">Status</th>
                  <th className="px-4 py-3 font-bold">Link de cadastro</th>
                  <th className="px-4 py-3 font-bold">Contato</th>
                  <th className="px-4 py-3 font-bold text-right">Ação</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100 dark:border-neutral-800/60 last:border-0 hover:bg-slate-50/70 dark:hover:bg-white/[0.03] transition-colors">
                    <td className="px-4 py-3">
                      <span className="block font-bold text-slate-800 dark:text-neutral-100">{humanizeName(r.name)}</span>
                      {r.status === 'reconciled' && r.affiliateId && (
                        <span className="block text-[10px] font-mono text-slate-400 dark:text-neutral-500 mt-0.5">{r.affiliateId}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-slate-100 dark:bg-neutral-800 text-[11px] font-bold text-slate-600 dark:text-neutral-300">
                        {getKnownBrandName(r.house) || r.house}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {r.status === 'reconciled' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-900/30 border border-emerald-200/70 dark:border-emerald-900/50 text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                          <CheckCircle2 size={11} /> Reconciliado
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-900/30 border border-amber-200/70 dark:border-amber-900/50 text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                          <Clock size={11} /> Aguardando
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 max-w-[220px]">
                      {r.registerUrl ? (
                        <a href={r.registerUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 hover:underline truncate max-w-full" title={r.registerUrl}>
                          <ExternalLink size={12} className="shrink-0" />
                          <span className="truncate">{r.registerUrl.replace(/^https?:\/\//, '')}</span>
                        </a>
                      ) : <span className="text-xs text-slate-300 dark:text-neutral-600">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 text-slate-400 dark:text-neutral-500">
                        {r.email ? <a href={`mailto:${r.email}`} title={r.email} className="hover:text-slate-700 dark:hover:text-neutral-200"><Mail size={14} /></a> : null}
                        {r.phone ? <span title={r.phone} className="hover:text-slate-700 dark:hover:text-neutral-200"><Phone size={14} /></span> : null}
                        {r.social ? <a href={r.social.startsWith('http') ? r.social : `https://${r.social}`} target="_blank" rel="noopener noreferrer" title={r.social} className="hover:text-slate-700 dark:hover:text-neutral-200"><AtSign size={14} /></a> : null}
                        {!r.email && !r.phone && !r.social && <span className="text-xs text-slate-300 dark:text-neutral-600">—</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => handleInvite(r)}
                        disabled={invitingId === r.id}
                        title="Gerar convite de acesso para o afiliado"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-neutral-900 text-[11px] font-bold hover:opacity-90 transition-all disabled:opacity-50"
                      >
                        {invitingId === r.id ? <Loader2 size={13} className="animate-spin" /> : <UserPlus size={13} />}
                        Gerar acesso
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal do convite */}
      {inviteModal.open && (
        <div onClick={() => setInviteModal({ open: false })} className="fixed inset-0 z-50 overflow-y-auto bg-black/50 backdrop-blur-sm p-4">
          <div className="flex min-h-full items-center justify-center">
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-xl p-6"
            >
              <div className="flex items-start justify-between gap-3 mb-4">
                <div>
                  <h3 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">Convite gerado</h3>
                  <p className="text-sm text-slate-500 dark:text-neutral-400 mt-1">Envie o link para <span className="font-semibold">{humanizeName(inviteModal.name)}</span> criar o acesso.</p>
                </div>
                <button onClick={() => setInviteModal({ open: false })} className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-neutral-200 transition-colors"><X size={18} /></button>
              </div>
              <div className="flex gap-2">
                <input readOnly value={inviteModal.url || ''} className="flex-1 px-3 py-2.5 rounded-xl border border-slate-200 dark:border-neutral-700 bg-slate-50 dark:bg-neutral-800/60 text-xs text-slate-700 dark:text-neutral-200 font-mono" />
                <button onClick={copyUrl} className="px-3 py-2.5 rounded-xl bg-slate-900 dark:bg-amber-500 text-white dark:text-neutral-950 text-xs font-bold hover:opacity-90 transition-opacity">
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </div>
              <p className="text-[11px] text-slate-400 dark:text-neutral-500 mt-3">O convite expira em 7 dias e é de uso único.</p>
            </motion.div>
          </div>
        </div>
      )}
    </div>
  );
}

const selectCls =
  'px-3 py-2.5 rounded-xl border border-slate-200 dark:border-neutral-700 bg-white dark:bg-neutral-900/60 text-sm text-slate-700 dark:text-neutral-200 focus:outline-none focus:ring-2 focus:ring-amber-500/40';

function StatCard({ label, value, sub, tone }: { label: string; value: number; sub?: string; tone?: 'amber' | 'emerald' }) {
  return (
    <div className="p-4 rounded-2xl border border-slate-200/70 dark:border-neutral-800 bg-white dark:bg-neutral-900/60 shadow-sm">
      <p className="text-[10px] uppercase font-bold tracking-widest text-slate-400 dark:text-neutral-500">{label}</p>
      <p className={cn(
        'text-2xl font-bold tracking-tight mt-1',
        tone === 'amber' ? 'text-amber-600 dark:text-amber-400'
          : tone === 'emerald' ? 'text-emerald-600 dark:text-emerald-400'
          : 'text-slate-900 dark:text-white'
      )}>{value}</p>
      {sub && <p className="text-[10px] text-slate-400 dark:text-neutral-500 mt-1 truncate" title={sub}>{sub}</p>}
    </div>
  );
}
