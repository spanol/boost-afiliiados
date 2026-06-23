import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import { Megaphone, X, Save, Loader2, Search, Send, AlertTriangle } from 'lucide-react';
import { cn } from '../lib/utils';
import { useToast } from '../contexts/ToastContext';
import {
  Notice,
  NoticeAudience,
  NoticeCategory,
  createNotice,
  updateNotice,
} from '../services/noticeService';
import { sendDirectMessage } from '../services/directMessageService';
import { fetchAffiliates } from '../services/affiliateService';

interface AffiliateLite {
  id: string;
  name?: string;
}

interface Props {
  // Quando presente, edita um aviso existente (broadcast). Mensagem direta não edita.
  editing?: Notice;
  onClose: () => void;
  onSaved?: () => void;
}

// Audiência inclui 'affiliate' (1:1) só na UI do compositor: ao escolher um
// afiliado, o conteúdo vira uma MENSAGEM DIRETA (popup privado), não um aviso no
// feed. Os demais públicos viram avisos broadcast.
type ComposerAudience = NoticeAudience | 'affiliate';

const AUDIENCE_OPTIONS: { id: ComposerAudience; label: string; hint: string }[] = [
  { id: 'all', label: 'Todos', hint: 'Aparece no feed de todos os afiliados.' },
  { id: 'clients', label: 'Clientes', hint: 'Só afiliados comuns (não especiais).' },
  { id: 'specials', label: 'Especiais', hint: 'Só afiliados especiais (rede própria).' },
  { id: 'affiliate', label: 'Afiliado', hint: 'Mensagem privada (popup) para um afiliado.' },
];

const CATEGORY_OPTIONS: { id: NoticeCategory; label: string }[] = [
  { id: 'info', label: 'Info' },
  { id: 'importante', label: 'Importante' },
  { id: 'comunicado', label: 'Comunicado' },
];

