// Helpers de marca (multi-marca). A API externa hoje só retorna Superbet, mas o
// app não assume marca única — estas funções extraem a marca de forma defensiva
// para que filtros/badges funcionem automaticamente quando a OTG liberar outras
// marcas (ex.: SportingBet). O campo `brand` pode vir como objeto {name} ou string.

export const ALL_BRANDS = '__all__';

// Nome da marca de um afiliado, tolerando os vários shapes da API.
export function getBrandName(affiliate: any): string | null {
  if (!affiliate) return null;
  const b = affiliate.brand ?? affiliate.marca ?? affiliate.brand_name;
  if (!b) return null;
  if (typeof b === 'string') return b.trim() || null;
  if (typeof b === 'object') {
    const name = b.name ?? b.nome ?? b.label;
    return typeof name === 'string' ? name.trim() || null : null;
  }
  return null;
}

// Lista ordenada e única das marcas presentes numa coleção de afiliados.
export function uniqueBrands(affiliates: any[]): string[] {
  const set = new Set<string>();
  for (const a of Array.isArray(affiliates) ? affiliates : []) {
    const name = getBrandName(a);
    if (name) set.add(name);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

// --- Registro de casas (B6 · logo + casa vazia) ------------------------------
// A API da OTG NÃO expõe logo nem lista casas sem dados — verificado por probe
// direto (2026-06-10): `brand` vem só como {id,name}; v2/v1 `/brands` e `/houses`
// dão 404; `results?groupBy=brand` só traz casas COM produção. As fotos do portal
// `partners.grupootg.com` são assets do front-end deles, fora da API.
// Para seguir o MESMO modelo do portal (casa "acesa e vazia" + logo), mantemos
// um registro PRÓPRIO das casas conhecidas: fonte de verdade de quais casas
// exibir e de onde vem a logo (assets estáticos em /public/brands). Casamos por
// id quando conhecido, senão por nome/slug. [[boost-external-api-state]]
export interface BrandMeta {
  id?: string;   // brandId da OTG quando conhecido (Superbet)
  slug: string;
  name: string;
  logo?: string; // URL da logo (Storage) ou caminho em /public/brands; fallback = avatar
  registerUrlTemplate?: string | null; // URL base de cadastro com {ref} (gera links)
  active?: boolean; // casa "acesa": listada nas visões por casa (default true)
  order?: number;   // ordem de exibição
  // Origem dos resultados: 'otg' = vêm da API externa (Superbet/SportingBet);
  // 'manual' = alimentados por upload (CSV) no backoffice. Só casas 'manual'
  // recebem import e entram no merge — a OTG nunca é tocada (sem double-count).
  dataSource?: 'otg' | 'manual';
}

const normBrandKey = (s?: string | null) => String(s ?? '').trim().toLowerCase();

// Casas-semente embarcadas no bundle: usadas como FALLBACK quando o backoffice
// (coleção Firestore `houses`) ainda não carregou ou está vazio — e como dado de
// auto-seed do servidor. Em runtime o registro real vem do backend via
// `setKnownBrands` (DashboardLayout), tornando as casas gerenciáveis sem deploy.
// ids e logos confirmados na dashboard da OTG (partners.grupootg.com, 2026-06-11):
// o <select> de casas expõe o brandId real e as logos vêm do bucket público
// `betting-house-logos`. Baixamos as oficiais p/ /public/brands.
// [[boost-external-api-state]]
export const DEFAULT_BRANDS: BrandMeta[] = [
  { id: 'clsuperbet000001', slug: 'superbet', name: 'Superbet', logo: '/brands/superbet.png', active: true, dataSource: 'otg' },
  // SportingBet: a OTG já LISTA a casa pra agência, mas ela está vazia (0 afiliados)
  // e a nossa x-api-key ainda não traz dados dela — aparece zerada (modelo do portal).
  { id: 'cmm5dhdqm000e19b58dqc549a', slug: 'sportingbet', name: 'SportingBet', logo: '/brands/sportingbet.png', active: true, dataSource: 'otg' },
];

// Compat: alguns lugares ainda importam KNOWN_BRANDS como as casas-semente.
// O registro VIVO (que muda em runtime) é lido por getKnownBrands().
export const KNOWN_BRANDS = DEFAULT_BRANDS;

// Registro VIVO das casas. Começa nas sementes e é substituído quando o backend
// responde (setKnownBrands). Os helpers abaixo leem este cache em tempo de
// chamada, então toda a UI reflete o backoffice sem rewrite dos call-sites.
let _knownBrands: BrandMeta[] = [...DEFAULT_BRANDS];

// Lista viva das casas conhecidas (todas, ativas ou não).
export function getKnownBrands(): BrandMeta[] {
  return _knownBrands;
}

// Substitui o registro vivo (chamado no boot com as casas do backend). Ignora
// entradas sem nome; nunca deixa o registro vazio (cai nas sementes) p/ a UI não
// ficar sem casas se o backend falhar.
export function setKnownBrands(list: BrandMeta[] | null | undefined): void {
  const clean = (Array.isArray(list) ? list : [])
    .filter((b) => b && String(b.name ?? '').trim())
    .map((b) => ({ ...b, slug: b.slug || normBrandKey(b.name) }));
  _knownBrands = clean.length ? clean : [...DEFAULT_BRANDS];
}

// Metadados de uma casa por id (preferencial) ou por nome/slug. Lê o registro vivo
// e resolve mesmo casas inativas (badges/logos de dados históricos seguem certos).
export function getBrandMeta(idOrName?: string | null): BrandMeta | null {
  const key = normBrandKey(idOrName);
  if (!key) return null;
  const brands = getKnownBrands();
  return (
    brands.find((b) => normBrandKey(b.id) === key) ||
    brands.find((b) => normBrandKey(b.name) === key || b.slug === key) ||
    null
  );
}

// Caminho da logo de uma casa (ou null → a UI usa o avatar de inicial).
export function getBrandLogo(idOrName?: string | null): string | null {
  return getBrandMeta(idOrName)?.logo ?? null;
}

// Nome CANÔNICO de uma casa conhecida (ex.: "SportingBet"), casando por qualquer
// das chaves passadas (id e/ou nome cru da API). Retorna null se não for casa
// conhecida — o caller decide o fallback (ex.: humanizeName do nome cru). Evita
// que o humanizeName quebre "SportingBet" em "Sporting Bet".
export function getKnownBrandName(...keys: (string | null | undefined)[]): string | null {
  for (const k of keys) {
    const meta = getBrandMeta(k);
    if (meta) return meta.name;
  }
  return null;
}
