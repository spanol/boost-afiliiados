import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useAuth } from '../contexts/AuthContext';
import { subscribeToAppVersion } from '../services/versionService';
import { reloadApp } from '../lib/version';
import UpdateBanner from './UpdateBanner';

// Mockamos auth, o service de versão e o núcleo de versão. LOCAL_VERSION em vitest
// seria 'dev' (sem o define do Vite) e isOutdated nunca dispararia — por isso fixamos
// uma versão local conhecida no mock e mantemos a lógica de isOutdated p/ exercitar o
// render condicional. A pureza de isOutdated/reloadApp é coberta em lib/version.test.ts.
vi.mock('../contexts/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../services/versionService', () => ({ subscribeToAppVersion: vi.fn(() => vi.fn()) }));
vi.mock('../lib/version', () => ({
  LOCAL_VERSION: 'local-1',
  isOutdated: (local: string, remote?: string | null) =>
    !!remote && local !== 'dev' && remote !== local,
  reloadApp: vi.fn(),
}));

const emitRemote = (version: string | null) => {
  const onData = vi.mocked(subscribeToAppVersion).mock.calls[0][0];
  act(() => onData(version ? ({ version } as any) : null));
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useAuth).mockReturnValue({ user: { uid: 'u1' } } as any);
});

describe('UpdateBanner', () => {
  it('versão remota diferente da local -> mostra o banner', () => {
    render(<UpdateBanner />);
    emitRemote('remote-2');
    expect(screen.getByText('Nova versão disponível')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /atualizar agora/i })).toBeInTheDocument();
  });

  it('versão remota igual à local -> não mostra o banner', () => {
    render(<UpdateBanner />);
    emitRemote('local-1');
    expect(screen.queryByText('Nova versão disponível')).not.toBeInTheDocument();
  });

  it('sem versão remota publicada -> não mostra o banner', () => {
    render(<UpdateBanner />);
    emitRemote(null);
    expect(screen.queryByText('Nova versão disponível')).not.toBeInTheDocument();
  });

  it('clicar em "Atualizar agora" chama reloadApp', () => {
    render(<UpdateBanner />);
    emitRemote('remote-2');
    fireEvent.click(screen.getByRole('button', { name: /atualizar agora/i }));
    expect(reloadApp).toHaveBeenCalledTimes(1);
  });

  it('sem usuário logado -> não assina o snapshot', () => {
    vi.mocked(useAuth).mockReturnValue({ user: null } as any);
    render(<UpdateBanner />);
    expect(subscribeToAppVersion).not.toHaveBeenCalled();
  });
});
