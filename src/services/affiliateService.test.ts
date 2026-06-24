import { describe, it, expect, vi } from 'vitest';

// Isola os helpers de parsing — evita os efeitos colaterais de importar o
// Firebase client (lib/firebase roda um testConnection() no import).
vi.mock('../lib/firebase', () => ({ db: {} }));
vi.mock('../lib/api', () => ({ authFetch: vi.fn() }));

import {
  extractArray,
  extractApiError,
  isNoDataError,
  messageLooksLikeError,
  aggregateByCampaign,
  buildSubToSpecialConfig,
  calcAgencyNetProfit,
  calcNetProfitByHouse,
  calcManualHouseNetProfit,
  resolveBrandRates,
  calcAffiliatePayout,
  calcNetProfit,
} from './affiliateService';
import { StoredManualRow, emptyMetrics, addMetrics } from '../lib/houseResults';

describe('extractArray', () => {
  it('retorna [] para null/undefined', () => {
    expect(extractArray(null)).toEqual([]);
    expect(extractArray(undefined)).toEqual([]);
  });

  it('passa arrays direto', () => {
    expect(extractArray([{ id: 1 }])).toEqual([{ id: 1 }]);
  });

  it('encontra o array em data.data (estrutura aninhada)', () => {
    expect(extractArray({ data: { data: [{ id: 'a' }] } })).toEqual([{ id: 'a' }]);
  });

  it('encontra o array em chaves comuns (affiliates, results)', () => {
    expect(extractArray({ affiliates: [{ id: 1 }] })).toEqual([{ id: 1 }]);
    expect(extractArray({ results: [{ id: 2 }] })).toEqual([{ id: 2 }]);
  });

  it('faz fallback para qualquer array não-vazio aninhado', () => {
    expect(extractArray({ meta: {}, payloadX: [{ id: 9 }] })).toEqual([{ id: 9 }]);
  });

  it('retorna [] quando não há array', () => {
    expect(extractArray({ foo: 'bar', count: 0 })).toEqual([]);
  });
});

describe('isNoDataError', () => {
  it('reconhece o código 040 / 40', () => {
    expect(isNoDataError('040', '')).toBe(true);
    expect(isNoDataError('40', '')).toBe(true);
  });

  it('reconhece mensagens de "sem dados"', () => {
    expect(isNoDataError('', 'Nenhum dado encontrado')).toBe(true);
    expect(isNoDataError('', 'no data available')).toBe(true);
    expect(isNoDataError('', 'not found')).toBe(true);
  });

  it('não trata erro real como no-data', () => {
    expect(isNoDataError('500', 'internal error')).toBe(false);
  });
});

describe('messageLooksLikeError', () => {
  it('detecta palavras de erro', () => {
    expect(messageLooksLikeError('Ocorreu um erro')).toBe(true);
    expect(messageLooksLikeError('unauthorized')).toBe(true);
    expect(messageLooksLikeError('forbidden')).toBe(true);
  });

  it('ignora mensagens neutras', () => {
    expect(messageLooksLikeError('tudo certo')).toBe(false);
    expect(messageLooksLikeError('')).toBe(false);
  });
});

describe('extractApiError', () => {
  it('retorna null para não-objeto', () => {
    expect(extractApiError(null)).toBeNull();
    expect(extractApiError('texto')).toBeNull();
  });

  it('retorna null para payload de sucesso', () => {
    expect(extractApiError({ success: true, data: [{ id: 1 }] })).toBeNull();
  });

  it('marca noData=true para o código 040', () => {
    const err = extractApiError({ code: '040', message: 'Nenhum dado' });
    expect(err).not.toBeNull();
    expect(err?.noData).toBe(true);
  });

  it('marca noData=false para falha explícita real', () => {
    const err = extractApiError({ success: false, code: '500', message: 'erro interno' });
    expect(err).not.toBeNull();
    expect(err?.noData).toBe(false);
    expect(err?.message).toBe('erro interno');
  });

  it('detecta erro por mensagem mesmo sem flag de sucesso', () => {
    const err = extractApiError({ message: 'unauthorized' });
    expect(err).not.toBeNull();
  });
});

