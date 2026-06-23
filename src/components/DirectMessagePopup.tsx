import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { MailOpen, Loader2, Check } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
  DirectMessage,
  subscribeToMyDirectMessages,
  markDirectMessageRead,
} from '../services/directMessageService';

// Popup global das mensagens diretas da gerência. Montado no DashboardLayout, ouve
// as mensagens do próprio uid em tempo real e exibe as não-lidas uma a uma. Ao
// confirmar ("Entendi"), marca a leitura no servidor. `dismissed` evita reexibir a
// mesma mensagem enquanto o snapshot do Firestore não reflete o readAt.
export default function DirectMessagePopup() {
  const { user } = useAuth();
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user?.uid) {
      setMessages([]);
      return;
    }
    const unsubscribe = subscribeToMyDirectMessages(
      user.uid,
      (data) => setMessages(data),
      (err) => console.error('Erro ao carregar mensagens diretas:', err),
    );
    return () => unsubscribe();
  }, [user?.uid]);

  const current = useMemo(
    () => messages.find((m) => !m.readAt && !dismissed.has(m.id)) ?? null,
    [messages, dismissed],
  );

  const handleAck = async () => {
    if (!current) return;
    setBusy(true);
    try {
      await markDirectMessageRead(current.id);
    } catch (err) {
      console.error('Falha ao marcar mensagem como lida:', err);
    } finally {
      setDismissed((prev) => new Set(prev).add(current.id));
      setBusy(false);
    }
  };

  if (!current) return null;

  const when = current.createdAt
    ? new Date(current.createdAt.toDate()).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
    : '';

  return createPortal(
    <AnimatePresence>
      <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 12 }}
          className="w-full max-w-md bg-white dark:bg-neutral-900 rounded-3xl shadow-2xl border border-slate-200/70 dark:border-neutral-800 overflow-hidden"
        >
          <div className="p-6 border-b border-slate-100 dark:border-neutral-800">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 mb-3 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-[10px] font-bold uppercase tracking-widest">
              <MailOpen size={12} /> Mensagem da gerência
            </span>
            <h3 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">{current.title}</h3>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-neutral-500 mt-1">
              {current.createdByName || 'Gerência Boost'}{when ? ` · ${when}` : ''}
            </p>
          </div>

          <div className="p-6">
            <p className="text-sm text-slate-600 dark:text-neutral-300 whitespace-pre-wrap leading-relaxed">{current.body}</p>
          </div>

          <div className="p-6 pt-0 flex justify-end">
            <button
              onClick={handleAck}
              disabled={busy}
              className="px-5 py-2.5 rounded-full bg-amber-500 text-white text-xs font-bold hover:bg-amber-400 transition-all shadow-sm shadow-amber-500/20 disabled:opacity-50 flex items-center gap-2"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              Entendi
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>,
    document.body,
  );
}
