import { describe, it, expect, vi, beforeEach } from 'vitest';
import { authFetch } from '../lib/api';
import { setKnownBrands } from '../lib/brand';
import {
  houseToBrandMeta,
  syncKnownBrandsFrom,
  fetchHouses,
  createHouse,
  updateHouse,
  deleteHouse,
  importHouseResults,
  fetchHouseResults,
  clearHouseResults,
  type House,
} from './houseService';

// houseService NÃO importa firebase/firestore: ele só fala com o backend via
// authFetch e atualiza o registro de marcas via setKnownBrands. Mockamos apenas
// `../lib/api` (authFetch) e `../lib/brand` (setKnownBrands). Os tipos de
// `../lib/houseResults` são só de compilação — não precisam de mock.
vi.mock('../lib/api', () => ({ authFetch: vi.fn() }));
vi.mock('../lib/brand', () => ({ setKnownBrands: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
});

// Helper p/ montar uma House completa, sobrescrevendo o que o caso precisar.
const makeHouse = (over: Partial<House> = {}): House => ({
  id: 'superbet',
  slug: 'superbet',
  name: 'Superbet',
  brandId: 'clsuperbet000001',
  logo: '/brands/superbet.png',
  registerUrlTemplate: 'https://superbet.com/?ref={ref}',
  active: true,
  order: 1,
  dataSource: 'otg',
  ...over,
});

// =============================================================================
// houseToBrandMeta — House (backend) → BrandMeta (helpers de marca)
// =============================================================================
describe('houseToBrandMeta', () => {
  it('mapeia os campos preservando dataSource/order/active/slug/name', () => {
    const meta = houseToBrandMeta(makeHouse());
    expect(meta).toEqual({
      id: 'clsuperbet000001',
      slug: 'superbet',
      name: 'Superbet',
      logo: '/brands/superbet.png',
      registerUrlTemplate: 'https://superbet.com/?ref={ref}',
      active: true,
      order: 1,
      dataSource: 'otg',
    });
  });

  it('brandId null → id undefined', () => {
    const meta = houseToBrandMeta(makeHouse({ brandId: null }));
    expect(meta.id).toBeUndefined();
  });

  it('logo null → logo undefined', () => {
    const meta = houseToBrandMeta(makeHouse({ logo: null }));
    expect(meta.logo).toBeUndefined();
  });

  it('registerUrlTemplate null é PRESERVADO (não vira undefined)', () => {
    const meta = houseToBrandMeta(makeHouse({ registerUrlTemplate: null }));
    expect(meta.registerUrlTemplate).toBeNull();
  });
});

// =============================================================================
// syncKnownBrandsFrom — ordena (order asc, depois nome pt-BR) e seta o registro
// =============================================================================
describe('syncKnownBrandsFrom', () => {
  it('ordena por order asc e depois por nome (pt-BR) e chama setKnownBrands NA ORDEM', () => {
    const houses: House[] = [
      makeHouse({ id: 'b', slug: 'b', name: 'Bravo', order: 2 }),
      makeHouse({ id: 'a', slug: 'a', name: 'Alfa', order: 1 }),
      // sem order → cai em order ?? 0, então fica antes de order 1/2
      makeHouse({ id: 'z', slug: 'z', name: 'Zulu', order: undefined }),
    ];
    syncKnownBrandsFrom(houses);
    expect(setKnownBrands).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(setKnownBrands).mock.calls[0][0];
    expect(arg.map((m) => m.slug)).toEqual(['z', 'a', 'b']);
  });

  it('em empate de order, desempata pelo nome em pt-BR', () => {
    const houses: House[] = [
      makeHouse({ id: 'c', slug: 'c', name: 'Charlie', order: 0 }),
      makeHouse({ id: 'a', slug: 'a', name: 'Ágata', order: 0 }),
      makeHouse({ id: 'b', slug: 'b', name: 'Bravo', order: 0 }),
    ];
    syncKnownBrandsFrom(houses);
    const arg = vi.mocked(setKnownBrands).mock.calls[0][0];
    expect(arg.map((m) => m.name)).toEqual(['Ágata', 'Bravo', 'Charlie']);
  });

  it('passa metas (BrandMeta), não Houses, para setKnownBrands', () => {
    syncKnownBrandsFrom([makeHouse({ brandId: 'clsuperbet000001' })]);
    const arg = vi.mocked(setKnownBrands).mock.calls[0][0];
    expect(arg[0]).toMatchObject({ id: 'clsuperbet000001', slug: 'superbet', dataSource: 'otg' });
  });
});

// =============================================================================
// fetchHouses — GET /api/houses
// =============================================================================
describe('fetchHouses', () => {
  it('ok com {houses:[...]} → retorna o array', async () => {
    const houses = [makeHouse(), makeHouse({ id: 'x', slug: 'x', name: 'X' })];
    vi.mocked(authFetch).mockResolvedValue({ ok: true, json: async () => ({ houses }) } as any);
    const out = await fetchHouses();
    expect(authFetch).toHaveBeenCalledWith('/api/houses', expect.any(Object));
    expect(out).toEqual(houses);
  });

  it('!ok → retorna []', async () => {
    vi.mocked(authFetch).mockResolvedValue({ ok: false, json: async () => ({ houses: [makeHouse()] }) } as any);
    expect(await fetchHouses()).toEqual([]);
  });

  it('json inválido (json() rejeita) → retorna []', async () => {
    vi.mocked(authFetch).mockResolvedValue({
      ok: true,
      json: async () => { throw new Error('not json'); },
    } as any);
    expect(await fetchHouses()).toEqual([]);
  });
});

// =============================================================================
// createHouse — POST /api/houses com body serializado + parseError
// =============================================================================
describe('createHouse', () => {
  const input = { name: 'Nova Casa', slug: 'nova', dataSource: 'manual' as const };

  it('POST /api/houses com o corpo serializado; ok → res.json()', async () => {
    const created = makeHouse({ id: 'nova', slug: 'nova', name: 'Nova Casa', dataSource: 'manual' });
    vi.mocked(authFetch).mockResolvedValue({ ok: true, json: async () => created } as any);
    const out = await createHouse(input);
    expect(authFetch).toHaveBeenCalledWith('/api/houses', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify(input),
    }));
    expect(out).toEqual(created);
  });

  it('!ok → lança com a mensagem de erro (campo error)', async () => {
    vi.mocked(authFetch).mockResolvedValue({ ok: false, json: async () => ({ error: 'Slug já existe.' }) } as any);
    await expect(createHouse(input)).rejects.toThrow('Slug já existe.');
  });

  it('!ok com campo message → usa message', async () => {
    vi.mocked(authFetch).mockResolvedValue({ ok: false, json: async () => ({ message: 'Falhou aqui.' }) } as any);
    await expect(createHouse(input)).rejects.toThrow('Falhou aqui.');
  });

  it('!ok com corpo não-JSON → fallback "Erro na API: <status>"', async () => {
    vi.mocked(authFetch).mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => { throw new Error('not json'); },
    } as any);
    await expect(createHouse(input)).rejects.toThrow('Erro na API: 500');
  });
});

