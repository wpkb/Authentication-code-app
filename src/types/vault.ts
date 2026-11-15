export type TotpAlgorithm = 'SHA-1' | 'SHA-256' | 'SHA-512';

export interface RecoveryCodeItem {
  code: string;
  used: boolean;
}

export interface TotpAccount {
  id: string;
  issuer: string;
  label: string;
  secret: string;
  algorithm: TotpAlgorithm;
  digits: 6 | 8;
  period: 30 | 60;
  folder: string;
  favorite: boolean;
  loginUrl?: string;
  note?: string;
  recoveryCodes?: RecoveryCodeItem[];
  createdAt: string;
  updatedAt: string;
}

export interface VaultPayload {
  vaultId: string;
  vaultName: string;
  accounts: TotpAccount[];
  autoLockMinutes: number;
  createdAt: string;
  updatedAt: string;
}

export interface EncryptedEnvelope {
  version: 1;
  vaultId: string;
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  cipher: 'AES-256-GCM';
  salt: string;
  iv: string;
  ciphertext: string;
  checksum: string;
  updatedAt: string;
  revision: number;
}

export type StorageMode = 'cloud' | 'auto' | 'server' | 'cookie';

export interface StorageSyncResult {
  savedTo:
    | 'cloud+cookie'
    | 'cloud-only'
    | 'server+cookie'
    | 'server-only'
    | 'cookie-only';
  cloudSynced?: boolean;
  serverSynced: boolean;
  cookieSynced: boolean;
  cookieTier: 'cookie' | 'cookie+localStorage' | 'none';
  cookieBytes: number;
  error?: string;
}

export interface VaultSummary {
  vaultId: string;
  updatedAt: string;
  revision: number;
  source: 'cloud' | 'server' | 'cookie' | 'both';
}
