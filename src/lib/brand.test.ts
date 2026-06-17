import { describe, it, expect } from 'vitest';
import { getBrandName, uniqueBrands, ALL_BRANDS, getBrandMeta, getBrandLogo, KNOWN_BRANDS } from './brand';

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

describe('registro de casas (B6 · logo + casa conhecida)', () => {
  it('resolve metadados por brandId', () => {
    expect(getBrandMeta('clsuperbet000001')?.name).toBe('Superbet');
  });

  it('resolve por nome (case-insensitive) e por slug', () => {
    expect(getBrandMeta('superbet')?.slug).toBe('superbet');
    expect(getBrandMeta('SPORTINGBET')?.name).toBe('SportingBet');
    expect(getBrandMeta('sportingbet')?.id).toBe('cmm5dhdqm000e19b58dqc549a');
  });

  it('devolve null p/ casa desconhecida ou entrada vazia', () => {
    expect(getBrandMeta('betano')).toBeNull();
    expect(getBrandMeta('')).toBeNull();
    expect(getBrandMeta(null)).toBeNull();
  });

  it('getBrandLogo devolve o caminho do asset, null se desconhecida', () => {
    expect(getBrandLogo('clsuperbet000001')).toBe('/brands/superbet.png');
    expect(getBrandLogo('Betano')).toBeNull();
  });

  it('toda casa conhecida tem slug, name e logo', () => {
    for (const b of KNOWN_BRANDS) {
      expect(b.slug).toBeTruthy();
      expect(b.name).toBeTruthy();
      expect(b.logo).toMatch(/^\/brands\//);
    }
  });
});
