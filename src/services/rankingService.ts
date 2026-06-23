import { doc, onSnapshot, Timestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { authFetch } from '../lib/api';
import { toISODate } from '../lib/dateRange';

// Ranking diário: snapshot calculado no servidor (daily_rankings/{data}) e lido por
// qualquer afiliado (leaderboard público com nomes). O admin dispara o cálculo.

export interface RankingEntry {
  pos: number;
  affiliateId: string;
  name: string;
  commission: number;
}

export interface DailyRanking {
  date: string;
  entries: RankingEntry[];
  count: number;
  metric?: string;
  generatedByName?: string;
  generatedAt: Timestamp | null;
}

// Data de "hoje" no fuso local do browser (YYYY-MM-DD), igual aos filtros das dashboards.
export function todayISO(): string {
  return toISODate(new Date());
}

// Realtime do ranking de um dia. Chama onData(null) quando o snapshot ainda não
// foi calculado (doc inexistente).
export function subscribeToDailyRanking(
  date: string,
  onData: (ranking: DailyRanking | null) => void,
  onError?: (error: Error) => void,
) {
  return onSnapshot(
    doc(db, 'daily_rankings', date),
    (snap) => {
      if (!snap.exists()) {
        onData(null);
        return;
      }
      const data = snap.data() as Omit<DailyRanking, 'date'> & { date?: string };
      onData({
        date,
        entries: Array.isArray(data.entries) ? data.entries : [],
        count: data.count ?? (Array.isArray(data.entries) ? data.entries.length : 0),
        metric: data.metric,
        generatedByName: data.generatedByName,
        generatedAt: (data.generatedAt as Timestamp | null) ?? null,
      });
    },
    (error) => onError?.(error),
  );
}

async function readError(res: Response, fallback: string): Promise<never> {
  let message = fallback;
  try {
    const data = await res.json();
    if (data?.error) message = data.error;
  } catch {
    /* corpo não-JSON */
  }
  throw new Error(message);
}

// Admin: (re)calcula e grava o ranking do dia informado (default hoje).
export async function computeDailyRanking(date: string = todayISO()): Promise<{ date: string; count: number }> {
  const res = await authFetch('/api/rankings/compute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date }),
  });
  if (!res.ok) await readError(res, 'Falha ao calcular o ranking.');
  return res.json();
}
