import {
  collection,
  onSnapshot,
  query,
  where,
  Timestamp,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { authFetch } from '../lib/api';

// Mensagens diretas da gerência → afiliado (popup 1:1). O admin envia escolhendo
// o afiliado; o servidor resolve o(s) login(s) vinculado(s) (users.affiliateId) e
// grava `recipientUid` em cada mensagem. A leitura é escopada por recipientUid
// (regra canônica `resource.data.recipientUid == request.auth.uid` — query segura,
// sem get() em list). Marca-leitura passa pelo servidor.

export interface DirectMessage {
  id: string;
  recipientUid: string;
  affiliateId: string;
  affiliateName?: string;
  title: string;
  body: string;
  createdByName?: string;
  readAt: Timestamp | null;
  createdAt: Timestamp | null;
}

const messagesCollection = collection(db, 'direct_messages');

// Realtime das mensagens do próprio usuário (por recipientUid). Ordena no cliente
// p/ não exigir índice composto (where + orderBy).
export function subscribeToMyDirectMessages(
  uid: string,
  onData: (messages: DirectMessage[]) => void,
  onError?: (error: Error) => void,
) {
  const q = query(messagesCollection, where('recipientUid', '==', uid));

  return onSnapshot(
    q,
    (snapshot) => {
      const messages = snapshot.docs
        .map((doc) => {
          const data = doc.data() as Omit<DirectMessage, 'id'>;
          return {
            id: doc.id,
            recipientUid: data.recipientUid,
            affiliateId: data.affiliateId,
            affiliateName: data.affiliateName,
            title: data.title,
            body: data.body,
            createdByName: data.createdByName,
            readAt: (data.readAt as Timestamp | null) ?? null,
            createdAt: (data.createdAt as Timestamp | null) ?? null,
          } as DirectMessage;
        })
        .sort((a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0));
      onData(messages);
    },
    (error) => {
      onError?.(error);
    },
  );
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

export interface SendDirectMessageInput {
  affiliateId: string;
  title: string;
  body: string;
}

// Retorna quantos logins receberam (um afiliado pode ter >1 conta vinculada).
export async function sendDirectMessage(input: SendDirectMessageInput): Promise<{ delivered: number }> {
  const res = await authFetch('/api/direct-messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) await readError(res, 'Falha ao enviar mensagem.');
  return res.json();
}

export async function markDirectMessageRead(id: string): Promise<void> {
  const res = await authFetch(`/api/direct-messages/${encodeURIComponent(id)}/read`, {
    method: 'POST',
  });
  if (!res.ok) await readError(res, 'Falha ao marcar mensagem como lida.');
}
