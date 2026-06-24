// Cálculo PURO do leaderboard diário (ranking de comissão). Vive em lib (sem
// Firebase) p/ o server.ts reusar e ser testável. Antes o server.ts reimplementava
// a fórmula inline com SÓ a taxa de topo (cpaValue/revPercentage), ignorando o
// override por casa (byBrand) e divergindo dos dashboards (R2). Agora usa o MESMO
// calcAffiliatePayout, aplicando a taxa por casa quando o brandId do afiliado é
// conhecido (resolvido pelo caller a partir do mirror `affiliates`).
import { AffiliateConfig, calcAffiliatePayout } from './commission';

export interface RankingEntry {
  pos: number;
  affiliateId: string;
  name: string;
  commission: number;
}

export interface RankingOpts {
  // brandId do afiliado → aplica a taxa POR CASA (byBrand) dele. Sem ele, taxa de topo.
  brandIdOf?: (affiliateId: string) => string | undefined;
  nameById?: Record<string, string>;
  limit?: number; // top N (default 100)
}

export function computeRankingEntries(
  rows: any[],
  configById: Record<string, AffiliateConfig | undefined>,
  opts: RankingOpts = {}
): RankingEntry[] {
  const { brandIdOf, nameById = {}, limit = 100 } = opts;
  return (Array.isArray(rows) ? rows : [])
    .map((r) => {
      const affiliateId = String(r?.affiliate_id ?? r?.id ?? '').trim();
      if (!affiliateId) return null;
      // Mesma fórmula/repasse dos dashboards: taxa por casa (byBrand) quando conhecida.
      const commission = calcAffiliatePayout(r, configById[affiliateId], brandIdOf?.(affiliateId));
      const name =
        nameById[affiliateId] ||
        String(r?.name ?? r?.label ?? r?.affiliate_name ?? `Afiliado #${affiliateId}`);
      return { affiliateId, name, commission: Math.round(commission * 100) / 100 };
    })
    .filter((e): e is { affiliateId: string; name: string; commission: number } => !!e && e.commission > 0)
    .sort((a, b) => b.commission - a.commission)
    .slice(0, limit)
    .map((e, i) => ({ pos: i + 1, ...e }));
}
