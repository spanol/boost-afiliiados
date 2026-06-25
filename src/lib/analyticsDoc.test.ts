import { describe, it, expect } from 'vitest';
import {
  analyticsDocId,
  funnelKey,
  sanitizeFunnel,
  hasFunnelActivity,
  resolveFunnelAffiliateId,
  sumFunnelForAffiliate,
  ANALYTICS_METRICS,
} from './analyticsDoc';

describe('analyticsDocId / funnelKey · determinístico e normalizado', () => {
  it('id = nameKey__casa, ambos normalizados (idempotente p/ refresh)', () => {
    expect(analyticsDocId('LucasGuimaraes', 'SportingBet')).toBe('lucasguimaraes__sportingbet');
    // mesmo afiliado×casa com caixa/acentos diferentes → MESMO id
    expect(analyticsDocId('Lucas Guimarães', 'sportingbet')).toBe(analyticsDocId('lucasguimaraes', 'SPORTINGBET'));
  });

  it('funnelKey usa "|" e a mesma normalização da reconciliação de pending', () => {
    expect(funnelKey('LucasGuimaraes', 'SportingBet')).toBe('lucasguimaraes|sportingbet');
  });

  it('sanitiza "/" no id (proibido em doc id do Firestore)', () => {
    expect(analyticsDocId('a/b', 'c/d')).not.toContain('/');
  });
});

describe('sanitizeFunnel · coage as 7 métricas (num guarda lixo)', () => {
  it('só as 7 métricas, número, sem campos extras', () => {
    const out = sanitizeFunnel({ clicks: '20', registrations: 4, ngr: 'abc', affiliate: 'X', extra: 9 });
    expect(Object.keys(out).sort()).toEqual([...ANALYTICS_METRICS].sort());
    expect(out.clicks).toBe(20);
    expect(out.registrations).toBe(4);
    expect(out.ngr).toBe(0); // string não-numérica → 0
    expect((out as any).affiliate).toBeUndefined();
  });

  it('hasFunnelActivity = clique OU cadastro > 0 (caso Lucas: true mesmo sem comissão)', () => {
    expect(hasFunnelActivity({ clicks: 20, registrations: 4, ftd: 0, ngr: 0 })).toBe(true);
    expect(hasFunnelActivity({ clicks: 0, registrations: 0 })).toBe(false);
    expect(hasFunnelActivity({ clicks: 1 })).toBe(true);
  });
});

describe('resolveFunnelAffiliateId · real > pending > null', () => {
  const lookup = {
    realByKey: new Map([['helder|sportingbet', 'AFF-REAL-1']]),
    pendingByKey: new Map([['lucasguimaraes|sportingbet', 'pending_lucasguimaraes_sportingbet']]),
  };

  it('afiliado que produz → id real, funnelOnly=false', () => {
    expect(resolveFunnelAffiliateId({ nameKey: 'helder', house: 'sportingbet' }, lookup)).toEqual({
      affiliateId: 'AFF-REAL-1',
      funnelOnly: false,
    });
  });

  it('Lucas (só-funil, mas existe pending) → id sintético, funnelOnly=true', () => {
    expect(resolveFunnelAffiliateId({ nameKey: 'lucasguimaraes', house: 'sportingbet' }, lookup)).toEqual({
      affiliateId: 'pending_lucasguimaraes_sportingbet',
      funnelOnly: true,
    });
  });

  it('afiliado só-funil desconhecido → null, funnelOnly=true', () => {
    expect(resolveFunnelAffiliateId({ nameKey: 'novato', house: 'superbet' }, lookup)).toEqual({
      affiliateId: null,
      funnelOnly: true,
    });
  });
});

describe('sumFunnelForAffiliate · agrega o funil de um afiliado (id OU nameKey)', () => {
  const rows = [
    { affiliateId: 'AFF-1', nameKey: 'joao', house: 'sportingbet', funnelOnly: false, clicks: 10, registrations: 3, ftd: 1, cpaQual: 1, deposits: 0, betAmount: 0, ngr: 5 },
    { affiliateId: 'AFF-1', nameKey: 'joao', house: 'superbet', funnelOnly: false, clicks: 4, registrations: 1, ftd: 0, cpaQual: 0, deposits: 0, betAmount: 0, ngr: 0 },
    { affiliateId: 'pending_lucasguimaraes_sportingbet', nameKey: 'lucasguimaraes', house: 'sportingbet', funnelOnly: true, clicks: 20, registrations: 4, ftd: 0, cpaQual: 0, deposits: 0, betAmount: 0, ngr: 0 },
  ];

  it('casa por affiliateId e soma todas as casas', () => {
    const t = sumFunnelForAffiliate(rows, { affiliateId: 'AFF-1' });
    expect(t.matched).toBe(2);
    expect(t.clicks).toBe(14);
    expect(t.registrations).toBe(4);
    expect(t.funnelOnly).toBe(false);
  });

  it('Lucas: casa por nameKey (só-funil) → funnelOnly=true', () => {
    const t = sumFunnelForAffiliate(rows, { affiliateId: 'pending_lucasguimaraes_sportingbet', nameKey: 'Lucas Guimarães' });
    expect(t.matched).toBe(1);
    expect(t.clicks).toBe(20);
    expect(t.registrations).toBe(4);
    expect(t.funnelOnly).toBe(true);
  });

  it('sem casamento → matched 0, tudo zero, funnelOnly false', () => {
    const t = sumFunnelForAffiliate(rows, { affiliateId: 'NOPE', nameKey: 'ninguem' });
    expect(t.matched).toBe(0);
    expect(t.clicks).toBe(0);
    expect(t.funnelOnly).toBe(false);
  });
});
