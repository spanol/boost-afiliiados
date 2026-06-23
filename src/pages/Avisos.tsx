import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Megaphone, Plus, Pencil, Trash2, ExternalLink, Loader2, EyeOff, Inbox } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { cn } from '../lib/utils';
import {
  Notice,
  NoticeCategory,
  subscribeToNotices,
  isNoticeForUser,
  deleteNotice,
} from '../services/noticeService';
import NoticeComposerModal from '../components/NoticeComposerModal';

const CATEGORY_STYLES: Record<NoticeCategory, { label: string; cls: string }> = {
  importante: { label: 'Importante', cls: 'bg-red-50 border-red-200 text-red-600 dark:bg-red-500/10 dark:border-red-900/40 dark:text-red-400' },
  comunicado: { label: 'Comunicado', cls: 'bg-blue-50 border-blue-200 text-blue-600 dark:bg-blue-500/10 dark:border-blue-900/40 dark:text-blue-400' },
  info: { label: 'Info', cls: 'bg-slate-100 border-slate-200 text-slate-500 dark:bg-white/5 dark:border-white/10 dark:text-neutral-300' },
};

const AUDIENCE_LABEL: Record<string, string> = { all: 'Todos', clients: 'Clientes', specials: 'Especiais' };

function formatDate(notice: Notice): string {
  if (!notice.createdAt) return 'Sem data';
  return new Date(notice.createdAt.toDate()).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export default function Avisos() {
  const { profile } = useAuth();
  const { push } = useToast();
  const isAdmin = profile?.role === 'admin';

  const [notices, setNotices] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [composer, setComposer] = useState<{ open: boolean; editing?: Notice }>({ open: false });
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const unsubscribe = subscribeToNotices(
      (data) => {
        setNotices(data);
        setLoading(false);
      },
      (err) => {
        console.error('Erro ao carregar avisos:', err);
        setError('Não foi possível carregar os avisos no momento.');
        setLoading(false);
      },
    );
    return () => unsubscribe();
  }, []);

  // Admin vê tudo (gestão); afiliado vê só o que é do seu segmento e está ativo.
  const visible = useMemo(
    () => (isAdmin ? notices : notices.filter((n) => isNoticeForUser(n, profile))),
    [notices, isAdmin, profile],
  );

  const handleDelete = async (id: string) => {
    setDeleting(true);
    try {
      await deleteNotice(id);
      push({ type: 'success', message: 'Aviso removido.' });
      setConfirmDelete(null);
    } catch (err) {
      push({ type: 'error', message: err instanceof Error ? err.message : 'Falha ao remover aviso.' });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-8 pb-20">
      {composer.open && (
        <NoticeComposerModal
          editing={composer.editing}
          onClose={() => setComposer({ open: false })}
          onSaved={() => setComposer({ open: false })}
        />
      )}

      <header className="flex flex-col md:flex-row md:items-start justify-between gap-4">
        <div>
          <span className="inline-flex items-center gap-2 px-3 py-1 mb-3 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-[10px] font-bold uppercase tracking-widest">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
            Comunicação
          </span>
          <h1 className="text-3xl md:text-4xl font-bold text-slate-900 dark:text-white tracking-tighter flex items-center gap-3">
            <span className="p-2 rounded-xl bg-slate-50 dark:bg-neutral-800/60 border border-slate-100 dark:border-neutral-700/60">
              <Megaphone size={24} className="text-amber-500" />
            </span>
            Avisos
          </h1>
          <p className="text-slate-500 dark:text-neutral-400 text-sm mt-2">
            {isAdmin
              ? 'Publique comunicados para a rede ou envie uma mensagem direta a um afiliado.'
              : 'Atualizações e comunicados da Boost.'}
          </p>
        </div>
        {isAdmin && (
          <button
            onClick={() => setComposer({ open: true })}
            className="flex items-center gap-2 px-4 py-2.5 bg-slate-900 dark:bg-white text-white dark:text-neutral-900 rounded-full text-xs font-bold hover:opacity-90 transition-all shadow-sm self-start shrink-0"
          >
            <Plus size={14} />
            Novo comunicado
          </button>
        )}
      </header>

      {loading ? (
        <div className="p-24 flex flex-col items-center justify-center gap-4">
          <Loader2 size={40} className="text-amber-500 animate-spin" />
          <p className="text-xs font-bold text-slate-400 dark:text-neutral-500 uppercase tracking-widest animate-pulse">Carregando...</p>
        </div>
      ) : error ? (
        <div className="py-20 text-center text-red-500">{error}</div>
      ) : visible.length === 0 ? (
        <div className="bg-white dark:bg-neutral-900/60 border border-slate-200/70 dark:border-neutral-800 rounded-3xl shadow-sm p-20 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl border border-slate-100 dark:border-neutral-700 bg-slate-50 dark:bg-neutral-800 text-slate-400 dark:text-neutral-300 mb-4">
            <Inbox size={24} />
          </div>
          <h3 className="text-sm font-bold text-slate-800 dark:text-neutral-100 mb-1">Nenhum aviso por aqui</h3>
          <p className="text-xs text-slate-500 dark:text-neutral-400">
            {isAdmin ? 'Crie o primeiro comunicado para a rede.' : 'Quando a Boost publicar algo, aparece aqui.'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {visible.map((notice, idx) => {
            const cat = CATEGORY_STYLES[notice.category] ?? CATEGORY_STYLES.info;
            return (
              <motion.article
                key={notice.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(idx * 0.04, 0.3) }}
                className={cn(
                  'p-5 md:p-6 rounded-2xl border bg-white dark:bg-neutral-900/60 shadow-sm transition-colors',
                  notice.active ? 'border-slate-200/70 dark:border-neutral-800' : 'border-dashed border-slate-300 dark:border-neutral-700 opacity-70',
                )}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <span className={cn('inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest border', cat.cls)}>
                      {cat.label}
                    </span>
                    <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-neutral-500">{formatDate(notice)}</span>
                    {isAdmin && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest bg-slate-100 dark:bg-white/5 border border-slate-200/70 dark:border-white/10 text-slate-500 dark:text-neutral-300">
                        {AUDIENCE_LABEL[notice.audience] ?? notice.audience}
                      </span>
                    )}
                    {isAdmin && !notice.active && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest bg-slate-100 dark:bg-white/5 border border-slate-200/70 dark:border-white/10 text-slate-400 dark:text-neutral-500">
                        <EyeOff size={11} /> Oculto
                      </span>
                    )}
                  </div>
                  {isAdmin && (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => setComposer({ open: true, editing: notice })}
                        className="p-2 rounded-lg bg-slate-50 dark:bg-neutral-800/60 border border-slate-100 dark:border-neutral-700 text-slate-500 dark:text-neutral-300 hover:border-amber-500/40 hover:text-amber-500 transition-all"
                        title="Editar"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => setConfirmDelete(notice.id)}
                        className="p-2 rounded-lg bg-slate-50 dark:bg-neutral-800/60 border border-slate-100 dark:border-neutral-700 text-slate-400 dark:text-neutral-500 hover:bg-red-50 dark:hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400 hover:border-red-200 dark:hover:border-red-900/40 transition-all"
                        title="Remover"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )}
                </div>

                <h2 className="text-base md:text-lg font-bold text-slate-900 dark:text-white tracking-tight">{notice.title}</h2>
                <p className="text-sm text-slate-600 dark:text-neutral-300 mt-1.5 whitespace-pre-wrap leading-relaxed">{notice.body}</p>

                {notice.link && (
                  <a
                    href={notice.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 mt-3 text-xs font-bold text-amber-600 dark:text-amber-400 hover:underline"
                  >
                    Abrir link <ExternalLink size={13} />
                  </a>
                )}

                {confirmDelete === notice.id && (
                  <div className="mt-4 flex items-center justify-end gap-2 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-900/40 p-3">
                    <span className="text-xs font-semibold text-red-600 dark:text-red-400 mr-auto">Remover este aviso?</span>
                    <button onClick={() => setConfirmDelete(null)} className="px-3 py-1.5 rounded-full bg-white dark:bg-neutral-800 border border-slate-200 dark:border-neutral-700 text-[11px] font-bold text-slate-600 dark:text-neutral-200">Cancelar</button>
                    <button onClick={() => handleDelete(notice.id)} disabled={deleting} className="px-3 py-1.5 rounded-full bg-red-600 text-white text-[11px] font-bold hover:bg-red-500 disabled:opacity-50 flex items-center gap-1.5">
                      {deleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />} Remover
                    </button>
                  </div>
                )}
              </motion.article>
            );
          })}
        </div>
      )}
    </div>
  );
}
