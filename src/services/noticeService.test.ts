import { describe, it, expect, vi, beforeEach } from 'vitest';
import { onSnapshot } from 'firebase/firestore';
import { authFetch } from '../lib/api';
import {
  isNoticeForUser,
  subscribeToNotices,
  countUnreadNotices,
  createNotice,
  updateNotice,
  deleteNotice,
} from './noticeService';

// O service lê o Firestore direto (onSnapshot) e escreve via authFetch. Mockamos
// `firebase/firestore` (collection/query/orderBy/onSnapshot), `lib/firebase` (db) e
// `lib/api` (authFetch) — padrão dos testes de service deste repo.
vi.mock('../lib/firebase', () => ({ db: {} }));
vi.mock('../lib/api', () => ({ authFetch: vi.fn() }));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => 'notices-col'),
  query: vi.fn((...args: any[]) => ({ __query: args })),
  orderBy: vi.fn((field: string, dir: string) => ({ __orderBy: [field, dir] })),
  onSnapshot: vi.fn(() => vi.fn()),
  Timestamp: class {},
}));

beforeEach(() => {
  vi.clearAllMocks();
});

// =============================================================================
// isNoticeForUser — audiência por papel/segmento (R21, pura)
// =============================================================================
describe('isNoticeForUser (R21)', () => {
  const active = (audience: any) => ({ audience, active: true });

  it('audience "all" + ativo → true para qualquer (client/special/null)', () => {
    expect(isNoticeForUser(active('all'), { role: 'client' })).toBe(true);
    expect(isNoticeForUser(active('all'), { isSpecial: true })).toBe(true);
    expect(isNoticeForUser(active('all'), null)).toBe(true);
  });

  it('audience "specials" → só para isSpecial', () => {
    expect(isNoticeForUser(active('specials'), { isSpecial: true })).toBe(true);
    expect(isNoticeForUser(active('specials'), { isSpecial: false })).toBe(false);
    expect(isNoticeForUser(active('specials'), null)).toBe(false);
  });

  it('audience "clients" → só para NÃO-special', () => {
    expect(isNoticeForUser(active('clients'), { isSpecial: false })).toBe(true);
    expect(isNoticeForUser(active('clients'), null)).toBe(true);
    expect(isNoticeForUser(active('clients'), { isSpecial: true })).toBe(false);
  });

  it('inativo → sempre false, mesmo audience "all"', () => {
    expect(isNoticeForUser({ audience: 'all', active: false }, { isSpecial: true })).toBe(false);
  });

  it('profile null não quebra', () => {
    expect(isNoticeForUser(active('specials'), null)).toBe(false);
  });
});

// =============================================================================
// subscribeToNotices — mapper do snapshot + propagação de erro
// =============================================================================
describe('subscribeToNotices', () => {
  it('mapeia docs (active default true, createdAt/updatedAt null) e chama onData', () => {
    const onData = vi.fn();
    subscribeToNotices(onData);
    const onNext = vi.mocked(onSnapshot).mock.calls[0][1] as any;
    onNext({
      docs: [
        { id: 'n1', data: () => ({ title: 'T', body: 'B', category: 'info', audience: 'all' }) },
        { id: 'n2', data: () => ({ title: 'X', body: 'Y', category: 'info', audience: 'clients', active: false }) },
      ],
    });
    expect(onData).toHaveBeenCalledTimes(1);
    const notices = onData.mock.calls[0][0];
    expect(notices).toHaveLength(2);
    expect(notices[0]).toMatchObject({ id: 'n1', active: true, createdAt: null, updatedAt: null });
    expect(notices[1]).toMatchObject({ id: 'n2', active: false });
  });

  it('propaga erro para onError', () => {
    const onError = vi.fn();
    subscribeToNotices(vi.fn(), onError);
    const errCb = vi.mocked(onSnapshot).mock.calls[0][2] as any;
    const err = new Error('snapshot failed');
    errCb(err);
    expect(onError).toHaveBeenCalledWith(err);
  });

  it('retorna a função de unsubscribe do onSnapshot', () => {
    const unsub = subscribeToNotices(vi.fn());
    expect(typeof unsub).toBe('function');
  });
});

// =============================================================================
// CRUD via authFetch — URL/método/body + erro do servidor
// =============================================================================
describe('createNotice / updateNotice / deleteNotice (authFetch)', () => {
  const input = { title: 'T', body: 'B', category: 'info' as const, audience: 'all' as const };

  it('createNotice: POST /api/notices com o corpo serializado', async () => {
    vi.mocked(authFetch).mockResolvedValue({ ok: true } as any);
    await createNotice(input);
    expect(authFetch).toHaveBeenCalledWith('/api/notices', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify(input),
    }));
  });

  it('updateNotice: PATCH com id encodado', async () => {
    vi.mocked(authFetch).mockResolvedValue({ ok: true } as any);
    await updateNotice('a/b', { title: 'Z' });
    expect(authFetch).toHaveBeenCalledWith('/api/notices/a%2Fb', expect.objectContaining({ method: 'PATCH' }));
  });

  it('deleteNotice: DELETE', async () => {
    vi.mocked(authFetch).mockResolvedValue({ ok: true } as any);
    await deleteNotice('n1');
    expect(authFetch).toHaveBeenCalledWith('/api/notices/n1', expect.objectContaining({ method: 'DELETE' }));
  });

  it('resposta !ok → lança com a mensagem de erro do servidor', async () => {
    vi.mocked(authFetch).mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Falha ao criar aviso (server).' }),
    } as any);
    await expect(createNotice(input)).rejects.toThrow('Falha ao criar aviso (server).');
  });

  it('resposta !ok com corpo não-JSON → usa o fallback', async () => {
    vi.mocked(authFetch).mockResolvedValue({
      ok: false,
      json: async () => { throw new Error('not json'); },
    } as any);
    await expect(deleteNotice('n1')).rejects.toThrow('Falha ao remover aviso.');
  });
});

// =============================================================================
// countUnreadNotices — badge do sino: createdAt vs último "visto" (R27, pura)
// =============================================================================
describe('countUnreadNotices (R27)', () => {
  // Fixture: createdAt é { toMillis: () => N } (Timestamp resolvido) ou null
  // (serverTimestamp ainda pendente — write não resolveu no servidor).
  const at = (millis: number) => ({ createdAt: { toMillis: () => millis } } as any);
  const pending = () => ({ createdAt: null } as any);

  it('createdAt mais novo que o lastSeen → conta como não-lido', () => {
    expect(countUnreadNotices([at(200)], 100)).toBe(1);
  });

  it('createdAt NULL (serverTimestamp pendente) → conta como NÃO-LIDO (fix R27)', () => {
    expect(countUnreadNotices([pending()], 100)).toBe(1);
  });

  it('createdAt mais antigo que o lastSeen → NÃO conta (já lido)', () => {
    expect(countUnreadNotices([at(50)], 100)).toBe(0);
  });

  it('mistura de 3 (novo + pendente + antigo) → contagem correta (2 não-lidos)', () => {
    expect(countUnreadNotices([at(200), pending(), at(50)], 100)).toBe(2);
  });

  it('lista vazia → 0', () => {
    expect(countUnreadNotices([], 100)).toBe(0);
  });
});
