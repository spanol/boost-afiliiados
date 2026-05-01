import React, { useState } from 'react';
import { motion } from 'motion/react';
import { useAuth } from '../contexts/AuthContext';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { updatePassword } from 'firebase/auth';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { auth, db, storage, handleFirestoreError, OperationType } from '../lib/firebase';
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
    const file = e.target.files?.[0];
    if (!file || !user) return;

    setUploading(true);
    setMessage(null);

    try {
      const storageRef = ref(storage, `avatars/${user.uid}/${Date.now()}_${file.name}`);
      const snapshot = await uploadBytes(storageRef, file);
      const downloadURL = await getDownloadURL(snapshot.ref);
      
      setAvatarUrl(downloadURL);
      
      // Update immediately in Firestore as well for better UX
      await updateDoc(doc(db, 'users', user.uid), {
        avatarUrl: downloadURL,
        updatedAt: serverTimestamp()
      });
      
      setMessage({ type: 'success', text: 'Foto de perfil enviada com sucesso!' });
    } catch (err: any) {
      console.error('Error uploading file:', err);
      setMessage({ type: 'error', text: 'Erro ao enviar imagem. Verifique as dimensões ou permissões.' });
    } finally {
      setUploading(false);
    }
  };

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setLoading(true);
    setMessage(null);

    const currentPath = `users/${user.uid}`;
    try {
      // Update Firestore
      try {
        await updateDoc(doc(db, 'users', user.uid), {
          name: name.trim(),
          avatarUrl,
          updatedAt: serverTimestamp()
        });
      } catch (firestoreErr) {
        handleFirestoreError(firestoreErr, OperationType.UPDATE, currentPath);
      }

      // Update Password if provided
      if (newPassword) {
        await updatePassword(user, newPassword);
      }

      setMessage({ type: 'success', text: 'Perfil atualizado com sucesso!' });
      setNewPassword('');
    } catch (err: any) {
      console.error(err);
      setMessage({ type: 'error', text: 'Erro ao atualizar perfil. Certifique-se de que fez login recentemente.' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-12">
      <header>
        <h1 className="text-3xl font-light text-gray-900">Meu Perfil</h1>
        <p className="text-gray-500 text-sm mt-1">Gerencie suas informações pessoais e segurança da conta.</p>
      </header>

      {message && (
        <motion.div 
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className={cn(
            "p-4 rounded-2xl flex items-center gap-3 text-sm font-medium shadow-sm border",
            message.type === 'success' ? "bg-green-50 text-green-700 border-green-100" : "bg-red-50 text-red-700 border-red-100"
          )}
        >
          {message.type === 'success' ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
          {message.text}
        </motion.div>
      )}

      <form onSubmit={handleUpdateProfile} className="space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Avatar Section */}
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col items-center h-fit">
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-6 w-full text-center">Foto de Perfil</h3>
            <div className="relative group mb-6">
              <img 
                src={avatarUrl} 
                alt="Avatar" 
                className="w-28 h-28 rounded-full object-cover bg-slate-50 border-4 border-white shadow-lg"
              />
              {uploading && (
                <div className="absolute inset-0 bg-white/60 rounded-full flex items-center justify-center backdrop-blur-[1px]">
                  <Loader2 className="text-brand animate-spin" size={24} />
                </div>
              )}
            </div>
            
            <div className="w-full">
              <label className="w-full flex flex-col items-center justify-center gap-2 px-4 py-3 bg-slate-50 border border-slate-200 border-dashed rounded-xl cursor-pointer hover:bg-slate-100 hover:border-brand/30 transition-all text-slate-500 hover:text-brand bg-image-upload">
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
              <p className="text-[9px] text-center text-slate-400 mt-3 font-medium px-2">Suporte para JPG, PNG ou SVG. Recomendado 400x400px.</p>
            </div>
          </div>

          {/* Form Section */}
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-6">
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Dados Pessoais</h3>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase">Nome Completo</label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                    <input 
                      type="text" 
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                      className="w-full pl-10 pr-3 py-2 bg-slate-50 border border-slate-200 rounded text-xs focus:ring-1 focus:ring-brand transition-all outline-none"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase">E-mail</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                    <input 
                      type="email" 
                      value={profile?.email}
                      disabled
                      className="w-full pl-10 pr-3 py-2 bg-slate-100 border border-transparent rounded text-xs text-slate-400 cursor-not-allowed"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-6">
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Segurança</h3>
              
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase">Nova Senha</label>
                <div className="relative max-w-xs">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                  <input 
                    type="password" 
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="••••••••"
                    minLength={6}
                    className="w-full pl-10 pr-3 py-2 bg-slate-50 border border-slate-200 rounded text-xs focus:ring-1 focus:ring-brand transition-all outline-none"
                  />
                </div>
                <p className="text-[9px] text-slate-400 mt-1 italic">Mínimo 6 caracteres para alteração.</p>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button 
                type="submit"
                disabled={loading}
                className="bg-brand text-white px-6 py-2.5 rounded-md text-xs font-bold hover:bg-slate-800 transition-all disabled:opacity-50 flex items-center gap-2 shadow-sm"
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
