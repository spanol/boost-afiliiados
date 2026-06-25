// Orquestração do salvamento do perfil, extraída de Profile.tsx p/ ficar testável e
// blindar o R23: a flag `mustChangePassword:false` SÓ pode ser gravada no Firestore
// DEPOIS que a troca de senha (Firebase Auth) der certo. Antes a ordem era invertida —
// gravava o perfil (liberando o gate) e só então trocava a senha; se `updatePassword`
// falhasse (ex.: auth/requires-recent-login, comum), o usuário escapava do "primeiro
// acesso" mantendo a senha temporária. Aqui: senha PRIMEIRO; perfil só depois.

export interface SaveProfileInput {
  name: string;
  avatarUrl: string;
  newPassword: string;
  forcePasswordChange: boolean;
}

export interface SaveProfileDeps {
  // Troca a senha no Firebase Auth. Lança em falha — e aí o perfil NÃO é gravado.
  changePassword: (newPassword: string) => Promise<void>;
  // Grava o doc do perfil no Firestore (payload já montado).
  updateProfileDoc: (payload: Record<string, unknown>) => Promise<void>;
  // Valor de updatedAt (serverTimestamp injetado).
  timestamp: () => unknown;
}

// Validação pura → mensagem de erro pt-BR ou null (a UI exibe direto e aborta).
export function validateProfile(input: SaveProfileInput): string | null {
  if (input.forcePasswordChange && !input.newPassword) {
    return 'Você precisa definir uma nova senha antes de continuar.';
  }
  if (input.newPassword && input.newPassword.length < 6) {
    return 'A nova senha deve ter ao menos 6 caracteres.';
  }
  if (!input.name.trim()) {
    return 'Informe seu nome.';
  }
  return null;
}

// Executa o salvamento na ordem SEGURA (senha → perfil). Propaga a falha do firebase.
// Assume input já validado (a UI chama validateProfile antes). Retorna se trocou a senha.
export async function saveProfile(
  input: SaveProfileInput,
  deps: SaveProfileDeps,
): Promise<{ passwordChanged: boolean }> {
  // 1) Senha PRIMEIRO — se falhar, lança e o perfil NUNCA é gravado (gate preservado).
  if (input.newPassword) {
    await deps.changePassword(input.newPassword);
  }

  // 2) Perfil no Firestore — só aqui `mustChangePassword` vira false (a senha já trocou).
  const payload: Record<string, unknown> = {
    name: input.name.trim(),
    avatarUrl: input.avatarUrl,
    updatedAt: deps.timestamp(),
  };
  if (input.forcePasswordChange && input.newPassword) {
    payload.mustChangePassword = false;
  }
  await deps.updateProfileDoc(payload);

  return { passwordChanged: !!input.newPassword };
}
