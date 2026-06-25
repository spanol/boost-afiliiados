import { describe, it, expect, vi } from 'vitest';
import {
  validateProfile,
  saveProfile,
  type SaveProfileInput,
  type SaveProfileDeps,
} from './profileSave';

// Base de input válido — cada teste sobrescreve só o que importa.
function makeInput(overrides: Partial<SaveProfileInput> = {}): SaveProfileInput {
  return {
    name: 'Fulano',
    avatarUrl: 'https://exemplo.com/foto.png',
    newPassword: '',
    forcePasswordChange: false,
    ...overrides,
  };
}

describe('validateProfile', () => {
  it('exige nova senha quando a troca é forçada e o campo está vazio', () => {
    const msg = validateProfile(makeInput({ forcePasswordChange: true, newPassword: '' }));
    expect(msg).toBe('Você precisa definir uma nova senha antes de continuar.');
  });

  it('rejeita nova senha com menos de 6 caracteres', () => {
    const msg = validateProfile(makeInput({ newPassword: '12345' }));
    expect(msg).toBe('A nova senha deve ter ao menos 6 caracteres.');
  });

  it('rejeita nome vazio', () => {
    const msg = validateProfile(makeInput({ name: '' }));
    expect(msg).toBe('Informe seu nome.');
  });

  it('rejeita nome só com espaços', () => {
    const msg = validateProfile(makeInput({ name: '   ' }));
    expect(msg).toBe('Informe seu nome.');
  });

  it('retorna null para um input válido', () => {
    const msg = validateProfile(makeInput({ name: 'Fulano', newPassword: 'senha123' }));
    expect(msg).toBeNull();
  });

  it('retorna null quando sem força e sem senha (só dados de perfil)', () => {
    const msg = validateProfile(makeInput());
    expect(msg).toBeNull();
  });
});

describe('saveProfile', () => {
  // Helper que rastreia a ORDEM real das chamadas num array compartilhado.
  function makeDeps(overrides: Partial<SaveProfileDeps> = {}) {
    const calls: string[] = [];
    const docPayloads: Record<string, unknown>[] = [];
    const deps: SaveProfileDeps = {
      changePassword: vi.fn(async () => {
        calls.push('pw');
      }),
      updateProfileDoc: vi.fn(async (payload: Record<string, unknown>) => {
        calls.push('doc');
        docPayloads.push(payload);
      }),
      timestamp: vi.fn(() => 'TS'),
      ...overrides,
    };
    return { deps, calls, docPayloads };
  }

  it('troca a senha ANTES de gravar o perfil (ordem [pw, doc])', async () => {
    const { deps, calls } = makeDeps();
    await saveProfile(makeInput({ newPassword: 'senha123', forcePasswordChange: true }), deps);
    expect(calls).toEqual(['pw', 'doc']);
  });

  it('R23: se a troca de senha LANÇA, o perfil NUNCA é gravado (gate preservado)', async () => {
    const erro = new Error('auth/requires-recent-login');
    const { deps, calls } = makeDeps({
      changePassword: vi.fn(async () => {
        calls.push('pw');
        throw erro;
      }),
    });

    await expect(
      saveProfile(makeInput({ newPassword: 'senha123', forcePasswordChange: true }), deps),
    ).rejects.toThrow('auth/requires-recent-login');

    // O doc não foi gravado — só a tentativa de senha aconteceu.
    expect(deps.updateProfileDoc).not.toHaveBeenCalled();
    expect(calls).toEqual(['pw']);
  });

  it('com força + nova senha: payload zera mustChangePassword (=== false)', async () => {
    const { deps, docPayloads } = makeDeps();
    await saveProfile(makeInput({ newPassword: 'senha123', forcePasswordChange: true }), deps);
    expect(docPayloads[0].mustChangePassword).toBe(false);
  });

  it('sem força (mesmo com senha): mustChangePassword NÃO entra no payload', async () => {
    const { deps, docPayloads } = makeDeps();
    await saveProfile(makeInput({ newPassword: 'senha123', forcePasswordChange: false }), deps);
    expect(docPayloads[0]).not.toHaveProperty('mustChangePassword');
  });

  it('com força mas sem senha: mustChangePassword NÃO entra no payload', async () => {
    const { deps, docPayloads } = makeDeps();
    await saveProfile(makeInput({ newPassword: '', forcePasswordChange: true }), deps);
    expect(docPayloads[0]).not.toHaveProperty('mustChangePassword');
  });

  it('payload carrega name (trim), avatarUrl e updatedAt (do timestamp injetado)', async () => {
    const { deps, docPayloads } = makeDeps();
    await saveProfile(
      makeInput({ name: '  Fulano  ', avatarUrl: 'https://exemplo.com/x.png' }),
      deps,
    );
    expect(docPayloads[0].name).toBe('Fulano');
    expect(docPayloads[0].avatarUrl).toBe('https://exemplo.com/x.png');
    expect(docPayloads[0].updatedAt).toBe('TS');
    expect(deps.timestamp).toHaveBeenCalled();
  });

  it('sem nova senha: changePassword NÃO é chamado', async () => {
    const { deps, calls } = makeDeps();
    const res = await saveProfile(makeInput({ newPassword: '' }), deps);
    expect(deps.changePassword).not.toHaveBeenCalled();
    expect(calls).toEqual(['doc']);
    expect(res.passwordChanged).toBe(false);
  });
});