export default function NoticeComposerModal({ editing, onClose, onSaved }: Props) {
  const { push } = useToast();
  const isEdit = !!editing;

  const [audience, setAudience] = useState<ComposerAudience>(editing?.audience ?? 'all');
  const [category, setCategory] = useState<NoticeCategory>(editing?.category ?? 'info');
  const [title, setTitle] = useState(editing?.title ?? '');
  const [body, setBody] = useState(editing?.body ?? '');
  const [link, setLink] = useState(editing?.link ?? '');
  const [active, setActive] = useState(editing?.active ?? true);
  const [saving, setSaving] = useState(false);

  // Seleção de afiliado (audience = 'affiliate').
  const [affiliates, setAffiliates] = useState<AffiliateLite[]>([]);
  const [loadingAff, setLoadingAff] = useState(false);
  const [affError, setAffError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selectedAff, setSelectedAff] = useState<string | null>(null);

  const isDirect = audience === 'affiliate';

  // Carrega a lista de afiliados sob demanda (admin-only no proxy).
  useEffect(() => {
    if (audience !== 'affiliate' || affiliates.length || loadingAff) return;
    setLoadingAff(true);
    setAffError(null);
    fetchAffiliates()
      .then((list) => setAffiliates(list.map((a) => ({ id: String(a.id), name: a.name }))))
      .catch(() => setAffError('Não foi possível carregar os afiliados.'))
      .finally(() => setLoadingAff(false));
  }, [audience, affiliates.length, loadingAff]);

  const q = search.trim().toLowerCase();
  const filteredAff = q
    ? affiliates.filter((a) => (a.name || '').toLowerCase().includes(q) || a.id.includes(q))
    : affiliates;

  const handleSave = async () => {
    if (!title.trim() || !body.trim()) {
      push({ type: 'error', message: 'Preencha título e mensagem.' });
      return;
    }
    if (isDirect && !selectedAff) {
      push({ type: 'error', message: 'Selecione o afiliado destinatário.' });
      return;
    }
    setSaving(true);
    try {
      if (isDirect) {
        const { delivered } = await sendDirectMessage({ affiliateId: selectedAff!, title: title.trim(), body: body.trim() });
        push({ type: 'success', message: `Mensagem enviada (${delivered} login${delivered === 1 ? '' : 's'}).` });
      } else if (isEdit) {
        await updateNotice(editing!.id, { title: title.trim(), body: body.trim(), category, audience: audience as NoticeAudience, link: link.trim(), active });
        push({ type: 'success', message: 'Aviso atualizado.' });
      } else {
        await createNotice({ title: title.trim(), body: body.trim(), category, audience: audience as NoticeAudience, link: link.trim() || undefined, active });
        push({ type: 'success', message: 'Aviso publicado.' });
      }
      onSaved?.();
      onClose();
    } catch (err) {
      push({ type: 'error', message: err instanceof Error ? err.message : 'Falha ao salvar.' });
    } finally {
      setSaving(false);
    }
  };

  const inputClass = 'w-full px-4 py-3 bg-slate-50 dark:bg-neutral-800/60 border border-slate-200 dark:border-neutral-700 rounded-xl text-sm dark:text-white focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-all outline-none';
  const labelClass = 'text-[10px] font-bold text-slate-400 dark:text-neutral-500 uppercase tracking-widest ml-1 block mb-2';

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
                <Megaphone size={12} /> {isDirect ? 'Mensagem direta' : isEdit ? 'Editar aviso' : 'Novo aviso'}
              </span>
              <h3 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">
                {isDirect ? 'Enviar mensagem ao afiliado' : 'Comunicado da rede'}
              </h3>
            </div>
            <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-neutral-200 transition-colors">
              <X size={20} />
            </button>
          </div>

          <div className="flex-1 min-h-0 p-6 space-y-5 overflow-y-auto">
            {/* Público-alvo */}
            <div>
              <span className={labelClass}>Público</span>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {AUDIENCE_OPTIONS.filter((o) => !isEdit || o.id !== 'affiliate').map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => setAudience(o.id)}
                    disabled={isEdit && o.id === 'affiliate'}
                    className={cn(
                      'px-2 py-2 rounded-xl text-xs font-bold border transition-all',
                      audience === o.id
                        ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/40'
                        : 'bg-slate-50 dark:bg-neutral-800/60 text-slate-500 dark:text-neutral-400 border-slate-200 dark:border-neutral-700 hover:border-slate-300 dark:hover:border-neutral-600',
                    )}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-slate-500 dark:text-neutral-400 mt-2 ml-1">
                {AUDIENCE_OPTIONS.find((o) => o.id === audience)?.hint}
              </p>
            </div>

            {/* Seletor de afiliado (mensagem direta) */}
            {isDirect && (
              <div>
                <span className={labelClass}>Afiliado destinatário</span>
                <div className="relative mb-2">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-neutral-400" size={14} />
                  <input
                    type="text"
                    placeholder="Buscar por nome ou ID..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 bg-slate-50 dark:bg-neutral-800/60 border border-slate-200 dark:border-neutral-700 rounded-xl text-xs outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-all dark:text-white"
                  />
                </div>
                <div className="max-h-44 overflow-y-auto rounded-xl border border-slate-100 dark:border-neutral-800 divide-y divide-slate-100 dark:divide-neutral-800">
                  {loadingAff ? (
                    <p className="p-4 text-center text-[11px] text-slate-400 dark:text-neutral-500 flex items-center justify-center gap-2"><Loader2 size={14} className="animate-spin" /> Carregando afiliados...</p>
                  ) : affError ? (
                    <p className="p-4 text-center text-[11px] text-red-500">{affError}</p>
                  ) : filteredAff.length === 0 ? (
                    <p className="p-4 text-center text-[11px] text-slate-400 dark:text-neutral-500">Nenhum afiliado encontrado.</p>
                  ) : filteredAff.slice(0, 50).map((a) => {
                    const checked = selectedAff === a.id;
                    return (
                      <label key={a.id} className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-slate-50 dark:hover:bg-white/[0.03]">
                        <input type="radio" name="aff" checked={checked} onChange={() => setSelectedAff(a.id)} className="w-4 h-4 accent-amber-500" />
                        <span className="flex-1 min-w-0">
                          <span className="block text-xs font-semibold text-slate-700 dark:text-neutral-200 truncate">{a.name || 'Sem Nome'}</span>
                          <span className="block text-[10px] font-mono text-slate-400 dark:text-neutral-500">#{a.id}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
                <p className="text-[11px] text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2 mt-2 flex items-start gap-2">
                  <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                  Vira um popup privado. Só funciona se o afiliado já tiver login Boost vinculado.
                </p>
              </div>
            )}

            {/* Categoria (só broadcast) */}
            {!isDirect && (
              <div>
                <span className={labelClass}>Categoria</span>
                <div className="flex gap-2">
                  {CATEGORY_OPTIONS.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setCategory(c.id)}
                      className={cn(
                        'px-3 py-2 rounded-xl text-xs font-bold border transition-all flex-1',
                        category === c.id
                          ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/40'
                          : 'bg-slate-50 dark:bg-neutral-800/60 text-slate-500 dark:text-neutral-400 border-slate-200 dark:border-neutral-700 hover:border-slate-300 dark:hover:border-neutral-600',
                      )}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div>
              <label className={labelClass}>Título</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={isDirect ? 'Ex.: Sobre o seu acordo' : 'Ex.: Nova casa disponível'} className={inputClass} maxLength={160} />
            </div>

            <div>
              <label className={labelClass}>Mensagem</label>
              <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Escreva o conteúdo..." rows={5} className={cn(inputClass, 'resize-none')} maxLength={5000} />
            </div>

            {!isDirect && (
              <>
                <div>
                  <label className={labelClass}>Link (opcional)</label>
                  <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://..." className={inputClass} maxLength={500} />
                </div>
                <label className="flex items-center justify-between gap-4 p-4 rounded-2xl bg-slate-50 dark:bg-neutral-800/40 border border-slate-100 dark:border-neutral-800 cursor-pointer">
                  <div>
                    <p className="text-sm font-bold text-slate-800 dark:text-neutral-100">Publicado</p>
                    <p className="text-[11px] text-slate-500 dark:text-neutral-400 mt-0.5">Desligado, o aviso fica oculto para os afiliados.</p>
                  </div>
                  <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="w-5 h-5 accent-amber-500" />
                </label>
              </>
            )}
          </div>

          <div className="shrink-0 p-6 border-t border-slate-100 dark:border-neutral-800 flex justify-end gap-2">
            <button onClick={onClose} className="px-4 py-2.5 rounded-full bg-white dark:bg-neutral-800 border border-slate-200 dark:border-neutral-700 text-xs font-bold text-slate-600 dark:text-neutral-200 hover:border-slate-300 dark:hover:border-neutral-600 transition-all">
              Cancelar
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-5 py-2.5 rounded-full bg-amber-500 text-white text-xs font-bold hover:bg-amber-400 transition-all shadow-sm shadow-amber-500/20 disabled:opacity-50 flex items-center gap-2"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : isDirect ? <Send size={14} /> : <Save size={14} />}
              {isDirect ? 'Enviar' : isEdit ? 'Salvar' : 'Publicar'}
            </button>
          </div>
        </motion.div>
      </div>
    </div>,
    document.body,
  );
}
