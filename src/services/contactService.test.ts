import { describe, it, expect, vi, beforeEach } from 'vitest';
import { addDoc, onSnapshot, serverTimestamp } from 'firebase/firestore';
import {
  createContactInquiry,
  subscribeToContactInquiries,
  type ContactInquiryInput,
} from './contactService';

// O service escreve via addDoc + serverTimestamp e lê o Firestore direto (onSnapshot).
// Mockamos `firebase/firestore` (collection/query/orderBy/onSnapshot/addDoc/serverTimestamp),
// `lib/firebase` (db) e `lib/api` (authFetch) — padrão dos testes de service deste repo.
vi.mock('../lib/firebase', () => ({ db: {} }));
vi.mock('../lib/api', () => ({ authFetch: vi.fn() }));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => 'contacts-col'),
  query: vi.fn((...args: any[]) => ({ __query: args })),
  orderBy: vi.fn((field: string, dir: string) => ({ __orderBy: [field, dir] })),
  onSnapshot: vi.fn(() => vi.fn()),
  addDoc: vi.fn(),
  serverTimestamp: vi.fn(() => '__ts'),
  Timestamp: class {},
}));

beforeEach(() => {
  vi.clearAllMocks();
});

const input: ContactInquiryInput = {
  name: 'Fulano',
  email: 'fulano@ex.com',
  phone: '11999999999',
  socialMedia: '@fulano',
  affiliateExperience: 'sim',
  presentation: 'Quero ser afiliado.',
};

// =============================================================================
// createContactInquiry — addDoc com o input + createdAt do serverTimestamp
// =============================================================================
describe('createContactInquiry', () => {
  it('chama addDoc com a coleção e o corpo contendo o input + createdAt do serverTimestamp', async () => {
    vi.mocked(addDoc).mockResolvedValue({ id: 'novo' } as any);
    await createContactInquiry(input);
    expect(addDoc).toHaveBeenCalledTimes(1);
    expect(addDoc).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ ...input, createdAt: '__ts' }),
    );
    expect(serverTimestamp).toHaveBeenCalled();
  });
});

// =============================================================================
// subscribeToContactInquiries — mapper do snapshot + propagação de erro
// =============================================================================
describe('subscribeToContactInquiries', () => {
  it('mapeia docs (id + spread de data() + createdAt do doc) e chama onData', () => {
    const onData = vi.fn();
    const ts = { toMillis: () => 1000 };
    subscribeToContactInquiries(onData);
    const onNext = vi.mocked(onSnapshot).mock.calls[0][1] as any;
    onNext({
      docs: [
        { id: 'c1', data: () => ({ ...input, createdAt: ts }) },
      ],
    });
    expect(onData).toHaveBeenCalledTimes(1);
    const contacts = onData.mock.calls[0][0];
    expect(contacts).toHaveLength(1);
    expect(contacts[0]).toMatchObject({ id: 'c1', ...input, createdAt: ts });
  });

  it('createdAt vira null quando ausente no doc', () => {
    const onData = vi.fn();
    subscribeToContactInquiries(onData);
    const onNext = vi.mocked(onSnapshot).mock.calls[0][1] as any;
    onNext({
      docs: [
        { id: 'c2', data: () => ({ ...input }) },
      ],
    });
    expect(onData.mock.calls[0][0][0].createdAt).toBeNull();
  });

  it('registro legado com campo `instagram` é preservado no objeto mapeado (spread)', () => {
    const onData = vi.fn();
    subscribeToContactInquiries(onData);
    const onNext = vi.mocked(onSnapshot).mock.calls[0][1] as any;
    onNext({
      docs: [
        { id: 'legado', data: () => ({ ...input, instagram: '@antigo' }) },
      ],
    });
    expect(onData.mock.calls[0][0][0]).toMatchObject({ id: 'legado', instagram: '@antigo' });
  });

  it('propaga erro para onError', () => {
    const onError = vi.fn();
    subscribeToContactInquiries(vi.fn(), onError);
    const errCb = vi.mocked(onSnapshot).mock.calls[0][2] as any;
    const err = new Error('snapshot failed');
    errCb(err);
    expect(onError).toHaveBeenCalledWith(err);
  });

  it('retorna a função de unsubscribe do onSnapshot', () => {
    const unsub = subscribeToContactInquiries(vi.fn());
    expect(typeof unsub).toBe('function');
  });
});
