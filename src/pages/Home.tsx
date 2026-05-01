import { motion } from 'motion/react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { LayoutDashboard, LogIn, UserPlus } from 'lucide-react';

export default function Home() {
  const { user } = useAuth();

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center space-y-12 max-w-2xl px-6"
      >
        <div className="space-y-4">
          <div className="mx-auto w-16 h-16 bg-brand rounded-2xl flex items-center justify-center text-white text-2xl font-bold shadow-xl shadow-brand/20">AB</div>
          <h1 className="text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl">
            Agência <span className="text-brand">Boost</span>
          </h1>
          <p className="text-slate-500 text-lg font-medium leading-relaxed">
            Plataforma profissional de gestão de afiliados. Alta densidade de dados, performance e resultados.
          </p>
        </div>
        
        <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
          {user ? (
            <Link 
              to="/dashboard" 
              className="w-full sm:w-auto flex items-center justify-center gap-2 px-8 py-4 bg-slate-900 text-white rounded-xl hover:bg-slate-800 transition-all font-bold shadow-lg shadow-slate-200"
            >
              <LayoutDashboard size={20} />
              Acessar Meu Painel
            </Link>
          ) : (
            <>
              <Link 
                to="/login" 
                className="w-full sm:w-auto flex items-center justify-center gap-2 px-8 py-4 bg-white border border-slate-200 text-slate-900 rounded-xl hover:bg-slate-50 transition-all font-bold shadow-sm"
              >
                <LogIn size={20} />
                Entrar no Sistema
              </Link>
              <Link 
                to="/register" 
                className="w-full sm:w-auto flex items-center justify-center gap-2 px-8 py-4 bg-brand text-white rounded-xl hover:bg-slate-800 transition-all font-bold shadow-lg shadow-brand/20"
              >
                <UserPlus size={20} />
                Criar Conta Agora
              </Link>
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}
