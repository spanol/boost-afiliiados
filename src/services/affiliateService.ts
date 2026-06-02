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
import { getDefaultRange } from '../lib/dateRange';

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

export interface AffiliateConfig {
  affiliateId: string;
  cpaValue: number;
  revPercentage: number;
  updatedAt?: any;
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

const AFFILIATE_API_BASE_URL = (import.meta.env.VITE_AFFILIATE_API_BASE_URL || 'https://affiliate-api-prd.partnersotg.com').replace(/\/+$/, '');
const AFFILIATE_API_KEY = import.meta.env.VITE_AFFILIATE_API_KEY || '';

async function fetchAffiliateApi(endpoint: string, query?: URLSearchParams): Promise<Response> {
  const proxyUrl = `/api/external/${endpoint}${query && query.toString() ? `?${query.toString()}` : ''}`;
  const proxyResponse = await authFetch(proxyUrl, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
    },
  });

  if (proxyResponse.status !== 404) {
    return proxyResponse;
  }

  console.warn(`Proxy route unavailable for ${endpoint}, retrying against external affiliate API directly.`);

  if (!AFFILIATE_API_KEY) {
    return proxyResponse;
  }

  const directUrl = `${AFFILIATE_API_BASE_URL}/api/v2/external/${endpoint}${query && query.toString() ? `?${query.toString()}` : ''}`;
  return fetch(directUrl, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'x-api-key': AFFILIATE_API_KEY,
    },
  });
}

export async function fetchAffiliateConfigs(): Promise<Record<string, AffiliateConfig>> {
  try {
    const querySnapshot = await getDocs(collection(db, 'affiliate_configs'));
    const configs: Record<string, AffiliateConfig> = {};
    querySnapshot.forEach((doc) => {
      configs[doc.id] = doc.data() as AffiliateConfig;
    });
    return configs;
  } catch (error) {
    console.error('Error fetching affiliate configs:', error);
    return {};
  }
}

export async function saveAffiliateConfig(config: AffiliateConfig): Promise<void> {
  try {
    const docRef = doc(db, 'affiliate_configs', config.affiliateId);
    await setDoc(docRef, {
      ...config,
      updatedAt: serverTimestamp()
    });
  } catch (error) {
    console.error('Error saving affiliate config:', error);
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

export async function saveSpecialAffiliate(data: SpecialAffiliate): Promise<void> {
  try {
    const ref = doc(db, 'special_affiliates', String(data.affiliateId));
    await setDoc(ref, {
      active: !!data.active,
      subAffiliateIds: (data.subAffiliateIds ?? []).map(String),
      updatedAt: serverTimestamp(),
    }, { merge: true });
  } catch (error) {
    console.error('Error saving special affiliate:', error);
    throw error;
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

// Espelha a flag isSpecial no doc do usuário (conveniência p/ roteamento — Fase 3).
export async function setUserSpecialFlag(uid: string, isSpecial: boolean): Promise<void> {
  if (!uid) return;
  try {
    const ref = doc(db, 'users', String(uid));
    await setDoc(ref, { isSpecial, updatedAt: serverTimestamp() }, { merge: true });
  } catch (error) {
    console.error('Error setting user special flag:', error);
    throw error;
  }
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
    const found = allAffiliates.find((a: any) => String(a.id || a._id) === normalizedId);
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

// Per-house (brand) breakdown for an affiliate.
export async function fetchAffiliateResultsByBrand(id: string, opts: DateRangeOpts = {}): Promise<any[]> {
  try {
    return await fetchResultsGrouped('brand', { affiliateIds: id, ...opts });
  } catch (error) {
    console.error(`Error fetching brand results for affiliate ${id}:`, error);
    return [];
  }
}

// Daily time series for an affiliate. Defaults to the dashboard range (current month)
// when no explicit start/end is supplied.
export async function fetchAffiliateDailyResults(id: string, startDate?: string, endDate?: string): Promise<any[]> {
  try {
    return await fetchResultsGrouped('date', { affiliateIds: id, startDate, endDate });
  } catch (error) {
    console.error(`Error fetching daily results for affiliate ${id}:`, error);
    return [];
  }
}

export async function fetchAffiliateResults(id: string, opts: DateRangeOpts = {}): Promise<any> {
  try {
    return await fetchResultsGrouped('affiliate', { affiliateIds: id, ...opts });
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

const num = (v: any): number => (Number.isFinite(Number(v)) ? Number(v) : 0);

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

// Repasse devido ao afiliado para um result (mesmo cálculo exibido nos dashboards):
// CPA qualificado × valor de CPA + REV × (percentual / 100).
export function calcAffiliatePayout(result: any, config?: AffiliateConfig | null): number {
  const cpa = (result?.qualified_cpa || 0) * (config?.cpaValue || 0);
  const rev = (result?.rvs || 0) * ((config?.revPercentage || 0) / 100);
  return cpa + rev;
}

// Lucro líquido da agência para um result: comissão da casa − repasse ao afiliado.
export function calcNetProfit(result: any, config?: AffiliateConfig | null): number {
  const houseCommission = result?.total_commission || 0;
  return houseCommission - calcAffiliatePayout(result, config);
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
  instagram?: string;
}

export async function acceptInvite(token: string, email: string, password: string, profile?: InviteProfile): Promise<{ uid: string; affiliateId: string }> {
  const response = await fetch('/api/accept-invite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ token, email, password, phone: profile?.phone, instagram: profile?.instagram })
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
