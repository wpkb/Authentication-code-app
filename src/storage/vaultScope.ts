import type { VaultSummary } from '../types/vault';

export function mergeScopedAvailableVaults(params: {
  cookieVaults: VaultSummary[];
  cloudVaults: VaultSummary[];
  serverVaults: Array<{ vaultId: string; updatedAt: string; revision: number }>;
  browserKnownVaultIds: string[];
  activeVaultId?: string | null;
}): VaultSummary[] {
  const {
    cookieVaults,
    cloudVaults,
    serverVaults,
    browserKnownVaultIds,
    activeVaultId,
  } = params;

  const byId = new Map<string, VaultSummary>();
  for (const item of cookieVaults) {
    byId.set(item.vaultId, item);
  }

  for (const cl of cloudVaults) {
    const existing = byId.get(cl.vaultId);
    if (existing) {
      byId.set(cl.vaultId, {
        vaultId: cl.vaultId,
        updatedAt: cl.revision >= existing.revision ? cl.updatedAt : existing.updatedAt,
        revision: Math.max(cl.revision, existing.revision),
        source: 'cloud',
      });
    } else {
      byId.set(cl.vaultId, cl);
    }
  }

  const allowedServerIds = new Set<string>([
    ...cookieVaults.map((v) => v.vaultId),
    ...cloudVaults.map((v) => v.vaultId),
    ...browserKnownVaultIds,
    ...(activeVaultId ? [activeVaultId] : []),
  ]);

  for (const srv of serverVaults) {
    // Prevent leaking foreign vaults stored on the shared Express server to logged-out/new browsers
    if (!allowedServerIds.has(srv.vaultId)) continue;

    const existing = byId.get(srv.vaultId);
    if (existing) {
      byId.set(srv.vaultId, {
        vaultId: srv.vaultId,
        updatedAt:
          srv.revision >= existing.revision ? srv.updatedAt : existing.updatedAt,
        revision: Math.max(srv.revision, existing.revision),
        source: existing.source === 'cloud' ? 'cloud' : 'both',
      });
    } else {
      byId.set(srv.vaultId, {
        vaultId: srv.vaultId,
        updatedAt: srv.updatedAt,
        revision: srv.revision,
        source: 'server',
      });
    }
  }

  return Array.from(byId.values()).sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}
