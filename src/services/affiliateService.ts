import { 
  collection, 
  doc, 
  getDoc, 
  setDoc, 
  getDocs,
  query,
  where,
  serverTimestamp 
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { authFetch } from '../lib/api';
import { withKnownHouses } from '../lib/knownHouses';
import { findAffiliateInList } from '../lib/affiliateLookup';
import { getDefaultRange } from '../lib/dateRange';
import { getKnownBrands } from '../lib/brand';
import { fetchHouseResults } from './houseService';
import {
  StoredManualRow, Metrics, METRIC_KEYS,
  aggregateByHouse, aggregateByDate, aggregateByAffiliate,
} from '../lib/houseResults';
// Núcleo PURO de comissão (movido p/ lib/commission p/ o server.ts reusar a MESMA
// fórmula). Re-exportado abaixo p/ os call-sites antigos (`from './affiliateService'`).
import {
  num,
  resolveBrandRates,
  rateStatus,
  calcAffiliatePayout,
  calcNetProfit,
  type BrandRates,
  type AffiliateConfig,
} from '../lib/commission';
export { resolveBrandRates, rateStatus, calcAffiliatePayout, calcNetProfit };
export type { BrandRates, AffiliateConfig };

interface Affiliate {
  id: string;
  name: string;
  email: string;
  status: string;
  brand?: {
    id: string;
    name: string;
  };
  createdAt: string;
}

export interface AffiliateStatusConfig {
  status: 'active' | 'inactive';
  updatedAt?: string | null;
}

interface ApiErrorInfo {
  code?: string;
  message: string;
  noData: boolean;
}

// SECURITY (HIGH-1): o cliente NUNCA fala direto com a API de parceiros. A chave
// (x-api-key) vive somente no servidor; todo acesso passa pelo proxy autenticado
// `/api/external/...` (o `server.ts` injeta a chave server-side). Não há fallback
// de fetch direto nem leitura de env `VITE_*` de credencial no browser — qualquer
// VITE_* seria embarcado no bundle estático e vazaria a chave do parceiro.
async function fetchAffiliateApi(endpoint: string, query?: URLSearchParams): Promise<Response> {
  const proxyUrl = `/api/external/${endpoint}${query && query.toString() ? `?${query.toString()}` : ''}`;
  return authFetch(proxyUrl, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
    },
  });
}

// SECURITY (R5): as taxas (CPA/REV/byBrand) são dado comercial sensível — não são
// mais lidas direto do Firestore pelo cliente (a rule de affiliate_configs passou a
// ser admin-only). A leitura é mediada pelo servidor, que ESCOPA por papel: admin
// recebe todas; afiliado recebe só a própria + (se especial ativo) as da sub-rede.
// Mesma assinatura/retorno de antes — as páginas não mudam (já usavam só o próprio/subs).
export async function fetchAffiliateConfigs(): Promise<Record<string, AffiliateConfig>> {
  try {
    const resp = await authFetch('/api/affiliate-configs', { method: 'GET', headers: { Accept: 'application/json' } });
    if (!resp.ok) {
      console.error('Error fetching affiliate configs:', resp.status);
      return {};
    }
    const body = await resp.json().catch(() => null);
    return (body && typeof body === 'object' && body.configs && typeof body.configs === 'object')
      ? (body.configs as Record<string, AffiliateConfig>)
      : {};
  } catch (error) {
    console.error('Error fetching affiliate configs:', error);
    return {};
  }
}

export interface AffiliateFunnel {
  id: string;
  nameKey: string;
  affiliate: string;
  house: string;
  affiliateId: string | null;
  funnelOnly: boolean;
  clicks: number;
  registrations: number;
  ftd: number;
  cpaQual: number;
  deposits: number;
  betAmount: number;
  ngr: number;
  range?: { initialDate: string; finalDate: string };
}

// Funil da v1 analítica (cliques/cadastros/FTD/NGR) escopado por papel pelo servidor
// (admin = todos; afiliado = próprio + sub-rede). Cliente NUNCA lê affiliate_analytics
// direto. Ver server.ts GET /api/affiliate-analytics + src/lib/analyticsDoc.
export async function fetchAffiliateAnalytics(): Promise<AffiliateFunnel[]> {
  try {
    const resp = await authFetch('/api/affiliate-analytics', { method: 'GET', headers: { Accept: 'application/json' } });
    if (!resp.ok) {
      console.error('Error fetching affiliate analytics:', resp.status);
      return [];
    }
    const body = await resp.json().catch(() => null);
    return body && Array.isArray(body.analytics) ? (body.analytics as AffiliateFunnel[]) : [];
  } catch (error) {
    console.error('Error fetching affiliate analytics:', error);
    return [];
  }
}

// Aceita payload PARCIAL: omitir cpaValue/revPercentage (em vez de mandar 0)
// preserva a AUSÊNCIA da taxa no merge — é o que impede o "0 fantasma" de topo.
export async function saveAffiliateConfig(config: Partial<AffiliateConfig> & { affiliateId: string }): Promise<void> {
  try {
    const docRef = doc(db, 'affiliate_configs', config.affiliateId);
    // merge:true → preserva `byBrand` (overrides por casa) quando o editor de taxa
    // de topo salva só cpaValue/revPercentage. [[B6]]
    await setDoc(docRef, {
      ...config,
      updatedAt: serverTimestamp()
    }, { merge: true });
  } catch (error) {
    console.error('Error saving affiliate config:', error);
    throw error;
  }
}

// Monta o payload de TOPO do editor de comissão preservando a ausência: grava um
// campo só quando foi digitado AGORA (string não-vazia) OU já existia como número.
// Retorna null quando não há nada a gravar no topo — evita que editar só o REV (ou
// só um override por casa) crie um `cpaValue: 0` fantasma num afiliado que nunca teve
// taxa de contrato, o que faria rateStatus ver "0 real" em vez de "não configurado".
export function buildBrandConfigTopPayload(
  base: { cpa: string; rev: string },
  config?: AffiliateConfig | null
): Partial<Pick<AffiliateConfig, 'cpaValue' | 'revPercentage'>> | null {
  const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  const top: Partial<Pick<AffiliateConfig, 'cpaValue' | 'revPercentage'>> = {};
  if (base.cpa.trim() !== '') top.cpaValue = Number(base.cpa) || 0;
  else if (isNum(config?.cpaValue)) top.cpaValue = config!.cpaValue;
  if (base.rev.trim() !== '') top.revPercentage = Number(base.rev) || 0;
  else if (isNum(config?.revPercentage)) top.revPercentage = config!.revPercentage;
  return Object.keys(top).length > 0 ? top : null;
}

