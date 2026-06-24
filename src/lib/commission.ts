// Núcleo PURO de comissão/taxa — SEM dependência de Firebase, p/ ser importável
// tanto pelo client (services/pages) quanto pelo server.ts. Antes estas funções
// viviam em affiliateService.ts (que importa o Firebase client no topo), então o
// servidor não conseguia reusá-las e o ranking reimplementava a fórmula à mão,
// divergindo dos dashboards (R2). affiliateService re-exporta tudo daqui, então os
// call-sites antigos (`from '../services/affiliateService'`) seguem funcionando.

// B6 · comissão por casa. Par de taxas (CPA em R$, REV em %) — o mesmo shape do
// nível de topo da config, mas por marca.
export interface BrandRates {
  cpaValue: number;
  revPercentage: number;
}

export interface AffiliateConfig {
  affiliateId: string;
  // Taxas de TOPO = o default do afiliado (casa única / fallback). Retrocompat
  // total: configs antigas só têm estes campos e seguem funcionando.
  cpaValue: number;
  revPercentage: number;
  // B6 · override de comissão POR CASA (afiliado × casa). Chaveado por brandId.
  // Quando uma casa não tem override aqui, usa o CPA/REV de topo. Dev-gated na UI:
  // o editor por casa só aparece quando há ≥2 casas (hoje, com a mock multi-casa).
  byBrand?: Record<string, BrandRates>;
  updatedAt?: any;
}

// Coage valor não-finito (string não-numérica da API externa, null) p/ 0 — ANTES de
// multiplicar, p/ nunca propagar NaN aos totais de dinheiro.
export const num = (v: any): number => (Number.isFinite(Number(v)) ? Number(v) : 0);

// Resolve as taxas efetivas de um afiliado para uma casa: usa o override de
// `byBrand[brandId]` quando existe, senão cai no CPA/REV de topo (o default).
// Sem `brandId` (ou sem `byBrand`) devolve o default — é o caminho retrocompat
// usado por todos os call-sites antigos que não conhecem casa.
export function resolveBrandRates(config?: AffiliateConfig | null, brandId?: string): BrandRates {
  const fallback: BrandRates = {
    cpaValue: Number(config?.cpaValue) || 0,
    revPercentage: Number(config?.revPercentage) || 0,
  };
  if (!brandId || !config?.byBrand) return fallback;
  const o = config.byBrand[brandId];
  if (!o) return fallback;
  return {
    cpaValue: Number.isFinite(Number(o.cpaValue)) ? Number(o.cpaValue) : fallback.cpaValue,
    revPercentage: Number.isFinite(Number(o.revPercentage)) ? Number(o.revPercentage) : fallback.revPercentage,
  };
}

// Distingue "configurado como 0" de "ainda não configurado": um 0 cru é uma taxa
// real; a AUSÊNCIA (sem cpaValue de topo e sem override por casa) NÃO deve virar
// "R$0/CPA" enganoso no display. `brandId` informado → considera o override da casa
// OU o topo; sem `brandId` (visão "Todas as casas") → só o topo. Fonte ÚNICA da
// regra a0dc467, consumida por AffiliateDetails e ClientDashboard.
export function rateStatus(
  config?: AffiliateConfig | null,
  brandId?: string
): { cpaConfigured: boolean; revConfigured: boolean } {
  const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  const override = brandId && config?.byBrand ? config.byBrand[brandId] : undefined;
  return {
    cpaConfigured: isNum(override?.cpaValue) || isNum(config?.cpaValue),
    revConfigured: isNum(override?.revPercentage) || isNum(config?.revPercentage),
  };
}

// Repasse devido ao afiliado para um result: CPA qualificado × valor de CPA + REV ×
// (percentual / 100). `brandId` opcional → usa a taxa POR CASA (byBrand) do afiliado;
// sem ele, a taxa de topo (retrocompat). num() impede NaN de métrica string.
export function calcAffiliatePayout(result: any, config?: AffiliateConfig | null, brandId?: string): number {
  const { cpaValue, revPercentage } = resolveBrandRates(config, brandId);
  const cpa = num(result?.qualified_cpa) * cpaValue;
  const rev = num(result?.rvs) * (revPercentage / 100);
  return cpa + rev;
}

// Lucro líquido da agência para um result: comissão da casa − repasse ao afiliado.
export function calcNetProfit(result: any, config?: AffiliateConfig | null, brandId?: string): number {
  const houseCommission = num(result?.total_commission);
  return houseCommission - calcAffiliatePayout(result, config, brandId);
}
