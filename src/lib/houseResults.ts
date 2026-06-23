// Resultados manuais por casa (Fase 2). Casas 'manual' (não vêm da OTG) recebem
// resultados via upload de planilha/CSV. Este módulo é PURO (sem rede/Firestore):
// parseia o CSV, resolve afiliados contra o roster e agrega as linhas pros vários
// recortes (por casa / por afiliado / por data) usados no merge com a OTG. Mantê-lo
// puro deixa toda a aritmética sensível (sem double-count, "não atribuído") testável.

// Métricas canônicas — mesmo shape das linhas de `results` da API externa, pra que
// as linhas manuais somem direto nas visões existentes.
export const METRIC_KEYS = [
  'registrations',
  'first_deposits',
  'qualified_cpa',
  'rvs',
  'deposit',
  'total_commission',
] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];
export type Metrics = Record<MetricKey, number>;

export function emptyMetrics(): Metrics {
  return { registrations: 0, first_deposits: 0, qualified_cpa: 0, rvs: 0, deposit: 0, total_commission: 0 };
}

export function addMetrics(into: Metrics, from: Partial<Metrics>): Metrics {
  for (const k of METRIC_KEYS) into[k] += Number(from[k]) || 0;
  return into;
}

// Linha gravada (Firestore): casa + data + afiliado (null = agregado do dia) + métricas.
export interface StoredManualRow extends Metrics {
  houseSlug: string;
  date: string;            // YYYY-MM-DD
  affiliateId: string | null; // null = agregado da casa naquele dia
}

// --- Parsing do CSV/planilha -------------------------------------------------

// Aliases de coluna (case/acento-insensitive). chave canônica -> apelidos aceitos.
const COLUMN_ALIASES: Record<'date' | 'affiliate' | MetricKey, string[]> = {
  date: ['data', 'date', 'dia'],
  affiliate: ['afiliado', 'affiliate', 'affiliate_id', 'afiliado_id', 'id', 'nome', 'name'],
  registrations: ['cadastros', 'cadastro', 'registrations', 'registros', 'reg'],
  first_deposits: ['ftd', 'first_deposits', 'primeiros_depositos', 'primeiro_deposito', 'pd'],
  qualified_cpa: ['cpa', 'cpa_qualificado', 'qualified_cpa', 'cpaq', 'cpa_qualif'],
  rvs: ['rev', 'rvs', 'revshare', 'rev_share', 'revenue'],
  deposit: ['deposito', 'depositos', 'deposit', 'valor_depositado', 'deposito_valor'],
  total_commission: ['comissao', 'comissoes', 'commission', 'total_commission', 'comissao_total'],
};

const stripKey = (s: string) =>
  s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim().replace(/[\s.]+/g, '_');

// Número tolerante a pt-BR (R$ 2.400,50) e a contagens simples. Regras:
//  - remove R$, %, espaços; vazio = 0;
//  - "." e "," juntos -> "." é milhar, "," é decimal (pt-BR);
//  - só "," -> decimal;
//  - só "." em grupos de 3 (ex.: 88.000 / 1.234.567) -> milhar (inteiro);
//  - resto -> decimal/inteiro direto.
export function parsePtNumber(raw: string | number | null | undefined): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  let s = String(raw ?? '').replace(/r\$/gi, '').replace(/%/g, '').replace(/\s| /g, '').trim();
  if (!s) return 0;
  const neg = /^-/.test(s);
  s = s.replace(/^-/, '');
  let out: number;
  if (s.includes('.') && s.includes(',')) out = parseFloat(s.replace(/\./g, '').replace(',', '.'));
  else if (s.includes(',')) out = parseFloat(s.replace(',', '.'));
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) out = parseInt(s.replace(/\./g, ''), 10);
  else out = parseFloat(s);
  if (!Number.isFinite(out)) return null;
  return neg ? -out : out;
}

// Data -> ISO YYYY-MM-DD. Aceita ISO, DD/MM/YYYY, DD/MM/YY, DD-MM-YYYY. Valida o dia real.
export function parseDateToISO(raw: string): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  let y: number, m: number, d: number;
  let mt = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (mt) { y = +mt[1]; m = +mt[2]; d = +mt[3]; }
  else {
    mt = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/.exec(s);
    if (!mt) return null;
    d = +mt[1]; m = +mt[2]; y = +mt[3];
    if (y < 100) y += 2000;
  }
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const dt = new Date(`${iso}T00:00:00Z`);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() + 1 !== m || dt.getUTCDate() !== d) return null;
  return iso;
}

const detectDelimiter = (headerLine: string): string => {
  if (headerLine.includes('\t')) return '\t';
  if (headerLine.includes(';')) return ';';
  return ',';
};

const splitLine = (line: string, delim: string) => line.split(delim).map((c) => c.trim());

export interface ParsedRow extends Metrics {
  line: number;        // nº da linha no texto colado (1-based, conta o header)
  date: string;        // ISO
  affiliate: string;   // token cru (id ou nome); '' = agregado da casa
}

