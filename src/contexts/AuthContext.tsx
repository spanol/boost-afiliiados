import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, getDocFromServer, onSnapshot } from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from '../lib/firebase';

interface UserProfile {
  uid: string;
  name: string;
  email: string;
  role: 'admin' | 'client';
  avatarUrl?: string;
  affiliateId?: string;
  mustChangePassword?: boolean;
  isSpecial?: boolean; // B3 · afiliado especial (vê a própria sub-rede)
}

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType>({ user: null, profile: null, loading: true });

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsubscribeProfile: (() => void) | null = null;

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);

      if (unsubscribeProfile) {
        unsubscribeProfile();
        unsubscribeProfile = null;
      }

      if (currentUser) {
        // R14: na TROCA de conta (A→B), até o profile do novo usuário chegar, não
        // exponha o perfil/loading do anterior — senão o ProtectedRoute roteia com o
        // papel errado (user=B, profile=A, loading=false). Volta a "carregando" e
        // limpa o perfil obsoleto; o snapshot abaixo seta os dois. (No 1º login já é
        // o estado inicial; updates de profile NÃO repassam aqui, só o snapshot.)
        setProfile(null);
        setLoading(true);
        const path = `users/${currentUser.uid}`;
        try {
          const docRef = doc(db, 'users', currentUser.uid);
          unsubscribeProfile = onSnapshot(docRef, (docSnap) => {
            if (docSnap.exists()) {
              setProfile(docSnap.data() as UserProfile);
            } else {
              setProfile(null);
            }
            setLoading(false);
          }, (error) => {
            console.error('Error fetching profile snapshot:', error);
            handleFirestoreError(error, OperationType.GET, path);
            setProfile(null);
            setLoading(false);
          });
        } catch (error: any) {
          console.error('Error fetching profile:', error);
          handleFirestoreError(error, OperationType.GET, path);
          setProfile(null);
          setLoading(false);
        }
      } else {
        setProfile(null);
        setLoading(false);
      }
    });

    return () => {
      unsubscribe();
      if (unsubscribeProfile) {
        unsubscribeProfile();
      }
    };
  }, []);

  return (
    <AuthContext.Provider value={{ user, profile, loading }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