describe('aggregateByCampaign', () => {
  it('retorna [] para entrada não-array / vazia', () => {
    expect(aggregateByCampaign(null as any)).toEqual([]);
    expect(aggregateByCampaign([])).toEqual([]);
  });

  it('soma as métricas de linhas da mesma campanha', () => {
    const rows = [
      { campaign_id: 'c1', campaign_name: 'Black Friday', total_commission: 100, registrations: 5, first_deposits: 3, deposit: 250, qualified_cpa: 2, rvs: 40 },
      { campaign_id: 'c1', campaign_name: 'Black Friday', total_commission: 50, registrations: 2, first_deposits: 1, deposit: 100, qualified_cpa: 1, rvs: 10 },
    ];
    const result = aggregateByCampaign(rows);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'c1',
      name: 'Black Friday',
      total_commission: 150,
      registrations: 7,
      first_deposits: 4,
      deposit: 350,
      qualified_cpa: 3,
      rvs: 50,
    });
  });

  it('mantém campanhas distintas separadas e ordena por comissão desc', () => {
    const rows = [
      { campaign_id: 'low', total_commission: 10 },
      { campaign_id: 'high', total_commission: 90 },
      { campaign_id: 'mid', total_commission: 40 },
    ];
    expect(aggregateByCampaign(rows).map((c) => c.id)).toEqual(['high', 'mid', 'low']);
  });

  it('faz fallback entre variações de nome de campo para id/nome', () => {
    const rows = [{ campaign: 'Promo X', total_commission: 5 }];
    const [row] = aggregateByCampaign(rows);
    expect(row.name).toBe('Promo X');
    expect(row.id).toBe('Promo X');
  });

  it('converte campos numéricos ausentes/inválidos para zero', () => {
    const rows = [{ campaign_id: 'c1', total_commission: 'oops', registrations: undefined }];
    const [row] = aggregateByCampaign(rows);
    expect(row.total_commission).toBe(0);
    expect(row.registrations).toBe(0);
  });
});

describe('buildSubToSpecialConfig', () => {
  const specials = {
    sp1: { affiliateId: 'sp1', active: true, subAffiliateIds: ['subA', 'subB'] },
    sp2: { affiliateId: 'sp2', active: false, subAffiliateIds: ['subC'] },
  } as any;
  const configs = {
    sp1: { affiliateId: 'sp1', cpaValue: 200, revPercentage: 10 },
    sp2: { affiliateId: 'sp2', cpaValue: 150, revPercentage: 5 },
  } as any;

  it('mapeia cada sub para a config do especial-pai (só ativos por padrão)', () => {
    const map = buildSubToSpecialConfig(specials, configs);
    expect(map.subA).toEqual(configs.sp1);
    expect(map.subB).toEqual(configs.sp1);
    expect(map.subC).toBeUndefined(); // sp2 inativo
  });

  it('inclui especiais inativos quando activeOnly=false', () => {
    const map = buildSubToSpecialConfig(specials, configs, { activeOnly: false });
    expect(map.subC).toEqual(configs.sp2);
  });

  it('ignora especial sem config de taxa', () => {
    const map = buildSubToSpecialConfig(specials, { sp2: configs.sp2 } as any);
    expect(map.subA).toBeUndefined();
  });
});

describe('resolveBrandRates (B6 · comissão por casa)', () => {
  const config = {
    affiliateId: 'a1',
    cpaValue: 100,
    revPercentage: 10,
    byBrand: {
      sportingbet: { cpaValue: 200, revPercentage: 25 },
    },
  } as any;

  it('sem brandId devolve o default de topo (retrocompat)', () => {
    expect(resolveBrandRates(config)).toEqual({ cpaValue: 100, revPercentage: 10 });
  });

  it('com brandId conhecido devolve o override da casa', () => {
    expect(resolveBrandRates(config, 'sportingbet')).toEqual({ cpaValue: 200, revPercentage: 25 });
  });

  it('com brandId sem override cai no default de topo', () => {
    expect(resolveBrandRates(config, 'superbet')).toEqual({ cpaValue: 100, revPercentage: 10 });
  });

  it('config sem byBrand sempre devolve o default', () => {
    const legacy = { affiliateId: 'a2', cpaValue: 50, revPercentage: 5 } as any;
    expect(resolveBrandRates(legacy, 'sportingbet')).toEqual({ cpaValue: 50, revPercentage: 5 });
  });

  it('campo de override inválido cai no default daquele campo', () => {
    const partial = { affiliateId: 'a3', cpaValue: 80, revPercentage: 8, byBrand: { x: { cpaValue: 'oops', revPercentage: 30 } } } as any;
    expect(resolveBrandRates(partial, 'x')).toEqual({ cpaValue: 80, revPercentage: 30 });
  });

  it('config null/undefined devolve zeros', () => {
    expect(resolveBrandRates(null)).toEqual({ cpaValue: 0, revPercentage: 0 });
    expect(resolveBrandRates(undefined, 'x')).toEqual({ cpaValue: 0, revPercentage: 0 });
  });
});

