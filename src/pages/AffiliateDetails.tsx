import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router';
import { 
  ArrowLeft, 
  Mail, 
  Phone, 
  Calendar, 
  Globe, 
  TrendingUp, 
  Shield, 
  ExternalLink,
  Loader2,
  AlertCircle,
  Clock,
  User,
  Building,
  Activity
} from 'lucide-react';
import { fetchAffiliateById } from '../services/affiliateService';
import { cn } from '../lib/utils';
import { motion } from 'motion/react';

export default function AffiliateDetails() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [affiliate, setAffiliate] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (id) {
      loadDetails(id);
    }
  }, [id]);

  const loadDetails = async (affId: string) => {
    try {
      setLoading(true);
      const data = await fetchAffiliateById(affId);
      setAffiliate(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar detalhes');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <Loader2 className="w-10 h-10 text-brand animate-spin" />
        <p className="text-slate-500 font-medium">Carregando informações realistas...</p>
      </div>
    );
  }

  if (error || !affiliate) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 text-center">
        <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 text-red-500 rounded-full flex items-center justify-center">
          <AlertCircle size={32} />
        </div>
        <div className="space-y-2">
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">Ops! Algo deu errado</h2>
          <p className="text-slate-500 max-w-md">{error || 'Afiliado não encontrado'}</p>
        </div>
        <button 
          onClick={() => navigate('/affiliates')}
          className="flex items-center gap-2 px-6 py-2 bg-slate-900 dark:bg-slate-800 text-white rounded-xl hover:bg-slate-800 transition-all font-medium"
        >
          <ArrowLeft size={18} /> Voltar para lista
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-20">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          <button 
            onClick={() => navigate('/affiliates')}
            className="p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-500 hover:text-brand transition-all shadow-sm"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight">
                {affiliate.name || 'Sem Nome'}
              </h1>
              <span className={cn(
                "px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider",
                (affiliate.status === 'active' || affiliate.status === 'Ativo' || affiliate.status === 1) 
                  ? "bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400" 
                  : "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400"
              )}>
                {affiliate.status || 'Pendente'}
              </span>
            </div>
            <p className="text-slate-500 font-mono text-xs uppercase tracking-widest mt-1">ID Externo: #{affiliate.id}</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button className="px-6 py-3 bg-brand text-white text-sm font-bold rounded-xl hover:bg-brand/90 shadow-lg shadow-brand/20 transition-all flex items-center gap-2">
            <Mail size={18} /> Enviar Mensagem
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main Info */}
        <div className="lg:col-span-2 space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
             {/* General Data Card */}
             <motion.div 
               initial={{ opacity: 0, y: 20 }}
               animate={{ opacity: 1, y: 0 }}
               className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-100 dark:border-slate-800 shadow-sm space-y-6"
             >
                <h3 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-widest flex items-center gap-2">
                  <User size={16} className="text-brand" /> Dados Básicos
                </h3>
                <div className="space-y-4">
                  <div className="flex justify-between items-center py-2 border-b border-slate-50 dark:border-slate-800">
                    <span className="text-xs text-slate-400 font-medium">Nome</span>
                    <span className="text-sm font-bold text-slate-800 dark:text-slate-200">{affiliate.name || '---'}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b border-slate-50 dark:border-slate-800">
                    <span className="text-xs text-slate-400 font-medium">Email Principal</span>
                    <span className="text-sm font-bold text-slate-800 dark:text-slate-200">{affiliate.email || 'Não informado'}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b border-slate-50 dark:border-slate-800">
                    <span className="text-xs text-slate-400 font-medium">Data de Cadastro</span>
                    <span className="text-sm font-bold text-slate-800 dark:text-slate-200">{affiliate.createdAt ? new Date(affiliate.createdAt).toLocaleDateString('pt-BR') : '---'}</span>
                  </div>
                </div>
             </motion.div>

             {/* Connection Data Card */}
             <motion.div 
               initial={{ opacity: 0, y: 20 }}
               animate={{ opacity: 1, y: 0 }}
               transition={{ delay: 0.1 }}
               className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-100 dark:border-slate-800 shadow-sm space-y-6"
             >
                <h3 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-widest flex items-center gap-2">
                  <Globe size={16} className="text-brand" /> Plataforma
                </h3>
                <div className="space-y-4">
                  <div className="flex justify-between items-center py-2 border-b border-slate-50 dark:border-slate-800">
                    <span className="text-xs text-slate-400 font-medium">ID da Rede</span>
                    <span className="text-sm font-bold text-slate-800 dark:text-slate-200">{affiliate.siteId || '---'}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b border-slate-50 dark:border-slate-800">
                    <span className="text-xs text-slate-400 font-medium">Marca Vinculada</span>
                    <span className="text-sm font-bold text-brand">{affiliate.brand?.name || affiliate.marca?.nome || affiliate.brand || '---'}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b border-slate-50 dark:border-slate-800">
                    <span className="text-xs text-slate-400 font-medium">Status</span>
                    <span className="text-sm font-bold text-slate-800 dark:text-slate-200 capitalize">{affiliate.status || '---'}</span>
                  </div>
                </div>
             </motion.div>
          </div>

          {/* Activity Section */}
          <motion.div 
             initial={{ opacity: 0, y: 20 }}
             animate={{ opacity: 1, y: 0 }}
             transition={{ delay: 0.2 }}
             className="bg-white dark:bg-slate-900 p-8 rounded-3xl border border-slate-100 dark:border-slate-800 shadow-sm"
          >
            <div className="flex items-center justify-between mb-8">
              <h3 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-widest flex items-center gap-2">
                <Activity size={16} className="text-brand" /> Dados Adicionais
              </h3>
            </div>

            <div className="flex flex-col items-center justify-center py-12 text-center bg-slate-50 dark:bg-slate-900/30 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800">
               <div className="w-12 h-12 bg-white dark:bg-slate-800 rounded-full flex items-center justify-center text-slate-300 mb-4 shadow-sm">
                  <Clock size={24} />
               </div>
               <p className="text-sm text-slate-500 font-medium max-w-xs px-6">
                 Histórico de conversões e atividades detalhadas não disponíveis nesta consulta da API.
               </p>
            </div>
          </motion.div>
        </div>

        {/* Sidebar Info */}
        <div className="space-y-8">
           <motion.div 
             initial={{ opacity: 0, scale: 0.95 }}
             animate={{ opacity: 1, scale: 1 }}
             transition={{ delay: 0.3 }}
             className="bg-slate-950 p-8 rounded-3xl text-white relative overflow-hidden group shadow-xl"
           >
              <div className="absolute top-0 right-0 p-8 text-brand/20 group-hover:text-brand/30 transition-colors">
                <TrendingUp size={120} />
              </div>
              <div className="relative z-10 space-y-6">
                <div className="p-3 bg-brand/10 w-fit rounded-2xl text-brand">
                  <Shield size={24} />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Nível de Parceiro</h4>
                  <p className="text-2xl font-black mt-1">Verified Bronze</p>
                </div>
                <div className="pt-4 space-y-3">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Progresso Gold</span>
                    <span className="text-brand font-bold">12%</span>
                  </div>
                  <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                    <div className="h-full bg-brand w-[12%]"></div>
                  </div>
                </div>
              </div>
           </motion.div>

           <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-100 dark:border-slate-800 shadow-sm space-y-6">
              <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Ações Rápidas</h4>
              <div className="grid gap-3">
                <button className="w-full py-3 px-4 bg-slate-50 dark:bg-slate-800/50 hover:bg-brand/5 dark:hover:bg-brand/20 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-bold transition-all flex items-center justify-between group">
                  Sincronizar Dados <ExternalLink size={14} className="text-slate-300 group-hover:text-brand" />
                </button>
                <button className="w-full py-3 px-4 bg-slate-50 dark:bg-slate-800/50 hover:bg-brand/5 dark:hover:bg-brand/20 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-bold transition-all flex items-center justify-between group">
                  Exportar Relatório <ExternalLink size={14} className="text-slate-300 group-hover:text-brand" />
                </button>
                <button className="w-full py-3 px-4 bg-red-50 dark:bg-red-900/10 hover:bg-red-100 dark:hover:bg-red-900/20 text-red-600 dark:text-red-400 rounded-xl text-xs font-bold transition-all flex items-center justify-between group">
                  Bloquear Acesso <Shield size={14} className="text-red-300 group-hover:text-red-500" />
                </button>
              </div>
           </div>
        </div>
      </div>
    </div>
  );
}
