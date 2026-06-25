import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { cn } from '../lib/utils';
import { Notice, subscribeToNotices, isNoticeForUser, countUnreadNotices } from '../services/noticeService';

// Sino do header: mostra os avisos relevantes ao usuário + um badge de não-lidos.
// "Não-lido" é derivado de um marcador local (localStorage) por uid — MVP sem
// gravação extra no Firestore. Ao abrir o painel, marca tudo como visto.
function seenKey(uid?: string) {
  return `boost_notices_seen_${uid ?? 'anon'}`;
}

export default function NotificationBell() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const [notices, setNotices] = useState<Notice[]>([]);
  const [open, setOpen] = useState(false);
  const [lastSeen, setLastSeen] = useState<number>(0);

  useEffect(() => {
    const raw = Number(localStorage.getItem(seenKey(user?.uid)));
    setLastSeen(Number.isFinite(raw) ? raw : 0);
  }, [user?.uid]);

  useEffect(() => {
    const unsubscribe = subscribeToNotices(
      (data) => setNotices(data),
      (err) => console.error('Erro ao carregar avisos (sino):', err),
    );
    return () => unsubscribe();
  }, []);

  const visible = useMemo(() => {
    const isAdmin = profile?.role === 'admin';
    return notices.filter((n) => (isAdmin ? n.active : isNoticeForUser(n, profile)));
  }, [notices, profile]);

  const unread = useMemo(() => countUnreadNotices(visible, lastSeen), [visible, lastSeen]);

  const markSeen = () => {
    const now = Date.now();
    localStorage.setItem(seenKey(user?.uid), String(now));
    setLastSeen(now);
  };

  const toggle = () => {
    setOpen((prev) => {
      const next = !prev;
      if (next) markSeen();
      return next;
    });
  };

  return (
    <div className="relative">
      <button
        onClick={toggle}
        className="relative flex items-center justify-center w-9 h-9 rounded-full bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-neutral-300 hover:bg-slate-200 dark:hover:bg-white/10 hover:text-slate-900 dark:hover:text-white border border-transparent dark:border-white/10 hover:border-slate-300 dark:hover:border-white/20 transition-all shadow-sm"
        title="Avisos"
      >
        <Bell size={16} />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-amber-500 text-white text-[10px] font-bold flex items-center justify-center shadow">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <button className="fixed inset-0 z-30 cursor-default" onClick={() => setOpen(false)} aria-hidden tabIndex={-1} />
          <div className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-2rem)] z-40 rounded-2xl bg-white dark:bg-neutral-900 border border-slate-200 dark:border-neutral-800 shadow-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 dark:border-neutral-800 flex items-center justify-between">
              <p className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-widest">Avisos</p>
              <span className="text-[10px] font-bold text-slate-400 dark:text-neutral-500">{visible.length}</span>
            </div>
            <div className="max-h-80 overflow-y-auto divide-y divide-slate-100 dark:divide-neutral-800">
              {visible.length === 0 ? (
                <p className="p-6 text-center text-xs text-slate-400 dark:text-neutral-500">Nenhum aviso por enquanto.</p>
              ) : (
                visible.slice(0, 8).map((n) => (
                  <button
                    key={n.id}
                    onClick={() => { setOpen(false); navigate('/avisos'); }}
                    className="w-full text-left px-4 py-3 hover:bg-slate-50 dark:hover:bg-white/[0.03] transition-colors"
                  >
                    <p className="text-xs font-bold text-slate-800 dark:text-neutral-100 truncate">{n.title}</p>
                    <p className="text-[11px] text-slate-500 dark:text-neutral-400 line-clamp-2 mt-0.5">{n.body}</p>
                  </button>
                ))
              )}
            </div>
            <button
              onClick={() => { setOpen(false); navigate('/avisos'); }}
              className={cn('w-full px-4 py-3 text-center text-xs font-bold text-amber-600 dark:text-amber-400 hover:bg-slate-50 dark:hover:bg-white/[0.03] border-t border-slate-100 dark:border-neutral-800 transition-colors')}
            >
              Ver todos
            </button>
          </div>
        </>
      )}
    </div>
  );
}