// B6 · salva apenas os overrides por casa de um afiliado (admin — affiliate_configs
// é admin-only nas rules). merge:true preserva as taxas de topo. Envie o mapa
// COMPLETO de casas que devem ter override; remover um override = reescrever o
// mapa sem aquela chave + recarregar (no MVP dev o editor sempre manda todas as
// casas presentes, então não há fluxo de remoção parcial).
export async function saveAffiliateBrandRates(
  affiliateId: string,
  byBrand: Record<string, BrandRates>
): Promise<void> {
  try {
    const docRef = doc(db, 'affiliate_configs', affiliateId);
    await setDoc(docRef, { affiliateId, byBrand, updatedAt: serverTimestamp() }, { merge: true });
  } catch (error) {
    console.error('Error saving affiliate brand rates:', error);
    throw error;
  }
}

// --- B3 · Afiliado especial (Fase 1: modelo + setup do master) ----------------
// Marca um afiliado como ESPECIAL e lista seus sub-afiliados. Coleção própria da
// Boost (NÃO o mirror `affiliates`, que o sync sobrescreve). Modelo de comissão
// (confirmado pelo Carlos): o ganho do especial é o SPREAD sobre a TAXA PRÓPRIA
// dele (o CPA/REV que o master configura em `affiliate_configs`) — a agência paga
// o especial pela taxa própria sobre toda a rede, ele repassa cada sub pela taxa
// que ele mesmo define no /network, e fica com a diferença. Sem teto do master.
export interface SpecialAffiliate {
  affiliateId: string;
  active: boolean;
  subAffiliateIds: string[];
  // @deprecated — o teto do master foi removido (o especial seta a rede livremente).
  // Mantidos opcionais só para compat com docs antigos; não são mais escritos/lidos.
  networkCpaValue?: number;
  networkRevPercentage?: number;
  updatedAt?: any;
}

export async function fetchSpecialAffiliates(): Promise<Record<string, SpecialAffiliate>> {
  try {
    const snap = await getDocs(collection(db, 'special_affiliates'));
    const out: Record<string, SpecialAffiliate> = {};
    snap.forEach((d) => {
      const data = d.data() as any;
      out[d.id] = {
        affiliateId: d.id,
        active: !!data.active,
        subAffiliateIds: Array.isArray(data.subAffiliateIds) ? data.subAffiliateIds.map(String) : [],
        networkCpaValue: Number(data.networkCpaValue) || 0,
        networkRevPercentage: Number(data.networkRevPercentage) || 0,
        updatedAt: data.updatedAt ?? null,
      };
    });
    return out;
  } catch (error) {
    console.error('Error fetching special affiliates:', error);
    return {};
  }
}

// Grava o registro de afiliado especial VIA SERVIDOR — o endpoint escreve
// special_affiliates E espelha a flag isSpecial em todo login vinculado ao
// affiliateId (resolvido no servidor). Não depende mais do client passar o
// userUid: isso eliminava o flag quando o login não estava resolvido no momento
// da promoção (especial ativo sem acesso à /network).
export async function saveSpecialAffiliate(data: SpecialAffiliate): Promise<void> {
  const response = await authFetch('/api/special-affiliates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      affiliateId: String(data.affiliateId),
      active: !!data.active,
      subAffiliateIds: (data.subAffiliateIds ?? []).map(String),
    }),
  });
  if (!response.ok) {
    const e = await response.json().catch(() => ({}));
    throw new Error(e.error || e.message || `Erro: ${response.status}`);
  }
}

// O afiliado especial define a comissão de um sub da própria sub-rede (via servidor,
// que valida posse + teto — affiliate_configs é admin-only nas rules).
export async function saveSubAffiliateConfig(subAffiliateId: string, cpaValue: number, revPercentage: number): Promise<void> {
  const response = await authFetch('/api/special/sub-config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ subAffiliateId, cpaValue, revPercentage }),
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || errorData.message || `Erro: ${response.status}`);
  }
}

// --- B4 · Dados de pagamento do afiliado (PIX + dados de NF) ------------------
// Coletados pelo próprio afiliado (afiliado preenche, admin só visualiza). PII
// numa coleção server-only (payment_profiles); todo acesso passa pelo servidor.
export interface PaymentProfile {
  affiliateId?: string;
  pixKeyType?: string;                 // cpf | cnpj | email | telefone | aleatoria
  pixKey?: string;
  documentType?: 'cpf' | 'cnpj';
  document?: string;                   // CPF ou CNPJ
  legalName?: string;                  // Razão Social / Nome completo
  address?: string;
  updatedAt?: any;
}

// Perfil de pagamento do próprio afiliado logado (escopado pelo token no server).
export async function fetchMyPaymentProfile(): Promise<PaymentProfile> {
  const response = await authFetch('/api/payment-profile', { method: 'GET', headers: { Accept: 'application/json' } });
  if (!response.ok) {
    const e = await response.json().catch(() => ({}));
    throw new Error(e.error || e.message || `Erro: ${response.status}`);
  }
  return response.json();
}

export async function saveMyPaymentProfile(data: PaymentProfile): Promise<PaymentProfile> {
  const response = await authFetch('/api/payment-profile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const e = await response.json().catch(() => ({}));
    throw new Error(e.error || e.message || `Erro: ${response.status}`);
  }
  return response.json();
}

// Perfil de pagamento de um afiliado (admin — visualização).
export async function fetchPaymentProfile(affiliateId: string): Promise<PaymentProfile> {
  const response = await authFetch(`/api/payment-profile/${encodeURIComponent(affiliateId)}`, { method: 'GET', headers: { Accept: 'application/json' } });
  if (!response.ok) {
    const e = await response.json().catch(() => ({}));
    throw new Error(e.error || e.message || `Erro: ${response.status}`);
  }
  return response.json();
}

// Admin · vincula um login EXISTENTE (por e-mail) a um afiliado, gravando
// `affiliateId` no doc users/{uid} e espelhando `isSpecial` (via servidor —
// affiliateId/isSpecial são server-only nas rules). Corrige o login órfão que
// prende o afiliado no /profile (clientHome sem affiliateId nem isSpecial).
export async function linkAffiliateUser(
  email: string,
  affiliateId: string
): Promise<{ uid: string; affiliateId: string; isSpecial: boolean }> {
  const response = await authFetch('/api/link-affiliate-user', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ email, affiliateId }),
  });
  if (!response.ok) {
    const e = await response.json().catch(() => ({}));
    throw new Error(e.error || e.message || `Erro ao vincular login: ${response.status}`);
  }
  return response.json();
}

