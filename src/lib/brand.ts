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
