// Lógica pura do import de resultados manuais por casa (Houses.tsx), extraída p/
// ficar testável e — principalmente — garantir o SHAPE do payload. O `buildImportPayload`
// copia EXATAMENTE { date, affiliateId, ...6 métricas }; campos só-de-UI do ResolvedRow
// (`line`, `affiliateLabel`) NÃO podem vazar p/ o backend (R24).
import { METRIC_KEYS, type ResolveResult } from './houseResults';
import type { ImportResultRow } from '../services/houseService';

// Gatilho do botão "Importar": só habilita com análise presente, ≥1 linha resolvida,
// zero erro de parse e zero afiliado não-encontrado (unresolved). `parseErrors` é só
// contado (length) — aceita qualquer shape de erro da página.
export function canImport(analysis: ResolveResult | null, parseErrors: ReadonlyArray<unknown>): boolean {
  return (
    !!analysis &&
    analysis.rows.length > 0 &&
    parseErrors.length === 0 &&
    analysis.unresolved.length === 0
  );
}

// Monta o payload enviado a importHouseResults: só date + affiliateId (null = agregado)
// + as 6 métricas canônicas. O loop sobre METRIC_KEYS é a barreira contra vazar
// `affiliateLabel`/`line` (não estão em METRIC_KEYS) e o tipo ImportResultRow trava o shape.
export function buildImportPayload(analysis: ResolveResult): ImportResultRow[] {
  return analysis.rows.map((r) => {
    const out: ImportResultRow = { date: r.date, affiliateId: r.affiliateId };
    for (const k of METRIC_KEYS) out[k] = r[k];
    return out;
  });
}
