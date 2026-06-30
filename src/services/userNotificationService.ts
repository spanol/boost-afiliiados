import {
  collection,
  onSnapshot,
  query,
  where,
  Timestamp,
} from 'firebase/firestore';
import { db } from '../lib/firebase';

// Notificações de SISTEMA por afiliado (ex.: "novos resultados na casa X" quando o
// admin sobe um upload cruzado pelo e-mail de login). Gravadas SÓ pelo servidor
// (Admin SDK) — o afiliado lê as SUAS (escopo por recipientUid, igual a
// direct_messages) e elas aparecem no SINO (não em popup). [[boost-results-notification]]

export interface UserNotification {
  id: string;
  recipientUid: string;
  affiliateId?: string;
  type: string;          // 'results_updated'
  houseSlug?: string;
  houseName?: string;
  title: string;
  body: string;
  createdAt: Timestamp | null;
}

const notificationsCollection = collection(db, 'user_notifications');

// Realtime das notificações do próprio usuário (por recipientUid). Ordena no cliente
// p/ não exigir índice composto (where + orderBy) — mesmo padrão de direct_messages.
export function subscribeToMyNotifications(
  uid: string,
  onData: (items: UserNotification[]) => void,
  onError?: (error: Error) => void,
) {
  const q = query(notificationsCollection, where('recipientUid', '==', uid));

  return onSnapshot(
    q,
    (snapshot) => {
      const items = snapshot.docs
        .map((doc) => {
          const data = doc.data() as Omit<UserNotification, 'id'>;
          return {
            id: doc.id,
            recipientUid: data.recipientUid,
            affiliateId: data.affiliateId,
            type: data.type,
            houseSlug: data.houseSlug,
            houseName: data.houseName,
            title: data.title,
            body: data.body,
            createdAt: (data.createdAt as Timestamp | null) ?? null,
          } as UserNotification;
        })
        .sort((a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0));
      onData(items);
    },
    (error) => {
      onError?.(error);
    },
  );
}