export interface ParseError {
  line: number;
  raw: string;
  message: string;
}

export interface ParseResult {
  rows: ParsedRow[];
  errors: ParseError[];
  // índice de coluna de cada campo reconhecido (date/affiliate obrigam date; métricas opcionais)
  columns: Partial<Record<'date' | 'affiliate' | MetricKey, number>>;
}

// Parseia o texto colado. Exige uma linha de cabeçalho reconhecível com ao menos
// `data` e uma métrica. Linhas com afiliado vazio = agregado da casa naquele dia.
export function parseResultsCsv(text: string): ParseResult {
  const result: ParseResult = { rows: [], errors: [], columns: {} };
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  // primeira linha não-vazia = cabeçalho
  let headerIdx = lines.findIndex((l) => l.trim() !== '');
  if (headerIdx === -1) {
    result.errors.push({ line: 0, raw: '', message: 'Nada para importar.' });
    return result;
  }
  const delim = detectDelimiter(lines[headerIdx]);
  const headerCells = splitLine(lines[headerIdx], delim).map(stripKey);

  const aliasToKey = new Map<string, 'date' | 'affiliate' | MetricKey>();
  (Object.keys(COLUMN_ALIASES) as ('date' | 'affiliate' | MetricKey)[]).forEach((key) => {
    COLUMN_ALIASES[key].forEach((a) => aliasToKey.set(stripKey(a), key));
  });

  headerCells.forEach((cell, idx) => {
    const key = aliasToKey.get(cell);
    // primeira coluna que casa cada campo vence (evita sobrescrever com apelidos repetidos)
    if (key && result.columns[key] === undefined) result.columns[key] = idx;
  });

  if (result.columns.date === undefined) {
    result.errors.push({ line: headerIdx + 1, raw: lines[headerIdx], message: 'Cabeçalho sem coluna de data (ex.: "data").' });
    return result;
  }
  const hasMetric = METRIC_KEYS.some((k) => result.columns[k] !== undefined);
  if (!hasMetric) {
    result.errors.push({ line: headerIdx + 1, raw: lines[headerIdx], message: 'Cabeçalho sem nenhuma coluna de métrica (cadastros, ftd, cpa, rev, depósito, comissão).' });
    return result;
  }

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.trim() === '') continue;
    const cells = splitLine(raw, delim);
    const lineNo = i + 1;

    const iso = parseDateToISO(cells[result.columns.date!] ?? '');
    if (!iso) {
      result.errors.push({ line: lineNo, raw, message: `Data inválida: "${cells[result.columns.date!] ?? ''}".` });
      continue;
    }
    const affiliate = result.columns.affiliate !== undefined ? (cells[result.columns.affiliate] ?? '').trim() : '';

    const row: ParsedRow = { line: lineNo, date: iso, affiliate, ...emptyMetrics() };
    let bad = '';
    for (const k of METRIC_KEYS) {
      const col = result.columns[k];
      if (col === undefined) continue;
      const n = parsePtNumber(cells[col] ?? '');
      if (n === null) { bad = `${k}="${cells[col] ?? ''}"`; break; }
      row[k] = n;
    }
    if (bad) {
      result.errors.push({ line: lineNo, raw, message: `Valor numérico inválido (${bad}).` });
      continue;
    }
    result.rows.push(row);
  }
  return result;
}

// --- Resolução de afiliados --------------------------------------------------
// Mapeia o token do CSV (id OU nome) para um affiliateId do roster. Token vazio =
// agregado (affiliateId null). Tokens não-resolvidos são reportados (a UI bloqueia
// a importação até resolver, p/ não gravar atribuição fantasma).
export interface ResolvedRow extends Metrics {
  line: number;
  date: string;
  affiliateId: string | null;
  affiliateLabel?: string;
}
export interface ResolveResult {
  rows: ResolvedRow[];
  unresolved: { line: number; token: string }[];
}

export type AffiliateLookup = (token: string) => { id: string; label?: string } | null;

export function resolveAffiliates(parsed: ParsedRow[], lookup: AffiliateLookup): ResolveResult {
  const out: ResolveResult = { rows: [], unresolved: [] };
  for (const p of parsed) {
    const base = { line: p.line, date: p.date, ...metricsOf(p) };
    if (!p.affiliate) {
      out.rows.push({ ...base, affiliateId: null });
      continue;
    }
    const hit = lookup(p.affiliate);
    if (!hit) {
      out.unresolved.push({ line: p.line, token: p.affiliate });
      continue;
    }
    out.rows.push({ ...base, affiliateId: hit.id, affiliateLabel: hit.label });
  }
  return out;
}

