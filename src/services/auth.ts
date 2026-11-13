import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  type Unsubscribe,
  type User,
} from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import {
  auth,
  BOOTSTRAPPED_OWNER_EMAIL,
  db,
  handleFirestoreError,
  normalizeUserAccount,
  OperationType,
} from './firebase.ts';
import type { UserAccount } from '../types.ts';

export const WORKSPACE_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/gmail.send',
] as const;

const provider = new GoogleAuthProvider();
for (const scope of WORKSPACE_SCOPES) {
  provider.addScope(scope);
}
provider.setCustomParameters({ prompt: 'select_account' });

// Strictly in-memory OAuth access token cache (never localStorage/sessionStorage)
let cachedAccessToken: string | null = null;
let isSigningIn = false;

export function getWorkspaceAccessToken(): string | null {
  return cachedAccessToken;
}

export function initAuthObserver(
  onUserChange: (user: User | null, hasWorkspaceToken: boolean) => void
): Unsubscribe {
  return onAuthStateChanged(auth, (user) => {
    if (!user) {
      cachedAccessToken = null;
      onUserChange(null, false);
      return;
    }
    if (!cachedAccessToken && !isSigningIn) {
      cachedAccessToken = null;
    }
    onUserChange(user, Boolean(cachedAccessToken));
  });
}

export async function ensureUserProfile(user: User): Promise<UserAccount> {
  const path = `users/${user.uid}`;
  try {
    const userRef = doc(db, 'users', user.uid);
    const snap = await getDoc(userRef);

    if (snap.exists()) {
      return normalizeUserAccount(snap.data() as Record<string, unknown>);
    }

    const isBootstrappedOwner =
      Boolean(user.emailVerified) &&
      (user.email || '').toLowerCase() === BOOTSTRAPPED_OWNER_EMAIL;

    const newProfile: Record<string, unknown> = {
      uid: user.uid,
      email: (user.email || '').slice(0, 200),
      displayName: (user.displayName || user.email?.split('@')[0] || 'Member').slice(0, 120),
      role: isBootstrappedOwner ? 'owner' : 'member',
      status: 'active',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    if (user.photoURL) {
      newProfile.photoURL = user.photoURL.slice(0, 500);
    }

    await setDoc(userRef, newProfile);
    const createdSnap = await getDoc(userRef);
    return normalizeUserAccount((createdSnap.data() || newProfile) as Record<string, unknown>);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function googleSignIn(): Promise<{
  user: User;
  accessToken: string | null;
}> {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    cachedAccessToken = credential?.accessToken || null;
    return {
      user: result.user,
      accessToken: cachedAccessToken,
    };
  } finally {
    isSigningIn = false;
  }
}

export async function authorizeWorkspaceToken(): Promise<string> {
  isSigningIn = true;
  try {
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Google Workspace access token was not granted.');
    }
    cachedAccessToken = credential.accessToken;
    return cachedAccessToken;
  } finally {
    isSigningIn = false;
  }
}

export async function logout(): Promise<void> {
  cachedAccessToken = null;
  await auth.signOut();
}