describe('calcAffiliatePayout / calcNetProfit por casa (B6)', () => {
  const config = {
    affiliateId: 'a1',
    cpaValue: 100,
    revPercentage: 10,
    byBrand: { sportingbet: { cpaValue: 200, revPercentage: 50 } },
  } as any;
  // 2 CPA qualificados + R$1000 de RVS.
  const result = { qualified_cpa: 2, rvs: 1000, total_commission: 900 };

  it('payout sem brandId usa o default (2×100 + 1000×10%)', () => {
    expect(calcAffiliatePayout(result, config)).toBe(2 * 100 + 1000 * 0.1); // 300
  });

  it('payout com brandId usa o override da casa (2×200 + 1000×50%)', () => {
    expect(calcAffiliatePayout(result, config, 'sportingbet')).toBe(2 * 200 + 1000 * 0.5); // 900
  });

  it('payout em casa sem override cai no default', () => {
    expect(calcAffiliatePayout(result, config, 'superbet')).toBe(300);
  });

  it('netProfit desconta o repasse da casa correta', () => {
    expect(calcNetProfit(result, config)).toBe(900 - 300);                 // default
    expect(calcNetProfit(result, config, 'sportingbet')).toBe(900 - 900);  // override
  });
});

describe('calcAgencyNetProfit', () => {
  // Cluster de especial: pai sp1 (R$200/CPA) com 1 sub a R$30/CPA. A agência paga
  // o sub pela taxa do PAI (R$200), não a R$30 → repasse maior, lucro menor.
  const results = [
    { id: 'sp1', total_commission: 1000, qualified_cpa: 2, rvs: 0 },   // pai: repasse 2×200 = 400
    { id: 'subA', total_commission: 500, qualified_cpa: 3, rvs: 0 },   // sub: 3×200 = 600 (não 3×30=90)
    { id: 'x', total_commission: 100, qualified_cpa: 1, rvs: 0 },      // avulso: 1×50 = 50
  ];
  const configs = {
    sp1: { affiliateId: 'sp1', cpaValue: 200, revPercentage: 0 },
    subA: { affiliateId: 'subA', cpaValue: 30, revPercentage: 0 },
    x: { affiliateId: 'x', cpaValue: 50, revPercentage: 0 },
  } as any;

  it('cobra o sub pela taxa do especial-pai (corrige a superestimativa do lucro)', () => {
    const subMap = buildSubToSpecialConfig(
      { sp1: { affiliateId: 'sp1', active: true, subAffiliateIds: ['subA'] } } as any,
      configs
    );
    const r = calcAgencyNetProfit(results, configs, subMap);
    expect(r.commission).toBe(1600);          // 1000+500+100
    expect(r.payout).toBe(400 + 600 + 50);     // sub a R$200, não R$30
    expect(r.netProfit).toBe(1600 - 1050);     // 550
  });

  it('sem mapa de sub, cobra cada um pela própria taxa (sub a R$30)', () => {
    const r = calcAgencyNetProfit(results, configs, {});
    expect(r.payout).toBe(400 + 90 + 50);      // sub a R$30
    expect(r.netProfit).toBe(1600 - 540);      // 1060 (superestimado vs 550)
  });

  it('cada afiliado entra uma vez (sem double-count) e tolera entrada vazia', () => {
    expect(calcAgencyNetProfit([], configs, {})).toEqual({ commission: 0, payout: 0, netProfit: 0 });
    expect(calcAgencyNetProfit(null as any, configs, {}).netProfit).toBe(0);
  });

  it('com houseOf, aplica a taxa POR CASA (byBrand) e bate com a Σ das casas', () => {
    // Replica o caso real: afiliado na SportingBet com topo R$300/CPA mas byBrand
    // SportingBet R$200/CPA (especial superfaturado no topo). Sem houseOf o card de
    // cima usa R$300 (lucro negativo); com houseOf usa R$200 e bate com os cards.
    const res = [{ id: 'y', total_commission: 1000, qualified_cpa: 5, rvs: 0 }];
    const cfgs = {
      y: { affiliateId: 'y', cpaValue: 300, revPercentage: 0, byBrand: { sb: { cpaValue: 200, revPercentage: 0 } } },
    } as any;
    const houseOf = (id: string) => (id === 'y' ? { key: 'SportingBet', brandId: 'sb' } : null);

    // Sem houseOf: taxa de topo (R$300) → repasse 5×300 = 1500 (lucro −500).
    expect(calcAgencyNetProfit(res, cfgs).payout).toBe(1500);
    expect(calcAgencyNetProfit(res, cfgs).netProfit).toBe(1000 - 1500);

    // Com houseOf: taxa por casa (R$200) → repasse 5×200 = 1000 (lucro 0)...
    const withHouse = calcAgencyNetProfit(res, cfgs, {}, houseOf);
    expect(withHouse.payout).toBe(1000);
    expect(withHouse.netProfit).toBe(0);

    // ...e isso bate EXATAMENTE com a Σ dos cards por casa.
    const byHouse = calcNetProfitByHouse(res, houseOf, cfgs);
    const sumNet = Object.values(byHouse).reduce((s, h) => s + h.netProfit, 0);
    expect(withHouse.netProfit).toBe(sumNet);
  });

  it('com houseOf, casa desconhecida cai na taxa de topo (não derruba o afiliado)', () => {
    const res = [{ id: 'z', total_commission: 100, qualified_cpa: 1, rvs: 0 }];
    const cfgs = { z: { affiliateId: 'z', cpaValue: 50, revPercentage: 0 } } as any;
    const r = calcAgencyNetProfit(res, cfgs, {}, () => null); // ninguém tem casa conhecida
    expect(r.payout).toBe(50);     // taxa de topo, afiliado contabilizado (≠ calcNetProfitByHouse, que o ignora)
    expect(r.netProfit).toBe(50);
  });
});

