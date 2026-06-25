import React, { useState } from 'react';
import { motion } from 'motion/react';
import { useAuth } from '../contexts/AuthContext';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { updatePassword } from 'firebase/auth';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../lib/firebase';
import { validateProfile, saveProfile } from '../lib/profileSave';
import { 
  User, 
  Mail, 
  Lock, 
  Image as ImageIcon,
  Save,
  CheckCircle,
  AlertCircle,
  Upload,
  Loader2
} from 'lucide-react';
import { cn } from '../lib/utils';

export default function Profile() {
  const { profile, user } = useAuth();
  const [name, setName] = useState(profile?.name || '');
  const [avatarUrl, setAvatarUrl] = useState(profile?.avatarUrl || '');
  const [newPassword, setNewPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputEl = e.target;
    const file = inputEl.files?.[0];
    if (!file || !user) return;

    // Validação no cliente — evita upload inútil e dá mensagem clara.
    if (!file.type.startsWith('image/')) {
      setMessage({ type: 'error', text: 'Selecione um arquivo de imagem (JPG, PNG ou SVG).' });
      inputEl.value = '';
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setMessage({ type: 'error', text: 'Imagem muito grande. O limite é 5 MB.' });
      inputEl.value = '';
      return;
    }

    setUploading(true);
    setMessage(null);

    try {
      const storageRef = ref(storage, `avatars/${user.uid}/${Date.now()}_${file.name}`);
      const snapshot = await uploadBytes(storageRef, file);
      const downloadURL = await getDownloadURL(snapshot.ref);

      setAvatarUrl(downloadURL);

      // Persiste de imediato no Firestore (o onSnapshot do AuthContext propaga).
      await updateDoc(doc(db, 'users', user.uid), {
        avatarUrl: downloadURL,
        updatedAt: serverTimestamp()
      });

      setMessage({ type: 'success', text: 'Foto de perfil enviada com sucesso!' });
    } catch (err: any) {
      console.error('Error uploading file:', err);
      const code = err?.code || '';
      if (code === 'storage/unauthorized') {
        setMessage({ type: 'error', text: 'Sem permissão no Storage. As regras de Storage (storage.rules) precisam ser publicadas.' });
      } else if (code === 'storage/unknown' || code === 'storage/object-not-found' || code === 'storage/no-default-bucket') {
        setMessage({ type: 'error', text: 'Falha no Storage. Verifique se o Firebase Storage está habilitado neste projeto.' });
      } else if (code === 'storage/canceled') {
        setMessage({ type: 'error', text: 'Envio cancelado.' });
      } else {
        setMessage({ type: 'error', text: `Erro ao enviar imagem: ${err?.message || 'tente novamente'}.` });
      }
    } finally {
      setUploading(false);
      // Limpa o input p/ permitir reenviar o MESMO arquivo (onChange não dispara se o value não muda).
      inputEl.value = '';
    }
  };

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setLoading(true);
    setMessage(null);

    try {
      const forcePasswordChange = !!profile?.mustChangePassword;
      const validationError = validateProfile({ name, avatarUrl, newPassword, forcePasswordChange });
      if (validationError) {
        setMessage({ type: 'error', text: validationError });
        return; // o finally faz setLoading(false)
      }

      // Ordem SEGURA (R23): a senha troca PRIMEIRO; o perfil (com mustChangePassword:false)
      // só é gravado DEPOIS — se updatePassword falhar, o gate de primeiro acesso permanece.
      await saveProfile(
        { name, avatarUrl, newPassword, forcePasswordChange },
        {
          changePassword: (pw) => updatePassword(user, pw),
          updateProfileDoc: (payload) => updateDoc(doc(db, 'users', user.uid), payload),
          timestamp: () => serverTimestamp(),
        },
      );
      if (newPassword) setNewPassword('');

      setMessage({ type: 'success', text: 'Perfil atualizado com sucesso!' });
    } catch (err: any) {
      console.error('Erro ao atualizar perfil:', err);
      const code = err?.code || '';
      const msg = String(err?.message || '');
      if (code === 'auth/requires-recent-login') {
        setMessage({ type: 'error', text: 'Por segurança, saia e entre novamente antes de alterar a senha.' });
      } else if (code === 'auth/weak-password') {
        setMessage({ type: 'error', text: 'Senha fraca: use ao menos 6 caracteres.' });
      } else if (code === 'permission-denied' || msg.includes('permission') || msg.includes('insufficient')) {
        setMessage({ type: 'error', text: 'Sem permissão para salvar as alterações. Verifique seu acesso e tente novamente.' });
      } else {
        setMessage({ type: 'error', text: `Não foi possível salvar: ${err?.message || 'erro desconhecido'}.` });
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-12">
      <header>
        <span className="inline-flex items-center gap-2 px-3 py-1 mb-3 rounded-full bg-slate-900/5 dark:bg-white/5 border border-slate-900/10 dark:border-white/10 text-slate-500 dark:text-neutral-300 text-[10px] font-bold uppercase tracking-widest">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          Sua conta
        </span>
        <h1 className="text-3xl md:text-4xl font-bold text-slate-900 dark:text-white tracking-tighter">Meu Perfil</h1>
        <p className="text-slate-500 dark:text-neutral-400 text-sm mt-2">Gerencie suas informações pessoais e segurança da conta.</p>
      </header>
      {profile?.mustChangePassword && (
        <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200/70 dark:border-amber-900/40 text-amber-900 dark:text-amber-100">
          <p className="text-sm font-bold">Primeiro acesso: é necessário alterar a senha temporária antes de continuar.</p>
          <p className="text-xs mt-1 text-amber-800/80 dark:text-amber-200/70">Use o campo abaixo para criar uma nova senha segura.</p>
        </div>
      )}

      {/* Login órfão: client sem affiliateId e não-especial fica sem painel (o
          roteamento cai no /profile). Antes era um beco sem saída silencioso —
          agora avisa pra o admin vincular o login ao afiliado. */}
      {profile?.role === 'client' && !profile?.affiliateId && !profile?.isSpecial && (
        <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200/70 dark:border-amber-900/40 text-amber-900 dark:text-amber-100">
          <p className="text-sm font-bold">Sua conta ainda não está vinculada a um afiliado.</p>
          <p className="text-xs mt-1 text-amber-800/80 dark:text-amber-200/70">Por isso o painel não abre. Peça ao administrador para vincular seu login ao seu cadastro de afiliado.</p>
        </div>
      )}

      {message && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className={cn(
            "p-4 rounded-2xl flex items-center gap-3 text-sm font-medium shadow-sm border",
            message.type === 'success' ? "bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400 border-emerald-200/70 dark:border-emerald-900/40" : "bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-400 border-red-200/70 dark:border-red-900/40"
          )}
        >
          {message.type === 'success' ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
          {message.text}
        </motion.div>
      )}

      <form onSubmit={handleUpdateProfile} className="space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Avatar Section */}
          <div className="bg-white dark:bg-neutral-900/60 p-6 rounded-3xl border border-slate-200/70 dark:border-neutral-800 shadow-sm flex flex-col items-center h-fit hover:border-slate-300 dark:hover:border-neutral-700 transition-colors">
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-neutral-500 mb-6 w-full text-center">Foto de Perfil</h3>
            <div className="relative group mb-6">
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt="Avatar"
                  className="w-28 h-28 rounded-full object-cover bg-slate-50 dark:bg-neutral-800 border-4 border-white dark:border-neutral-800 shadow-lg"
                />
              ) : (
                <div className="w-28 h-28 rounded-full flex items-center justify-center bg-slate-100 dark:bg-neutral-800 border-4 border-white dark:border-neutral-800 shadow-lg text-3xl font-black text-slate-400 dark:text-neutral-500">
                  {(profile?.name || '?').charAt(0).toUpperCase()}
                </div>
              )}
              {uploading && (
                <div className="absolute inset-0 bg-white/60 dark:bg-neutral-900/60 rounded-full flex items-center justify-center backdrop-blur-[1px]">
                  <Loader2 className="text-amber-500 animate-spin" size={24} />
                </div>
              )}
            </div>

            <div className="w-full">
              <label className="w-full flex flex-col items-center justify-center gap-2 px-4 py-3 bg-slate-50 dark:bg-neutral-800/50 border border-slate-200 dark:border-neutral-700 border-dashed rounded-2xl cursor-pointer hover:bg-amber-50 dark:hover:bg-amber-500/10 hover:border-amber-500/50 transition-all text-slate-500 dark:text-neutral-400 hover:text-amber-600 dark:hover:text-amber-400 shadow-sm hover:shadow-md">
                <Upload size={18} />
                <span className="text-[10px] font-bold uppercase tracking-tight">Alterar Foto</span>
                <input
                  type="file"
                  className="hidden"
                  accept="image/*"
                  onChange={handleFileUpload}
                  disabled={uploading}
                />
              </label>
              <p className="text-[9px] text-center text-slate-400 dark:text-neutral-500 mt-3 font-medium px-2">Suporte para JPG, PNG ou SVG. Recomendado 400x400px.</p>
            </div>
          </div>

          {/* Form Section */}
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white dark:bg-neutral-900/60 p-6 rounded-3xl border border-slate-200/70 dark:border-neutral-800 shadow-sm space-y-6 hover:border-slate-300 dark:hover:border-neutral-700 transition-colors">
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-neutral-500">Dados Pessoais</h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 dark:text-neutral-500 uppercase tracking-widest ml-1">Nome Completo</label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-neutral-400" size={16} />
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                      className="w-full pl-10 pr-3 py-2.5 bg-slate-50 dark:bg-neutral-800/60 border border-slate-200 dark:border-neutral-700 rounded-xl text-xs dark:text-white focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-all outline-none"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 dark:text-neutral-500 uppercase tracking-widest ml-1">E-mail</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-neutral-400" size={16} />
                    <input
                      type="email"
                      value={profile?.email || ''}
                      disabled
                      className="w-full pl-10 pr-3 py-2.5 bg-slate-100 dark:bg-neutral-800/40 border border-transparent dark:border-neutral-800 rounded-xl text-xs text-slate-400 dark:text-neutral-500 cursor-not-allowed"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white dark:bg-neutral-900/60 p-6 rounded-3xl border border-slate-200/70 dark:border-neutral-800 shadow-sm space-y-6 hover:border-slate-300 dark:hover:border-neutral-700 transition-colors">
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-neutral-500">Segurança</h3>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 dark:text-neutral-500 uppercase tracking-widest ml-1">Nova Senha</label>
                <div className="relative max-w-xs">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-neutral-400" size={16} />
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="••••••••"
                    minLength={6}
                    className="w-full pl-10 pr-3 py-2.5 bg-slate-50 dark:bg-neutral-800/60 border border-slate-200 dark:border-neutral-700 rounded-xl text-xs dark:text-white focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-all outline-none"
                  />
                </div>
                <p className="text-[9px] text-slate-400 dark:text-neutral-500 mt-1 italic">Mínimo 6 caracteres para alteração.</p>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="submit"
                disabled={loading}
                className="bg-slate-900 dark:bg-white text-white dark:text-neutral-900 px-6 py-2.5 rounded-full text-xs font-bold hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50 flex items-center gap-2 shadow-sm"
              >
                {loading ? 'Salvando...' : <><Save size={16} /> Salvar Alterações</>}
              </button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
