// DEV-ONLY · mock de multi-casa para validar a UI enquanto a OTG não libera os
// dados reais da 2ª casa na nossa x-api-key (hoje só Superbet — ver
// [[boost-external-api-state]]). Injeta afiliados + resultados sintéticos de uma
// casa "SportingBet" CLIENT-SIDE (depois do proxy). DESLIGADO por padrão:
//   liga com  localStorage.setItem('mockMultiHouse','1')  e recarrega,
//   ou com a env  VITE_MOCK_MULTIHOUSE=1.
// Sem o flag, todas as funções retornam o dado real intacto (no-op em prod).

export function mockMultiHouseEnabled(): boolean {
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem('mockMultiHouse') === '1') return true;
  } catch { /* ignore */ }
  try {
    return (import.meta as any)?.env?.VITE_MOCK_MULTIHOUSE === '1';
  } catch {
    return false;
  }
}

// Marca sintética (mesmo shape do brand{id,name} que a API usa p/ Superbet).
const SB_BRAND = { id: 'clsportingbet000001', name: 'SportingBet' };
const CPA_VALUE = 180; // valor de CPA fictício da casa, p/ a "comissão da casa"

// Afiliados sintéticos da SportingBet (produção variada: top, médio, baixo, zerado).
const SB_AFFILIATES = [
  { id: 'sb-001', name: 'JoaoPedroAlmeidaSilva', siteId: '90001', reg: 120, ftd: 64, qcpa: 41, rvs: 80, deposit: 9800 },
  { id: 'sb-002', name: 'MariaFernandaCostaLima', siteId: '90002', reg: 88, ftd: 40, qcpa: 22, rvs: 33, deposit: 5400 },
  { id: 'sb-003', name: 'RafaelSouzaCarvalho', siteId: '90003', reg: 15, ftd: 4, qcpa: 1, rvs: 2, deposit: 600 },
  { id: 'sb-004', name: 'AnaBeatrizRochaMendes', siteId: '90004', reg: 0, ftd: 0, qcpa: 0, rvs: 0, deposit: 0 },
];

const sbResultRow = (a: typeof SB_AFFILIATES[number]) => ({
  id: a.id,
  label: a.name,
  registrations: a.reg,
  first_deposits: a.ftd,
  qualified_cpa: a.qcpa,
  rvs: a.rvs,
  deposit: a.deposit,
  cpa: a.qcpa * CPA_VALUE,
  total_commission: a.qcpa * CPA_VALUE + a.rvs, // comissão da casa (bruta) fictícia
});

// /affiliates → acrescenta os afiliados sintéticos com brand SportingBet.
export function withMockAffiliates<T>(real: T[]): T[] {
  if (!mockMultiHouseEnabled()) return real;
  const mock = SB_AFFILIATES.map((a) => ({ id: a.id, name: a.name, siteId: a.siteId, brand: SB_BRAND })) as unknown as T[];
  return [...(Array.isArray(real) ? real : []), ...mock];
}

// results?groupBy=affiliate → acrescenta uma linha por afiliado SportingBet.
export function withMockResults<T>(real: T[]): T[] {
  if (!mockMultiHouseEnabled()) return real;
  return [...(Array.isArray(real) ? real : []), ...(SB_AFFILIATES.map(sbResultRow) as unknown as T[])];
}

// results?groupBy=brand ESCOPADO a um afiliado (fetchAffiliateResultsByBrand) →
// acrescenta uma 2ª casa (SportingBet) ao breakdown daquele afiliado, pra que a UI
// por casa (BrandBreakdown + editor de comissão por casa B6) acenda em dev mesmo
// com a API real só devolvendo Superbet. Valores DETERMINÍSTICOS derivados do id
// (sem Math.random, que quebraria SSR/resume) — variam por afiliado mas estáveis.
export function withMockAffiliateBrandRows<T>(real: T[], affiliateId: string): T[] {
  if (!mockMultiHouseEnabled()) return real;
  const seed = String(affiliateId)
    .split('')
    .reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) % 997, 7);
  const qcpa = 3 + (seed % 18);          // 3..20
  const rvs = 20 + (seed % 120);         // 20..139
  const row = {
    id: SB_BRAND.id,
    label: SB_BRAND.name,
    registrations: qcpa * 3,
    first_deposits: Math.round(qcpa * 1.5),
    qualified_cpa: qcpa,
    rvs,
    deposit: qcpa * 75,
    cpa: qcpa * CPA_VALUE,
    total_commission: qcpa * CPA_VALUE + rvs,
  } as unknown as T;
  return [...(Array.isArray(real) ? real : []), row];
}

// results?groupBy=brand → acrescenta a linha agregada da casa SportingBet.
export function withMockBrandRows<T>(real: T[]): T[] {
  if (!mockMultiHouseEnabled()) return real;
  const agg = SB_AFFILIATES.reduce(
    (acc, a) => ({
      registrations: acc.registrations + a.reg,
      first_deposits: acc.first_deposits + a.ftd,
      qualified_cpa: acc.qualified_cpa + a.qcpa,
      rvs: acc.rvs + a.rvs,
      deposit: acc.deposit + a.deposit,
    }),
    { registrations: 0, first_deposits: 0, qualified_cpa: 0, rvs: 0, deposit: 0 }
  );
  const row = {
    id: SB_BRAND.id,
    label: SB_BRAND.name,
    ...agg,
    cpa: agg.qualified_cpa * CPA_VALUE,
    total_commission: agg.qualified_cpa * CPA_VALUE + agg.rvs,
  } as unknown as T;
  return [...(Array.isArray(real) ? real : []), row];
}
