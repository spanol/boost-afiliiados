import { describe, it, expect } from 'vitest';
import { buildResultsNotification } from './resultsNotification';

describe('buildResultsNotification — variante counts (ativa)', () => {
  it('lista contagens não-zero pluralizadas e une com "e"', () => {
    const { title, body } = buildResultsNotification('Betano', { registrations: 3, first_deposits: 1, qualified_cpa: 2 });
    expect(title).toBe('🎉 Novos resultados na Betano!');
    expect(body).toContain('3 novos cadastros, 1 FTD e 2 CPAs');
    expect(body).toContain('Betano');
  });

  it('singular vs plural (1 cadastro / 1 CPA)', () => {
    expect(buildResultsNotification('X', { registrations: 1 }).body).toContain('1 novo cadastro');
    expect(buildResultsNotification('X', { qualified_cpa: 1 }).body).toContain('1 CPA');
    expect(buildResultsNotification('X', { qualified_cpa: 5 }).body).toContain('5 CPAs');
  });

  it('omite métricas zeradas (só FTD)', () => {
    const { body } = buildResultsNotification('Betfair', { registrations: 0, first_deposits: 2, qualified_cpa: 0 });
    expect(body).toContain('2 FTDs');
    expect(body).not.toContain('cadastro');
    expect(body).not.toContain('CPA');
  });

  it('sem nenhuma contagem → texto genérico de atualização', () => {
    const { body } = buildResultsNotification('Betano', {});
    expect(body).toBe('Seus resultados na Betano foram atualizados. Confira no seu painel!');
  });

  it('NÃO expõe R$ na variante counts mesmo com comissão presente', () => {
    const { body } = buildResultsNotification('Betano', { registrations: 1, total_commission: 500 }, 'counts');
    expect(body).not.toContain('R$');
    expect(body).not.toContain('comissão');
  });

  it('nome de casa vazio cai num rótulo seguro', () => {
    expect(buildResultsNotification('', { registrations: 1 }).title).toContain('sua casa');
  });
});

describe('buildResultsNotification — variante money (pronta, off)', () => {
  it('inclui a comissão em R$ junto das contagens', () => {
    const { body } = buildResultsNotification('Betano', { registrations: 2, total_commission: 887 }, 'money');
    expect(body).toContain('2 novos cadastros');
    expect(body).toContain('887,00');
    expect(body).toContain('comissão');
  });

  it('só comissão (sem contagem) ainda celebra o R$', () => {
    const { body } = buildResultsNotification('Betano', { total_commission: 1000 }, 'money');
    expect(body).toContain('1.000,00');
    expect(body).not.toContain('cadastro');
  });

  it('variante money sem comissão (0) cai no texto de contagens', () => {
    const { body } = buildResultsNotification('Betano', { registrations: 3, total_commission: 0 }, 'money');
    expect(body).toContain('3 novos cadastros');
    expect(body).not.toContain('R$');
  });
});