// =============================================================================
// updateHouse / deleteHouse — PATCH / DELETE com id encodado
// =============================================================================
describe('updateHouse / deleteHouse', () => {
  it('updateHouse: PATCH /api/houses/<id> com id encodado e patch serializado', async () => {
    const updated = makeHouse({ name: 'Editada' });
    vi.mocked(authFetch).mockResolvedValue({ ok: true, json: async () => updated } as any);
    const out = await updateHouse('a/b', { name: 'Editada' });
    expect(authFetch).toHaveBeenCalledWith('/api/houses/a%2Fb', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ name: 'Editada' }),
    }));
    expect(out).toEqual(updated);
  });

  it('updateHouse: !ok → lança via parseError', async () => {
    vi.mocked(authFetch).mockResolvedValue({ ok: false, json: async () => ({ error: 'Não encontrada.' }) } as any);
    await expect(updateHouse('x', { name: 'Y' })).rejects.toThrow('Não encontrada.');
  });

  it('deleteHouse: DELETE /api/houses/<id> com id encodado', async () => {
    vi.mocked(authFetch).mockResolvedValue({ ok: true } as any);
    await deleteHouse('a/b');
    expect(authFetch).toHaveBeenCalledWith('/api/houses/a%2Fb', expect.objectContaining({ method: 'DELETE' }));
  });

  it('deleteHouse: !ok → lança via parseError', async () => {
    vi.mocked(authFetch).mockResolvedValue({ ok: false, json: async () => ({ error: 'Falha ao remover.' }) } as any);
    await expect(deleteHouse('x')).rejects.toThrow('Falha ao remover.');
  });
});

