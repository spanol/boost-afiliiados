// Backoffice de casas (betting houses). Fonte de verdade = coleção Firestore
// `houses`, gerida pelo admin via /casas. Substitui o antigo array hardcoded
// KNOWN_BRANDS: o registro vira gerenciável (criar/editar/logo) sem deploy.
// Tudo passa pelo servidor (Admin SDK); o cliente nunca toca `houses` direto.
import { authFetch } from '../lib/api';
import { BrandMeta, setKnownBrands } from '../lib/brand';
import { StoredManualRow, Metrics } from '../lib/houseResults';

export interface House {
  id: string;        // doc id (= slug)
  slug: string;
  name: string;
  brandId?: string | null;         // brandId da OTG quando conhecido
  logo?: string | null;            // URL no Storage (ou /brands/* das sementes)
  registerUrlTemplate?: string | null; // URL base de cadastro com {ref} (links)
  active: boolean;
  order?: number;
  // 'otg' = resultados vêm da API externa; 'manual' = alimentados por upload (CSV).
  dataSource: 'otg' | 'manual';
}

// Campos editáveis no backoffice. `logoBase64` (data URL) sobe a logo nova; se
// ausente, a logo atual é preservada.
export interface HouseInput {
  name: string;
  slug?: string;
  brandId?: string | null;
  registerUrlTemplate?: string | null;
  active?: boolean;
  order?: number;
  dataSource?: 'otg' | 'manual';
  logoBase64?: string | null;
}

// Mapeia uma House (backend) para o BrandMeta usado pelos helpers de marca.
export function houseToBrandMeta(h: House): BrandMeta {
  return {
    id: h.brandId ?? undefined,
    slug: h.slug,
    name: h.name,
    logo: h.logo ?? undefined,
    registerUrlTemplate: h.registerUrlTemplate ?? null,
    active: h.active,
    order: h.order,
    dataSource: h.dataSource,
  };
}

// Atualiza o registro vivo de marcas (cache em brand.ts) com as casas do backend,
// para que toda a UI (logos, filtros, breakdown por casa) reflita o backoffice.
export function syncKnownBrandsFrom(houses: House[]): void {
  const ordered = [...houses].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name, 'pt-BR')
  );
  setKnownBrands(ordered.map(houseToBrandMeta));
}

async function parseError(response: Response): Promise<never> {
  const e = await response.json().catch(() => ({}));
  throw new Error((e as any).error || (e as any).message || `Erro na API: ${response.status}`);
}

// Lista as casas (admin → gestão; afiliado → leitura p/ logos/filtros).
export async function fetchHouses(): Promise<House[]> {
  const response = await authFetch('/api/houses', { headers: { Accept: 'application/json' } });
  if (!response.ok) return [];
  const data = await response.json().catch(() => ({}));
  return Array.isArray((data as any)?.houses) ? (data as any).houses : [];
}

// Cria uma casa (admin). Retorna a casa criada.
export async function createHouse(input: HouseInput): Promise<House> {
  const response = await authFetch('/api/houses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) await parseError(response);
  return response.json();
}

// Atualiza uma casa por id (admin). Aceita patch parcial.
export async function updateHouse(id: string, patch: Partial<HouseInput>): Promise<House> {
  const response = await authFetch(`/api/houses/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!response.ok) await parseError(response);
  return response.json();
}

// Remove uma casa por id (admin).
export async function deleteHouse(id: string): Promise<void> {
  const response = await authFetch(`/api/houses/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!response.ok) await parseError(response);
}

// --- Resultados manuais por casa --------------------------------------------

// Lista as linhas manuais no range (admin → todas; afiliado → só as dele).
export async function fetchHouseResults(
  opts: { start?: string; end?: string; houseSlug?: string } = {}
): Promise<StoredManualRow[]> {
  const params = new URLSearchParams();
  if (opts.start) params.set('start', opts.start);
  if (opts.end) params.set('end', opts.end);
  if (opts.houseSlug) params.set('houseSlug', opts.houseSlug);
  const qs = params.toString();
  const response = await authFetch(`/api/house-results${qs ? `?${qs}` : ''}`, { headers: { Accept: 'application/json' } });
  if (!response.ok) return [];
  const data = await response.json().catch(() => ({}));
  return Array.isArray((data as any)?.rows) ? (data as any).rows : [];
}

// Linha de import: data + afiliado (null = agregado) + métricas.
export type ImportResultRow = { date: string; affiliateId: string | null } & Partial<Metrics>;

// Importa (admin): substitui as linhas da casa nas datas presentes no upload.
export async function importHouseResults(
  houseSlug: string,
  rows: ImportResultRow[]
): Promise<{ imported: number; dates: string[]; deleted: number }> {
  const response = await authFetch('/api/house-results/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ houseSlug, rows }),
  });
  if (!response.ok) await parseError(response);
  return response.json();
}

// Limpa as linhas de uma casa (admin); date opcional limpa só aquele dia.
export async function clearHouseResults(houseSlug: string, date?: string): Promise<number> {
  const params = new URLSearchParams({ houseSlug });
  if (date) params.set('date', date);
  const response = await authFetch(`/api/house-results?${params.toString()}`, { method: 'DELETE' });
  if (!response.ok) await parseError(response);
  const data = await response.json().catch(() => ({}));
  return Number((data as any)?.deleted) || 0;
}
