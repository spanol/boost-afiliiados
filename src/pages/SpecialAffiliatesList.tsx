import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Crown, Loader2, Users, Settings2, ArrowRight, Plus } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  fetchSpecialAffiliates,
  fetchAffiliates,
  fetchRegisteredUsers,
  fetchAffiliateConfigs,
  SpecialAffiliate,
  AffiliateConfig,
} from '../services/affiliateService';
import SpecialAffiliateModal from '../components/SpecialAffiliateModal';
import { useAuth } from '../contexts/AuthContext';
import { Navigate } from 'react-router-dom';

interface AffiliateLite {
  id: string;
  name?: string;
  label?: string;
  userUid?: string;
}

// B3 · Listagem de afiliados especiais (admin). Mostra cada especial ativo, o
// tamanho da sub-rede e a taxa própria dele (referência do spread), com atalho
// para gerir (mesmo modal compartilhado da lista de afiliados).
export default function SpecialAffiliatesList() {
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [specials, setSpecials] = useState<Record<string, SpecialAffiliate>>({});
  const [affiliates, setAffiliates] = useState<AffiliateLite[]>([]);
  const [configs, setConfigs] = useState<Record<string, AffiliateConfig>>({});
  const [modal, setModal] = useState<{ open: boolean; affiliate?: AffiliateLite }>({ open: false });

  const isAdmin = profile?.role === 'admin';

  const loadData = async () => {
    setLoading(true);
    try {
      const [specialData, affData, registeredUsers, configData] = await Promise.all([
        fetchSpecialAffiliates(),
        fetchAffiliates(),
        fetchRegisteredUsers(),
        fetchAffiliateConfigs(),
      ]);

      // Resolve userUid por affiliateId (necessário para o modal espelhar isSpecial).
      const uidByAffiliate = new Map<string, string>();
      registeredUsers.forEach((u) => {
        const key = String(u.affiliateId || u.uid);
        if (key) uidByAffiliate.set(key, u.uid);
      });

      const merged: AffiliateLite[] = (Array.isArray(affData) ? affData : []).map((a: any) => ({
        id: String(a.id ?? a._id ?? ''),
        name: a.name,
        label: a.label,
        userUid: uidByAffiliate.get(String(a.id ?? a._id ?? '')),
      }));

      setSpecials(specialData);
      setAffiliates(merged);
      setConfigs(configData);
    } catch (err) {
      console.error('Erro ao carregar afiliados especiais:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAdmin) loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  const affById = useMemo(() => {
    const m = new Map<string, AffiliateLite>();
    affiliates.forEach((a) => m.set(String(a.id), a));
    return m;
  }, [affiliates]);

  const activeSpecials = useMemo(
    () => Object.values(specials).filter((s) => s.active),
    [specials]
  );

  const nameFor = (id: string) => {
    const a = affById.get(String(id));
    return a?.name || a?.label || `#${id}`;
  };

  if (profile && !isAdmin) return <Navigate to="/dashboard" replace />;

  return (
    <div className="space-y-8 pb-12">
      {modal.open && modal.affiliate && (
        <SpecialAffiliateModal
          affiliate={modal.affiliate}
          allAffiliates={affiliates}
          specials={specials}
          onClose={() => setModal({ open: false })}
          onSaved={loadData}
        />
      )}

      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <span className="inline-flex items-center gap-2 px-3 py-1 mb-3 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-[10px] font-bold uppercase tracking-widest">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
            Rede de especiais
          </span>
          <h1 className="text-3xl md:text-4xl font-bold text-slate-900 dark:text-white tracking-tighter flex items-center gap-3">
            <span className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/20">
              <Crown size={24} className="text-amber-500" />
            </span>
            Afiliados Especiais
          </h1>
          <p className="text-slate-500 dark:text-neutral-400 text-sm mt-2">
            Afiliados que gerenciam a própria sub-rede e ficam com o spread sobre os sub-afiliados.
          </p>
        </div>
        <Link
          to="/affiliates"
          className="flex items-center gap-2 px-4 py-2.5 bg-slate-900 dark:bg-white text-white dark:text-neutral-900 rounded-full text-xs font-bold hover:opacity-90 transition-all shadow-sm self-start"
        >
          <Plus size={14} />
          Tornar afiliado especial
        </Link>
      </header>

      {loading ? (
        <div className="p-24 flex flex-col items-center justify-center gap-4">
          <Loader2 size={40} className="text-amber-500 animate-spin" />
          <p className="text-xs font-bold text-slate-400 dark:text-neutral-500 uppercase tracking-widest animate-pulse">Carregando especiais...</p>
        </div>
      ) : activeSpecials.length === 0 ? (
        <div className="bg-white dark:bg-neutral-900/60 border border-slate-200/70 dark:border-neutral-800 rounded-3xl shadow-sm p-24 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl border border-amber-200/70 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-950/30 text-amber-500 mb-4">
            <Crown size={24} />
          </div>
          <h3 className="text-sm font-bold text-slate-800 dark:text-neutral-100 mb-1">Nenhum afiliado especial ainda</h3>
          <p className="text-xs text-slate-500 dark:text-neutral-400 max-w-xs mx-auto">
            Promova um afiliado pela lista de afiliados (botão coroa) para que ele gerencie a própria sub-rede.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {activeSpecials.map((s, idx) => {
            const id = String(s.affiliateId);
            const aff = affById.get(id) || { id, name: nameFor(id) };
            const cfg = configs[id];
            return (
              <motion.div
                key={id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.05 }}
                className="group relative overflow-hidden p-6 rounded-2xl border bg-white dark:bg-neutral-900/60 border-amber-200/60 dark:border-amber-900/30 shadow-sm hover:border-amber-300 dark:hover:border-amber-800 transition-all"
              >
                <div className="absolute top-0 right-0 w-40 h-40 bg-amber-500/10 rounded-full blur-3xl -mr-12 -mt-12 pointer-events-none" />
                <div className="relative flex items-start justify-between mb-4">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{nameFor(id)}</p>
                    <p className="text-[10px] font-mono uppercase tracking-widest text-slate-400 dark:text-neutral-500 mt-0.5">ID #{id}</p>
                  </div>
                  <span className="shrink-0 p-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-500">
                    <Crown size={16} />
                  </span>
                </div>

                <div className="relative grid grid-cols-2 gap-3 mb-5">
                  <div>
                    <span className="text-[10px] uppercase font-bold tracking-widest text-slate-400 dark:text-neutral-500">Sub-afiliados</span>
                    <p className="font-bold text-base text-slate-800 dark:text-white mt-0.5 flex items-center gap-1.5">
                      <Users size={14} className="text-slate-400 dark:text-neutral-500" />
                      {s.subAffiliateIds.length}
                    </p>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold tracking-widest text-slate-400 dark:text-neutral-500">Taxa própria</span>
                    <p className="font-bold text-base text-slate-800 dark:text-white mt-0.5 truncate">
                      R$ {cfg?.cpaValue ?? 0} · {cfg?.revPercentage ?? 0}%
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => setModal({ open: true, affiliate: aff })}
                  className="relative w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-slate-50 dark:bg-neutral-800/60 border border-slate-100 dark:border-neutral-700/60 text-xs font-bold text-slate-600 dark:text-neutral-200 hover:border-amber-500/40 hover:text-amber-600 dark:hover:text-amber-400 transition-all"
                >
                  <Settings2 size={14} />
                  Gerir sub-rede
                </button>
                <Link
                  to={`/affiliates/${id}`}
                  className="relative mt-2 w-full flex items-center justify-center gap-1.5 py-2 text-[11px] font-bold text-slate-400 dark:text-neutral-500 hover:text-slate-600 dark:hover:text-neutral-300 transition-colors"
                >
                  Ver dados do afiliado <ArrowRight size={12} />
                </Link>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
