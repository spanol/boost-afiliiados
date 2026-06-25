import { describe, it, expect } from 'vitest';
import { computeRosterStats, type RosterStatsRow } from './rosterStats';

// Estatísticas do roster de aprovados: total, contagem por casa e o split pending/reconciled.
// Invariantes travados aqui: total === nº de linhas; pending + reconciled === total;
// só 'reconciled' conta como reconciliado (qualquer outro/ausente vira pending);
// linha sem casa é OMITIDA do byHouse; e a soma do byHouse === nº de linhas com casa.
describe('computeRosterStats', () => {
  it('total é igual ao número de linhas', () => {
    const rows: RosterStatsRow[] = [
      { house: 'Superbet', status: 'reconciled' },
      { house: 'SportingBet', status: 'pending' },
      { house: 'Superbet' },
    ];
    const stats = computeRosterStats(rows);
    expect(stats.total).toBe(rows.length);
    expect(stats.total).toBe(3);
  });

  it('pending + reconciled é igual ao total', () => {
    const rows: RosterStatsRow[] = [
      { house: 'Superbet', status: 'reconciled' },
      { house: 'SportingBet', status: 'pending' },
      { house: 'Superbet', status: 'reconciled' },
      { house: 'SportingBet' },
      { house: 'Superbet', status: 'qualquer-outro' },
    ];
    const stats = computeRosterStats(rows);
    expect(stats.pending + stats.reconciled).toBe(stats.total);
    expect(stats.total).toBe(5);
  });

  it('byHouse conta as linhas por casa', () => {
    const rows: RosterStatsRow[] = [
      { house: 'Superbet', status: 'reconciled' },
      { house: 'Superbet', status: 'pending' },
      { house: 'SportingBet', status: 'reconciled' },
    ];
    const stats = computeRosterStats(rows);
    expect(stats.byHouse).toEqual({ Superbet: 2, SportingBet: 1 });
  });

  it("status 'reconciled' incrementa reconciled; qualquer outro/undefined vira pending", () => {
    const rows: RosterStatsRow[] = [
      { house: 'A', status: 'reconciled' }, // reconciled
      { house: 'A', status: 'reconciled' }, // reconciled
      { house: 'A', status: 'pending' },    // pending (outro valor)
      { house: 'A', status: 'foo' },        // pending (outro valor)
      { house: 'A' },                       // pending (status undefined)
    ];
    const stats = computeRosterStats(rows);
    expect(stats.reconciled).toBe(2);
    expect(stats.pending).toBe(3);
  });

  it('linha com house null/undefined é OMITIDA do byHouse', () => {
    const rows: RosterStatsRow[] = [
      { house: 'Superbet', status: 'reconciled' },
      { house: null, status: 'pending' },
      { house: undefined, status: 'reconciled' },
      { status: 'pending' }, // sem a propriedade house
    ];
    const stats = computeRosterStats(rows);
    expect(stats.byHouse).toEqual({ Superbet: 1 });
    expect(Object.keys(stats.byHouse)).not.toContain('null');
    expect(Object.keys(stats.byHouse)).not.toContain('undefined');
    // total continua contando TODAS as linhas, mesmo as sem casa
    expect(stats.total).toBe(4);
  });

  it('a soma dos valores de byHouse é igual ao nº de linhas COM casa', () => {
    const rows: RosterStatsRow[] = [
      { house: 'Superbet', status: 'reconciled' },
      { house: 'SportingBet', status: 'pending' },
      { house: 'Superbet' },
      { house: null, status: 'reconciled' },  // sem casa → fora do byHouse
      { house: undefined },                    // sem casa → fora do byHouse
      { status: 'pending' },                    // sem casa → fora do byHouse
    ];
    const stats = computeRosterStats(rows);
    const withHouse = rows.filter((r) => r.house).length;
    const sumByHouse = Object.values(stats.byHouse).reduce((a, b) => a + b, 0);
    expect(sumByHouse).toBe(withHouse);
    expect(sumByHouse).toBe(3);
  });

  it('lista vazia retorna {total:0, byHouse:{}, pending:0, reconciled:0}', () => {
    expect(computeRosterStats([])).toEqual({
      total: 0,
      byHouse: {},
      pending: 0,
      reconciled: 0,
    });
  });
});
