import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { 
  Settings as SettingsIcon, 
  Key, 
  ExternalLink, 
  Save, 
  AlertCircle, 
  Database, 
  ShieldCheck,
  RefreshCw,
  Copy,
  Check
} from 'lucide-react';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import firebaseConfig from '../../firebase-applet-config.json';
import { fetchAuditLogs, AuditLog } from '../services/affiliateService';

export default function Settings() {
  const { profile } = useAuth();
  const [apiKey, setApiKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(true);

  // Local state for Firebase Override (Display only or persist if requested)
  const [fbConfig, setFbConfig] = useState(JSON.stringify(firebaseConfig, null, 2));

  useEffect(() => {
    async function loadSettings() {
      if (profile?.role !== 'admin') return;
      
      try {
        const docRef = doc(db, 'settings', 'external_api');
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          setApiKey(docSnap.data().value);
        }
      } catch (err) {
        console.error('Erro ao carregar configurações:', err);
      }
    }
    loadSettings();
    async function loadLogs() {
      try {
        setLoadingLogs(true);
        const logs = await fetchAuditLogs();
        setAuditLogs(logs);
      } catch (err) {
        console.error('Erro carregando logs de auditoria', err);
      } finally {
        setLoadingLogs(false);
      }
    }
    loadLogs();
  }, [profile]);

  const handleSaveApiKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (profile?.role !== 'admin') return;

    setLoading(true);
    setError('');
    setSaveSuccess(false);

    try {
      await setDoc(doc(db, 'settings', 'external_api'), {
        key: 'client_capture_api_key',
        value: apiKey,
        description: 'Chave de API para captura de dados de clientes',
        updatedAt: serverTimestamp()
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'settings/external_api');
      setError('Falha ao salvar a chave de API.');
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (profile?.role !== 'admin') {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] space-y-4">
        <div className="p-4 rounded-2xl border border-slate-200/70 dark:border-neutral-800 bg-slate-50 dark:bg-neutral-900/60">
          <ShieldCheck size={40} className="text-slate-500 dark:text-neutral-300" />
        </div>
        <div className="text-center">
          <h2 className="text-lg font-bold tracking-tight text-slate-800 dark:text-white">Acesso Restrito</h2>
          <p className="text-slate-500 dark:text-neutral-400 text-sm">Esta página está disponível apenas para administradores.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl space-y-8">
      <header>
        <span className="inline-flex items-center gap-2 px-3 py-1 mb-3 rounded-full bg-slate-900/5 dark:bg-white/5 border border-slate-900/10 dark:border-white/10 text-slate-500 dark:text-neutral-300 text-[10px] font-bold uppercase tracking-widest">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          Integrações
        </span>
        <h1 className="text-3xl md:text-4xl font-bold text-slate-900 dark:text-white tracking-tighter flex items-center gap-3">
          <span className="p-2 rounded-xl bg-slate-50 dark:bg-neutral-800/60 border border-slate-100 dark:border-neutral-700/60">
            <SettingsIcon size={24} className="text-slate-900 dark:text-white" />
          </span>
          Configurações
        </h1>
        <p className="text-slate-500 dark:text-neutral-400 text-sm mt-2">Gerencie chaves de API e integração Firebase.</p>
      </header>

      <div className="grid grid-cols-1 gap-8">
        {/* API Settings */}
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white dark:bg-neutral-900/60 border border-slate-200/70 dark:border-neutral-800 rounded-3xl shadow-sm overflow-hidden hover:border-slate-300 dark:hover:border-neutral-700 transition-colors"
        >
          <div className="p-5 border-b border-slate-100 dark:border-neutral-800 flex items-center gap-3">
            <span className="p-2 rounded-xl bg-slate-50 dark:bg-neutral-800/60 border border-slate-100 dark:border-neutral-700/60">
              <Key size={16} className="text-slate-900 dark:text-neutral-100" />
            </span>
            <h3 className="text-sm font-bold text-slate-800 dark:text-white tracking-tight">API de Captura de Dados</h3>
          </div>
          <div className="p-6 space-y-6">
            <p className="text-xs text-slate-500 dark:text-neutral-400 leading-relaxed">
              Insira abaixo a chave da API que será utilizada pelo sistema para capturar e processar os dados dos clientes vinculados aos seus afiliados.
            </p>

            <form onSubmit={handleSaveApiKey} className="space-y-4">
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-400 dark:text-neutral-500 uppercase tracking-widest ml-1">Chave da API (Secret)</label>
                <div className="relative">
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="sk-xxxxxxxxxxxxxxxxxxxxxxxx"
                    className="w-full px-4 py-3 bg-slate-50 dark:bg-neutral-800/60 border border-slate-200 dark:border-neutral-700 rounded-xl text-sm dark:text-white focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-all outline-none"
                  />
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    <ShieldCheck size={16} className="text-slate-400 dark:text-neutral-400" aria-label="Armazenamento Seguro" />
                  </div>
                </div>
              </div>

              {error && (
                <div className="p-3 bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 rounded-xl text-[11px] font-bold flex items-center gap-2 border border-red-100 dark:border-red-900/40">
                  <AlertCircle size={14} />
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-slate-900 dark:bg-white text-white dark:text-neutral-900 py-3 rounded-full text-xs font-bold hover:opacity-90 active:scale-[0.99] transition-all flex items-center justify-center gap-2 shadow-sm disabled:opacity-50"
              >
                {loading ? <RefreshCw size={14} className="animate-spin" /> : saveSuccess ? <Check size={14} /> : <Save size={14} />}
                {saveSuccess ? 'Chave Salva!' : 'Salvar Configuração'}
              </button>
            </form>
          </div>
        </motion.div>
        {/* Audit Logs Table */}
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white dark:bg-neutral-900/60 border border-slate-200/70 dark:border-neutral-800 rounded-3xl shadow-sm overflow-hidden hover:border-slate-300 dark:hover:border-neutral-700 transition-colors"
        >
          <div className="p-5 border-b border-slate-100 dark:border-neutral-800 flex items-center gap-3">
            <span className="p-2 rounded-xl bg-slate-50 dark:bg-neutral-800/60 border border-slate-100 dark:border-neutral-700/60">
              <Database size={16} className="text-slate-900 dark:text-neutral-100" />
            </span>
            <h3 className="text-sm font-bold text-slate-800 dark:text-white tracking-tight">Logs de Auditoria</h3>
          </div>
          <div className="p-6">
            {loadingLogs ? (
              <div className="py-8 text-center text-slate-500 dark:text-neutral-400 text-sm">Carregando logs...</div>
            ) : auditLogs.length === 0 ? (
              <div className="py-8 text-center text-slate-500 dark:text-neutral-400 text-sm">Nenhum log de auditoria encontrado.</div>
            ) : (
              <>
                {/* sm+ : tabela */}
                <div className="hidden sm:block overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-[10px] text-slate-400 dark:text-neutral-500 uppercase tracking-widest border-b border-slate-100 dark:border-neutral-800">
                      <tr>
                        <th className="px-4 py-3">Data</th>
                        <th className="px-4 py-3">Afiliado</th>
                        <th className="px-4 py-3">Ação</th>
                        <th className="px-4 py-3">Usuário</th>
                        <th className="px-4 py-3">Motivo</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-neutral-800">
                      {auditLogs.map((log) => (
                        <tr key={log.id} className="hover:bg-slate-50/70 dark:hover:bg-white/[0.03] transition-colors">
                          <td className="px-4 py-3 text-[13px] text-slate-600 dark:text-neutral-300">{log.createdAt ? new Date(log.createdAt).toLocaleString('pt-BR') : '-'}</td>
                          <td className="px-4 py-3 text-slate-700 dark:text-neutral-200">{log.affiliateId}</td>
                          <td className="px-4 py-3 text-slate-700 dark:text-neutral-200">{log.action}</td>
                          <td className="px-4 py-3 text-slate-600 dark:text-neutral-300">{log.actorName || log.actorId}</td>
                          <td className="px-4 py-3 text-slate-600 dark:text-neutral-300">{log.reason || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* mobile : cards */}
                <div className="sm:hidden space-y-3">
                  {auditLogs.map((log) => (
                    <div key={log.id} className="p-4 rounded-2xl border border-slate-100 dark:border-neutral-800 bg-slate-50/50 dark:bg-neutral-800/30 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-medium text-slate-500 dark:text-neutral-400">{log.createdAt ? new Date(log.createdAt).toLocaleString('pt-BR') : '-'}</span>
                        <span className="px-2 py-0.5 rounded-lg text-[10px] font-bold uppercase tracking-wider bg-slate-200/70 dark:bg-neutral-700/60 text-slate-600 dark:text-neutral-200">{log.action}</span>
                      </div>
                      <dl className="text-xs space-y-1">
                        <div className="flex gap-2">
                          <dt className="text-slate-400 dark:text-neutral-500 font-bold uppercase tracking-widest text-[10px] shrink-0 pt-0.5">Afiliado</dt>
                          <dd className="text-slate-700 dark:text-neutral-200 font-medium break-all">{log.affiliateId}</dd>
                        </div>
                        <div className="flex gap-2">
                          <dt className="text-slate-400 dark:text-neutral-500 font-bold uppercase tracking-widest text-[10px] shrink-0 pt-0.5">Usuário</dt>
                          <dd className="text-slate-700 dark:text-neutral-200 font-medium break-words">{log.actorName || log.actorId || '-'}</dd>
                        </div>
                        {log.reason && (
                          <div className="flex gap-2">
                            <dt className="text-slate-400 dark:text-neutral-500 font-bold uppercase tracking-widest text-[10px] shrink-0 pt-0.5">Motivo</dt>
                            <dd className="text-slate-700 dark:text-neutral-200 font-medium break-words">{log.reason}</dd>
                          </div>
                        )}
                      </dl>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </motion.div>
      </div>

      {/* Security Info */}
      <div className="bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-200/70 dark:border-emerald-900/40 p-5 rounded-2xl flex gap-4 items-start">
        <div className="p-2.5 bg-emerald-500/10 rounded-xl border border-emerald-500/20 text-emerald-500 shrink-0">
          <ShieldCheck size={20} />
        </div>
        <div>
          <h4 className="text-xs font-bold text-slate-800 dark:text-neutral-100 uppercase tracking-widest mb-1">Segurança de Dados</h4>
          <p className="text-[11px] text-slate-500 dark:text-neutral-400 leading-relaxed font-medium">
            Todas as chaves de API inseridas nesta área são armazenadas no Google Cloud Firestore com criptografia em repouso. 
            O acesso a estes dados é restrito via Security Rules do Firebase, permitindo leitura e escrita exclusivamente para usuários com função de administrador autenticados.
          </p>
        </div>
      </div>
    </div>
  );
}
