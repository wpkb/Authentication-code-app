import type { EncryptedEnvelope, VaultPayload } from '../types/vault';

export interface ExistingDemoCandidate {
  envelope: EncryptedEnvelope | null;
  decrypted: VaultPayload | null;
}

export interface DemoVaultStartPlan {
  reuseExisting: boolean;
  payload: VaultPayload;
  saltB64: string | undefined;
  iterations: number | undefined;
  revision: number;
}

export function planDemoVaultStart(params: {
  existingEnvelope: EncryptedEnvelope | null;
  existingDecrypted: VaultPayload | null;
  freshPayload: VaultPayload;
  defaultIterations: number;
}): DemoVaultStartPlan {
  const { existingEnvelope, existingDecrypted, freshPayload, defaultIterations } = params;

  if (existingEnvelope && existingDecrypted) {
    return {
      reuseExisting: true,
      payload: existingDecrypted,
      saltB64: existingEnvelope.salt,
      iterations: existingEnvelope.iterations || defaultIterations,
      revision: existingEnvelope.revision || 1,
    };
  }

  return {
    reuseExisting: false,
    payload: freshPayload,
    saltB64: undefined,
    iterations: defaultIterations,
    revision: 1,
  };
}
