import type { User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type DocumentSnapshot,
  type Unsubscribe,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import type { EncryptedEnvelope, VaultSummary } from '../types/vault';

const pendingProfileOps = new Map<string, Promise<void>>();
const syncedProfilesSession = new Set<string>();
const pendingVaultSaves = new Map<string, Promise<void>>();

export function clearProfileSessionCache(uid?: string): void {
  if (uid) {
    syncedProfilesSession.delete(uid);
  } else {
    syncedProfilesSession.clear();
  }
}

async function getDocPreferServer(
  ref: ReturnType<typeof doc>
): Promise<DocumentSnapshot> {
  try {
    return await getDocFromServer(ref);
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    if (code === 'unavailable' || (err instanceof Error && err.message.includes('offline'))) {
      return getDoc(ref);
    }
    throw err;
  }
}

export function ensureUserProfile(user: User): Promise<void> {
  if (syncedProfilesSession.has(user.uid)) {
    return Promise.resolve();
  }

  const existingOp = pendingProfileOps.get(user.uid);
  if (existingOp) {
    return existingOp;
  }

  const op = (async () => {
    const userPath = `users/${user.uid}`;
    const userRef = doc(db, 'users', user.uid);

    let snap: DocumentSnapshot;
    try {
      snap = await getDocPreferServer(userRef);
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, userPath);
    }

    const payload = {
      uid: user.uid,
      email: (user.email || '').slice(0, 256),
      displayName: (user.displayName || user.email || 'ユーザー').slice(0, 128),
      ...(user.photoURL ? { photoURL: user.photoURL.slice(0, 512) } : {}),
    };

    try {
      if (!snap.exists()) {
        try {
          await setDoc(userRef, {
            ...payload,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } catch (createErr) {
          // If another tab/device created the profile simultaneously, fall back to updateDoc
          const recheck = await getDocPreferServer(userRef).catch(() => null);
          if (recheck?.exists()) {
            await updateDoc(userRef, {
              email: payload.email,
              displayName: payload.displayName,
              ...(payload.photoURL ? { photoURL: payload.photoURL } : {}),
              updatedAt: serverTimestamp(),
            });
          } else {
            throw createErr;
          }
        }
      } else {
        await updateDoc(userRef, {
          email: payload.email,
          displayName: payload.displayName,
          ...(payload.photoURL ? { photoURL: payload.photoURL } : {}),
          updatedAt: serverTimestamp(),
        });
      }
      syncedProfilesSession.add(user.uid);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, userPath);
    }
  })().finally(() => {
    pendingProfileOps.delete(user.uid);
  });

  pendingProfileOps.set(user.uid, op);
  return op;
}

function docToEnvelope(data: Record<string, unknown>): EncryptedEnvelope {
  return {
    version: 1,
    vaultId: String(data.vaultId),
    kdf: 'PBKDF2-SHA256',
    iterations: Number(data.iterations),
    cipher: 'AES-256-GCM',
    salt: String(data.salt),
    iv: String(data.iv),
    ciphertext: String(data.ciphertext),
    checksum: String(data.checksum),
    updatedAt: String(data.clientUpdatedAt || new Date().toISOString()),
    revision: Number(data.revision || 1),
  };
}

export async function listCloudVaults(uid: string): Promise<VaultSummary[]> {
  const colPath = `users/${uid}/vaults`;
  try {
    const q = query(
      collection(db, 'users', uid, 'vaults'),
      where('ownerId', '==', uid)
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => {
      const data = d.data();
      return {
        vaultId: String(data.vaultId),
        updatedAt: String(data.clientUpdatedAt || new Date().toISOString()),
        revision: Number(data.revision || 1),
        source: 'cloud' as const,
      };
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, colPath);
  }
}

export async function loadCloudVault(
  uid: string,
  vaultId: string
): Promise<EncryptedEnvelope | null> {
  const docPath = `users/${uid}/vaults/${vaultId}`;
  try {
    const snap = await getDoc(doc(db, 'users', uid, 'vaults', vaultId));
    if (!snap.exists()) return null;
    return docToEnvelope(snap.data());
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, docPath);
  }
}

export function saveCloudVault(
  user: User,
  envelope: EncryptedEnvelope
): Promise<void> {
  const lockKey = `${user.uid}:${envelope.vaultId}`;
  const prev = pendingVaultSaves.get(lockKey) ?? Promise.resolve();

  const next = prev
    .catch(() => {})
    .then(async () => {
      await ensureUserProfile(user);
      const docPath = `users/${user.uid}/vaults/${envelope.vaultId}`;
      const ref = doc(db, 'users', user.uid, 'vaults', envelope.vaultId);

      let existing: DocumentSnapshot;
      try {
        existing = await getDocPreferServer(ref);
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, docPath);
      }

      const updateFields = {
        version: envelope.version,
        kdf: envelope.kdf,
        iterations: envelope.iterations,
        cipher: envelope.cipher,
        salt: envelope.salt,
        iv: envelope.iv,
        ciphertext: envelope.ciphertext,
        checksum: envelope.checksum,
        revision: envelope.revision,
        clientUpdatedAt: envelope.updatedAt,
        updatedAt: serverTimestamp(),
      };

      try {
        if (!existing.exists()) {
          try {
            await setDoc(ref, {
              vaultId: envelope.vaultId,
              ownerId: user.uid,
              ...updateFields,
              createdAt: serverTimestamp(),
            });
          } catch (createErr) {
            const recheck = await getDocPreferServer(ref).catch(() => null);
            if (recheck?.exists()) {
              await updateDoc(ref, updateFields);
            } else {
              throw createErr;
            }
          }
        } else {
          await updateDoc(ref, updateFields);
        }
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, docPath);
      }
    });

  const tracked = next.finally(() => {
    if (pendingVaultSaves.get(lockKey) === tracked) {
      pendingVaultSaves.delete(lockKey);
    }
  });

  pendingVaultSaves.set(lockKey, tracked);
  return tracked;
}

export async function deleteCloudVault(uid: string, vaultId: string): Promise<void> {
  const docPath = `users/${uid}/vaults/${vaultId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'vaults', vaultId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, docPath);
  }
}

export function subscribeCloudVault(
  uid: string,
  vaultId: string,
  onEnvelope: (envelope: EncryptedEnvelope | null) => void,
  onError?: (err: unknown) => void
): Unsubscribe {
  const docPath = `users/${uid}/vaults/${vaultId}`;
  return onSnapshot(
    doc(db, 'users', uid, 'vaults', vaultId),
    (snap) => {
      if (!snap.exists()) {
        onEnvelope(null);
        return;
      }
      onEnvelope(docToEnvelope(snap.data()));
    },
    (error) => {
      if (onError) {
        onError(error);
      } else {
        handleFirestoreError(error, OperationType.GET, docPath);
      }
    }
  );
}
