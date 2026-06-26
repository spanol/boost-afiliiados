import { describe, it, expect, vi, beforeEach } from 'vitest';
import { onSnapshot } from 'firebase/firestore';
import { subscribeToAppVersion } from './versionService';

// Padrão dos testes de service do repo: mock de firebase/firestore (doc/onSnapshot) +
// lib/firebase (db). Dirige o onSnapshot por onSnapshot.mock.calls[0][1] (onNext) /
// [0][2] (onError).
vi.mock('../lib/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(() => 'app_meta/version-ref'),
  onSnapshot: vi.fn(() => vi.fn()),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('subscribeToAppVersion', () => {
  it('doc existente -> entrega os dados da versão para onData', () => {
    const onData = vi.fn();
    subscribeToAppVersion(onData);
    const onNext = vi.mocked(onSnapshot).mock.calls[0][1] as any;
    onNext({ exists: () => true, data: () => ({ version: '2026.06.26-100000', commit: 'abc1234' }) });
    expect(onData).toHaveBeenCalledWith({ version: '2026.06.26-100000', commit: 'abc1234' });
  });

  it('doc inexistente -> entrega null', () => {
    const onData = vi.fn();
    subscribeToAppVersion(onData);
    const onNext = vi.mocked(onSnapshot).mock.calls[0][1] as any;
    onNext({ exists: () => false, data: () => undefined });
    expect(onData).toHaveBeenCalledWith(null);
  });

  it('propaga erro para onError', () => {
    const onError = vi.fn();
    subscribeToAppVersion(vi.fn(), onError);
    const errCb = vi.mocked(onSnapshot).mock.calls[0][2] as any;
    const err = new Error('snapshot failed');
    errCb(err);
    expect(onError).toHaveBeenCalledWith(err);
  });

  it('retorna a função de unsubscribe do onSnapshot', () => {
    const unsub = subscribeToAppVersion(vi.fn());
    expect(typeof unsub).toBe('function');
  });
});
