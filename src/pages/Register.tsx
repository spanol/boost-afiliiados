import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Link, useNavigate } from 'react-router-dom';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from '../lib/firebase';
import { UserPlus, Mail, Lock, User, AlertCircle, CheckCircle } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { cn } from '../lib/utils';

const boostLogo = `${import.meta.env.BASE_URL}boost-home/logo.svg`;

export default function Register() {
  const { theme } = useTheme();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    
    // Explicit path for logging
    let currentPath = '';
    
    try {
      let user;
      try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        user = userCredential.user;
      } catch (authErr: any) {
        // Se o e-mail já existe, vamos ver se o usuário está logado e tentar criar o perfil
        // Isso ajuda em casos onde o Auth funcionou mas o Firestore falhou anteriormente
        if (authErr.code === 'auth/email-already-in-use') {
          if (auth.currentUser && auth.currentUser.email === email) {
            user = auth.currentUser;
          } else {
            setError('Este e-mail já está cadastrado. Tente fazer login ou use outro.');
            setLoading(false);
            return;
          }
        } else {
          throw authErr;
        }
      }
      
      // Create user profile in Firestore
      const role = email.trim().toLowerCase() === 'goatechbr@gmail.com' ? 'admin' : 'client';
      currentPath = `users/${user.uid}`;
      
      try {
        await setDoc(doc(db, 'users', user.uid), {
          uid: user.uid,
          name: name.trim(),
          email: email.trim().toLowerCase(),
          role,
          avatarUrl: `https://api.dicebear.com/7.x/shapes/svg?seed=${encodeURIComponent(name)}`,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        }, { merge: true });
      } catch (firestoreErr: any) {
        console.error('Firestore creation failed:', firestoreErr);
        setError(`Erro ao salvar perfil: ${firestoreErr.message || 'Verifique as permissões do Firebase.'}`);
        handleFirestoreError(firestoreErr, OperationType.WRITE, currentPath);
        return;
      }

      setSuccess(true);
      // Simulate welcome email
      console.log('E-mail de confirmação e boas vindas enviado para:', email);
      
      setTimeout(() => {
        navigate('/dashboard');
      }, 2000);
    } catch (err: any) {
      if (err.code === 'auth/email-already-in-use') {
        setError('Este e-mail já está em uso.');
      } else {
        setError('Ocorreu um erro ao criar sua conta.');
      }
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className={cn("min-h-screen bg-[#f5f5f5] dark:bg-slate-950 flex items-center justify-center p-4 transition-colors duration-300", theme === 'dark' && 'dark')}>
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white dark:bg-slate-900 p-12 rounded-3xl shadow-sm border border-gray-100 dark:border-slate-800 text-center max-w-sm"
        >
          <div className="flex justify-center mb-6">
            <CheckCircle size={64} className="text-green-500" />
          </div>
          <h2 className="text-2xl font-light text-gray-900 dark:text-white mb-2">Conta Criada!</h2>
          <p className="text-gray-500 dark:text-slate-400 mb-6">Um e-mail de confirmação e boas vindas foi enviado para <b>{email}</b>.</p>
          <p className="text-xs text-gray-400 dark:text-slate-500">Redirecionando para o painel...</p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className={cn("min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-4 transition-colors duration-300", theme === 'dark' && 'dark')}>
      <motion.div 
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white dark:bg-slate-900 p-8 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 w-full max-w-md"
      >
        <div className="text-center mb-8">
          <img
            src={boostLogo}
            alt="Boost"
            className="mx-auto h-[28px] w-auto"
          />
          <p className="text-slate-400 dark:text-slate-500 text-[10px] font-bold uppercase tracking-wider mt-1">Crie sua conta profissional</p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg border border-red-100 dark:border-red-900/30 flex items-center gap-2 text-[11px] font-bold">
            <AlertCircle size={16} />
            {error}
          </div>
        )}

        <form onSubmit={handleRegister} className="space-y-4">
          <div className="space-y-1">
            <label className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500 tracking-wider ml-1">Nome Completo</label>
            <div className="relative">
              <User className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" size={16} />
              <input 
                type="text" 
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="w-full pl-12 pr-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded text-sm dark:text-white focus:ring-1 focus:ring-brand transition-all outline-none"
                placeholder="Seu nome"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500 tracking-wider ml-1">E-mail</label>
            <div className="relative">
              <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" size={16} />
              <input 
                type="email" 
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full pl-12 pr-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded text-sm dark:text-white focus:ring-1 focus:ring-brand transition-all outline-none"
                placeholder="nome@exemplo.com"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500 tracking-wider ml-1">Senha Corporativa</label>
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" size={16} />
              <input 
                type="password" 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                className="w-full pl-12 pr-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded text-sm dark:text-white focus:ring-1 focus:ring-brand transition-all outline-none"
                placeholder="Mínimo 6 caracteres"
              />
            </div>
          </div>

          <button 
            type="submit" 
            disabled={loading}
            className="w-full bg-brand text-white py-4 rounded-xl font-bold hover:bg-slate-800 dark:hover:bg-brand/80 transition-all disabled:opacity-50 mt-4 flex items-center justify-center gap-2 shadow-lg shadow-brand/10 dark:shadow-brand/20"
          >
            {loading ? 'Cadastrando...' : <><UserPlus size={18} /> Criar minha conta</>}
          </button>
        </form>

        <p className="text-center mt-8 text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-tight">
          Já possui acesso? <Link to="/login" className="text-brand hover:underline">Fazer login</Link>
        </p>
      </motion.div>
    </div>
  );
}
