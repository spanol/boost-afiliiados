// Gate de visibilidade do card "Lucro líquido do afiliado" (AffiliateDetails). Esse
// valor é o GANHO do próprio afiliado (a taxa dele sobre a produção própria + o spread
// sobre a sub-rede) — NUNCA a margem/lucro da agência, que só aparece no /admin do
// master (composeAdminProfit). Regras: admin vê o de qualquer um; o afiliado ESPECIAL
// vê o de qualquer sub da sua rede (id ≠ o próprio); o afiliado vendo a PRÓPRIA página
// não vê o card. Fonte única do `isSuperiorView`. [[boost-net-profit-rule]]
export function canViewAffiliateNetProfit(params: {
  isAdmin: boolean;
  isSpecial: boolean;
  viewedAffiliateId: string;
  ownAffiliateId?: string | null;
}): boolean {
  if (params.isAdmin) return true;
  return (
    params.isSpecial &&
    String(params.viewedAffiliateId) !== String(params.ownAffiliateId ?? '')
  );
}
