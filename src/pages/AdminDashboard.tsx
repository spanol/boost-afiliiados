import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { 
  Users, 
  DollarSign, 
  BarChart3, 
  ArrowUpRight, 
  ArrowDownRight,
  UserPlus,
  Zap,
  Globe,
  Loader2
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { cn } from '../lib/utils';
import { fetchAffiliates } from '../services/affiliateService';

export default function AdminDashboard() {
  const { profile } = useAuth();
  const [affiliatesCount, setAffiliatesCount] = useState<string | number>('---');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function getStats() {
      try {
        const affiliates = await fetchAffiliates();
        setAffiliatesCount(affiliates.length);
      } catch (err) {
        console.error('Error fetching dashboard stats:', err);
      } finally {
        setLoading(false);
      }
    }
    getStats();
  }, []);

  const metrics = [
    { label: 'Total de Afiliados', value: affiliatesCount.toString(), trend: +12, icon: Users, color: 'brand' },
    { label: 'Conversões Hoje', value: '0', trend: 0, icon: BarChart3, color: 'green' },
    { label: 'Ganhos Acumulados', value: 'R$ 0,00', trend: 0, icon: DollarSign, color: 'purple' },
    { label: 'Novos Cadastros', value: affiliatesCount.toString(), trend: +affiliatesCount === 0 ? 0 : 100, icon: UserPlus, color: 'orange' },
  ];

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-light text-gray-900 dark:text-white">Dashboard Administrativo</h1>
        <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">Bem-vindo de volta, {profile?.name}. Aqui estão os números de hoje.</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {metrics.map((metric, idx) => (
          <motion.div
            key={idx}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.05 }}
            className={cn(
              "p-5 rounded-xl border shadow-sm transition-all relative overflow-hidden",
              idx === 0 
                ? "bg-gradient-to-br from-brand/90 to-brand text-white border-transparent" 
                : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800"
            )}
          >
            {loading && idx < 1 ? (
              <div className="flex items-center justify-center h-20">
                <Loader2 className="animate-spin" />
              </div>
            ) : (
              <>
                <div className="flex justify-between items-start mb-4">
                  <div className={cn(
                    "p-2 rounded-lg",
                    idx === 0 ? "bg-white/10" : {
                      'bg-brand/10': metric.color === 'brand',
                      'bg-green-100': metric.color === 'green',
                      'bg-purple-100': metric.color === 'purple',
                      'bg-orange-100': metric.color === 'orange'
                    }
                  )}>
                    <metric.icon size={20} className={cn(
                      idx === 0 ? "text-white" : {
                        'text-brand': metric.color === 'brand',
                        'text-green-600': metric.color === 'green',
                        'text-purple-600': metric.color === 'purple',
                        'text-orange-600': metric.color === 'orange'
                      }
                    )} />
                  </div>
                </div>
                
                <div>
                  <p className={cn(
                    "text-[10px] uppercase font-bold tracking-wider mb-1",
                    idx === 0 ? "text-white/70" : "text-slate-500 dark:text-slate-400"
                  )}>
                    {metric.label}
                  </p>
                  <h3 className="text-2xl font-bold dark:text-white">{metric.value}</h3>
                </div>
              </>
            )}
          </motion.div>
        ))}
      </div>

      {/* Connection Status Section */}
      <section className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-green-100 dark:bg-green-900/30 text-green-600 rounded-xl flex items-center justify-center">
              <Zap size={24} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">API de Captura de Dados</h3>
              <p className="text-xs text-slate-500 font-medium">Status operacional: Todos os sistemas estão online e sincronizados.</p>
            </div>
          </div>
          <div className="flex items-center gap-2 px-4 py-2 bg-slate-50 dark:bg-slate-800 rounded-lg">
            <Globe size={16} className="text-brand" />
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Latência: 124ms</span>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl flex flex-col shadow-sm">
          <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center">
            <h3 className="font-bold text-xs text-slate-800 dark:text-slate-200 uppercase tracking-tight">Atividade do Sistema</h3>
            <button className="text-[10px] text-brand font-bold uppercase tracking-wider hover:underline">Ver tudo</button>
          </div>
          <div className="flex-1 overflow-auto max-h-[400px]">
            <table className="w-full text-left">
              <thead className="bg-slate-50 dark:bg-slate-800 text-[10px] text-slate-400 uppercase tracking-wider sticky top-0">
                <tr>
                  <th className="px-6 py-3 font-bold">Evento</th>
                  <th className="px-6 py-3 font-bold">Status</th>
                  <th className="px-6 py-3 font-bold">Horário</th>
                </tr>
              </thead>
              <tbody className="text-xs divide-y divide-slate-50 dark:divide-slate-800">
                {[
                  { name: 'Marco Antonio', status: 'Ativo', time: 'Hoje, 10:45', color: 'bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400', initial: 'MA' },
                  { name: 'Lucas Barbosa', status: 'Pendente', time: 'Ontem, 16:20', color: 'bg-brand/10 dark:bg-brand/20 text-brand dark:text-brand', initial: 'LB' },
                  { name: 'Sara Rocha', status: 'Ativo', time: '12/10, 09:12', color: 'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400', initial: 'SR' },
                  { name: 'Julio Cesar', status: 'Ativo', time: '12/10, 08:30', color: 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400', initial: 'JC' },
                ].map((row, i) => (
                  <tr key={i} className="hover:bg-brand/[0.03] dark:hover:bg-white/[0.03] transition-all cursor-default">
                    <td className="px-6 py-4 flex items-center gap-3">
                      <div className={cn("w-7 h-7 rounded-full flex items-center justify-center font-bold text-[10px]", row.color)}>
                        {row.initial}
                      </div>
                      <span className="font-medium text-slate-700 dark:text-slate-300">{row.name}</span>
                    </td>
                    <td className="px-6 py-4">
                      <span className={cn(
                        "px-2 py-0.5 rounded-full text-[10px] font-bold",
                        row.status === 'Ativo' ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400" : "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400"
                      )}>
                        {row.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-slate-400 dark:text-slate-500 font-medium">{row.time}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-6 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm space-y-6">
          <h3 className="font-bold text-xs text-slate-800 dark:text-slate-200 uppercase tracking-tight">Metas de Desempenho</h3>
          <div className="space-y-6">
            {[
              { label: 'Novos Afiliados', value: 75 },
              { label: 'Volume de Vendas', value: 42 },
              { label: 'Retenção de Clientes', value: 91 },
            ].map((meta, i) => (
              <div key={i}>
                <div className="flex justify-between text-[11px] mb-2 font-bold uppercase tracking-tight">
                  <span className="text-slate-500 dark:text-slate-400">{meta.label}</span>
                  <span className="text-slate-900 dark:text-white">{meta.value}%</span>
                </div>
                <div className="h-2 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-brand rounded-full transition-all duration-1000" 
                    style={{ width: `${meta.value}%` }} 
                  />
                </div>
              </div>
            ))}
          </div>
          
          <div className="pt-4 mt-4 border-t border-slate-50 dark:border-slate-800 text-[10px] text-slate-400 italic">
            * Dados atualizados automaticamente a cada 5 minutos.
          </div>
        </div>
      </div>
    </div>
  );
}

function clsx(...classes: any[]) {
  return classes.filter(Boolean).join(' ');
}