export async function fetchAffiliateStatuses(): Promise<Record<string, AffiliateStatusConfig>> {
  try {
    const response = await authFetch('/api/affiliate-statuses', {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || errorData.message || `Erro na API: ${response.status}`);
    }

    const data = await response.json();
    return data && typeof data === 'object' ? data : {};
  } catch (error) {
    console.error('Error fetching affiliate statuses:', error);
    return {};
  }
}

export async function fetchAffiliates(): Promise<Affiliate[]> {
  try {
    const response = await fetchAffiliateApi('affiliates');

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || errorData.message || `Erro na API: ${response.status}`);
    }

    const data = await response.json();
    const apiError = extractApiError(data);
    if (apiError) {
      if (apiError.noData) {
        console.warn(`Affiliate API returned no data (${apiError.code || 'no-code'}): ${apiError.message}`);
        return [];
      }
      throw new Error(apiError.message);
    }

    return extractArray(data);
  } catch (error) {
    console.error('Affiliate fetch error:', error);
    throw error;
  }
}

// The external API has no GET /affiliates/:id endpoint (it 404s). We read from the
// local `affiliates` mirror (populated by syncAffiliates) and only fall back to a
// full-list scan if the affiliate hasn't been synced yet.
export async function fetchAffiliateById(id: string): Promise<any> {
  const normalizedId = String(id);

  try {
    const docSnap = await getDoc(doc(db, 'affiliates', normalizedId));
    if (docSnap.exists()) {
      return docSnap.data();
    }
  } catch (error) {
    console.error(`Error reading local affiliate ${normalizedId}:`, error);
  }

  try {
    const allAffiliates = await fetchAffiliates();
    const found = findAffiliateInList(allAffiliates, normalizedId);
    if (found) return found;
  } catch (error) {
    console.error(`Fallback list lookup failed for affiliate ${normalizedId}:`, error);
  }

  return null;
}

interface ResultsQuery {
  affiliateIds?: string;
  startDate?: string;
  endDate?: string;
}

async function fetchResultsGrouped(groupBy: 'affiliate' | 'brand' | 'date' | 'campaign', opts: ResultsQuery = {}): Promise<any[]> {
  const defaults = getDefaultRange();
  const params = new URLSearchParams({
    startDate: opts.startDate || defaults.startDate,
    endDate: opts.endDate || defaults.endDate,
    groupBy
  });
  if (opts.affiliateIds) params.set('affiliateIds', opts.affiliateIds);

  const response = await fetchAffiliateApi('results', params);
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || errorData.message || `Erro na API: ${response.status}`);
  }

  const data = await response.json();
  const apiError = extractApiError(data);
  if (apiError) {
    if (apiError.noData) return [];
    throw new Error(apiError.message);
  }

  if (data.data && Array.isArray(data.data.data)) return data.data.data;
  return Array.isArray(data.data) ? data.data : (Array.isArray(data) ? data : []);
}

export interface DateRangeOpts {
  startDate?: string;
  endDate?: string;
}

// --- Merge dos resultados MANUAIS (casas 'manual') ---------------------------
// As casas 'manual' (não vêm da OTG) recebem resultados por upload (house_results).
// Aqui somamos essas linhas às da OTG, respeitando o groupBy. O merge é ADITIVO e
// só ocorre nas visões por casa/data e nas escopadas a afiliado — NÃO em
// fetchAllResults (groupBy=affiliate da rede), que alimenta a atribuição "1 casa
// por afiliado" do /admin (manual é incorporado lá explicitamente, sem contaminar).

// Busca as linhas manuais do range; nunca lança (dado opcional/aditivo).
async function fetchManualRowsSafe(opts: DateRangeOpts): Promise<StoredManualRow[]> {
  try {
    return await fetchHouseResults({ start: opts.startDate, end: opts.endDate });
  } catch {
    return [];
  }
}

// Mantém só as linhas ATRIBUÍDAS a um conjunto de afiliados (descarta agregados).
function manualForAffiliates(rows: StoredManualRow[], ids: (string | number)[]): StoredManualRow[] {
  const set = new Set(ids.map(String));
  return rows.filter((r) => r.affiliateId !== null && set.has(String(r.affiliateId)));
}

// Linha de marca (groupBy=brand) a partir do total de uma casa manual.
function manualBrandRow(slug: string, m: Metrics): any {
  const meta = getKnownBrands().find((b) => b.slug === slug);
  return {
    id: meta?.id ?? slug,
    label: meta?.name ?? slug,
    registrations: m.registrations,
    first_deposits: m.first_deposits,
    qualified_cpa: m.qualified_cpa,
    rvs: m.rvs,
    deposit: m.deposit,
    cpa: 0,
    total_commission: m.total_commission,
  };
}

// Anexa as casas manuais (uma linha por casa) às linhas groupBy=brand da OTG.
// Casas manuais e OTG são disjuntas, então é append puro (sem risco de somar 2×).
function appendManualBrandRows(otg: any[], byHouse: Record<string, Metrics>): any[] {
  const rows = Array.isArray(otg) ? [...otg] : [];
  for (const slug of Object.keys(byHouse)) rows.push(manualBrandRow(slug, byHouse[slug]));
  return rows;
}

// Soma o manual por afiliado nas linhas groupBy=affiliate (merge por id; push se novo).
function mergeManualAffiliateRows(otg: any[], byAff: Record<string, Metrics>): any[] {
  const rows = Array.isArray(otg) ? otg.map((r) => ({ ...r })) : [];
  const idx = new Map<string, any>();
  rows.forEach((r) => { const id = String(r.affiliate_id ?? r.id ?? ''); if (id) idx.set(id, r); });
  for (const id of Object.keys(byAff)) {
    const m = byAff[id];
    const existing = idx.get(id);
    if (existing) {
      for (const k of METRIC_KEYS) existing[k] = (Number(existing[k]) || 0) + m[k];
    } else {
      rows.push({ id, affiliate_id: id, ...m, cpa: 0 });
    }
  }
  return rows;
}

