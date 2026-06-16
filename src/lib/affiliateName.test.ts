import { describe, it, expect } from 'vitest';
import { normalizeNameKey } from './affiliateName';

describe('normalizeNameKey (ponte de reconciliação provisionamento ↔ relatório)', () => {
  it('remove espaços, acentos e caixa', () => {
    expect(normalizeNameKey('Leonardo Portugal Vasconcelos')).toBe('leonardoportugalvasconcelos');
    expect(normalizeNameKey('Antonio Carlos dos santos e santos')).toBe('antoniocarlosdossantosesantos');
    expect(normalizeNameKey('Fernando José feitosa de brito')).toBe('fernandojosefeitosadebrito');
  });

  it('o nome do provisionamento casa com o do relatório (PascalCase sem espaço)', () => {
    // a OTG deriva o name do relatório tirando os espaços do affiliate_name
    expect(normalizeNameKey('Bruno Eduardo Santos Rodrigues'))
      .toBe(normalizeNameKey('BrunoEduardoSantosRodrigues'));
    expect(normalizeNameKey('Paolla Maia')).toBe(normalizeNameKey('PaollaMaia'));
  });

  it('ignora pontuação e espaços extras', () => {
    expect(normalizeNameKey('  Júlio  César  Quirino ')).toBe('juliocesarquirino');
    expect(normalizeNameKey('Yago Luiz de Oliveira Cavalier')).toBe('yagoluizdeoliveiracavalier');
  });

  it('tolera nulo/indefinido/vazio', () => {
    expect(normalizeNameKey(undefined)).toBe('');
    expect(normalizeNameKey(null)).toBe('');
    expect(normalizeNameKey('')).toBe('');
  });

  it('nomes distintos não colidem', () => {
    expect(normalizeNameKey('Leonardo')).not.toBe(normalizeNameKey('Leonardo Portugal Vasconcelos'));
  });
});
