// Projeção dos resultados da OTG expostos ao PARCEIRO externo
// (/api/partner/v1/results). Regra do Carlos (2026-06-17): pro parceiro só podemos
// passar CADASTRO, DEPÓSITOS e CPA — em CONTAGEM. **NADA de valores (R$).**
// Por isso a projeção é uma WHITELIST (não blocklist): qualquer campo monetário da
// OTG — conhecido (total_commission, cpa, rvs, deposit) ou futuro/desconhecido —
// é descartado por padrão. Pura e testável; o server.ts aplica antes do envelope.

// Dimensões/identidade (não-monetárias) — variam conforme o groupBy
// (affiliate/brand/date/campaign). Mantê-las deixa o dado útil sem expor valor.
const DIMENSION_FIELDS = [
  'affiliate_id', 'affiliate_name',
  'id', 'name', 'label',
  'brand', 'brand_id', 'brand_name',
  'date', 'campaign', 'campaign_id', 'campaign_name',
] as const;

// Métricas PERMITIDAS — contagens, nunca R$:
//   registrations  = cadastros
//   first_deposits = depósitos (FTD, CONTAGEM — NÃO o `deposit`, que é o valor R$)
//   qualified_cpa  = CPA (contagem qualificada — NÃO o `cpa`, que é o valor R$)
const COUNT_FIELDS = ['registrations', 'first_deposits', 'qualified_cpa'] as const;

export const PARTNER_RESULT_ALLOWED_FIELDS: string[] = [...DIMENSION_FIELDS, ...COUNT_FIELDS];

// Campos monetários da OTG (proibidos). A whitelist acima já os exclui; listados
// aqui só p/ deixar a intenção auditável e travar via teste de não-regressão.
export const PARTNER_RESULT_MONETARY_FIELDS = [
  'total_commission', 'commission', 'cpa', 'rvs', 'rev', 'deposit', 'deposits',
  'revenue', 'ngr', 'ggr', 'wager', 'payout', 'net_profit', 'profit',
];

// Projeta UMA linha de resultado pra só os campos permitidos.
export function projectPartnerResult(row: any): Record<string, any> {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return {};
  const out: Record<string, any> = {};
  for (const k of PARTNER_RESULT_ALLOWED_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(row, k)) out[k] = row[k];
  }
  return out;
}

// Projeta a lista inteira (tolera entrada não-array).
export function projectPartnerResults(rows: any): Record<string, any>[] {
  return (Array.isArray(rows) ? rows : []).map(projectPartnerResult);
}

// --- Auditoria (usada pelo explorer p/ PROVAR a resposta visualmente) ---------

// Todos os campos distintos presentes nas linhas (ordenados) — p/ listar na UI.
export function collectFields(rows: any): string[] {
  const set = new Set<string>();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (row && typeof row === 'object' && !Array.isArray(row)) {
      for (const k of Object.keys(row)) set.add(k);
    }
  }
  return Array.from(set).sort();
}

// Quais campos MONETÁRIOS (proibidos) aparecem nas linhas. Vazio = limpo. É o
// sinal que o explorer usa p/ mostrar verde ("só contagem/identidade") ou vermelho.
export function findMonetaryFields(rows: any): string[] {
  return collectFields(rows).filter((k) => PARTNER_RESULT_MONETARY_FIELDS.includes(k));
}
