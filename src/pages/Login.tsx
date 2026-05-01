import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Link, useNavigate } from 'react-router-dom';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { LogIn, Mail, Lock, AlertCircle } from 'lucide-react';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await signInWithEmailAndPassword(auth, email, password);
      navigate('/dashboard');
    } catch (err: any) {
      setError('E-mail ou senha inválidos.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white p-8 rounded-xl shadow-sm border border-slate-200 w-full max-w-md"
      >
        <div className="text-center mb-8">
          <div className="mx-auto w-12 h-12 bg-brand rounded-xl flex items-center justify-center text-white text-xl font-bold mb-4">AB</div>
          <h2 className="text-xl font-bold text-slate-800">Autenticação</h2>
          <p className="text-slate-400 text-xs font-bold uppercase tracking-wider mt-1">Acesse sua área restrita</p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 text-red-600 rounded-lg border border-red-100 flex items-center gap-2 text-[11px] font-bold">
            <AlertCircle size={16} />
            {error}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
          <div className="space-y-1">
            <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider ml-1">E-mail Corporativo</label>
            <div className="relative">
              <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input 
                type="email" 
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full pl-12 pr-4 py-3 bg-slate-50 border border-slate-200 rounded text-sm focus:ring-1 focus:ring-brand transition-all outline-none"
                placeholder="nome@empresa.com"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider ml-1">Senha de Acesso</label>
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input 
                type="password" 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full pl-12 pr-4 py-3 bg-slate-50 border border-slate-200 rounded text-sm focus:ring-1 focus:ring-brand transition-all outline-none"
                placeholder="••••••••"
              />
            </div>
          </div>

          <button 
            type="submit" 
            disabled={loading}
            className="w-full bg-brand text-white py-4 rounded-xl font-bold hover:bg-slate-800 transition-all disabled:opacity-50 mt-4 flex items-center justify-center gap-2 shadow-lg shadow-brand/10"
          >
            {loading ? 'Processando...' : <><LogIn size={18} /> Entrar no sistema</>}
          </button>
        </form>

        <p className="text-center mt-8 text-xs font-bold text-slate-400 uppercase tracking-tight">
          Novo aqui? <Link to="/register" className="text-brand hover:underline">Solicitar cadastro</Link>
        </p>
      </motion.div>
    </div>
  );
}