// Soma o manual por data nas linhas groupBy=date (a data está em r.id).
function mergeManualDateRows(otg: any[], byDate: Record<string, Metrics>): any[] {
  const rows = Array.isArray(otg) ? otg.map((r) => ({ ...r })) : [];
  const idx = new Map<string, any>();
  rows.forEach((r) => { const d = String(r.id ?? r.label ?? ''); if (d) idx.set(d, r); });
  for (const date of Object.keys(byDate)) {
    const m = byDate[date];
    const existing = idx.get(date);
    if (existing) {
      for (const k of METRIC_KEYS) existing[k] = (Number(existing[k]) || 0) + m[k];
    } else {
      rows.push({ id: date, label: date, ...m });
    }
  }
  return rows;
}

// Busca pública das linhas manuais (o /admin incorpora ao lucro/totais por casa).
export async function fetchManualResults(opts: DateRangeOpts = {}): Promise<StoredManualRow[]> {
  return fetchManualRowsSafe(opts);
}

// Per-house (brand) breakdown for an affiliate.
export async function fetchAffiliateResultsByBrand(id: string, opts: DateRangeOpts = {}): Promise<any[]> {
  try {
    // Casas conhecidas aparecem mesmo vazias (modelo OTG); as casas MANUAIS do
    // afiliado entram com a produção atribuída a ele (house_results).
    const [otg, manual] = await Promise.all([
      fetchResultsGrouped('brand', { affiliateIds: id, ...opts }),
      fetchManualRowsSafe(opts),
    ]);
    const mine = manualForAffiliates(manual, [id]);
    return withKnownHouses(appendManualBrandRows(otg, aggregateByHouse(mine)));
  } catch (error) {
    console.error(`Error fetching brand results for affiliate ${id}:`, error);
    return [];
  }
}

// Daily time series for an affiliate. Defaults to the dashboard range (current month)
// when no explicit start/end is supplied.
export async function fetchAffiliateDailyResults(id: string, startDate?: string, endDate?: string): Promise<any[]> {
  try {
    const [otg, manual] = await Promise.all([
      fetchResultsGrouped('date', { affiliateIds: id, startDate, endDate }),
      fetchManualRowsSafe({ startDate, endDate }),
    ]);
    return mergeManualDateRows(otg, aggregateByDate(manualForAffiliates(manual, [id])));
  } catch (error) {
    console.error(`Error fetching daily results for affiliate ${id}:`, error);
    return [];
  }
}

export async function fetchAffiliateResults(id: string, opts: DateRangeOpts = {}): Promise<any> {
  try {
    const [otg, manual] = await Promise.all([
      fetchResultsGrouped('affiliate', { affiliateIds: id, ...opts }),
      fetchManualRowsSafe(opts),
    ]);
    return mergeManualAffiliateRows(otg, aggregateByAffiliate(manualForAffiliates(manual, [id])));
  } catch (error) {
    console.error(`Error fetching results for affiliate ${id}:`, error);
    throw error;
  }
}

export async function fetchAllResults(opts: DateRangeOpts = {}): Promise<any[]> {
  try {
    return await fetchResultsGrouped('affiliate', opts);
  } catch (error) {
    console.error('Error fetching all results:', error);
    throw error;
  }
}

// Resultados por afiliado para um CONJUNTO de ids (groupBy=affiliate). Usado pelo
// master p/ ver a rede de um afiliado especial (own + subs) na AffiliateDetails.
// O proxy expande o CSV em params repetidos (a API externa exige isso, não aceita
// affiliateIds=a,b). Admin não sofre auto-escopo no servidor.
export async function fetchResultsForAffiliates(ids: string[], opts: DateRangeOpts = {}): Promise<any[]> {
  const clean = (ids || []).map(String).map((s) => s.trim()).filter(Boolean);
  if (!clean.length) return [];
  try {
    const [otg, manual] = await Promise.all([
      fetchResultsGrouped('affiliate', { affiliateIds: clean.join(','), ...opts }),
      fetchManualRowsSafe(opts),
    ]);
    return mergeManualAffiliateRows(otg, aggregateByAffiliate(manualForAffiliates(manual, clean)));
  } catch (error) {
    console.error('Error fetching results for affiliate set:', error);
    return [];
  }
}

// Per-house (brand) breakdown for the whole accessible scope (sem affiliateIds).
// Admin → rede inteira; afiliado especial → o proxy escopa à sub-rede (own + subs).
export async function fetchAllResultsByBrand(opts: DateRangeOpts = {}): Promise<any[]> {
  try {
    // Casas conhecidas aparecem mesmo vazias (modelo OTG); casas MANUAIS entram
    // com o agregado da casa no range (house_results).
    const [otg, manual] = await Promise.all([
      fetchResultsGrouped('brand', opts),
      fetchManualRowsSafe(opts),
    ]);
    return withKnownHouses(appendManualBrandRows(otg, aggregateByHouse(manual)));
  } catch (error) {
    console.error('Error fetching network brand results:', error);
    return [];
  }
}

// Daily time series for the whole accessible scope (sem affiliateIds).
// Admin → rede inteira; afiliado especial → o proxy escopa à sub-rede (own + subs).
export async function fetchAllDailyResults(opts: DateRangeOpts = {}): Promise<any[]> {
  try {
    const [otg, manual] = await Promise.all([
      fetchResultsGrouped('date', opts),
      fetchManualRowsSafe(opts),
    ]);
    return mergeManualDateRows(otg, aggregateByDate(manual));
  } catch (error) {
    console.error('Error fetching network daily results:', error);
    return [];
  }
}

// --- Por Campanha ------------------------------------------------------------
// Visão analítica por campanha (results?groupBy=campaign). Disponível em dois lugares:
//   - por afiliado (AffiliateDetails / painel do cliente), escopado via affiliateIds;
//   - agregada da rede (AdminDashboard), sem affiliateIds (somente admin no proxy).

// Linha de campanha normalizada — soma das métricas cruas da API por campanha.
export interface CampaignRow {
  id: string;
  name: string;
  total_commission: number;
  cpa: number;
  rvs: number;
  registrations: number;
  first_deposits: number;
  qualified_cpa: number;
  deposit: number;
}

// `num` agora vem de lib/commission (importado no topo) — fonte única, sem NaN.

