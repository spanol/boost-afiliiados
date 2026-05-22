import { motion } from 'motion/react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { 
  LayoutDashboard, 
  LogIn, 
  UserPlus, 
  ChevronRight, 
  Activity, 
  Shield, 
  Zap, 
  TrendingUp,
  BarChart3
} from 'lucide-react';

export default function Home() {
  const { user } = useAuth();

  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 flex flex-col transition-colors duration-300">
      {/* Navigation */}
      <nav className="w-full max-w-7xl mx-auto px-6 py-6 flex justify-between items-center relative z-20">
        <motion.div 
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="flex items-center gap-2"
        >
          <div className="w-8 h-8 bg-brand rounded-lg flex items-center justify-center">
            <TrendingUp className="text-white" size={18} />
          </div>
          <span className="text-xl font-black text-slate-900 dark:text-white tracking-tighter">
            PREVIMARKET
          </span>
        </motion.div>
        
        <motion.div 
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          className="flex items-center gap-4"
        >
          {user ? (
            <Link 
              to="/dashboard" 
              className="px-5 py-2.5 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-lg font-bold text-sm hover:scale-[1.02] transition-transform shadow-lg shadow-slate-200 dark:shadow-white/5"
            >
              Dashboard
            </Link>
          ) : (
            <>
              <Link 
                to="/login" 
                className="px-5 py-2.5 text-slate-600 dark:text-slate-400 font-bold text-sm hover:text-slate-900 dark:hover:text-white transition-colors"
              >
                Log In
              </Link>
              <Link 
                to="/register" 
                className="px-5 py-2.5 bg-brand text-white rounded-lg font-bold text-sm hover:scale-[1.02] transition-transform shadow-lg shadow-brand/20"
              >
                Join Now
              </Link>
            </>
          )}
        </motion.div>
      </nav>

      {/* Hero Section */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 relative overflow-hidden pt-12 pb-24">
        {/* Background Gradients */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] opacity-10 dark:opacity-20 pointer-events-none">
          <div className="absolute inset-0 bg-radial from-brand/40 to-transparent blur-3xl"></div>
        </div>

        <motion.div 
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="text-center space-y-8 max-w-4xl relative z-10"
        >
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">
            <Activity size={12} className="text-brand" />
            <span className="animate-pulse">Live Predictive Market Analysis</span>
          </div>

          <h1 className="text-6xl sm:text-8xl font-black tracking-tighter leading-[0.9] text-slate-900 dark:text-white">
            MAO DE OBRA <br />
            <span className="text-brand">BASEADA EM DADOS</span>
          </h1>

          <p className="max-w-2xl mx-auto text-slate-500 dark:text-slate-400 text-lg sm:text-xl font-medium leading-relaxed">
            A PREVIMARKET combina inteligência preditiva e gestão profissional de afiliados para maximizar suas conversões em tempo real.
          </p>
          
          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center pt-4">
            {user ? (
              <Link 
                to="/dashboard" 
                className="w-full sm:w-auto h-16 flex items-center justify-center gap-3 px-12 bg-brand text-white rounded-2xl hover:scale-[1.02] active:scale-[0.98] transition-all font-black shadow-2xl shadow-brand/20 group"
              >
                <LayoutDashboard size={20} />
                ACESSAR MEU PAINEL
                <ChevronRight size={20} className="group-hover:translate-x-1 transition-transform" />
              </Link>
            ) : (
              <Link 
                to="/register" 
                className="w-full sm:w-auto h-16 flex items-center justify-center gap-3 px-12 bg-brand text-white rounded-2xl hover:scale-[1.02] active:scale-[0.98] transition-all font-black shadow-2xl shadow-brand/20 group"
              >
                <Zap size={20} className="fill-white" />
                COMEÇAR AGORA
                <ChevronRight size={20} className="group-hover:translate-x-1 transition-transform" />
              </Link>
            )}
          </div>
        </motion.div>

        {/* Global Market Simulation Visual */}
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1, delay: 0.4 }}
          className="mt-20 w-full max-w-5xl relative aspect-video rounded-[3rem] border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-[0_0_100px_-20px_rgba(20,28,42,0.1)] overflow-hidden hidden sm:block"
        >
          {/* Simulated Dashboard UI */}
          <div className="absolute inset-0 bg-gradient-to-br from-slate-50 to-white dark:from-slate-900 dark:to-slate-950 flex flex-col p-8">
             <div className="flex justify-between items-center mb-8">
                <div className="flex gap-4">
                   <div className="w-12 h-3 bg-slate-200 dark:bg-slate-800 rounded-full"></div>
                   <div className="w-20 h-3 bg-slate-100 dark:bg-slate-800 rounded-full"></div>
                </div>
                <div className="w-10 h-10 bg-slate-50 dark:bg-slate-800 rounded-full"></div>
             </div>
             <div className="flex-1 grid grid-cols-12 gap-6">
                <div className="col-span-8 flex flex-col gap-6">
                   <div className="flex-1 bg-slate-50 dark:bg-slate-800/50 rounded-3xl relative overflow-hidden">
                      <div className="absolute inset-0 flex items-end px-4 gap-1">
                         {[40, 70, 45, 90, 65, 80, 50, 100, 85, 95].map((h, idx) => (
                           <div key={idx} className="flex-1 bg-brand/10 dark:bg-brand/20 rounded-t-lg transition-all" style={{ height: `${h}%` }}></div>
                         ))}
                      </div>
                      <div className="absolute top-6 left-6 space-y-1">
                        <div className="w-32 h-4 bg-slate-200 dark:bg-slate-700/50 rounded-full"></div>
                        <div className="w-20 h-2 bg-slate-100 dark:bg-slate-700/30 rounded-full"></div>
                      </div>
                   </div>
                </div>
                <div className="col-span-4 flex flex-col gap-6">
                   <div className="flex-1 bg-slate-50 dark:bg-slate-800/50 rounded-3xl p-6 space-y-4">
                      {[1, 2, 3].map(i => (
                        <div key={i} className="flex items-center gap-3">
                           <div className="w-8 h-8 rounded-xl bg-white dark:bg-slate-800 shadow-sm"></div>
                           <div className="space-y-1.5">
                              <div className="w-24 h-2 bg-slate-200 dark:bg-slate-700 rounded-full"></div>
                              <div className="w-16 h-1 bg-slate-100 dark:bg-slate-700/50 rounded-full"></div>
                           </div>
                        </div>
                      ))}
                   </div>
                   <div className="h-32 bg-brand rounded-3xl p-6 flex flex-col justify-between">
                      <div className="w-8 h-8 rounded-lg bg-white/20"></div>
                      <div className="w-20 h-3 bg-white/40 rounded-full"></div>
                   </div>
                </div>
             </div>
          </div>
          <div className="absolute inset-0 bg-gradient-to-t from-white dark:from-slate-950 via-transparent to-transparent"></div>
        </motion.div>

        {/* Feature Grid - Minimal High Tech */}
        <motion.div 
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2 }}
          className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-6xl mt-24 w-full"
        >
          {[
            { icon: Shield, title: "Segurança Total", desc: "Infraestrutura robusta e dados criptografados para sua rede." },
            { icon: BarChart3, title: "Análise Preditiva", desc: "Antecipe tendências e ajuste suas campanhas antes da concorrência." },
            { icon: Zap, title: "Performance Instantânea", desc: "Relatórios real-time com latência zero para decisões rápidas." }
          ].map((feature, i) => (
            <div key={i} className="bg-slate-50 dark:bg-slate-900/50 p-8 rounded-[2.5rem] border border-slate-100 dark:border-slate-800 hover:border-brand/30 transition-colors group">
              <div className="w-12 h-12 bg-white dark:bg-slate-800 rounded-2xl flex items-center justify-center mb-6 shadow-sm group-hover:scale-110 transition-transform">
                <feature.icon className="text-brand" size={24} />
              </div>
              <h3 className="text-xl font-black text-slate-900 dark:text-white mb-2 tracking-tight">{feature.title}</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed font-medium">
                {feature.desc}
              </p>
            </div>
          ))}
        </motion.div>
      </main>

      {/* Footer */}
      <footer className="w-full max-w-7xl mx-auto px-6 py-12 border-t border-slate-100 dark:border-slate-900 flex flex-col sm:flex-row justify-between items-center gap-6 opacity-60">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 bg-slate-200 dark:bg-slate-800 rounded flex items-center justify-center">
            <TrendingUp size={14} className="text-slate-500" />
          </div>
          <span className="text-sm font-black tracking-widest">PREVIMARKET</span>
        </div>
        <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
          © 2024 PreviMarket Professional Predictive Ecosystem
        </div>
      </footer>
    </div>
  );
}
