import { describe, it, expect } from 'vitest';
import { canViewAffiliateNetProfit } from './affiliateView';

// Gate do card "Lucro líquido do afiliado" (AffiliateDetails). É o GANHO do próprio
// afiliado — NUNCA a margem da agência. Regras: admin vê de qualquer um; o ESPECIAL vê
// de qualquer sub (id ≠ o próprio); o afiliado vendo a PRÓPRIA página não vê o card.
// [[boost-net-profit-rule]]
describe('canViewAffiliateNetProfit', () => {
  it('admin SEMPRE vê — inclusive na própria página (id igual)', () => {
    expect(
      canViewAffiliateNetProfit({
        isAdmin: true,
        isSpecial: false,
        viewedAffiliateId: '42',
        ownAffiliateId: '42',
      }),
    ).toBe(true);
  });

  it('admin vê mesmo sem ownAffiliateId (master sem id de afiliado)', () => {
    expect(
      canViewAffiliateNetProfit({
        isAdmin: true,
        isSpecial: false,
        viewedAffiliateId: '7',
        ownAffiliateId: null,
      }),
    ).toBe(true);
  });

  it('admin tem precedência sobre tudo (isSpecial ignorado, id igual)', () => {
    expect(
      canViewAffiliateNetProfit({
        isAdmin: true,
        isSpecial: true,
        viewedAffiliateId: '1',
        ownAffiliateId: '1',
      }),
    ).toBe(true);
  });

  it('especial vê o lucro de uma SUB da rede (viewedId ≠ ownId)', () => {
    expect(
      canViewAffiliateNetProfit({
        isAdmin: false,
        isSpecial: true,
        viewedAffiliateId: '99',
        ownAffiliateId: '42',
      }),
    ).toBe(true);
  });

  it('especial NÃO vê na PRÓPRIA página (viewedId === ownId)', () => {
    expect(
      canViewAffiliateNetProfit({
        isAdmin: false,
        isSpecial: true,
        viewedAffiliateId: '42',
        ownAffiliateId: '42',
      }),
    ).toBe(false);
  });

  it('não-admin não-especial nunca vê (mesmo olhando outro afiliado)', () => {
    expect(
      canViewAffiliateNetProfit({
        isAdmin: false,
        isSpecial: false,
        viewedAffiliateId: '99',
        ownAffiliateId: '42',
      }),
    ).toBe(false);
  });

  it('não-admin não-especial não vê nem na própria página', () => {
    expect(
      canViewAffiliateNetProfit({
        isAdmin: false,
        isSpecial: false,
        viewedAffiliateId: '42',
        ownAffiliateId: '42',
      }),
    ).toBe(false);
  });

  it('coerção de id: number vs string nos DOIS lados conta como o mesmo afiliado (especial não vê a própria)', () => {
    expect(
      canViewAffiliateNetProfit({
        isAdmin: false,
        isSpecial: true,
        viewedAffiliateId: 42 as unknown as string,
        ownAffiliateId: '42',
      }),
    ).toBe(false);
    expect(
      canViewAffiliateNetProfit({
        isAdmin: false,
        isSpecial: true,
        viewedAffiliateId: '42',
        ownAffiliateId: 42 as unknown as string,
      }),
    ).toBe(false);
    expect(
      canViewAffiliateNetProfit({
        isAdmin: false,
        isSpecial: true,
        viewedAffiliateId: 42 as unknown as string,
        ownAffiliateId: 42 as unknown as string,
      }),
    ).toBe(false);
  });

  it('coerção de id: number vs string DIFERENTES contam como sub (especial vê)', () => {
    expect(
      canViewAffiliateNetProfit({
        isAdmin: false,
        isSpecial: true,
        viewedAffiliateId: 99 as unknown as string,
        ownAffiliateId: '42',
      }),
    ).toBe(true);
  });

  it('ownAffiliateId ausente (undefined/null) → especial vê qualquer id não-vazio', () => {
    expect(
      canViewAffiliateNetProfit({
        isAdmin: false,
        isSpecial: true,
        viewedAffiliateId: '42',
        ownAffiliateId: null,
      }),
    ).toBe(true);
    expect(
      canViewAffiliateNetProfit({
        isAdmin: false,
        isSpecial: true,
        viewedAffiliateId: '42',
      }),
    ).toBe(true);
  });
});