// Lookup por id exato OU nome normalizado, a partir da lista de afiliados.
export function buildAffiliateLookup(
  affiliates: { id?: string; _id?: string; name?: string; label?: string }[]
): AffiliateLookup {
  const byId = new Map<string, { id: string; label?: string }>();
  const byName = new Map<string, { id: string; label?: string }>();
  for (const a of Array.isArray(affiliates) ? affiliates : []) {
    const id = String(a.id ?? a._id ?? '').trim();
    if (!id) continue;
    const label = a.name || a.label || undefined;
    byId.set(id.toLowerCase(), { id, label });
    for (const nm of [a.name, a.label]) {
      const key = nm ? stripKey(String(nm)) : '';
      if (key && !byName.has(key)) byName.set(key, { id, label });
    }
  }
  return (token: string) => {
    const t = String(token ?? '').trim();
    if (!t) return null;
    return byId.get(t.toLowerCase()) || byName.get(stripKey(t)) || null;
  };
}

const metricsOf = (m: Partial<Metrics>): Metrics => addMetrics(emptyMetrics(), m);

// --- Agregações pro merge (puras) --------------------------------------------
// Agregado da casa naquele dia: a linha agregada explícita (affiliateId null) quando
// existe; senão a soma das linhas atribuídas. Evita double-count quando o usuário
// sobe AMBOS (agregado + por afiliado).
function dailyAggregate(rows: StoredManualRow[]): Map<string, Metrics> {
  // chave = houseSlug|date
  const explicit = new Map<string, Metrics>();
  const summed = new Map<string, Metrics>();
  const hasExplicit = new Set<string>();
  for (const r of rows) {
    const key = `${r.houseSlug}|${r.date}`;
    if (r.affiliateId === null) {
      hasExplicit.add(key);
      addMetrics(explicit.get(key) ?? explicit.set(key, emptyMetrics()).get(key)!, r);
    } else {
      addMetrics(summed.get(key) ?? summed.set(key, emptyMetrics()).get(key)!, r);
    }
  }
  const out = new Map<string, Metrics>();
  const keys = new Set([...explicit.keys(), ...summed.keys()]);
  for (const key of keys) out.set(key, hasExplicit.has(key) ? explicit.get(key)! : summed.get(key)!);
  return out;
}

// Total por CASA no range (soma dos agregados diários). Chave = houseSlug.
export function aggregateByHouse(rows: StoredManualRow[]): Record<string, Metrics> {
  const daily = dailyAggregate(rows);
  const out: Record<string, Metrics> = {};
  for (const [key, m] of daily) {
    const slug = key.split('|')[0];
    addMetrics(out[slug] ?? (out[slug] = emptyMetrics()), m);
  }
  return out;
}

// Total por DATA no range (soma dos agregados das casas). Chave = date ISO.
export function aggregateByDate(rows: StoredManualRow[]): Record<string, Metrics> {
  const daily = dailyAggregate(rows);
  const out: Record<string, Metrics> = {};
  for (const [key, m] of daily) {
    const date = key.split('|')[1];
    addMetrics(out[date] ?? (out[date] = emptyMetrics()), m);
  }
  return out;
}

// Total por AFILIADO no range (só linhas ATRIBUÍDAS; agregado não vira repasse).
// Chave = affiliateId.
export function aggregateByAffiliate(rows: StoredManualRow[]): Record<string, Metrics> {
  const out: Record<string, Metrics> = {};
  for (const r of rows) {
    if (r.affiliateId === null) continue;
    addMetrics(out[r.affiliateId] ?? (out[r.affiliateId] = emptyMetrics()), r);
  }
  return out;
}

// Total por AFILIADO × CASA (atribuídas), p/ o breakdown por casa de um afiliado e
// p/ o lucro por casa manual. Chave = `${affiliateId}|${houseSlug}`.
export function aggregateByAffiliateHouse(rows: StoredManualRow[]): Record<string, Metrics> {
  const out: Record<string, Metrics> = {};
  for (const r of rows) {
    if (r.affiliateId === null) continue;
    const key = `${r.affiliateId}|${r.houseSlug}`;
    addMetrics(out[key] ?? (out[key] = emptyMetrics()), r);
  }
  return out;
}

// "Não atribuído" por casa no range = agregado − Σ atribuídos (clamp em 0 por métrica).
export function unattributedByHouse(rows: StoredManualRow[]): Record<string, Metrics> {
  const houseTotals = aggregateByHouse(rows);
  const attributed: Record<string, Metrics> = {};
  for (const r of rows) {
    if (r.affiliateId === null) continue;
    addMetrics(attributed[r.houseSlug] ?? (attributed[r.houseSlug] = emptyMetrics()), r);
  }
  const out: Record<string, Metrics> = {};
  for (const slug of Object.keys(houseTotals)) {
    const agg = houseTotals[slug];
    const att = attributed[slug] ?? emptyMetrics();
    const diff = emptyMetrics();
    for (const k of METRIC_KEYS) diff[k] = Math.max(0, agg[k] - att[k]);
    out[slug] = diff;
  }
  return out;
}
