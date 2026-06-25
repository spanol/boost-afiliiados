import {
  collection,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { authFetch } from '../lib/api';

// Avisos / comunicados da rede (feed). O admin publica; o afiliado lê em tempo real.
// Leitura é direta do Firestore (regra: signed-in) com filtro de audiência no
// cliente; a escrita passa pelo servidor (requireAdmin), espelhando audit-logs/houses.

export type NoticeCategory = 'info' | 'importante' | 'comunicado';
// Público-alvo do aviso (broadcast). Mensagem 1:1 a um afiliado NÃO entra aqui —
// vira mensagem direta (popup) em directMessageService.
export type NoticeAudience = 'all' | 'clients' | 'specials';

export interface NoticeInput {
  title: string;
  body: string;
  category: NoticeCategory;
  audience: NoticeAudience;
  link?: string;
  active?: boolean;
}

export interface Notice extends NoticeInput {
  id: string;
  active: boolean;
  createdAt: Timestamp | null;
  updatedAt?: Timestamp | null;
}

const noticesCollection = collection(db, 'notices');

// Realtime: usado tanto pelo feed do afiliado quanto pela gestão do admin.
export function subscribeToNotices(
  onData: (notices: Notice[]) => void,
  onError?: (error: Error) => void,
) {
  const noticesQuery = query(noticesCollection, orderBy('createdAt', 'desc'));

  return onSnapshot(
    noticesQuery,
    (snapshot) => {
      const notices = snapshot.docs.map((doc) => {
        const data = doc.data() as NoticeInput & { createdAt?: Timestamp; updatedAt?: Timestamp; active?: boolean };
        return {
          id: doc.id,
          title: data.title,
          body: data.body,
          category: data.category,
          audience: data.audience,
          link: data.link,
          active: data.active ?? true,
          createdAt: (data.createdAt as Timestamp | null) ?? null,
          updatedAt: (data.updatedAt as Timestamp | null) ?? null,
        } as Notice;
      });
      onData(notices);
    },
    (error) => {
      onError?.(error);
    },
  );
}

// Mostra o aviso para o usuário conforme o papel/segmento. Admin vê tudo na gestão
// (esta função é para a VIEW do afiliado). `isSpecial` recebe 'specials' + 'all';
// afiliado comum recebe 'clients' + 'all'.
export function isNoticeForUser(
  notice: Pick<Notice, 'audience' | 'active'>,
  profile: { role?: string; isSpecial?: boolean } | null,
): boolean {
  if (!notice.active) return false;
  if (notice.audience === 'all') return true;
  if (notice.audience === 'specials') return !!profile?.isSpecial;
  if (notice.audience === 'clients') return !profile?.isSpecial;
  return false;
}

// Conta avisos não-lidos (badge do sino) comparando createdAt com o último "visto"
// (ms). R27: um aviso com serverTimestamp PENDENTE chega com createdAt null (o write
// ainda não resolveu no servidor); antes `(createdAt?.toMillis() ?? 0)` virava 0 e
// `0 > lastSeen` era falso → o aviso recém-criado nascia "lido". Aqui, createdAt null =
// recém-criado = NÃO lido (conta como não-lido até o timestamp resolver).
export function countUnreadNotices(
  notices: Pick<Notice, 'createdAt'>[],
  lastSeenMillis: number,
): number {
  return notices.filter((n) => {
    const ts = n.createdAt?.toMillis();
    return ts == null ? true : ts > lastSeenMillis;
  }).length;
}

async function readError(res: Response, fallback: string): Promise<never> {
  let message = fallback;
  try {
    const data = await res.json();
    if (data?.error) message = data.error;
  } catch {
    /* corpo não-JSON */
  }
  throw new Error(message);
}

export async function createNotice(input: NoticeInput): Promise<void> {
  const res = await authFetch('/api/notices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) await readError(res, 'Falha ao criar aviso.');
}

export async function updateNotice(id: string, patch: Partial<NoticeInput>): Promise<void> {
  const res = await authFetch(`/api/notices/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) await readError(res, 'Falha ao atualizar aviso.');
}

export async function deleteNotice(id: string): Promise<void> {
  const res = await authFetch(`/api/notices/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!res.ok) await readError(res, 'Falha ao remover aviso.');
}
