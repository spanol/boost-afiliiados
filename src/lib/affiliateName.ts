// Reconciliação de afiliado entre os DOIS sistemas da OTG:
//   - Provisionamento (links.otgpartners): `affiliate_name` com espaços/acentos.
//   - Relatório (affiliate-api / x-api-key): `name` em PascalCase sem espaços.
// A OTG deriva o nome do relatório tirando espaços/acentos do provisionamento, então
// o NOME normalizado é a chave estável que liga um pré-cadastro ao registro real.
// Esta normalização DEVE ser idêntica à do servidor (server.ts normNameKey) e à do
// script de export (scripts/otg-approved/fetch-approved-console.js). Ver
// scripts/otg-approved/README.md e a memória boost-external-api-state.
//
// Regra: NFD (separa diacríticos) → remove diacríticos → minúsculo → só [a-z0-9].
//   "Leonardo Portugal Vasconcelos" → "leonardoportugalvasconcelos"
//   "Antonio Carlos dos santos e santos" → "antoniocarlosdossantosesantos"
//   "BrunoEduardoSantosRodrigues" (relatório) → "brunoeduardosantosrodrigues"
export function normalizeNameKey(name?: string | null): string {
  return String(name ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}
