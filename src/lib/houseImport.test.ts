import { describe, it, expect } from 'vitest';
import { canImport, buildImportPayload } from './houseImport';
import { METRIC_KEYS, type ResolveResult, type ResolvedRow } from './houseResults';

// Helpers de fixture --------------------------------------------------------

// Monta um ResolvedRow completo: as 6 métricas + os campos SÓ-DE-UI (`line`,
// `affiliateLabel`) preenchidos de propósito, pra provar que o payload não os vaza.
function makeRow(overrides: Partial<ResolvedRow> = {}): ResolvedRow {
  return {
    line: 7,
    date: '2026-06-01',
    affiliateId: 'aff_123',
    affiliateLabel: 'João Silva',
    registrations: 40,
    first_deposits: 18,
    qualified_cpa: 12,
    rvs: 80,
    deposit: 2400,
    total_commission: 2400,
    ...overrides,
  };
}

function makeAnalysis(rows: ResolvedRow[], unresolved: ResolveResult['unresolved'] = []): ResolveResult {
  return { rows, unresolved };
}

// canImport -----------------------------------------------------------------

describe('houseImport.canImport (gatilho do botão Importar — R24)', () => {
  it('é false quando a análise é null (nada parseado ainda)', () => {
    expect(canImport(null, [])).toBe(false);
  });

  it('é false quando a análise não tem nenhuma linha resolvida', () => {
    expect(canImport(makeAnalysis([]), [])).toBe(false);
  });

  it('é false quando há erros de parse (parseErrors.length > 0)', () => {
    expect(canImport(makeAnalysis([makeRow()]), [{ line: 3, message: 'Data inválida' }])).toBe(false);
  });

  it('é false quando há afiliados não-encontrados (unresolved.length > 0)', () => {
    const analysis = makeAnalysis([makeRow()], [{ line: 5, token: 'Fulano' }]);
    expect(canImport(analysis, [])).toBe(false);
  });

  it('é true só com ≥1 linha, zero parseErrors e zero unresolved', () => {
    expect(canImport(makeAnalysis([makeRow()]), [])).toBe(true);
  });
});

// buildImportPayload --------------------------------------------------------

describe('houseImport.buildImportPayload (shape do payload — R24)', () => {
  const EXPECTED_KEYS = ['date', 'affiliateId', ...METRIC_KEYS].sort();

  it('cada item tem EXATAMENTE { date, affiliateId, ...6 métricas } (ordem não importa)', () => {
    const payload = buildImportPayload(makeAnalysis([makeRow()]));
    expect(payload).toHaveLength(1);
    expect(Object.keys(payload[0]).sort()).toEqual(EXPECTED_KEYS);
    // sanity: as 6 métricas canônicas estão todas presentes
    expect(new Set(Object.keys(payload[0]))).toEqual(new Set(['date', 'affiliateId', ...METRIC_KEYS]));
  });

  it('NÃO vaza os campos só-de-UI `line` nem `affiliateLabel` (mesmo preenchidos na entrada)', () => {
    const row = makeRow({ line: 99, affiliateLabel: 'NÃO DEVE VAZAR' });
    expect(row.line).toBe(99);
    expect(row.affiliateLabel).toBe('NÃO DEVE VAZAR');

    const [item] = buildImportPayload(makeAnalysis([row]));
    expect(item).not.toHaveProperty('line');
    expect(item).not.toHaveProperty('affiliateLabel');
    expect(Object.keys(item)).not.toContain('line');
    expect(Object.keys(item)).not.toContain('affiliateLabel');
  });

  it('copia os valores de date, affiliateId e das 6 métricas fielmente', () => {
    const row = makeRow();
    const [item] = buildImportPayload(makeAnalysis([row]));
    expect(item.date).toBe(row.date);
    expect(item.affiliateId).toBe(row.affiliateId);
    for (const k of METRIC_KEYS) expect(item[k]).toBe(row[k]);
  });

  it('preserva affiliateId null (linha agregada da casa) sem virar string', () => {
    const row = makeRow({ affiliateId: null, affiliateLabel: undefined });
    const [item] = buildImportPayload(makeAnalysis([row]));
    expect(item.affiliateId).toBeNull();
    // mesmo no agregado o shape continua canônico (sem line/affiliateLabel)
    expect(Object.keys(item).sort()).toEqual(EXPECTED_KEYS);
  });

  it('mapeia todas as linhas preservando o shape canônico em cada uma', () => {
    const rows = [
      makeRow({ line: 2, date: '2026-06-01', affiliateId: 'a1' }),
      makeRow({ line: 3, date: '2026-06-02', affiliateId: null, affiliateLabel: undefined }),
      makeRow({ line: 4, date: '2026-06-03', affiliateId: 'a2' }),
    ];
    const payload = buildImportPayload(makeAnalysis(rows));
    expect(payload).toHaveLength(3);
    for (const item of payload) {
      expect(Object.keys(item).sort()).toEqual(EXPECTED_KEYS);
    }
    expect(payload.map((p) => p.affiliateId)).toEqual(['a1', null, 'a2']);
  });
});
