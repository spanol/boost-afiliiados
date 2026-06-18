import { describe, it, expect, afterEach } from 'vitest';
import {
  getBrandName, uniqueBrands, ALL_BRANDS, getBrandMeta, getBrandLogo, KNOWN_BRANDS,
  DEFAULT_BRANDS, getKnownBrands, setKnownBrands,
} from './brand';
import { withKnownHouses, withKnownBrandNames } from './knownHouses';

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

  it('toda casa-semente tem slug, name e logo', () => {
    for (const b of KNOWN_BRANDS) {
      expect(b.slug).toBeTruthy();
      expect(b.name).toBeTruthy();
      expect(b.logo).toMatch(/^\/brands\//);
    }
  });
});

describe('registro VIVO de casas (backoffice)', () => {
  // Restaura as sementes após cada teste — o cache é módulo-global.
  afterEach(() => setKnownBrands(DEFAULT_BRANDS));

  it('começa nas sementes (DEFAULT_BRANDS)', () => {
    expect(getKnownBrands().map((b) => b.name)).toEqual(['Superbet', 'SportingBet']);
  });

  it('setKnownBrands substitui o registro e getBrandMeta passa a resolver as novas casas', () => {
    setKnownBrands([
      { id: 'brand_betano', slug: 'betano', name: 'Betano', logo: 'https://x/y.png', active: true },
    ]);
    expect(getBrandMeta('Betano')?.slug).toBe('betano');
    expect(getBrandMeta('brand_betano')?.name).toBe('Betano');
    expect(getBrandLogo('betano')).toBe('https://x/y.png');
    // a casa-semente removida do registro vivo não resolve mais
    expect(getBrandMeta('superbet')).toBeNull();
  });

  it('setKnownBrands ignora entradas sem nome e nunca esvazia (cai nas sementes)', () => {
    setKnownBrands([{ slug: '', name: '', active: true } as any]);
    expect(getKnownBrands().length).toBe(DEFAULT_BRANDS.length);
    setKnownBrands([]);
    expect(getKnownBrands().length).toBe(DEFAULT_BRANDS.length);
  });
});

describe('withKnownHouses / withKnownBrandNames (casas vivas)', () => {
  afterEach(() => setKnownBrands(DEFAULT_BRANDS));

  it('adiciona casas conhecidas faltantes como linhas ZERADAS, sem duplicar as presentes', () => {
    const real = [{ id: 'clsuperbet000001', label: 'Superbet', registrations: 50, total_commission: 999 }];
    const rows = withKnownHouses(real as any) as any[];
    const names = rows.map((r) => r.label).sort();
    expect(names).toEqual(['SportingBet', 'Superbet']);
    const sporting = rows.find((r) => r.label === 'SportingBet');
    expect(sporting.registrations).toBe(0); // casa "acesa e vazia"
    const superbet = rows.find((r) => r.label === 'Superbet');
    expect(superbet.total_commission).toBe(999); // a real não é sobrescrita
  });

  it('casa INATIVA não aparece nas visões por casa', () => {
    setKnownBrands([
      { slug: 'superbet', name: 'Superbet', active: true },
      { slug: 'betano', name: 'Betano', active: false },
    ]);
    const rows = withKnownHouses([] as any) as any[];
    expect(rows.map((r) => r.label)).toEqual(['Superbet']);
    expect(withKnownBrandNames([])).toEqual(['Superbet']);
  });
});
