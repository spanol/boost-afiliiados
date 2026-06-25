// Estatísticas do roster de aprovados (OtgRoster): total, contagem por casa e o split
// pending vs reconciled. Extraído do useMemo da página p/ ficar testável (status só é
// 'reconciled' OU pending; qualquer outro/ausente conta como pending).
export interface RosterStatsRow {
  house?: string | null;
  status?: string;
}

export interface RosterStats {
  total: number;
  byHouse: Record<string, number>;
  pending: number;
  reconciled: number;
}

export function computeRosterStats(rows: RosterStatsRow[]): RosterStats {
  const byHouse: Record<string, number> = {};
  let pending = 0;
  let reconciled = 0;
  for (const r of rows) {
    if (r.house) byHouse[r.house] = (byHouse[r.house] || 0) + 1;
    if (r.status === 'reconciled') reconciled++;
    else pending++;
  }
  return { total: rows.length, byHouse, pending, reconciled };
}