// =============================================================================
// importHouseResults — POST /api/house-results/import
// =============================================================================
describe('importHouseResults', () => {
  const rows = [{ date: '2026-06-01', affiliateId: null }];

  it('POST /api/house-results/import com body {houseSlug, rows}; ok → json', async () => {
    const result = { imported: 1, dates: ['2026-06-01'], deleted: 0 };
    vi.mocked(authFetch).mockResolvedValue({ ok: true, json: async () => result } as any);
    const out = await importHouseResults('superbet', rows as any);
    expect(authFetch).toHaveBeenCalledWith('/api/house-results/import', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ houseSlug: 'superbet', rows }),
    }));
    expect(out).toEqual(result);
  });

  it('!ok → lança via parseError', async () => {
    vi.mocked(authFetch).mockResolvedValue({ ok: false, json: async () => ({ error: 'Import inválido.' }) } as any);
    await expect(importHouseResults('superbet', rows as any)).rejects.toThrow('Import inválido.');
  });
});

// =============================================================================
// fetchHouseResults — GET /api/house-results?<querystring>
// =============================================================================
describe('fetchHouseResults', () => {
  it('monta a querystring (start/end/houseSlug) e retorna rows quando ok', async () => {
    const rows = [{ date: '2026-06-01', houseSlug: 'superbet' }];
    vi.mocked(authFetch).mockResolvedValue({ ok: true, json: async () => ({ rows }) } as any);
    const out = await fetchHouseResults({ start: '2026-06-01', end: '2026-06-30', houseSlug: 'superbet' });
    const url = vi.mocked(authFetch).mock.calls[0][0] as string;
    expect(url).toContain('start=2026-06-01');
    expect(url).toContain('end=2026-06-30');
    expect(url).toContain('houseSlug=superbet');
    expect(out).toEqual(rows);
  });

  it('sem opts → URL sem querystring', async () => {
    vi.mocked(authFetch).mockResolvedValue({ ok: true, json: async () => ({ rows: [] }) } as any);
    await fetchHouseResults();
    expect(vi.mocked(authFetch).mock.calls[0][0]).toBe('/api/house-results');
  });

  it('!ok → retorna []', async () => {
    vi.mocked(authFetch).mockResolvedValue({ ok: false, json: async () => ({ rows: [{ date: 'x' }] }) } as any);
    expect(await fetchHouseResults({ houseSlug: 'superbet' })).toEqual([]);
  });

  it('json inválido → retorna []', async () => {
    vi.mocked(authFetch).mockResolvedValue({
      ok: true,
      json: async () => { throw new Error('not json'); },
    } as any);
    expect(await fetchHouseResults({ houseSlug: 'superbet' })).toEqual([]);
  });
});

// =============================================================================
// clearHouseResults — DELETE /api/house-results?<querystring>
// =============================================================================
describe('clearHouseResults', () => {
  it('DELETE com houseSlug (sem date) e retorna Number(deleted)', async () => {
    vi.mocked(authFetch).mockResolvedValue({ ok: true, json: async () => ({ deleted: 7 }) } as any);
    const out = await clearHouseResults('superbet');
    const url = vi.mocked(authFetch).mock.calls[0][0] as string;
    expect(url).toContain('/api/house-results?');
    expect(url).toContain('houseSlug=superbet');
    expect(url).not.toContain('date=');
    expect(out).toBe(7);
  });

  it('DELETE com houseSlug + date inclui date na querystring', async () => {
    vi.mocked(authFetch).mockResolvedValue({ ok: true, json: async () => ({ deleted: 2 }) } as any);
    await clearHouseResults('superbet', '2026-06-01');
    const url = vi.mocked(authFetch).mock.calls[0][0] as string;
    expect(url).toContain('houseSlug=superbet');
    expect(url).toContain('date=2026-06-01');
  });

  it('deleted ausente/inválido → 0', async () => {
    vi.mocked(authFetch).mockResolvedValue({ ok: true, json: async () => ({}) } as any);
    expect(await clearHouseResults('superbet')).toBe(0);
  });

  it('!ok → lança via parseError', async () => {
    vi.mocked(authFetch).mockResolvedValue({ ok: false, json: async () => ({ error: 'Falha ao limpar.' }) } as any);
    await expect(clearHouseResults('superbet')).rejects.toThrow('Falha ao limpar.');
  });
});