// Agrega linhas cruas de results?groupBy=campaign por campanha, somando as métricas.
// Defensivo porque (a) a API externa varia os nomes de campo e (b) a chamada da rede
// pode devolver uma linha por afiliado×campanha — agrupamos por id/nome da campanha
// para um total por campanha independentemente do shape recebido.
export function aggregateByCampaign(rows: any[]): CampaignRow[] {
  const byKey = new Map<string, CampaignRow>();

  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== 'object') continue;
    const name = String(
      row.campaign_name ?? row.campaign ?? row.label ?? row.name ?? row.campaign_id ?? row.id ?? 'Campanha'
    );
    const id = String(row.campaign_id ?? row.id ?? name);

    const existing = byKey.get(id);
    const acc = existing ?? {
      id,
      name,
      total_commission: 0,
      cpa: 0,
      rvs: 0,
      registrations: 0,
      first_deposits: 0,
      qualified_cpa: 0,
      deposit: 0,
    };

    acc.total_commission += num(row.total_commission);
    acc.cpa += num(row.cpa);
    acc.rvs += num(row.rvs);
    acc.registrations += num(row.registrations);
    acc.first_deposits += num(row.first_deposits);
    acc.qualified_cpa += num(row.qualified_cpa);
    acc.deposit += num(row.deposit);

    byKey.set(id, acc);
  }

  return Array.from(byKey.values()).sort((a, b) => b.total_commission - a.total_commission);
}

// Campanhas de um afiliado específico.
export async function fetchAffiliateResultsByCampaign(id: string, opts: DateRangeOpts = {}): Promise<CampaignRow[]> {
  try {
    const rows = await fetchResultsGrouped('campaign', { affiliateIds: id, ...opts });
    return aggregateByCampaign(rows);
  } catch (error) {
    console.error(`Error fetching campaign results for affiliate ${id}:`, error);
    return [];
  }
}

// Campanhas agregadas de toda a rede (somente admin — o proxy bloqueia non-admin sem affiliateIds).
// `affiliateIds` opcional (CSV) reescopa a uma marca/subconjunto de afiliados (multi-marca).
export async function fetchAllResultsByCampaign(opts: DateRangeOpts = {}, affiliateIds?: string): Promise<CampaignRow[]> {
  try {
    const rows = await fetchResultsGrouped('campaign', { ...opts, ...(affiliateIds ? { affiliateIds } : {}) });
    return aggregateByCampaign(rows);
  } catch (error) {
    console.error('Error fetching network campaign results:', error);
    return [];
  }
}

// --- B1 · Lucro líquido ------------------------------------------------------
// Regra CONFIRMADA pelo Carlos (2026-05-29):
//   (a) a "comissão recebida da casa" é EXATAMENTE o `total_commission` da OTG
//       (sem acordo diferente por casa); e
//   (b) NÃO há custos fixos da agência a descontar (por ora).
// => lucro líquido = total_commission − repasse ao afiliado.
// Pendente (só apresentação, não a fórmula): exibir também POR CASA e POR PERÍODO
// além do consolidado atual.

// calcAffiliatePayout e calcNetProfit agora vivem em lib/commission (importados +
// re-exportados no topo) — fonte única compartilhada client+server.

// Mapa subId → config do ESPECIAL-pai. Regra de negócio (Carlos, 2026-06-04): a
// agência paga o especial pela taxa DELE sobre toda a rede; quem repassa os subs
// é o especial (ele fica com o spread). Logo, no LUCRO DA AGÊNCIA, o repasse de um
// sub deve usar a taxa do especial-pai, não a taxa baixa que o especial deu ao sub
// (senão o /admin subestima o repasse e SUPERESTIMA o lucro). [[boost-special-as-scoped-master]]
export function buildSubToSpecialConfig(
  specials: Record<string, SpecialAffiliate>,
  configs: Record<string, AffiliateConfig | undefined>,
  opts: { activeOnly?: boolean } = {}
): Record<string, AffiliateConfig> {
  const activeOnly = opts.activeOnly !== false; // default: só especiais ativos
  const map: Record<string, AffiliateConfig> = {};
  for (const s of Object.values(specials || {})) {
    if (!s) continue;
    if (activeOnly && !s.active) continue;
    const parent = configs[String(s.affiliateId)];
    if (!parent) continue; // sem taxa do especial não há como cobrar a rede
    for (const sid of s.subAffiliateIds || []) map[String(sid)] = parent;
  }
  return map;
}

// Lucro líquido AGREGADO da agência sobre um conjunto de results (1 linha por
// afiliado). Repasse usa a config do afiliado, EXCETO quando ele é sub de um
// especial — aí usa a config do especial-pai (subToSpecialConfig). Cada afiliado
// entra uma vez (sem double-count).
// `houseOf` (opcional): resolve a casa de cada afiliado p/ aplicar a taxa POR
// CASA (byBrand) — a MESMA que `calcNetProfitByHouse` usa. Sem ele (ou quando a
// casa é desconhecida) cai na taxa padrão/topo: retrocompat e nunca derruba o
// afiliado. COM ele, este agregado bate EXATAMENTE com a Σ dos cards por casa —
// antes divergia quando algum afiliado tinha override byBrand ≠ topo (ex.: um
// especial com taxa de topo alta e taxa por casa menor). [[boost-net-profit-per-house]]
export function calcAgencyNetProfit(
  results: any[],
  configs: Record<string, AffiliateConfig | undefined>,
  subToSpecialConfig: Record<string, AffiliateConfig> = {},
  houseOf?: (affiliateId: string) => { key: string; brandId?: string } | null
): { commission: number; payout: number; netProfit: number } {
  let commission = 0;
  let payout = 0;
  for (const r of Array.isArray(results) ? results : []) {
    const id = String(r?.affiliate_id ?? r?.id ?? '');
    commission += num(r?.total_commission);
    payout += calcAffiliatePayout(r, subToSpecialConfig[id] || configs[id], houseOf?.(id)?.brandId);
  }
  return { commission, payout, netProfit: commission - payout };
}

