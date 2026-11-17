import type { StorageMode, VaultSummary } from '../types/vault';
import { resolveStorageModeForVault } from './startupUnlockTarget';

export interface AuthScreenSyncDecision {
  shouldUpdateTab: boolean;
  nextTab: 'unlock' | 'create' | 'import';
  shouldUpdateVaultId: boolean;
  nextVaultId: string;
  shouldUpdateVaultName: boolean;
  nextVaultName: string;
}

export function computeAuthScreenDefaults(params: {
  googleSignedIn: boolean;
  availableVaults: VaultSummary[];
  initialVaultId: string | null;
  faceEnrolledVaultIds: string[];
  currentTab: 'unlock' | 'create' | 'import';
  currentVaultId: string;
  userEditedTab: boolean;
  userEditedVaultId: boolean;
}): AuthScreenSyncDecision {
  const {
    googleSignedIn,
    availableVaults,
    initialVaultId,
    faceEnrolledVaultIds,
    currentTab,
    currentVaultId,
    userEditedTab,
    userEditedVaultId,
  } = params;

  const cloudVault = googleSignedIn
    ? availableVaults.find((v) => v.source === 'cloud')
    : undefined;
  const faceVault = availableVaults.find((v) =>
    faceEnrolledVaultIds.includes(v.vaultId)
  );
  const initialSummary = initialVaultId
    ? availableVaults.find((v) => v.vaultId === initialVaultId)
    : undefined;

  if (availableVaults.length === 0) {
    const fallbackId = googleSignedIn ? 'cloud-main' : 'main-vault';
    const fallbackName = googleSignedIn ? 'クラウド認証ボルト' : 'メイン認証ボルト';
    const isAutoPlaceholder =
      !currentVaultId ||
      currentVaultId === 'main-vault' ||
      currentVaultId === 'cloud-main';

    return {
      shouldUpdateTab: !userEditedTab && !initialVaultId && currentTab !== 'create',
      nextTab: 'create',
      shouldUpdateVaultId: !userEditedVaultId && isAutoPlaceholder && currentVaultId !== fallbackId,
      nextVaultId: initialVaultId || fallbackId,
      shouldUpdateVaultName: googleSignedIn,
      nextVaultName: fallbackName,
    };
  }

  // Prefer explicit initialVaultId if present in availableVaults, else face-enrolled vault, else cloud/first vault
  const preferredSummary =
    (initialSummary && faceEnrolledVaultIds.includes(initialSummary.vaultId)
      ? initialSummary
      : undefined) ??
    initialSummary ??
    faceVault ??
    cloudVault ??
    availableVaults[0];

  const isPlaceholderId =
    !currentVaultId ||
    ((currentVaultId === 'main-vault' || currentVaultId === 'cloud-main') &&
      !availableVaults.some((v) => v.vaultId === currentVaultId));

  const nextVaultId = preferredSummary.vaultId;

  return {
    shouldUpdateTab: !userEditedTab && currentTab !== 'import' && currentTab !== 'unlock',
    nextTab: 'unlock',
    shouldUpdateVaultId:
      !userEditedVaultId &&
      (isPlaceholderId || Boolean(initialSummary) || Boolean(cloudVault) || Boolean(faceVault)) &&
      currentVaultId !== nextVaultId,
    nextVaultId,
    shouldUpdateVaultName: false,
    nextVaultName: '',
  };
}

export function resolveAuthVaultStorageMode(
  vaultId: string,
  availableVaults: VaultSummary[],
  fallbackMode: StorageMode
): StorageMode {
  const summary = availableVaults.find((v) => v.vaultId === vaultId);
  if (!summary) return fallbackMode;
  return resolveStorageModeForVault(summary);
}
