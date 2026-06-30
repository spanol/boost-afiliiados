import { describe, it, expect, vi, beforeEach } from 'vitest';
import { onSnapshot, where } from 'firebase/firestore';
import { subscribeToMyNotifications } from './userNotificationService';

// Mesmo padrão dos testes de service do repo: mock de firebase/firestore + lib/firebase.
vi.mock('../lib/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => 'user-notifications-col'),
  query: vi.fn((...args: any[]) => ({ __query: args })),
  where: vi.fn((field: string, op: string, value: any) => ({ __where: [field, op, value] })),
  onSnapshot: vi.fn(() => vi.fn()),
  Timestamp: class {},
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('subscribeToMyNotifications', () => {
  it('escopa por recipientUid == uid (where) — afiliado só lê as suas', () => {
    subscribeToMyNotifications('uid-123', vi.fn());
    expect(where).toHaveBeenCalledWith('recipientUid', '==', 'uid-123');
  });

  it('ordena por createdAt desc; doc sem createdAt (null) vai para o FIM', () => {
    const onData = vi.fn();
    subscribeToMyNotifications('uid-123', onData);
    const onNext = vi.mocked(onSnapshot).mock.calls[0][1] as any;
    onNext({
      docs: [
        { id: 'n1', data: () => ({ recipientUid: 'uid-123', type: 'results_updated', title: 'T1', body: 'B1', createdAt: { toMillis: () => 200 } }) },
        { id: 'n2', data: () => ({ recipientUid: 'uid-123', type: 'results_updated', title: 'T2', body: 'B2', createdAt: null }) },
        { id: 'n3', data: () => ({ recipientUid: 'uid-123', type: 'results_updated', title: 'T3', body: 'B3', createdAt: { toMillis: () => 100 } }) },
      ],
    });
    expect(onData).toHaveBeenCalledTimes(1);
    const items = onData.mock.calls[0][0];
    expect(items.map((m: any) => m.id)).toEqual(['n1', 'n3', 'n2']);
  });

  it('mapeia os campos da notificação (casa + tipo)', () => {
    const onData = vi.fn();
    subscribeToMyNotifications('uid-123', onData);
    const onNext = vi.mocked(onSnapshot).mock.calls[0][1] as any;
    onNext({
      docs: [
        { id: 'n1', data: () => ({ recipientUid: 'uid-123', affiliateId: 'a1', type: 'results_updated', houseSlug: 'betano', houseName: 'Betano', title: 'T', body: 'B', createdAt: { toMillis: () => 1 } }) },
      ],
    });
    expect(onData.mock.calls[0][0][0]).toMatchObject({ houseName: 'Betano', houseSlug: 'betano', type: 'results_updated' });
  });

  it('propaga erro para onError', () => {
    const onError = vi.fn();
    subscribeToMyNotifications('uid-123', vi.fn(), onError);
    const errCb = vi.mocked(onSnapshot).mock.calls[0][2] as any;
    const err = new Error('snapshot failed');
    errCb(err);
    expect(onError).toHaveBeenCalledWith(err);
  });

  it('retorna a função de unsubscribe do onSnapshot', () => {
    const unsub = subscribeToMyNotifications('uid-123', vi.fn());
    expect(typeof unsub).toBe('function');
  });
});
