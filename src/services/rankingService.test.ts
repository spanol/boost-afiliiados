import { describe, it, expect, vi, beforeEach } from 'vitest';
import { onSnapshot } from 'firebase/firestore';
import { authFetch } from '../lib/api';
import {
  subscribeToDailyRanking,
  computeDailyRanking,
  todayISO,
} from './rankingService';

// O service lê o Firestore direto (doc/onSnapshot) e dispara o cálculo via authFetch.
// Mockamos `firebase/firestore` (doc/onSnapshot/Timestamp), `lib/firebase` (db) e
// `lib/api` (authFetch). NÃO mockamos `lib/dateRange` — toISODate é puro/real (R22).
vi.mock('../lib/firebase', () => ({ db: {} }));
vi.mock('../lib/api', () => ({ authFetch: vi.fn() }));
vi.mock('firebase/firestore', () => ({
  doc: vi.fn((...args: any[]) => ({ __doc: args })),
  onSnapshot: vi.fn(() => vi.fn()),
  Timestamp: class {},
}));

beforeEach(() => {
  vi.clearAllMocks();
});

// =============================================================================
// subscribeToDailyRanking — null-vs-vazio é o ponto crítico (R22)
// =============================================================================
describe('subscribeToDailyRanking (R22)', () => {
  // Helper: registra a subscription e retorna o callback onNext do onSnapshot.
  const onNextOf = () => vi.mocked(onSnapshot).mock.calls[0][1] as any;

  it('doc inexistente (exists()=false) → onData(null)', () => {
    const onData = vi.fn();
    subscribeToDailyRanking('2026-06-24', onData);
    onNextOf()({ exists: () => false, data: () => ({}) });
    expect(onData).toHaveBeenCalledWith(null);
  });

  it('snapshot com entries:[] e count:0 → objeto vazio, NÃO null', () => {
    const onData = vi.fn();
    subscribeToDailyRanking('2026-06-24', onData);
    onNextOf()({ exists: () => true, data: () => ({ entries: [], count: 0 }) });
    expect(onData).toHaveBeenCalledTimes(1);
    expect(onData.mock.calls[0][0]).toMatchObject({
      date: '2026-06-24',
      entries: [],
      count: 0,
    });
    expect(onData.mock.calls[0][0]).not.toBeNull();
  });

  it('entries com 2 itens e SEM count → count = entries.length (2)', () => {
    const onData = vi.fn();
    subscribeToDailyRanking('2026-06-24', onData);
    onNextOf()({
      exists: () => true,
      data: () => ({
        entries: [
          { pos: 1, affiliateId: 'a', name: 'A', commission: 10 },
          { pos: 2, affiliateId: 'b', name: 'B', commission: 5 },
        ],
      }),
    });
    const ranking = onData.mock.calls[0][0];
    expect(ranking.count).toBe(2);
    expect(ranking.entries).toHaveLength(2);
  });

  it('entries não-array (undefined) → entries:[] e count:0', () => {
    const onData = vi.fn();
    subscribeToDailyRanking('2026-06-24', onData);
    onNextOf()({ exists: () => true, data: () => ({ entries: undefined }) });
    const ranking = onData.mock.calls[0][0];
    expect(ranking.entries).toEqual([]);
    expect(ranking.count).toBe(0);
  });

  it('erro no snapshot → onError chamado com o Error', () => {
    const onError = vi.fn();
    subscribeToDailyRanking('2026-06-24', vi.fn(), onError);
    const errCb = vi.mocked(onSnapshot).mock.calls[0][2] as any;
    const err = new Error('snapshot failed');
    errCb(err);
    expect(onError).toHaveBeenCalledWith(err);
  });
});

// =============================================================================
// computeDailyRanking — POST /api/rankings/compute + erro do servidor
// =============================================================================
describe('computeDailyRanking', () => {
  it('POST /api/rankings/compute com body JSON {date}; ok → retorna res.json()', async () => {
    const payload = { date: '2026-06-24', count: 3 };
    vi.mocked(authFetch).mockResolvedValue({
      ok: true,
      json: async () => payload,
    } as any);
    const result = await computeDailyRanking('2026-06-24');
    expect(authFetch).toHaveBeenCalledWith('/api/rankings/compute', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ date: '2026-06-24' }),
    }));
    expect(result).toEqual(payload);
  });

  it('resposta !ok → lança com a mensagem de erro do servidor', async () => {
    vi.mocked(authFetch).mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Falha ao calcular o ranking (server).' }),
    } as any);
    await expect(computeDailyRanking('2026-06-24')).rejects.toThrow('Falha ao calcular o ranking (server).');
  });
});

// =============================================================================
// todayISO — formato YYYY-MM-DD
// =============================================================================
describe('todayISO', () => {
  it('retorna string no formato YYYY-MM-DD', () => {
    expect(todayISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
