import { getFirebaseApp } from '../config/firebase';

export interface FirebaseVerifiedToken {
  uid: string;
  phone_number?: string;
  email?: string;
  name?: string;
}

export async function verifyFirebaseToken(idToken: string): Promise<FirebaseVerifiedToken> {
  const app = getFirebaseApp();
  if (!app) throw new Error('Firebase is not configured on this server');
  const decoded = await app.auth().verifyIdToken(idToken);
  return {
    uid: decoded.uid,
    phone_number: decoded.phone_number,
    email: decoded.email,
    name: decoded.name,
  };
}