describe('calcNetProfitByHouse (B1 · lucro por casa, cruzando afiliado×casa)', () => {
  // 3 afiliados em 2 casas. Repasse = Σ por afiliado da casa (taxa dele × métricas
  // dele NAQUELA casa) — não derivado do agregado de marca.
  const results = [
    { id: 'a1', total_commission: 1000, qualified_cpa: 2, rvs: 0 }, // Superbet
    { id: 'a2', total_commission: 600, qualified_cpa: 3, rvs: 0 },  // Superbet
    { id: 'b1', total_commission: 400, qualified_cpa: 1, rvs: 0 },  // SportingBet
  ];
  const configs = {
    a1: { affiliateId: 'a1', cpaValue: 100, revPercentage: 0 },
    a2: { affiliateId: 'a2', cpaValue: 50, revPercentage: 0 },
    b1: { affiliateId: 'b1', cpaValue: 80, revPercentage: 0 },
  } as any;
  // a1 → casa "super" (brandId sb1); a2 → "super"; b1 → "sport" (brandId sp1).
  const houseOf = (id: string) =>
    ({
      a1: { key: 'Superbet', brandId: 'sb1' },
      a2: { key: 'Superbet', brandId: 'sb1' },
      b1: { key: 'SportingBet', brandId: 'sp1' },
    } as any)[id] ?? null;

  it('particiona comissão e repasse por casa (taxa de cada afiliado)', () => {
    const np = calcNetProfitByHouse(results, houseOf, configs);
    // Superbet: comissão 1600; repasse a1 2×100 + a2 3×50 = 200+150 = 350; lucro 1250.
    expect(np.Superbet).toEqual({ commission: 1600, payout: 350, netProfit: 1250 });
    // SportingBet: comissão 400; repasse 1×80 = 80; lucro 320.
    expect(np.SportingBet).toEqual({ commission: 400, payout: 80, netProfit: 320 });
  });

  it('aplica o override por casa (byBrand) via o brandId real da casa', () => {
    const withOverride = {
      ...configs,
      a1: { affiliateId: 'a1', cpaValue: 100, revPercentage: 0, byBrand: { sb1: { cpaValue: 250, revPercentage: 0 } } },
    } as any;
    const np = calcNetProfitByHouse(results, houseOf, withOverride);
    // a1 passa a 2×250 = 500 (em vez de 200); Superbet repasse 500+150 = 650; lucro 950.
    expect(np.Superbet.payout).toBe(650);
    expect(np.Superbet.netProfit).toBe(1600 - 650);
  });

  it('cobra o sub pela taxa do especial-pai (subToSpecialConfig)', () => {
    // b1 vira sub de um especial que paga 200/CPA → repasse 1×200 = 200 (não 80).
    const subMap = { b1: { affiliateId: 'sp', cpaValue: 200, revPercentage: 0 } } as any;
    const np = calcNetProfitByHouse(results, houseOf, configs, subMap);
    expect(np.SportingBet.payout).toBe(200);
    expect(np.SportingBet.netProfit).toBe(200); // 400 − 200
  });

  it('invariante: Σ das casas == calcAgencyNetProfit (sem overrides)', () => {
    const np = calcNetProfitByHouse(results, houseOf, configs);
    const agg = calcAgencyNetProfit(results, configs);
    const sum = Object.values(np).reduce(
      (acc, h) => ({ commission: acc.commission + h.commission, payout: acc.payout + h.payout, netProfit: acc.netProfit + h.netProfit }),
      { commission: 0, payout: 0, netProfit: 0 }
    );
    expect(sum).toEqual({ commission: agg.commission, payout: agg.payout, netProfit: agg.netProfit });
  });

  it('ignora afiliado sem casa conhecida e tolera entrada vazia', () => {
    const withOrphan = [...results, { id: 'ghost', total_commission: 999, qualified_cpa: 5, rvs: 0 }];
    const np = calcNetProfitByHouse(withOrphan, houseOf, configs);
    expect(np.Superbet.commission).toBe(1600); // ghost não entrou em nenhuma casa
    expect(Object.keys(np).sort()).toEqual(['SportingBet', 'Superbet']);
    expect(calcNetProfitByHouse([], houseOf, configs)).toEqual({});
    expect(calcNetProfitByHouse(null as any, houseOf, configs)).toEqual({});
  });
});

