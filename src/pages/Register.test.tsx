import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import Register from './Register';

// Prova do fix P1.10: o Register normaliza o e-mail (trim + lowercase) UMA vez e o passa
// ao Firebase Auth (createUserWithEmailAndPassword). Antes o Auth recebia o e-mail cru.
// Mockamos firebase/auth + firestore (sem rede), a lib/firebase (sem boot do Firebase) e
// react-router-dom (sem Router de verdade). useTheme/motion são stubados p/ render puro.
const h = vi.hoisted(() => ({
  createUserWithEmailAndPassword: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  setDoc: vi.fn(),
}));

vi.mock('firebase/auth', () => ({
  createUserWithEmailAndPassword: (...a: any[]) => h.createUserWithEmailAndPassword(...a),
  signInWithEmailAndPassword: (...a: any[]) => h.signInWithEmailAndPassword(...a),
}));
vi.mock('firebase/firestore', () => ({
  doc: vi.fn((...a: any[]) => ({ __doc: a })),
  setDoc: (...a: any[]) => h.setDoc(...a),
  serverTimestamp: vi.fn(() => '__ts'),
}));
vi.mock('../lib/firebase', () => ({
  auth: { currentUser: null },
  db: {},
  storage: {},
  handleFirestoreError: vi.fn(),
  OperationType: { WRITE: 'WRITE' },
}));
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  Link: (props: any) => props.children,
}));
vi.mock('../contexts/ThemeContext', () => ({
  useTheme: () => ({ theme: 'light', toggleTheme: vi.fn() }),
}));
vi.mock('motion/react', () => ({
  motion: new Proxy({}, {
    get: () => (props: any) => props.children ?? null,
  }),
}));

const CPF_VALIDO = '529.982.247-25';
const CPF_INVALIDO = '111.111.111-11';

// Preenche todos os campos obrigatórios do formulário. Os inputs de telefone/CPF têm
// máscara no onChange, então digitamos o valor cru e a máscara formata sozinha.
function preencher(opts: { email: string; cpf: string }) {
  fireEvent.change(screen.getByPlaceholderText('Seu nome'), { target: { value: 'Fulano' } });
  fireEvent.change(screen.getByPlaceholderText('nome@exemplo.com'), { target: { value: opts.email } });
  fireEvent.change(screen.getByPlaceholderText('(11) 98765-4321'), { target: { value: '11999999999' } });
  fireEvent.change(screen.getByPlaceholderText('@seu_perfil'), { target: { value: '@fulano' } });
  fireEvent.change(screen.getByPlaceholderText('000.000.000-00'), { target: { value: opts.cpf } });
  fireEvent.change(screen.getByPlaceholderText('Mínimo 6 caracteres'), { target: { value: 'senha123' } });
}

// O submit dispara o fluxo assíncrono (createUser → setDoc → setState); envolvemos em
// act + flush de microtasks p/ que os updates de estado terminem sem warning.
async function submeter() {
  await act(async () => {
    fireEvent.submit(screen.getByPlaceholderText('Seu nome').closest('form')!);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.createUserWithEmailAndPassword.mockResolvedValue({ user: { uid: 'u1' } });
  h.setDoc.mockResolvedValue(undefined);
});

describe('Register (P1.10 — e-mail normalizado antes do Auth)', () => {
  it('passa o e-mail NORMALIZADO (trim + lowercase) ao Auth, não o cru', async () => {
    render(<Register />);
    preencher({ email: '  TEST@X.COM ', cpf: CPF_VALIDO });
    await submeter();

    // O 2º argumento do createUser é o e-mail; tem que vir tratado, e a senha intacta.
    expect(h.createUserWithEmailAndPassword).toHaveBeenCalledTimes(1);
    const [authArg, emailArg, passwordArg] = h.createUserWithEmailAndPassword.mock.calls[0];
    expect(authArg).toBeDefined();
    expect(emailArg).toBe('test@x.com');
    expect(passwordArg).toBe('senha123');
  });

  it('CPF inválido bloqueia antes: createUser NÃO é chamado', async () => {
    render(<Register />);
    preencher({ email: '  TEST@X.COM ', cpf: CPF_INVALIDO });
    await submeter();

    expect(h.createUserWithEmailAndPassword).not.toHaveBeenCalled();
    expect(screen.getByText(/CPF inválido/i)).toBeInTheDocument();
  });
});
