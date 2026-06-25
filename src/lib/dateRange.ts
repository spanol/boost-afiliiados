// Centraliza a lógica de intervalo de datas usada pelos filtros das dashboards (B2).
// Todas as datas trafegam como 'YYYY-MM-DD' (formato esperado pela API externa /results).

export interface DateRange {
  startDate: string;
  endDate: string;
}

export type DateRangePresetId =
  | 'today'
  | 'yesterday'
  | 'last7'
  | 'last30'
  | 'thisMonth'
  | 'lastMonth'
  | 'custom';

// Formata uma Date no fuso LOCAL como 'YYYY-MM-DD'.
// Evita o off-by-one que toISOString() causa (ele converte para UTC antes).
export function toISODate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Valida o ?date do /ranking: o regex /^\d{4}-\d{2}-\d{2}$/ só checava o FORMATO, então
// uma data impossível (ex.: 2026-13-40 ou 2026-02-30) passava e o servidor montava o
// ranking de um dia inexistente. Aqui validamos a SEMÂNTICA: mês 1-12, dia 1-31 e um
// round-trip por Date UTC (que normaliza fora-de-faixa) — se não bater, cai no fallback.
export function resolveRankingDate(param: string | null | undefined, fallback: string): string {
  if (!param) return fallback;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(param);
  if (!match) return fallback;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > 31) return fallback;
  const dt = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() + 1 !== m || dt.getUTCDate() !== d) {
    return fallback;
  }
  return param;
}

// Calcula o intervalo de um preset. 'custom' não tem intervalo próprio
// (o usuário define manualmente), então retorna o mês atual como base.
export function getPresetRange(preset: DateRangePresetId, now: Date = new Date()): DateRange {
  const today = toISODate(now);

  switch (preset) {
    case 'today':
      return { startDate: today, endDate: today };
    case 'yesterday': {
      const d = new Date(now);
      d.setDate(d.getDate() - 1);
      const iso = toISODate(d);
      return { startDate: iso, endDate: iso };
    }
    case 'last7': {
      const start = new Date(now);
      start.setDate(start.getDate() - 6); // inclui hoje => 7 dias
      return { startDate: toISODate(start), endDate: today };
    }
    case 'last30': {
      const start = new Date(now);
      start.setDate(start.getDate() - 29);
      return { startDate: toISODate(start), endDate: today };
    }
    case 'thisMonth': {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      return { startDate: toISODate(start), endDate: today };
    }
    case 'lastMonth': {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0); // dia 0 = último dia do mês anterior
      return { startDate: toISODate(start), endDate: toISODate(end) };
    }
    case 'custom':
    default:
      return getPresetRange('thisMonth', now);
  }
}

export const DATE_RANGE_PRESETS: Array<{ id: DateRangePresetId; label: string }> = [
  { id: 'today', label: 'Hoje' },
  { id: 'yesterday', label: 'Ontem' },
  { id: 'last7', label: 'Últimos 7 dias' },
  { id: 'last30', label: 'Últimos 30 dias' },
  { id: 'thisMonth', label: 'Mês atual' },
  { id: 'lastMonth', label: 'Mês passado' },
  { id: 'custom', label: 'Personalizado' },
];

// Intervalo padrão ao abrir as dashboards: mês atual (decisão de produto, B2).
export function getDefaultRange(now: Date = new Date()): DateRange {
  return getPresetRange('thisMonth', now);
}

// Calcula o intervalo imediatamente anterior, de MESMA duração, para comparação
// período-a-período (ex.: crescimento de cadastros vs. período anterior).
// Ex.: 01–30/05 (30 dias) → 01–30/04. Datas em 'YYYY-MM-DD', fuso local.
export function getPreviousRange(range: DateRange): DateRange {
  const parse = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d);
  };
  const start = parse(range.startDate);
  const end = parse(range.endDate);
  // Duração inclusiva em dias.
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  const prevEnd = new Date(start);
  prevEnd.setDate(prevEnd.getDate() - 1);
  const prevStart = new Date(prevEnd);
  prevStart.setDate(prevStart.getDate() - (days - 1));
  return { startDate: toISODate(prevStart), endDate: toISODate(prevEnd) };
}

// Variação percentual entre dois valores. Retorna null quando não há base de
// comparação (anterior = 0) — evita exibir "+∞%" ou crescimento enganoso.
export function percentChange(current: number, previous: number): number | null {
  if (!previous) return null;
  return ((current - previous) / previous) * 100;
}

// Rótulo curto e legível (pt-BR) para o intervalo selecionado.
export function formatRangeLabel(range: DateRange): string {
  const fmt = (iso: string) => {
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  };
  if (range.startDate === range.endDate) return fmt(range.startDate);
  return `${fmt(range.startDate)} – ${fmt(range.endDate)}`;
}

// Descobre qual preset corresponde a um intervalo (ou 'custom' se nenhum bater).
export function matchPreset(range: DateRange, now: Date = new Date()): DateRangePresetId {
  for (const { id } of DATE_RANGE_PRESETS) {
    if (id === 'custom') continue;
    const r = getPresetRange(id, now);
    if (r.startDate === range.startDate && r.endDate === range.endDate) {
      return id;
    }
  }
  return 'custom';
}
