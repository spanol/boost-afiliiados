// Scan PURO da lista de afiliados por id, extraído do fallback de fetchAffiliateById
// (quando o mirror local do Firestore 404a/sem-dados, varre a lista completa da API).
// Casa tanto `a.id` quanto `a._id` (a API externa varia o nome do campo) e coage os
// dois lados a string (id pode vir number). Não acha → null (nunca lança). R19.
export function findAffiliateInList(list: any[], id: string): any | null {
  if (!Array.isArray(list)) return null;
  const normalizedId = String(id);
  return list.find((a: any) => String(a?.id || a?._id || '') === normalizedId) ?? null;
}