// Lucro líquido POR CASA (B1 · detalhamento por casa). Cruza afiliado×casa:
// cada afiliado pertence a UMA casa (resolvida por `houseOf` a partir do mapa
// id→marca do caller), então particionamos as linhas groupBy=affiliate por casa
// e somamos comissão e repasse de cada uma. O repasse NÃO se deriva do agregado
// de marca (cada afiliado tem taxa própria) — aqui ele é Σ por afiliado da casa
// (taxa do afiliado × métricas dele NAQUELA casa), com:
//   - a taxa POR CASA do afiliado quando há override (`byBrand` via `house.brandId`); e
//   - a regra do especial-pai p/ subs (subToSpecialConfig), igual ao lucro agregado.
// Invariante: Σ das casas == calcAgencyNetProfit QUANDO o agregado recebe o mesmo
// `houseOf` (ambos aplicam byBrand). Sem passar `houseOf` ao agregado, ele usa a
// taxa de topo e os dois divergem se houver override por casa — era a causa do
// card "lucro da agência" não bater com a Σ dos cards. [[boost-net-profit-per-house]] [[boost-net-profit-rule]]
export interface HouseNetProfit {
  commission: number;
  payout: number;
  netProfit: number;
}
export function calcNetProfitByHouse(
  results: any[],
  houseOf: (affiliateId: string) => { key: string; brandId?: string } | null,
  configs: Record<string, AffiliateConfig | undefined>,
  subToSpecialConfig: Record<string, AffiliateConfig> = {}
): Record<string, HouseNetProfit> {
  const out: Record<string, HouseNetProfit> = {};
  for (const r of Array.isArray(results) ? results : []) {
    const id = String(r?.affiliate_id ?? r?.id ?? '');
    const house = houseOf(id);
    if (!house || !house.key) continue; // afiliado sem casa conhecida fica de fora
    const acc = out[house.key] ?? (out[house.key] = { commission: 0, payout: 0, netProfit: 0 });
    const cfg = subToSpecialConfig[id] || configs[id];
    acc.commission += num(r?.total_commission);
    acc.payout += calcAffiliatePayout(r, cfg, house.brandId);
  }
  for (const k of Object.keys(out)) out[k].netProfit = out[k].commission - out[k].payout;
  return out;
}

// Lucro líquido por casa MANUAL (a partir de house_results). Comissão = agregado da
// casa (inclui o não-atribuído); repasse = Σ dos afiliados ATRIBUÍDOS (taxa default
// do afiliado, ou byBrand[brandId|slug] se houver override; regra do especial-pai
// para subs). O não-atribuído fica como margem (sem repasse). Chaveado pelo NOME
// canônico da casa, igual aos cards do /admin — disjunto das casas OTG.
export function calcManualHouseNetProfit(
  rows: StoredManualRow[],
  configs: Record<string, AffiliateConfig | undefined>,
  subToSpecialConfig: Record<string, AffiliateConfig> = {}
): Record<string, HouseNetProfit> {
  const nameOf = (slug: string) => getKnownBrands().find((b) => b.slug === slug)?.name ?? slug;
  const brandKeyOf = (slug: string) => getKnownBrands().find((b) => b.slug === slug)?.id ?? slug;
  const out: Record<string, HouseNetProfit> = {};
  const ensure = (name: string) => out[name] ?? (out[name] = { commission: 0, payout: 0, netProfit: 0 });

  // Comissão da casa = agregado (não-atribuído incluído).
  const byHouse = aggregateByHouse(rows);
  for (const slug of Object.keys(byHouse)) ensure(nameOf(slug)).commission += byHouse[slug].total_commission;

  // Repasse só das linhas atribuídas.
  for (const r of rows) {
    if (r.affiliateId === null) continue;
    const cfg = subToSpecialConfig[r.affiliateId] || configs[r.affiliateId];
    ensure(nameOf(r.houseSlug)).payout += calcAffiliatePayout(r, cfg, brandKeyOf(r.houseSlug));
  }
  for (const k of Object.keys(out)) out[k].netProfit = out[k].commission - out[k].payout;
  return out;
}

// Compõe o lucro da agência do /admin: headline + detalhamento por casa SAINDO DA
// MESMA base. Recebe os results e linhas manuais JÁ ESCOPADOS pelo filtro de marca
// (quando há filtro), p/ que o card de cima e os cards por casa nunca divirjam — antes
// o headline escopava mas o breakdown somava TODAS as casas (mesma classe do 7c1c830,
// reaberta no eixo do filtro). [[boost-net-profit-per-house]]
//   • `byHouse`  = comissão/repasse/lucro por casa (OTG cruzando afiliado×casa +
//                  manual), chaveado pelo nome canônico — alimenta os cards.
//   • `netProfit`= total REAL da agência: agregado OTG (inclui afiliado de casa
//                  DESCONHECIDA, à taxa de topo, que `byHouse` deixa de fora) + manual.
//   • `byHouseTotal` = Σ dos cards. Invariante: quando todo afiliado tem casa conhecida,
//                  `netProfit === byHouseTotal`; a diferença é o lucro dos afiliados sem
//                  casa mapeada (que não viram card).
export function composeAdminProfit(
  results: any[],
  manualRows: StoredManualRow[],
  configs: Record<string, AffiliateConfig | undefined>,
  subToSpecialConfig: Record<string, AffiliateConfig>,
  houseOf: (affiliateId: string) => { key: string; brandId?: string } | null
): { netProfit: number; byHouse: Record<string, HouseNetProfit>; byHouseTotal: number } {
  const manualByHouse = calcManualHouseNetProfit(manualRows, configs, subToSpecialConfig);
  const byHouse: Record<string, HouseNetProfit> = {
    ...calcNetProfitByHouse(results, houseOf, configs, subToSpecialConfig),
    ...manualByHouse,
  };
  const byHouseTotal = Object.values(byHouse).reduce((s, h) => s + h.netProfit, 0);
  const manualTotal = Object.values(manualByHouse).reduce((s, h) => s + h.netProfit, 0);
  const netProfit = calcAgencyNetProfit(results, configs, subToSpecialConfig, houseOf).netProfit + manualTotal;
  return { netProfit, byHouse, byHouseTotal };
}

// --- Link de divulgação da agência (/go/:code) -------------------------------
// O afiliado compartilha boost.../go/:code; o servidor registra o clique e
// redireciona pro registerUrl real da casa (passando o clickId como subid —
// subid-ready p/ a atribuição por jogador quando a OTG ligar o postback).
export interface AffiliateLink {
  code: string;
  affiliateId: string;
  brandId: string | null;
  registerUrl: string;
  active: boolean;
  clicks?: number;
  botClicks?: number;
  lastClickAt?: any;
}

// URL pública compartilhável do link. A casa recebe ?subid no redirect do servidor.
export function buildGoUrl(code: string, origin?: string): string {
  const base = origin ?? (typeof window !== 'undefined' ? window.location.origin : '');
  return `${base}/go/${code}`;
}

