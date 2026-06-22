import { describe, it, expect } from 'vitest';
import { maskCPF, maskPhone, isValidCPF, isValidPhone } from './validators';

describe('maskCPF', () => {
  it('formata progressivamente', () => {
    expect(maskCPF('529')).toBe('529');
    expect(maskCPF('529982')).toBe('529.982');
    expect(maskCPF('529982247')).toBe('529.982.247');
    expect(maskCPF('52998224725')).toBe('529.982.247-25');
  });

  it('trunca em 11 dígitos e ignora não-dígitos', () => {
    expect(maskCPF('529.982.247-2599')).toBe('529.982.247-25');
    expect(maskCPF('abc529982247def25')).toBe('529.982.247-25');
  });
});

describe('maskPhone', () => {
  it('formata celular (11 dígitos)', () => {
    expect(maskPhone('11987654321')).toBe('(11) 98765-4321');
  });

  it('formata fixo (10 dígitos)', () => {
    expect(maskPhone('1133334444')).toBe('(11) 3333-4444');
  });

  it('formata parcialmente e trunca', () => {
    expect(maskPhone('11')).toBe('(11');
    expect(maskPhone('119876')).toBe('(11) 9876');
    expect(maskPhone('119876543219999')).toBe('(11) 98765-4321');
  });
});

describe('isValidCPF', () => {
  it('aceita CPF válido com e sem máscara', () => {
    expect(isValidCPF('529.982.247-25')).toBe(true);
    expect(isValidCPF('52998224725')).toBe(true);
  });

  it('rejeita dígitos verificadores incorretos', () => {
    expect(isValidCPF('529.982.247-24')).toBe(false);
    expect(isValidCPF('12345678900')).toBe(false);
  });

  it('rejeita comprimento errado e sequências repetidas', () => {
    expect(isValidCPF('1234')).toBe(false);
    expect(isValidCPF('11111111111')).toBe(false);
    expect(isValidCPF('00000000000')).toBe(false);
  });
});

describe('isValidPhone', () => {
  it('aceita fixo (10) e celular (11)', () => {
    expect(isValidPhone('(11) 3333-4444')).toBe(true);
    expect(isValidPhone('(11) 98765-4321')).toBe(true);
  });

  it('rejeita comprimentos inválidos', () => {
    expect(isValidPhone('11987')).toBe(false);
    expect(isValidPhone('119876543210')).toBe(false);
  });
});
