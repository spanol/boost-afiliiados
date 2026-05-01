import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore, doc, getDocFromServer, setDoc, serverTimestamp } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
console.log('Firebase Config Loaded:', {
  projectId: firebaseConfig.projectId,
  databaseId: firebaseConfig.firestoreDatabaseId
});
console.log('Firebase App Options:', app.options);

// Initialize Firestore
export const db = getFirestore(app);
export const auth = getAuth(app);
export const storage = getStorage(app);

// Connectivity Test
async function testConnection() {
  setTimeout(async () => {
    try {
      console.log('Testing Firestore presence (delayed)...');
      console.log('Current Auth State:', auth.currentUser ? 'Logged In (' + auth.currentUser.uid + ')' : 'Logged Out');
      const testDoc = doc(db, 'system', 'connection_test_ping');
      await setDoc(testDoc, { testedAt: serverTimestamp(), ping: Math.random() });
      console.log('Firestore write success! Rules are working.');
    } catch (error: any) {
      console.error('Firestore connection/permission test failed:', error.message);
      console.error('Full Error:', error);
    }
  }, 2000); // Wait for auth to potentially initialize
}

testConnection();

// Standardized Firestore Error Handler
export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
    },
    operationType,
    path
  };
  
  const jsonError = JSON.stringify(errInfo);
  console.error('Firestore Error Detailed: ', jsonError);
  
  if (error instanceof Error && (error.message.includes('permission-denied') || error.message.includes('insufficient permissions'))) {
    throw new Error(jsonError);
  }
  
  throw error;
}
