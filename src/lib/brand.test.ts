import { describe, it, expect } from 'vitest';
import { getBrandName, uniqueBrands, ALL_BRANDS } from './brand';

describe('getBrandName', () => {
  it('extrai de brand objeto {name} (shape atual da API)', () => {
    expect(getBrandName({ brand: { id: 'x', name: 'Superbet' } })).toBe('Superbet');
  });

  it('extrai de brand string', () => {
    expect(getBrandName({ brand: 'SportingBet' })).toBe('SportingBet');
  });

  it('tolera campos alternativos (marca / brand_name / nome)', () => {
    expect(getBrandName({ marca: 'Betano' })).toBe('Betano');
    expect(getBrandName({ brand_name: 'KTO' })).toBe('KTO');
    expect(getBrandName({ brand: { nome: 'Stake' } })).toBe('Stake');
  });

  it('retorna null quando não há marca', () => {
    expect(getBrandName({})).toBeNull();
    expect(getBrandName(null)).toBeNull();
    expect(getBrandName({ brand: '' })).toBeNull();
  });
});

describe('uniqueBrands', () => {
  it('retorna marcas únicas, ordenadas, ignorando vazios', () => {
    const affs = [
      { brand: { name: 'Superbet' } },
      { brand: 'SportingBet' },
      { brand: { name: 'Superbet' } },
      { brand: null },
      {},
    ];
    expect(uniqueBrands(affs)).toEqual(['SportingBet', 'Superbet']);
  });

  it('retorna [] para entrada não-array / vazia', () => {
    expect(uniqueBrands(null as any)).toEqual([]);
    expect(uniqueBrands([])).toEqual([]);
  });
});

describe('ALL_BRANDS', () => {
  it('é um sentinel estável', () => {
    expect(ALL_BRANDS).toBe('__all__');
  });
});
