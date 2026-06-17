import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import { Crown, X, Save, Loader2, Search } from 'lucide-react';
import { cn } from '../lib/utils';
import { saveSpecialAffiliate, SpecialAffiliate } from '../services/affiliateService';
import { useToast } from '../contexts/ToastContext';

interface AffiliateLite {
  id: string;
  name?: string;
  label?: string;
  userUid?: string;
}

interface Props {
  affiliate: AffiliateLite;                       // afiliado sendo gerido
  allAffiliates: AffiliateLite[];                 // pool para escolher sub-afiliados
  specials: Record<string, SpecialAffiliate>;     // estado atual dos especiais
  onClose: () => void;
  onSaved?: () => void;                           // refresh do chamador
}

// B3 · Modal de gestão do afiliado especial (compartilhado entre a lista de
// afiliados e a página de dados do afiliado). Master promove/rebaixa e vincula
// sub-afiliados (1 especial por afiliado, 1 nível). A taxa da sub-rede NÃO é
// definida aqui — o próprio especial seta a comissão de cada sub na view dele
// (/network); o ganho dele é o spread sobre a taxa própria (decisão do Carlos).
export default function SpecialAffiliateModal({ affiliate, allAffiliates, specials, onClose, onSaved }: Props) {
  const { push } = useToast();
  const espId = String(affiliate.id);
  const existing = specials[espId];

  const [active, setActive] = useState(existing?.active ?? false);
  const [subs, setSubs] = useState<string[]>(existing?.subAffiliateIds ?? []);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);

  const toggleSub = (subId: string) =>
    setSubs((prev) => (prev.includes(subId) ? prev.filter((s) => s !== subId) : [...prev, subId]));

  const otherEspeciais = new Set(
    Object.values(specials).filter((s) => s.active && String(s.affiliateId) !== espId).map((s) => String(s.affiliateId))
  );
  const takenByOthers = new Set<string>();
  Object.values(specials).forEach((s) => {
    if (String(s.affiliateId) !== espId && s.active) s.subAffiliateIds.forEach((id) => takenByOthers.add(String(id)));
  });
  const q = search.toLowerCase();
  const eligible = allAffiliates.filter((a) => {
    const id = String(a.id);
    if (id === espId) return false;
    if (otherEspeciais.has(id)) return false;
    if (takenByOthers.has(id) && !subs.includes(id)) return false;
    return !q || (a.name || '').toLowerCase().includes(q) || id.includes(q);
  });

  const handleSave = async () => {
    setSaving(true);
    try {
      // O servidor grava o registro E espelha isSpecial no login vinculado
      // (resolvido pelo affiliateId) — não depende mais do userUid em mãos.
      await saveSpecialAffiliate({
        affiliateId: espId,
        active,
        subAffiliateIds: active ? subs : [],
      });
      push({ type: 'success', message: active ? 'Afiliado especial salvo.' : 'Afiliado especial desativado.' });
      onSaved?.();
      onClose();
    } catch (err) {
      push({ type: 'error', message: err instanceof Error ? err.message : 'Falha ao salvar afiliado especial.' });
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div onClick={onClose} className="fixed inset-0 z-50 overflow-y-auto bg-black/50 backdrop-blur-sm">
      <div className="flex min-h-full items-center justify-center p-4">
        <motion.div
          onClick={(e) => e.stopPropagation()}
          initial={{ opacity: 0, scale: 0.96, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          className="w-full max-w-lg bg-white dark:bg-neutral-900 rounded-3xl shadow-2xl border border-slate-200/70 dark:border-neutral-800 overflow-hidden flex flex-col max-h-[calc(100vh_-_2rem)]"
        >
        <div className="shrink-0 p-6 border-b border-slate-100 dark:border-neutral-800 flex items-start justify-between gap-4">
          <div>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 mb-2 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-[10px] font-bold uppercase tracking-widest">
              <Crown size={12} /> Afiliado especial
            </span>
            <h3 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">{affiliate.name || affiliate.label || 'Sem Nome'}</h3>
            <p className="text-[10px] font-mono uppercase tracking-widest text-slate-400 dark:text-neutral-500 mt-0.5">ID #{espId}</p>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-neutral-200 transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 min-h-0 p-6 space-y-5 overflow-y-auto">
          <label className="flex items-center justify-between gap-4 p-4 rounded-2xl bg-slate-50 dark:bg-neutral-800/40 border border-slate-100 dark:border-neutral-800 cursor-pointer">
            <div>
              <p className="text-sm font-bold text-slate-800 dark:text-neutral-100">Ativar como afiliado especial</p>
              <p className="text-[11px] text-slate-500 dark:text-neutral-400 mt-0.5">Dá a ele uma view da própria sub-rede.</p>
            </div>
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="w-5 h-5 accent-amber-500" />
          </label>

          {active && (
            <>
              {!affiliate.userUid && (
                <p className="text-[11px] text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2">
                  Este afiliado ainda não tem conta Boost — ele precisará se cadastrar (convite) para acessar a view de especial.
                </p>
              )}

              <p className="text-[11px] text-slate-500 dark:text-neutral-400 bg-slate-50 dark:bg-neutral-800/40 border border-slate-100 dark:border-neutral-800 rounded-xl px-3 py-2.5">
                A comissão de cada sub-afiliado é definida pelo próprio especial no
                painel dele (<span className="font-semibold">/network</span>). O ganho
                dele é o spread sobre a taxa própria.
              </p>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] font-bold text-slate-400 dark:text-neutral-500 uppercase tracking-widest">Sub-afiliados</p>
                  <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400">{subs.length} selecionado(s)</span>
                </div>
                <div className="relative mb-2">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-neutral-400" size={14} />
                  <input
                    type="text"
                    placeholder="Buscar afiliado..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 bg-slate-50 dark:bg-neutral-800/60 border border-slate-200 dark:border-neutral-700 rounded-xl text-xs outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-all dark:text-white"
                  />
                </div>
                <div className="max-h-52 overflow-y-auto rounded-xl border border-slate-100 dark:border-neutral-800 divide-y divide-slate-100 dark:divide-neutral-800">
                  {eligible.length === 0 ? (
                    <p className="p-4 text-center text-[11px] text-slate-400 dark:text-neutral-500">Nenhum afiliado disponível.</p>
                  ) : eligible.map((a) => {
                    const id = String(a.id);
                    const checked = subs.includes(id);
                    return (
                      <label key={id} className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-slate-50 dark:hover:bg-white/[0.03]">
                        <input type="checkbox" checked={checked} onChange={() => toggleSub(id)} className="w-4 h-4 accent-amber-500" />
                        <span className="flex-1 min-w-0">
                          <span className="block text-xs font-semibold text-slate-700 dark:text-neutral-200 truncate">{a.name || a.label || 'Sem Nome'}</span>
                          <span className="block text-[10px] font-mono text-slate-400 dark:text-neutral-500">#{id}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>

        <div className="shrink-0 p-6 border-t border-slate-100 dark:border-neutral-800 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2.5 rounded-full bg-white dark:bg-neutral-800 border border-slate-200 dark:border-neutral-700 text-xs font-bold text-slate-600 dark:text-neutral-200 hover:border-slate-300 dark:hover:border-neutral-600 transition-all"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2.5 rounded-full bg-amber-500 text-white text-xs font-bold hover:bg-amber-400 transition-all shadow-sm shadow-amber-500/20 disabled:opacity-50 flex items-center gap-2"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Salvar
          </button>
        </div>
        </motion.div>
      </div>
    </div>,
    document.body
  );
}