// Cria (ou reusa, idempotente por afiliado×casa) o link de um afiliado. Admin.
export async function createAffiliateLink(
  affiliateId: string,
  registerUrl: string,
  brandId?: string | null
): Promise<AffiliateLink> {
  const response = await authFetch('/api/affiliate-links', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ affiliateId, registerUrl, brandId: brandId ?? null }),
  });
  if (!response.ok) {
    const e = await response.json().catch(() => ({}));
    throw new Error(e.error || e.message || `Erro na API: ${response.status}`);
  }
  return response.json();
}

// Lista os links acessíveis: admin → todos; afiliado → só os dele.
export async function fetchAffiliateLinks(): Promise<AffiliateLink[]> {
  try {
    const response = await authFetch('/api/affiliate-links', { headers: { Accept: 'application/json' } });
    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data?.links) ? data.links : [];
  } catch (error) {
    console.error('Error fetching affiliate links:', error);
    return [];
  }
}

export async function updateAffiliateStatus(affiliateId: string, status: 'active' | 'inactive'): Promise<any> {
  try {
    const response = await authFetch(`/api/affiliates/${affiliateId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({ status })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || errorData.message || `Erro na API: ${response.status}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error(`Error updating affiliate ${affiliateId} status:`, error);
    throw error;
  }
}

export interface AuditLog {
  id?: string;
  affiliateId: string;
  actorId?: string;
  actorName?: string;
  action: string;
  reason?: string;
  createdAt?: any;
}

export async function createAuditLog(log: AuditLog): Promise<AuditLog> {
  try {
    const response = await authFetch('/api/audit-logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(log)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || errorData.message || `Erro na API: ${response.status}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error creating audit log:', error);
    throw error;
  }
}

export async function fetchAuditLogs(): Promise<AuditLog[]> {
  try {
    const response = await authFetch('/api/audit-logs', {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || errorData.message || `Erro na API: ${response.status}`);
    }

    const data = await response.json();
    return Array.isArray(data) ? data : (data.data || []);
  } catch (error) {
    console.error('Error fetching audit logs:', error);
    throw error;
  }
}

export async function fetchRegisteredUsers(): Promise<Array<{ uid: string; affiliateId?: string; name?: string; email?: string; role?: string }>> {
  try {
    const q = query(collection(db, 'users'));
    const snapshot = await getDocs(q);
    const users: Array<{ uid: string; affiliateId?: string; name?: string; email?: string; role?: string }> = [];
    snapshot.forEach(docSnap => {
      const data = docSnap.data();
      users.push({ uid: docSnap.id, affiliateId: data.affiliateId, name: data.name, email: data.email, role: data.role });
    });
    return users;
  } catch (err) {
    console.error('Error fetching registered users:', err);
    return [];
  }
}

export async function updateUserRole(uid: string, role: 'admin' | 'client'): Promise<void> {
  try {
    const userRef = doc(db, 'users', uid);
    await setDoc(userRef, { role, updatedAt: serverTimestamp() }, { merge: true });
  } catch (err) {
    console.error('Error updating user role:', err);
    throw err;
  }
}

export async function isUserRegistered(uidOrAffiliateId: string): Promise<boolean> {
  try {
    const normalizedId = String(uidOrAffiliateId);
    const docRef = doc(db, 'users', normalizedId);
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      return true;
    }

    const affiliateQuery = query(collection(db, 'users'), where('affiliateId', '==', normalizedId));
    const affiliateSnapshot = await getDocs(affiliateQuery);
    return !affiliateSnapshot.empty;
  } catch (err) {
    console.error('Error checking user registration:', err);
    return false;
  }
}

export interface AffiliateUserData {
  uid?: string;
  affiliateId?: string;
  name: string;
  email: string;
  role: 'admin' | 'client';
  password?: string;
  mustChangePassword?: boolean;
}

export async function createUser(userData: AffiliateUserData): Promise<void> {
  if (userData.password) {
    try {
      const response = await authFetch('/api/create-user', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(userData)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || errorData.message || `Erro ao criar usuário: ${response.status}`);
      }

      return;
    } catch (error) {
      console.error('Error creating user via backend:', error);
      throw error;
    }
  }

  try {
    const userId = userData.uid;
    if (!userId) {
      throw new Error('O ID do usuário não foi definido ao criar a conta.');
    }

    const docRef = doc(db, 'users', userId);
    await setDoc(docRef, {
      uid: userId,
      name: userData.name,
      email: userData.email,
      role: userData.role,
      affiliateId: userData.affiliateId || null,
      mustChangePassword: userData.mustChangePassword ?? false,
      avatarUrl: `https://api.dicebear.com/7.x/shapes/svg?seed=${encodeURIComponent(userData.name)}`,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }, { merge: true });
  } catch (error) {
    console.error('Error creating user:', error);
    throw error;
  }
}

export interface SyncResult {
  synced: number;
  total: number;
  reconciled?: number;
}

export async function syncAffiliates(): Promise<SyncResult> {
  const response = await authFetch('/api/affiliates/sync', {
    method: 'POST',
    headers: { 'Accept': 'application/json' }
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || errorData.message || `Erro ao sincronizar: ${response.status}`);
  }
  return response.json();
}

// --- Pré-cadastro (afiliados aprovados na OTG, aguardando produção) ------------
// Importados do snapshot `scripts/otg-approved` (links.otgpartners). Aparecem na
// lista do master com badge "aguardando produção" e podem receber convite/login
// antes de existir no relatório; o servidor reconcilia o affiliateId real (id
// sintético `pending_<nameKey>_<casa>`) por nameKey quando o afiliado produz.
export interface PendingAffiliate {
  id: string;            // affiliateId sintético: pending_<nameKey>_<casa>
  name: string;
  nameKey: string;
  house: string;
  email?: string | null;
  phone?: string | null;
  social?: string | null;
  registerUrl?: string | null;
  status: 'pending' | 'reconciled';
  affiliateId?: string;  // id real do relatório, após reconciliar
  updatedAt?: any;
}

export async function fetchPendingAffiliates(): Promise<PendingAffiliate[]> {
  try {
    const response = await authFetch('/api/pending-affiliates', { method: 'GET', headers: { Accept: 'application/json' } });
    if (!response.ok) {
      const e = await response.json().catch(() => ({}));
      throw new Error(e.error || e.message || `Erro ao listar pré-cadastros: ${response.status}`);
    }
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error('Error fetching pending affiliates:', error);
    return [];
  }
}

export interface ImportPendingResult {
  imported: number;
  skipped: number;
  reconciled: number;
  total: number;
}

