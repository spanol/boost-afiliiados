import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { RefreshCw, Sparkles } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { subscribeToAppVersion } from '../services/versionService';
import { LOCAL_VERSION, isOutdated, reloadApp } from '../lib/version';

// Banner global de atualização. Ouve app_meta/version (publicado pelo servidor no boot
// de cada deploy) e, se a versão remota difere da deste bundle, mostra um aviso com
// botão de refresh. Gate por auth: a regra do Firestore exige signed-in, e só faz
// sentido para quem está usando o app — logado-fora pega o bundle novo na próxima
// navegação (o index.html é servido com no-store).
export default function UpdateBanner() {
  const { user } = useAuth();
  const [remoteVersion, setRemoteVersion] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.uid) {
      setRemoteVersion(null);
      return;
    }
    const unsubscribe = subscribeToAppVersion(
      (v) => setRemoteVersion(v?.version ?? null),
      (err) => console.error('Erro ao verificar a versão do app:', err),
    );
    return () => unsubscribe();
  }, [user?.uid]);

  const show = isOutdated(LOCAL_VERSION, remoteVersion);

  return createPortal(
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 24 }}
          transition={{ type: 'spring', damping: 24, stiffness: 260 }}
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[70] w-[calc(100%-2rem)] max-w-md"
          role="alert"
        >
          <div className="flex items-center gap-3 rounded-2xl border border-amber-500/30 bg-white/95 dark:bg-neutral-900/95 backdrop-blur-md shadow-2xl shadow-black/10 p-4">
            <div className="shrink-0 w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/20 flex items-center justify-center">
              <Sparkles size={16} className="text-amber-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-slate-900 dark:text-white">Nova versão disponível</p>
              <p className="text-xs text-slate-500 dark:text-neutral-400">
                Atualize para carregar a versão mais recente do painel.
              </p>
            </div>
            <button
              onClick={reloadApp}
              className="shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-full bg-amber-500 text-white text-xs font-bold hover:bg-amber-400 transition-all shadow-sm shadow-amber-500/20"
            >
              <RefreshCw size={14} />
              Atualizar agora
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
