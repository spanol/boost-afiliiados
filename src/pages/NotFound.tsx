import React from 'react';
import { Link } from 'react-router-dom';
import { Compass, ArrowLeft } from 'lucide-react';

// 404 client-side: renderizada para qualquer rota não mapeada no SPA.
export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 px-6">
      <div className="w-full max-w-md text-center bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-3xl shadow-sm p-12">
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-brand/10 text-brand text-[10px] font-black uppercase tracking-[0.2em] mb-7">
          <Compass size={14} /> Agência Boost
        </div>
        <div className="text-6xl font-black text-slate-900 dark:text-white tracking-tighter leading-none">404</div>
        <h1 className="mt-4 text-lg font-black text-slate-900 dark:text-white">Página não encontrada</h1>
        <p className="mt-2.5 text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
          O endereço que você tentou acessar não existe ou foi movido.
        </p>
        <Link
          to="/"
          className="inline-flex items-center gap-2 mt-8 px-7 py-3.5 bg-slate-900 dark:bg-brand text-white rounded-2xl font-black text-xs uppercase tracking-[0.15em] hover:opacity-90 transition-all"
        >
          <ArrowLeft size={16} /> Voltar ao início
        </Link>
      </div>
    </div>
  );
}