// Recebe as linhas do snapshot (name, nameKey, house, email, phone, registerUrl).
export async function importPendingAffiliates(rows: Array<Partial<PendingAffiliate>>): Promise<ImportPendingResult> {
  const response = await authFetch('/api/pending-affiliates/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ rows }),
  });
  if (!response.ok) {
    const e = await response.json().catch(() => ({}));
    throw new Error(e.error || e.message || `Erro ao importar pré-cadastros: ${response.status}`);
  }
  return response.json();
}

// Pull AO VIVO do roster de aprovados direto da OTG (Supabase de provisionamento).
// Faz upsert em pending_affiliates + reconcilia contra o relatório. Server-only
// (creds OTG_LINKS_* no .env). Ver POST /api/pending-affiliates/refresh.
export interface RefreshRosterResult {
  source: string;
  total: number;
  byHouse: Record<string, number>;
  imported: number;
  skipped: number;
  reconciled: number;
  fetchedAt: string;
}

export async function refreshPendingAffiliates(): Promise<RefreshRosterResult> {
  const response = await authFetch('/api/pending-affiliates/refresh', {
    method: 'POST',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    const e = await response.json().catch(() => ({}));
    throw new Error(e.error || e.message || `Erro ao atualizar da OTG: ${response.status}`);
  }
  return response.json();
}

export interface AccessInvite {
  token: string;
  url: string;
  expiresAt?: string;
}

export async function createAccessInvite(affiliateId: string, affiliateName?: string): Promise<AccessInvite> {
  const response = await authFetch('/api/invites', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ affiliateId, affiliateName })
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || errorData.message || `Erro ao gerar convite: ${response.status}`);
  }
  const data = await response.json();
  const url = `${window.location.origin}/convite/${data.token}`;
  return { token: data.token, url, expiresAt: data.expiresAt };
}

export interface InviteInfo {
  affiliateId: string;
  affiliateName: string | null;
  status: string;
}

export async function fetchInvite(token: string): Promise<InviteInfo> {
  const response = await fetch(`/api/invites/${encodeURIComponent(token)}`, {
    method: 'GET',
    headers: { 'Accept': 'application/json' }
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || errorData.message || `Convite inválido: ${response.status}`);
  }
  return response.json();
}

export interface InviteProfile {
  phone?: string;
  socialMedia?: string;
  cpf?: string;
}

export async function acceptInvite(token: string, email: string, password: string, profile?: InviteProfile): Promise<{ uid: string; affiliateId: string }> {
  const response = await fetch('/api/accept-invite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ token, email, password, phone: profile?.phone, socialMedia: profile?.socialMedia, cpf: profile?.cpf })
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || errorData.message || `Erro ao concluir cadastro: ${response.status}`);
  }
  return response.json();
}

export async function fetchSetting(key: string): Promise<string | null> {
  try {
    const docRef = doc(db, 'settings', key);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      return docSnap.data().value;
    }
    
    // Fallback search by key property if not found by ID
    const q = query(collection(db, 'settings'), where('key', '==', key));
    const querySnapshot = await getDocs(q);
    if (!querySnapshot.empty) {
      return querySnapshot.docs[0].data().value;
    }
    
    return null;
  } catch (error) {
    console.error(`Error fetching setting ${key}:`, error);
    return null;
  }
}

export function extractArray(data: any): Affiliate[] {
  if (!data) return [];
  
  if (Array.isArray(data)) {
    return data;
  }
  
  if (typeof data === 'object') {
    // Check common locations for the array of data
    const potentialPaths = [
      'data.data', // Nested structure: { data: { data: [...] } }
      'data',
      'affiliates',
      'results',
      'items',
      'list',
      'payload',
      'content',
      'data.items',
      'data.results',
      'response',
      'rows'
    ];
    
    for (const path of potentialPaths) {
      if (path.includes('.')) {
        const parts = path.split('.');
        let current = data;
        for (const part of parts) {
          current = current ? current[part] : undefined;
        }
        if (Array.isArray(current)) return current;
      } else {
        if (Array.isArray(data[path])) return data[path];
      }
    }
    
    // Last resort: look for any array that isn't empty
    const keys = Object.keys(data);
    for (const key of keys) {
      if (Array.isArray(data[key]) && data[key].length > 0) {
        return data[key];
      }
      if (data[key] && typeof data[key] === 'object') {
        const subKeys = Object.keys(data[key]);
        for (const subKey of subKeys) {
          if (Array.isArray(data[key][subKey]) && data[key][subKey].length > 0) {
            return data[key][subKey];
          }
        }
      }
    }
  }

  return [];
}

export function extractApiError(payload: any): ApiErrorInfo | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const candidates = [payload, payload.data, payload.error, payload.meta].filter(Boolean);

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') continue;

    const rawCode = candidate.code ?? candidate.errorCode ?? candidate.statusCode ?? candidate.status;
    const code = rawCode != null ? String(rawCode).trim() : '';
    const rawMessage =
      candidate.message ??
      candidate.error ??
      candidate.details ??
      candidate.description;
    const message = typeof rawMessage === 'string' ? rawMessage.trim() : '';
    const success = candidate.success;
    const hasExplicitFailure = success === false || Boolean(code && code !== '200' && code !== '201');

    if (!hasExplicitFailure && !messageLooksLikeError(message)) {
      continue;
    }

    const noData = isNoDataError(code, message);
    return {
      code: code || undefined,
      message: message || (noData ? 'Nenhum dado encontrado.' : 'Erro retornado pela API externa.'),
      noData
    };
  }

  return null;
}

export function isNoDataError(code: string, message: string): boolean {
  const normalizedCode = code.replace(/^0+/, '') || code;
  const normalizedMessage = message.toLowerCase();

  return (
    code === '040' ||
    normalizedCode === '40' ||
    normalizedMessage.includes('nenhum') ||
    normalizedMessage.includes('nao encontrado') ||
    normalizedMessage.includes('não encontrado') ||
    normalizedMessage.includes('not found') ||
    normalizedMessage.includes('no data') ||
    normalizedMessage.includes('sem dados')
  );
}

export function messageLooksLikeError(message: string): boolean {
  const normalizedMessage = message.toLowerCase();
  return (
    normalizedMessage.includes('erro') ||
    normalizedMessage.includes('error') ||
    normalizedMessage.includes('invalid') ||
    normalizedMessage.includes('unauthorized') ||
    normalizedMessage.includes('forbidden') ||
    normalizedMessage.includes('not found') ||
    normalizedMessage.includes('não encontrado') ||
    normalizedMessage.includes('nao encontrado')
  );
}