describe('calcManualHouseNetProfit (Fase 2 · lucro por casa manual)', () => {
  const row = (houseSlug: string, affiliateId: string | null, m: Partial<ReturnType<typeof emptyMetrics>>): StoredManualRow =>
    ({ houseSlug, date: '2026-06-01', affiliateId, ...addMetrics(emptyMetrics(), m) });
  // 'betano' não está nas casas-semente → nameOf/brandKey caem no slug.
  const configs = {
    '123': { affiliateId: '123', cpaValue: 100, revPercentage: 10 },
    '456': { affiliateId: '456', cpaValue: 50, revPercentage: 0 },
  } as any;

  it('comissão = agregado (inclui não-atribuído); repasse = Σ atribuídos', () => {
    const rows = [
      row('betano', null, { total_commission: 1000, registrations: 100 }),     // agregado
      row('betano', '123', { qualified_cpa: 2, rvs: 1000, total_commission: 400 }),
      row('betano', '456', { qualified_cpa: 1, rvs: 0, total_commission: 300 }),
    ];
    const np = calcManualHouseNetProfit(rows, configs);
    // comissão = 1000 (agregado, não 1000+400+300)
    // repasse = (2×100 + 1000×0.10) + (1×50 + 0) = 300 + 50 = 350
    expect(np.betano).toEqual({ commission: 1000, payout: 350, netProfit: 650 });
  });

  it('sem linha agregada, comissão = soma das atribuídas', () => {
    const rows = [row('kto', '123', { qualified_cpa: 1, total_commission: 200 })];
    const np = calcManualHouseNetProfit(rows, configs);
    expect(np.kto.commission).toBe(200);
    expect(np.kto.payout).toBe(1 * 100 + 0); // 100
    expect(np.kto.netProfit).toBe(100);
  });

  it('aplica a regra do especial-pai (subToSpecialConfig) no repasse do sub', () => {
    const rows = [row('betano', '456', { qualified_cpa: 1, total_commission: 300 })];
    const subMap = { '456': { affiliateId: 'sp', cpaValue: 200, revPercentage: 0 } } as any;
    const np = calcManualHouseNetProfit(rows, configs, subMap);
    expect(np.betano.payout).toBe(200); // taxa do pai (200), não a do sub (50)
  });

  it('tolera entrada vazia', () => {
    expect(calcManualHouseNetProfit([], configs)).toEqual({});
  });
});
