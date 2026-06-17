import { describe, it, expect } from 'vitest';
import {
  projectPartnerResult,
  projectPartnerResults,
  collectFields,
  findMonetaryFields,
  PARTNER_RESULT_MONETARY_FIELDS,
} from './partnerResults';

describe('projectPartnerResult (parceiro: só contagem, nada de valores)', () => {
  // Linha típica da OTG (groupBy=affiliate) com métricas E valores misturados.
  const otgRow = {
    id: 'aff1',
    affiliate_id: 'aff1',
    label: 'Fulano',
    affiliate_name: 'Fulano',
    registrations: 12,
    first_deposits: 5,
    qualified_cpa: 3,
    // valores monetários — NÃO podem vazar:
    total_commission: 1999.9,
    cpa: 360,
    rvs: 80.5,
    deposit: 5400,
  };

  it('mantém cadastro, depósitos (contagem) e CPA (contagem)', () => {
    const out = projectPartnerResult(otgRow);
    expect(out.registrations).toBe(12);
    expect(out.first_deposits).toBe(5);
    expect(out.qualified_cpa).toBe(3);
  });

  it('mantém identidade/dimensão (não-monetária)', () => {
    const out = projectPartnerResult(otgRow);
    expect(out.affiliate_id).toBe('aff1');
    expect(out.label).toBe('Fulano');
  });

  it('NÃO vaza nenhum valor monetário', () => {
    const out = projectPartnerResult(otgRow);
    expect(out.total_commission).toBeUndefined();
    expect(out.cpa).toBeUndefined();   // `cpa` é R$ (≠ qualified_cpa)
    expect(out.rvs).toBeUndefined();
    expect(out.deposit).toBeUndefined(); // `deposit` é R$ (≠ first_deposits)
  });

  it('whitelist: derruba qualquer campo monetário conhecido OU desconhecido', () => {
    const sneaky = { registrations: 1, ngr: 999, ggr: 888, wager: 777, payout: 666, lucro_oculto: 555 };
    const out = projectPartnerResult(sneaky);
    expect(out).toEqual({ registrations: 1 });
    for (const f of PARTNER_RESULT_MONETARY_FIELDS) expect(out[f]).toBeUndefined();
  });

  it('preserva dimensões de brand/date/campanha conforme o groupBy', () => {
    expect(projectPartnerResult({ id: 'b1', name: 'Superbet', registrations: 4, total_commission: 10 }))
      .toEqual({ id: 'b1', name: 'Superbet', registrations: 4 });
    expect(projectPartnerResult({ date: '2026-06-17', first_deposits: 2, deposit: 300 }))
      .toEqual({ date: '2026-06-17', first_deposits: 2 });
    expect(projectPartnerResult({ campaign_id: 'c1', campaign_name: 'BF', qualified_cpa: 7, cpa: 9 }))
      .toEqual({ campaign_id: 'c1', campaign_name: 'BF', qualified_cpa: 7 });
  });

  it('tolera entradas inválidas', () => {
    expect(projectPartnerResult(null)).toEqual({});
    expect(projectPartnerResult('x')).toEqual({});
    expect(projectPartnerResult([1, 2])).toEqual({});
  });
});

describe('projectPartnerResults (lista)', () => {
  it('projeta cada linha e tolera não-array', () => {
    const rows = [
      { id: 'a', registrations: 1, total_commission: 5 },
      { id: 'b', qualified_cpa: 2, cpa: 50 },
    ];
    expect(projectPartnerResults(rows)).toEqual([
      { id: 'a', registrations: 1 },
      { id: 'b', qualified_cpa: 2 },
    ]);
    expect(projectPartnerResults(null)).toEqual([]);
    expect(projectPartnerResults(undefined)).toEqual([]);
  });
});

describe('collectFields / findMonetaryFields (auditoria do explorer)', () => {
  it('collectFields reúne as chaves distintas, ordenadas', () => {
    const rows = [{ id: 'a', registrations: 1 }, { id: 'b', qualified_cpa: 2 }];
    expect(collectFields(rows)).toEqual(['id', 'qualified_cpa', 'registrations']);
    expect(collectFields(null)).toEqual([]);
  });

  it('findMonetaryFields acusa valores quando (e só quando) existem', () => {
    expect(findMonetaryFields([{ id: 'a', registrations: 1, first_deposits: 2 }])).toEqual([]);
    expect(findMonetaryFields([{ id: 'a', total_commission: 9, deposit: 5 }]).sort()).toEqual(['deposit', 'total_commission']);
  });

  it('a saída projetada NUNCA acusa monetário (não-regressão)', () => {
    const raw = [{ id: 'a', registrations: 1, total_commission: 99, cpa: 9, deposit: 5 }];
    expect(findMonetaryFields(projectPartnerResults(raw))).toEqual([]);
  });
});
