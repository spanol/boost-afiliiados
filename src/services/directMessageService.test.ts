import { describe, it, expect, vi, beforeEach } from 'vitest';
import { onSnapshot, where } from 'firebase/firestore';
import { authFetch } from '../lib/api';
import {
  subscribeToMyDirectMessages,
  sendDirectMessage,
  markDirectMessageRead,
} from './directMessageService';

// O service lê o Firestore direto (onSnapshot, escopado por recipientUid) e escreve
// via authFetch. Mockamos `firebase/firestore` (collection/query/where/onSnapshot),
// `lib/firebase` (db) e `lib/api` (authFetch) — padrão dos testes de service do repo.
vi.mock('../lib/firebase', () => ({ db: {} }));
vi.mock('../lib/api', () => ({ authFetch: vi.fn() }));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => 'direct-messages-col'),
  query: vi.fn((...args: any[]) => ({ __query: args })),
  where: vi.fn((field: string, op: string, value: any) => ({ __where: [field, op, value] })),
  onSnapshot: vi.fn(() => vi.fn()),
  Timestamp: class {},
}));

beforeEach(() => {
  vi.clearAllMocks();
});

// =============================================================================
// subscribeToMyDirectMessages — escopo por recipientUid + ordenação + erro
// =============================================================================
describe('subscribeToMyDirectMessages', () => {
  it('filtra por recipientUid == uid (where) e escopa só ao próprio usuário', () => {
    subscribeToMyDirectMessages('uid-123', vi.fn());
    expect(where).toHaveBeenCalledWith('recipientUid', '==', 'uid-123');
  });

  it('ordena por createdAt desc; doc sem createdAt (null) vai para o FIM', () => {
    const onData = vi.fn();
    subscribeToMyDirectMessages('uid-123', onData);
    const onNext = vi.mocked(onSnapshot).mock.calls[0][1] as any;
    onNext({
      docs: [
        { id: 'm1', data: () => ({ recipientUid: 'uid-123', affiliateId: 'a1', title: 'T1', body: 'B1', createdAt: { toMillis: () => 200 } }) },
        { id: 'm2', data: () => ({ recipientUid: 'uid-123', affiliateId: 'a1', title: 'T2', body: 'B2', createdAt: null }) },
        { id: 'm3', data: () => ({ recipientUid: 'uid-123', affiliateId: 'a1', title: 'T3', body: 'B3', createdAt: { toMillis: () => 100 } }) },
      ],
    });
    expect(onData).toHaveBeenCalledTimes(1);
    const messages = onData.mock.calls[0][0];
    expect(messages.map((m: any) => m.id)).toEqual(['m1', 'm3', 'm2']);
  });

  it('readAt ausente é preservado como null', () => {
    const onData = vi.fn();
    subscribeToMyDirectMessages('uid-123', onData);
    const onNext = vi.mocked(onSnapshot).mock.calls[0][1] as any;
    onNext({
      docs: [
        { id: 'm1', data: () => ({ recipientUid: 'uid-123', affiliateId: 'a1', title: 'T', body: 'B', createdAt: { toMillis: () => 100 } }) },
      ],
    });
    const messages = onData.mock.calls[0][0];
    expect(messages[0].readAt).toBeNull();
  });

  it('propaga erro para onError', () => {
    const onError = vi.fn();
    subscribeToMyDirectMessages('uid-123', vi.fn(), onError);
    const errCb = vi.mocked(onSnapshot).mock.calls[0][2] as any;
    const err = new Error('snapshot failed');
    errCb(err);
    expect(onError).toHaveBeenCalledWith(err);
  });

  it('retorna a função de unsubscribe do onSnapshot', () => {
    const unsub = subscribeToMyDirectMessages('uid-123', vi.fn());
    expect(typeof unsub).toBe('function');
  });
});

// =============================================================================
// sendDirectMessage — POST /api/direct-messages + erro do servidor
// =============================================================================
describe('sendDirectMessage', () => {
  const input = { affiliateId: 'aff-1', title: 'Olá', body: 'Mensagem' };

  it('POST /api/direct-messages com o corpo serializado e retorna { delivered }', async () => {
    vi.mocked(authFetch).mockResolvedValue({
      ok: true,
      json: async () => ({ delivered: 2 }),
    } as any);
    const result = await sendDirectMessage(input);
    expect(authFetch).toHaveBeenCalledWith('/api/direct-messages', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify(input),
    }));
    expect(result).toEqual({ delivered: 2 });
  });

  it('resposta !ok → lança com a mensagem de erro do servidor', async () => {
    vi.mocked(authFetch).mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Afiliado sem login vinculado.' }),
    } as any);
    await expect(sendDirectMessage(input)).rejects.toThrow('Afiliado sem login vinculado.');
  });
});

// =============================================================================
// markDirectMessageRead — POST /read com id encodado
// =============================================================================
describe('markDirectMessageRead', () => {
  it('POST /api/direct-messages/<id>/read', async () => {
    vi.mocked(authFetch).mockResolvedValue({ ok: true } as any);
    await markDirectMessageRead('m1');
    expect(authFetch).toHaveBeenCalledWith('/api/direct-messages/m1/read', expect.objectContaining({
      method: 'POST',
    }));
  });

  it('id com barra é encodado (encodeURIComponent)', async () => {
    vi.mocked(authFetch).mockResolvedValue({ ok: true } as any);
    await markDirectMessageRead('a/b');
    expect(authFetch).toHaveBeenCalledWith('/api/direct-messages/a%2Fb/read', expect.objectContaining({
      method: 'POST',
    }));
  });

  it('resposta !ok → lança com a mensagem de erro do servidor', async () => {
    vi.mocked(authFetch).mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Falha ao marcar mensagem como lida.' }),
    } as any);
    await expect(markDirectMessageRead('m1')).rejects.toThrow('Falha ao marcar mensagem como lida.');
  });
});
