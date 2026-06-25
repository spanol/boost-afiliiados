import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion } from 'motion/react';
import { Trophy, Crown, Loader2, RefreshCw, Medal } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { cn, humanizeName } from '../lib/utils';
import { formatRangeLabel, resolveRankingDate } from '../lib/dateRange';
import {
  DailyRanking,
  RankingEntry,
  subscribeToDailyRanking,
  computeDailyRanking,
  todayISO,
} from '../services/rankingService';

const formatBRL = (v: number) =>
  `R$ ${(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const PODIUM = [
  { ring: 'ring-amber-400', bg: 'bg-amber-500/10', text: 'text-amber-500', icon: Crown },
  { ring: 'ring-slate-300', bg: 'bg-slate-400/10', text: 'text-slate-400', icon: Medal },
  { ring: 'ring-orange-400', bg: 'bg-orange-500/10', text: 'text-orange-500', icon: Medal },
];

export default function Ranking() {
  const { profile } = useAuth();
  const { push } = useToast();
  const isAdmin = profile?.role === 'admin';
  // Dia exibido: hoje por padrão; admin pode inspecionar/recalcular outro via ?date=YYYY-MM-DD.
  const [searchParams] = useSearchParams();
  const dateParam = searchParams.get('date');
  const today = resolveRankingDate(dateParam, todayISO());

  const [ranking, setRanking] = useState<DailyRanking | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [computing, setComputing] = useState(false);

  useEffect(() => {
    setLoading(true);
    const unsubscribe = subscribeToDailyRanking(
      today,
      (data) => {
        setRanking(data);
        setLoading(false);
      },
      (err) => {
        console.error('Erro ao carregar ranking:', err);
        setError('Não foi possível carregar o ranking no momento.');
        setLoading(false);
      },
    );
    return () => unsubscribe();
  }, [today]);

  const handleCompute = async () => {
    setComputing(true);
    try {
      const { count } = await computeDailyRanking(today);
      push({ type: 'success', message: `Ranking atualizado (${count} afiliado${count === 1 ? '' : 's'}).` });
    } catch (err) {
      push({ type: 'error', message: err instanceof Error ? err.message : 'Falha ao calcular o ranking.' });
    } finally {
      setComputing(false);
    }
  };

  const entries = ranking?.entries ?? [];
  const podium = entries.slice(0, 3);
  const rest = entries.slice(3);

  // Posição do próprio afiliado (se estiver no ranking).
  const myEntry = useMemo(
    () => (profile?.affiliateId ? entries.find((e) => e.affiliateId === String(profile.affiliateId)) : undefined),
    [entries, profile?.affiliateId],
  );

  const generatedLabel = ranking?.generatedAt
    ? new Date(ranking.generatedAt.toDate()).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
    : null;

  return (
    <div className="space-y-8 pb-20">
      <header className="flex flex-col md:flex-row md:items-start justify-between gap-4">
        <div>
          <span className="inline-flex items-center gap-2 px-3 py-1 mb-3 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-[10px] font-bold uppercase tracking-widest">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
            Gamificação · {formatRangeLabel({ startDate: today, endDate: today })}
          </span>
          <h1 className="text-3xl md:text-4xl font-bold text-slate-900 dark:text-white tracking-tighter flex items-center gap-3">
            <span className="p-2 rounded-xl bg-slate-50 dark:bg-neutral-800/60 border border-slate-100 dark:border-neutral-700/60">
              <Trophy size={24} className="text-amber-500" />
            </span>
            Ranking diário
          </h1>
          <p className="text-slate-500 dark:text-neutral-400 text-sm mt-2">
            Os maiores geradores de comissão do dia.{generatedLabel ? ` Atualizado às ${generatedLabel}.` : ''}
          </p>
        </div>
        {isAdmin && (
          <button
            onClick={handleCompute}
            disabled={computing}
            className="flex items-center gap-2 px-4 py-2.5 bg-slate-900 dark:bg-white text-white dark:text-neutral-900 rounded-full text-xs font-bold hover:opacity-90 transition-all shadow-sm self-start shrink-0 disabled:opacity-50"
          >
            {computing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            {ranking ? 'Atualizar ranking' : 'Gerar ranking de hoje'}
          </button>
        )}
      </header>

      {/* Faixa com a posição do próprio afiliado */}
      {myEntry && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-5 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="flex items-center justify-center w-10 h-10 rounded-full bg-amber-500 text-white font-black text-sm shadow">#{myEntry.pos}</span>
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-amber-600 dark:text-amber-400">Sua posição hoje</p>
              <p className="text-sm font-bold text-slate-900 dark:text-white">{humanizeName(myEntry.name)}</p>
            </div>
          </div>
          <span className="text-base font-black text-slate-900 dark:text-white">{formatBRL(myEntry.commission)}</span>
        </div>
      )}

      {loading ? (
        <div className="p-24 flex flex-col items-center justify-center gap-4">
          <Loader2 size={40} className="text-amber-500 animate-spin" />
          <p className="text-xs font-bold text-slate-400 dark:text-neutral-500 uppercase tracking-widest animate-pulse">Carregando...</p>
        </div>
      ) : error ? (
        <div className="py-20 text-center text-red-500">{error}</div>
      ) : !ranking || entries.length === 0 ? (
        <div className="bg-white dark:bg-neutral-900/60 border border-slate-200/70 dark:border-neutral-800 rounded-3xl shadow-sm p-20 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl border border-slate-100 dark:border-neutral-700 bg-slate-50 dark:bg-neutral-800 text-amber-500 mb-4">
            <Trophy size={24} />
          </div>
          <h3 className="text-sm font-bold text-slate-800 dark:text-neutral-100 mb-1">
            {ranking ? 'Sem comissão registrada neste dia (ainda)' : 'Ranking ainda não calculado para este dia'}
          </h3>
          <p className="text-xs text-slate-500 dark:text-neutral-400">
            {ranking
              ? 'A OTG atualiza os resultados entre 13h–14h. Atualize mais tarde para ver o ranking do dia.'
              : isAdmin
                ? 'Clique em "Gerar ranking de hoje" para calcular a partir dos resultados do dia.'
                : 'Aguarde o ciclo de atualização — a Boost calcula a partir dos resultados do dia.'}
          </p>
        </div>
      ) : (
        <>
          {/* Pódio Top 3 */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {podium.map((entry, i) => {
              const style = PODIUM[i];
              const Icon = style.icon;
              const isMe = profile?.affiliateId && entry.affiliateId === String(profile.affiliateId);
              return (
                <motion.div
                  key={entry.affiliateId}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.06 }}
                  className={cn(
                    'relative p-6 rounded-3xl border bg-white dark:bg-neutral-900/60 shadow-sm flex flex-col items-center text-center ring-1',
                    style.ring,
                    isMe ? 'border-amber-500/50' : 'border-slate-200/70 dark:border-neutral-800',
                  )}
                >
                  <span className={cn('inline-flex items-center justify-center w-12 h-12 rounded-2xl mb-3', style.bg, style.text)}>
                    <Icon size={24} />
                  </span>
                  <span className={cn('text-[11px] font-black uppercase tracking-widest mb-1', style.text)}>{entry.pos}º lugar</span>
                  <p className="text-sm font-bold text-slate-900 dark:text-white leading-tight">{humanizeName(entry.name)}</p>
                  <p className="text-lg font-black text-slate-900 dark:text-white mt-2">{formatBRL(entry.commission)}</p>
                </motion.div>
              );
            })}
          </div>

          {/* Restante da lista */}
          {rest.length > 0 && (
            <div className="bg-white dark:bg-neutral-900/60 border border-slate-200/70 dark:border-neutral-800 rounded-3xl shadow-sm overflow-hidden divide-y divide-slate-100 dark:divide-neutral-800">
              {rest.map((entry: RankingEntry) => {
                const isMe = profile?.affiliateId && entry.affiliateId === String(profile.affiliateId);
                return (
                  <div
                    key={entry.affiliateId}
                    className={cn(
                      'flex items-center gap-4 px-5 py-3.5 transition-colors',
                      isMe ? 'bg-amber-500/10' : 'hover:bg-slate-50/70 dark:hover:bg-white/[0.03]',
                    )}
                  >
                    <span className="w-8 text-center text-sm font-black text-slate-400 dark:text-neutral-500">{entry.pos}</span>
                    <span className="flex-1 min-w-0 text-sm font-semibold text-slate-800 dark:text-neutral-100 truncate">
                      {humanizeName(entry.name)}
                      {isMe && <span className="ml-2 text-[10px] font-bold uppercase tracking-widest text-amber-600 dark:text-amber-400">você</span>}
                    </span>
                    <span className="text-sm font-bold text-slate-900 dark:text-white">{formatBRL(entry.commission)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
