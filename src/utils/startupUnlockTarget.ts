import type { StorageMode, VaultSummary } from '../types/vault';

export interface StartupUnlockTarget {
  vaultId: string;
  storageMode: StorageMode;
  faceEnrolled: boolean;
  shouldAutoStartFaceAuth: boolean;
}

export function resolveStorageModeForVault(
  summary: VaultSummary | undefined
): StorageMode {
  if (!summary) return 'auto';
  if (summary.source === 'cloud') return 'cloud';
  if (summary.source === 'cookie') return 'cookie';
  if (summary.source === 'server') return 'server';
  return 'auto';
}

export function resolveStartupUnlockTarget(params: {
  availableVaults: VaultSummary[];
  initialVaultId?: string | null;
  faceEnrolledVaultIds: string[];
  cameraSupported: boolean;
}): StartupUnlockTarget {
  const {
    availableVaults,
    initialVaultId,
    faceEnrolledVaultIds,
    cameraSupported,
  } = params;

  const preferredVaultId =
    initialVaultId && availableVaults.some((v) => v.vaultId === initialVaultId)
      ? initialVaultId
      : availableVaults.find((v) => faceEnrolledVaultIds.includes(v.vaultId))?.vaultId ??
        availableVaults[0]?.vaultId ??
        initialVaultId ??
        '';

  const summary =
    availableVaults.find((v) => v.vaultId === preferredVaultId) ?? availableVaults[0];
  const vaultId = summary?.vaultId || preferredVaultId || '';
  const storageMode = resolveStorageModeForVault(summary);
  const faceEnrolled =
    Boolean(vaultId) && faceEnrolledVaultIds.includes(vaultId);

  return {
    vaultId,
    storageMode,
    faceEnrolled,
    shouldAutoStartFaceAuth: faceEnrolled && cameraSupported,
  };
}
