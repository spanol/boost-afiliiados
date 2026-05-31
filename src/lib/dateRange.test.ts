import { describe, it, expect } from 'vitest';
import {
  toISODate,
  getPresetRange,
  getDefaultRange,
  formatRangeLabel,
  matchPreset,
  getPreviousRange,
  percentChange,
} from './dateRange';

// 29/05/2026 (mês index 4). Datas locais — coerente com toISODate (usa fuso local).
const NOW = new Date(2026, 4, 29);

describe('toISODate', () => {
  it('formata em YYYY-MM-DD com zero-padding', () => {
    expect(toISODate(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(toISODate(new Date(2026, 11, 31))).toBe('2026-12-31');
  });

  it('usa o fuso local (sem off-by-one do toISOString)', () => {
    // Início do dia local não deve "voltar" para o dia anterior.
    expect(toISODate(new Date(2026, 4, 29, 0, 0, 0))).toBe('2026-05-29');
  });
});

describe('getPresetRange', () => {
  it('today: início == fim == hoje', () => {
    expect(getPresetRange('today', NOW)).toEqual({ startDate: '2026-05-29', endDate: '2026-05-29' });
  });

  it('yesterday: início == fim == ontem', () => {
    expect(getPresetRange('yesterday', NOW)).toEqual({ startDate: '2026-05-28', endDate: '2026-05-28' });
  });

  it('yesterday vira o mês corretamente no dia 1', () => {
    expect(getPresetRange('yesterday', new Date(2026, 5, 1))).toEqual({ startDate: '2026-05-31', endDate: '2026-05-31' });
  });

  it('last7: 7 dias incluindo hoje', () => {
    expect(getPresetRange('last7', NOW)).toEqual({ startDate: '2026-05-23', endDate: '2026-05-29' });
  });

  it('last30: 30 dias incluindo hoje', () => {
    expect(getPresetRange('last30', NOW)).toEqual({ startDate: '2026-04-30', endDate: '2026-05-29' });
  });

  it('thisMonth: do dia 1º até hoje', () => {
    expect(getPresetRange('thisMonth', NOW)).toEqual({ startDate: '2026-05-01', endDate: '2026-05-29' });
  });

  it('lastMonth: mês anterior completo', () => {
    expect(getPresetRange('lastMonth', NOW)).toEqual({ startDate: '2026-04-01', endDate: '2026-04-30' });
  });

  it('lastMonth vira o ano corretamente em janeiro', () => {
    const jan = new Date(2026, 0, 15);
    expect(getPresetRange('lastMonth', jan)).toEqual({ startDate: '2025-12-01', endDate: '2025-12-31' });
  });

  it('custom cai para o mês atual', () => {
    expect(getPresetRange('custom', NOW)).toEqual(getPresetRange('thisMonth', NOW));
  });
});

describe('getDefaultRange', () => {
  it('é o mês atual (decisão de produto do B2)', () => {
    expect(getDefaultRange(NOW)).toEqual(getPresetRange('thisMonth', NOW));
  });
});

describe('matchPreset', () => {
  it('reconhece cada preset a partir do intervalo', () => {
    expect(matchPreset(getPresetRange('today', NOW), NOW)).toBe('today');
    expect(matchPreset(getPresetRange('yesterday', NOW), NOW)).toBe('yesterday');
    expect(matchPreset(getPresetRange('last7', NOW), NOW)).toBe('last7');
    expect(matchPreset(getPresetRange('thisMonth', NOW), NOW)).toBe('thisMonth');
    expect(matchPreset(getPresetRange('lastMonth', NOW), NOW)).toBe('lastMonth');
  });

  it('retorna custom para um intervalo arbitrário', () => {
    expect(matchPreset({ startDate: '2026-03-10', endDate: '2026-03-12' }, NOW)).toBe('custom');
  });
});

describe('formatRangeLabel', () => {
  it('mostra uma única data quando início == fim', () => {
    expect(formatRangeLabel({ startDate: '2026-05-29', endDate: '2026-05-29' })).toBe('29/05/2026');
  });

  it('mostra o intervalo quando início != fim', () => {
    expect(formatRangeLabel({ startDate: '2026-05-01', endDate: '2026-05-29' })).toBe('01/05/2026 – 29/05/2026');
  });
});

describe('getPreviousRange', () => {
  it('mês cheio (30 dias) → mês anterior de mesma duração', () => {
    // 01–30/04 (30 dias) → os 30 dias imediatamente anteriores: 02–31/03.
    expect(getPreviousRange({ startDate: '2026-04-01', endDate: '2026-04-30' }))
      .toEqual({ startDate: '2026-03-02', endDate: '2026-03-31' });
  });

  it('um único dia → dia anterior', () => {
    expect(getPreviousRange({ startDate: '2026-05-10', endDate: '2026-05-10' }))
      .toEqual({ startDate: '2026-05-09', endDate: '2026-05-09' });
  });

  it('7 dias → 7 dias imediatamente anteriores', () => {
    // 08–14 (7 dias) → 01–07.
    expect(getPreviousRange({ startDate: '2026-05-08', endDate: '2026-05-14' }))
      .toEqual({ startDate: '2026-05-01', endDate: '2026-05-07' });
  });

  it('vira o mês corretamente', () => {
    // 01–03/05 (3 dias) → 28–30/04.
    expect(getPreviousRange({ startDate: '2026-05-01', endDate: '2026-05-03' }))
      .toEqual({ startDate: '2026-04-28', endDate: '2026-04-30' });
  });
});

describe('percentChange', () => {
  it('retorna null sem base de comparação (anterior 0)', () => {
    expect(percentChange(10, 0)).toBeNull();
  });

  it('calcula alta e queda', () => {
    expect(percentChange(110, 100)).toBe(10);
    expect(percentChange(80, 100)).toBe(-20);
  });

  it('retorna 0 quando não houve variação', () => {
    expect(percentChange(50, 50)).toBe(0);
  });
});
