import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { 
  Users, 
  Search, 
  Filter, 
  RefreshCw, 
  ChevronRight,
  AlertCircle,
  Loader2
} from 'lucide-react';
import { fetchAffiliates } from '../services/affiliateService';
import { cn } from '../lib/utils';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';

interface Affiliate {
  id: string;
  name: string;
  email: string;
  status: string;
  brand?: {
    id: string;
    name: string;
  };
  createdAt: string;
}

export default function AffiliatesList() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [affiliates, setAffiliates] = useState<Affiliate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const isAdmin = profile?.role === 'admin';
  const pageTitle = isAdmin ? 'Gestão de Afiliados' : 'Meus Clientes';
  const pageSubTitle = isAdmin 
    ? 'Visualize e gerencie todos os parceiros conectados à rede.' 
    : 'Lista de clientes vinculados à sua conta de afiliado.';

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAffiliates();
      setAffiliates(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar dados da API');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const filteredAffiliates = Array.isArray(affiliates) 
    ? affiliates.filter(item => 
        item.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.id?.toString().includes(searchTerm)
      )
    : [];

  const handleOpenDetails = (affiliate: any) => {
    navigate(`/affiliates/${affiliate.id}`);
  };

  return (
    <div className="space-y-8 pb-12">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-light text-gray-900 dark:text-white flex items-center gap-3">
            <Users size={32} className="text-brand" />
            {pageTitle}
          </h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">{pageSubTitle}</p>
        </div>
        <button 
          onClick={loadData}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 transition-all shadow-sm disabled:opacity-50"
        >
          <RefreshCw size={14} className={cn(loading && "animate-spin")} />
          Atualizar Lista
        </button>
      </header>

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden transition-colors">
        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row gap-4 items-center justify-between">
          <div className="relative w-full sm:max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input 
              type="text" 
              placeholder="Buscar por nome, e-mail ou ID..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-lg text-xs outline-none focus:ring-1 focus:ring-brand transition-all dark:text-white"
            />
          </div>
          <div className="flex items-center gap-2">
            <button className="p-2 text-slate-400 hover:text-brand dark:hover:text-brand transition-colors">
              <Filter size={18} />
            </button>
          </div>
        </div>

        {error ? (
          <div className="p-12 text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-red-50 dark:bg-red-900/20 text-red-500 mb-4">
              <AlertCircle size={24} />
            </div>
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200 mb-2">Erro de Conexão</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs mx-auto mb-6">
              {error}
            </p>
            <button 
              onClick={loadData}
              className="px-6 py-2 bg-brand text-white rounded-lg text-xs font-bold hover:bg-brand/90 transition-all"
            >
              Tentar Novamente
            </button>
          </div>
        ) : loading ? (
          <div className="p-24 flex flex-col items-center justify-center gap-4">
            <Loader2 size={40} className="text-brand animate-spin" />
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest animate-pulse">Sincronizando com a API...</p>
          </div>
        ) : filteredAffiliates.length === 0 ? (
          <div className="p-24 text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-slate-50 dark:bg-slate-800 text-slate-300 dark:text-slate-600 mb-4">
              <Users size={24} />
            </div>
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200 mb-1">Nenhum resultado encontrado</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">Tente ajustar seus filtros de busca.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800 text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-wider">
                  <th className="px-6 py-4">ID</th>
                  <th className="px-6 py-4">Nome / Empresa</th>
                  <th className="px-6 py-4">Contato</th>
                  <th className="px-6 py-4">Marca</th>
                  <th className="px-6 py-4 text-center">Status</th>
                  <th className="px-6 py-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                {filteredAffiliates.map((item: any) => (
                  <tr 
                    key={item.id || item._id || Math.random()} 
                    className="hover:bg-brand/[0.02] dark:hover:bg-white/[0.02] transition-colors group cursor-pointer"
                    onClick={() => handleOpenDetails(item)}
                  >
                    <td className="px-6 py-4 font-mono text-[10px] text-slate-400 group-hover:text-brand transition-colors">
                      #{item.id || item._id || 'N/A'}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col">
                        <span className="font-bold text-slate-800 dark:text-slate-200">
                          {item.name || item.fullName || item.nome || 'Sem Nome'}
                        </span>
                        {(item.brand || item.marca) && (
                          <span className="text-[10px] text-slate-400 dark:text-slate-500">
                            {(item.brand?.name || item.marca?.nome || item.brand || item.marca)}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-slate-500 dark:text-slate-400 font-medium">
                      {item.email || item.contato || 'N/A'}
                    </td>
                    <td className="px-6 py-4">
                      <span className="px-2 py-1 bg-slate-100 dark:bg-slate-800 rounded text-[10px] font-bold text-slate-600 dark:text-slate-400">
                        {item.brand?.name || item.marca?.nome || item.brand || item.marca || '---'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <span className={cn(
                        "inline-flex items-center px-2 py-1 rounded-full text-[9px] font-bold uppercase tracking-wider",
                        (item.status === 'active' || item.status === 'Ativo' || item.status === 1) 
                          ? "bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400" 
                          : "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400"
                      )}>
                        {item.status || 'Pendente'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenDetails(item);
                        }}
                        className="p-2 text-slate-300 hover:text-brand dark:text-slate-600 dark:hover:text-brand transition-all hover:bg-brand/5 dark:hover:bg-brand/20 rounded-lg"
                      >
                        <ChevronRight size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        
        <div className="p-4 bg-slate-50 dark:bg-slate-800/30 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <p className="text-[10px] text-slate-400 font-bold uppercase italic">
            Exibindo {filteredAffiliates.length} de {affiliates.length} registros
          </p>
          <div className="flex gap-2">
            <button className="px-3 py-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded text-[10px] font-bold text-slate-400 disabled:opacity-30" disabled>Anterior</button>
            <button className="px-3 py-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded text-[10px] font-bold text-slate-400 disabled:opacity-30" disabled>Próxima</button>
          </div>
        </div>
      </div>
    </div>
  );
}
