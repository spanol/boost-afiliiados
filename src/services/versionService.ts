import { doc, onSnapshot, type Timestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { AppVersion } from '../lib/version';

// app_meta/version: doc publicado pelo servidor (Admin SDK) no boot de cada deploy.
// Leitura liberada a signed-in (regra app_meta). Lê direto do Firestore (onSnapshot) —
// padrão dos serviços de tempo real do repo (notices/direct_messages).

export interface RemoteAppVersion extends AppVersion {
  updatedAt?: Timestamp | null;
}

// Realtime: o banner de atualização compara `version` com a do bundle e, se diferirem,
// oferece o refresh. Retorna a função de unsubscribe do onSnapshot.
export function subscribeToAppVersion(
  onData: (version: RemoteAppVersion | null) => void,
  onError?: (error: Error) => void,
) {
  return onSnapshot(
    doc(db, 'app_meta', 'version'),
    (snap) => onData(snap.exists() ? (snap.data() as RemoteAppVersion) : null),
    (error) => onError?.(error),
  );
}
