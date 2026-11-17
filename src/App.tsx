import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import {
  Cloud,
  Cookie,
  Folder,
  HardDrive,
  KeyRound,
  Lock,
  LogOut,
  Menu,
  Moon,
  Plus,
  ScanFace,
  Search,
  Server,
  ShieldAlert,
  ShieldCheck,
  Star,
  Sun,
  X,
  Zap,
} from 'lucide-react';
import { AddEditAccountModal } from './components/AddEditAccountModal';
import { AutofillBridgeView } from './components/AutofillBridgeView';
import { BottomToastHost, type ToastItem, type ToastTone } from './components/BottomToastHost';
import { FaceAuthModal } from './components/FaceAuthModal';
import { OfflineIndicator } from './components/OfflineIndicator';
import { PWAInstallButton } from './components/PWAInstallButton';
import { QrExportModal } from './components/QrExportModal';
import { RecoveryCodesModal } from './components/RecoveryCodesModal';
import { SecurityAuditView } from './components/SecurityAuditView';
import {
  StartupLoadingModal,
  type StartupPhase,
  type StartupUnlockReason,
} from './components/StartupLoadingModal';
import { SyncBackupView } from './components/SyncBackupView';
import { TotpCard } from './components/TotpCard';
import { VaultAuthScreen } from './components/VaultAuthScreen';
import {
  detectCameraCapabilities,
  getEnrolledFaceVaultIds,
  removeFaceForVault,
  saveEnrolledFaceForVault,
  syncEnrolledFaceVaultIds,
  updateFaceVaultKey,
  type CameraCapabilities,
} from './crypto/faceAuthVault';
import {
  clearAllTrustedKeys,
  clearAllTrustedKeysForUser,
  clearTrustedVaultKey,
  getTrustedVaultKey,
  saveTrustedVaultKey,
} from './crypto/trustedKeyStore';
import { generateTotp, type TotpResult } from './crypto/totp';
import {
  DEFAULT_PBKDF2_ITERATIONS,
  decryptVault,
  decryptVaultWithKey,
  deriveKeyAndSalt,
  encryptVaultWithKey,
} from './crypto/vaultCrypto';
import { auth, googleProvider } from './firebase';
import {
  clearProfileSessionCache,
  ensureUserProfile,
  subscribeCloudVault,
} from './storage/cloudVault';
import {
  getActiveVaultIdPref,
  getStorageModePref,
  setActiveVaultIdPref,
  setStorageModePref,
} from './storage/cookieVault';
import {
  checkServerHealth,
  deleteVaultEverywhere,
  listAvailableVaults,
  loadEncryptedVault,
  saveEncryptedVault,
  type ServerHealthStatus,
} from './storage/vaultStorage';
import type {
  EncryptedEnvelope,
  RecoveryCodeItem,
  StorageMode,
  StorageSyncResult,
  TotpAccount,
  TotpAlgorithm,
  VaultPayload,
  VaultSummary,
} from './types/vault';
import { createDemoVaultPayload } from './utils/demoData';
import { planDemoVaultStart } from './utils/demoVaultPolicy';
import {
  clearAutoBackupsForVault,
  deleteAutoBackupSnapshot,
  listAutoBackupSnapshots,
  loadAutoBackupSettings,
  saveAutoBackupSettings,
  saveAutoBackupSnapshot,
  type AutoBackupSettings,
  type AutoBackupSnapshot,
} from './storage/autoBackupStore';
import {
  checkPersistedAutoLockExpiry,
  clearUnlockedActivitySession,
  isAutoLockExpired,
  recordUnlockedActivity,
  updatePersistedAutoLockMinutes,
} from './utils/autoLockPolicy';
import { runVaultSecurityAudit } from './utils/securityAudit';
import { resolveStartupUnlockTarget } from './utils/startupUnlockTarget';

type ActiveSection = 'all' | 'favorites' | 'autofill' | 'audit' | 'sync';

const SESSION_ONLY_PREF_KEY = 'kv_session_only_lock';
const SESSION_TAB_ALIVE_KEY = 'kv_session_tab_active';
const SESSION_CLOSED_LOCK_KEY = 'kv_session_closed_lock';
const LOCKED_STATE_KEY = 'kv_vault_locked';

function readPersistedLockFlag(): boolean {
  try {
    return localStorage.getItem(LOCKED_STATE_KEY) === '1';
  } catch {
    return false;
  }
}

function getInitialStartupExpiry() {
  return checkPersistedAutoLockExpiry(Date.now());
}

interface ActiveCryptoSession {
  key: CryptoKey;
  saltB64: string;
  iterations: number;
}

export default function App() {
  const [isDark, setIsDark] = useState<boolean>(() => {
    try {
      return localStorage.getItem('kv_theme') === 'dark';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
    try {
      localStorage.setItem('kv_theme', isDark ? 'dark' : 'light');
    } catch {
      // ignore
    }
  }, [isDark]);

  // Firebase Auth state
  const [googleUser, setGoogleUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState<boolean>(true);
  const [trustDevice, setTrustDevice] = useState<boolean>(() => {
    try {
      return localStorage.getItem('kv_trust_device') !== 'false';
    } catch {
      return true;
    }
  });
  const [sessionOnlyLock, setSessionOnlyLock] = useState<boolean>(() => {
    try {
      return localStorage.getItem(SESSION_ONLY_PREF_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const [storageMode, setStorageModeState] = useState<StorageMode>(() =>
    getStorageModePref()
  );
  const [serverHealth, setServerHealth] = useState<ServerHealthStatus>({
    available: true,
    storage: 'checking',
    writable: true,
  });
  const [availableVaults, setAvailableVaults] = useState<VaultSummary[]>([]);
  const [initialVaultId, setInitialVaultId] = useState<string | null>(() =>
    getActiveVaultIdPref()
  );

  // Unlocked vault state (null when locked)
  const [vault, setVault] = useState<VaultPayload | null>(null);
  const [passphrase, setPassphrase] = useState<string>('');
  const [envelope, setEnvelope] = useState<EncryptedEnvelope | null>(null);
  const [syncStatus, setSyncStatus] = useState<StorageSyncResult | null>(null);

  const initialExpiryRef = useRef(getInitialStartupExpiry());
  // Non-extractable CryptoKey session
  const activeKeyRef = useRef<ActiveCryptoSession | null>(null);
  const manualLockRef = useRef<boolean>(
    readPersistedLockFlag() || initialExpiryRef.current.expired
  );
  const vaultRef = useRef<VaultPayload | null>(null);
  vaultRef.current = vault;
  const trustDeviceRef = useRef<boolean>(trustDevice);
  trustDeviceRef.current = trustDevice;
  const sessionOnlyLockRef = useRef<boolean>(sessionOnlyLock);
  sessionOnlyLockRef.current = sessionOnlyLock;
  const envelopeRef = useRef<EncryptedEnvelope | null>(envelope);
  envelopeRef.current = envelope;
  const envelopeRevisionRef = useRef<number>(0);
  envelopeRevisionRef.current = envelope?.revision ?? 0;

  // UI Navigation & Filters
  const [activeSection, setActiveSection] = useState<ActiveSection>('all');
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);

  // Live TOTP map
  const [totpMap, setTotpMap] = useState<Record<string, TotpResult>>({});

  // Modals
  const [addModalOpen, setAddModalOpen] = useState<boolean>(false);
  const [editingAccount, setEditingAccount] = useState<TotpAccount | null>(null);
  const [qrAccount, setQrAccount] = useState<TotpAccount | null>(null);
  const [recoveryAccountId, setRecoveryAccountId] = useState<string | null>(null);
  const [deletingAccount, setDeletingAccount] = useState<TotpAccount | null>(null);

  useEffect(() => {
    if (!deletingAccount && !mobileMenuOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (deletingAccount) setDeletingAccount(null);
        else if (mobileMenuOpen) setMobileMenuOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [deletingAccount, mobileMenuOpen]);

  // Independent In-Web Camera Face Authentication state
  const [faceVaultIds, setFaceVaultIds] = useState<string[]>(() =>
    getEnrolledFaceVaultIds()
  );
  const [cameraCapabilities, setCameraCapabilities] =
    useState<CameraCapabilities>(() => detectCameraCapabilities());
  const [faceModal, setFaceModal] = useState<{
    open: boolean;
    mode: 'enroll' | 'verify';
    vaultId: string;
    vaultName?: string;
    storageMode: StorageMode;
  }>({
    open: false,
    mode: 'enroll',
    vaultId: '',
    storageMode: 'auto',
  });
  // Automatic encrypted backup state
  const [autoBackupSettings, setAutoBackupSettings] = useState<AutoBackupSettings>(() =>
    loadAutoBackupSettings()
  );
  const autoBackupSettingsRef = useRef<AutoBackupSettings>(autoBackupSettings);
  autoBackupSettingsRef.current = autoBackupSettings;
  const [autoBackupSnapshots, setAutoBackupSnapshots] = useState<AutoBackupSnapshot[]>([]);

  const [faceBannerDismissed, setFaceBannerDismissed] =
    useState<boolean>(false);

  // Startup loading overlay state
  const isAutostartUrl =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('autostart') === '1';
  const isAutostartSessionRef = useRef<boolean>(
    isAutostartUrl && !manualLockRef.current && !initialExpiryRef.current.expired
  );
  const [startupUnlockReason, setStartupUnlockReason] = useState<StartupUnlockReason>(() => {
    if (initialExpiryRef.current.expired) return 'auto-expired';
    if (readPersistedLockFlag()) return 'locked';
    return null;
  });
  const [startupSubView, setStartupSubView] = useState<'select' | 'password'>('select');
  const [startupPhase, setStartupPhase] = useState<StartupPhase>(
    isAutostartSessionRef.current ? 'idle' : 'checking-auth'
  );
  const [startupDetail, setStartupDetail] = useState<string>(
    '認証セッションと保存先を確認しています'
  );
  const skipAutoUnlockRef = useRef<boolean>(false);
  const autoStartedFaceRef = useRef<boolean>(false);

  const markVaultLocked = useCallback(() => {
    manualLockRef.current = true;
    clearUnlockedActivitySession();
    try {
      localStorage.setItem(LOCKED_STATE_KEY, '1');
    } catch {
      // ignore
    }
  }, []);

  const clearVaultLocked = useCallback(() => {
    manualLockRef.current = false;
    setStartupUnlockReason(null);
    try {
      localStorage.removeItem(LOCKED_STATE_KEY);
    } catch {
      // ignore
    }
  }, []);

  // Persist auto-expired lock state cleanly after mount if startup check detected >= autoLockMinutes idle
  useEffect(() => {
    if (initialExpiryRef.current.expired) {
      markVaultLocked();
    }
  }, [markVaultLocked]);

  // Bottom Toast stack & Lock notice
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastTimersRef = useRef<Map<string, number>>(new Map());
  const [lockNotice, setLockNotice] = useState<string | null>(() => {
    if (initialExpiryRef.current.expired) {
      return `前回の操作から${initialExpiryRef.current.thresholdMinutes}分以上経過したため自動ロックしました。Web顔認証またはパスワードでロック解除してください。`;
    }
    return readPersistedLockFlag()
      ? 'ボルトはロックされています。再アクセスするには顔認証またはマスターパスフレーズでロック解除してください。'
      : null;
  });

  const dismissToast = useCallback((id: string) => {
    const existingTimer = toastTimersRef.current.get(id);
    if (existingTimer !== undefined) {
      window.clearTimeout(existingTimer);
      toastTimersRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const pushToast = useCallback(
    (message: string, tone: ToastTone = 'success') => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setToasts((prev) => [...prev.slice(-3), { id, message, tone }]);
      const timer = window.setTimeout(() => {
        toastTimersRef.current.delete(id);
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 4000);
      toastTimersRef.current.set(id, timer);
    },
    []
  );

  useEffect(() => {
    return () => {
      toastTimersRef.current.forEach((t) => window.clearTimeout(t));
      toastTimersRef.current.clear();
    };
  }, []);

  const lastActivityRef = useRef<number>(Date.now());
  const autostartRanRef = useRef<boolean>(false);

  const handleSelectStorageMode = useCallback((mode: StorageMode) => {
    setStorageModeState(mode);
    setStorageModePref(mode);
  }, []);

  const refreshDiagnostics = useCallback(
    async (userOverride?: User | null) => {
      const targetUser = userOverride !== undefined ? userOverride : googleUser;
      const [health, vaults] = await Promise.all([
        checkServerHealth(),
        listAvailableVaults(targetUser),
      ]);
      setServerHealth(health);
      setAvailableVaults(vaults);
    },
    [googleUser]
  );

  const handleSkipStartupWait = useCallback(() => {
    skipAutoUnlockRef.current = true;
    setStartupPhase('idle');
    pushToast('待機をスキップしました。手動で操作できます。', 'info');
  }, [pushToast]);

  // Detect camera capability & sync enrolled in-web face auth vault IDs
  useEffect(() => {
    let active = true;
    setCameraCapabilities(detectCameraCapabilities());
    void syncEnrolledFaceVaultIds().then((ids) => {
      if (!active) return;
      setFaceVaultIds(ids);
    });
    return () => {
      active = false;
    };
  }, []);

  // Firebase Auth listener + Trusted Device Auto-Unlock (mount once)
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setGoogleUser(user);
      setAuthLoading(false);

      // Re-verify persisted inactivity expiration before attempting any auto-unlock
      const runtimeExpiry = checkPersistedAutoLockExpiry(Date.now());
      if (runtimeExpiry.expired) {
        markVaultLocked();
        setStartupUnlockReason('auto-expired');
        setLockNotice(
          `前回の操作から${runtimeExpiry.thresholdMinutes}分以上経過したため自動ロックしました。Web顔認証またはパスワードでロック解除してください。`
        );
      }

      let loadedVaults: VaultSummary[] = [];

      try {
        if (user) {
          const explicitlyLocked = manualLockRef.current || readPersistedLockFlag();
          if (!skipAutoUnlockRef.current && !isAutostartSessionRef.current) {
            setStartupPhase('fetching-vaults');
            setStartupDetail(
              `${user.email || 'Googleアカウント'} の保存済みボルトを読み込み中...`
            );
          }
          try {
            await ensureUserProfile(user);
          } catch {
            // ignore transient offline errors
          }
          const [health, vaults] = await Promise.all([
            checkServerHealth(),
            listAvailableVaults(user),
          ]);
          loadedVaults = vaults;
          setServerHealth(health);
          setAvailableVaults(vaults);

          if (getStorageModePref() === 'auto') {
            handleSelectStorageMode('cloud');
          }

          // Attempt trusted browser auto-unlock only if not locked, not expired, and not Session Only
          if (
            !explicitlyLocked &&
            !manualLockRef.current &&
            !vaultRef.current &&
            trustDeviceRef.current &&
            !sessionOnlyLockRef.current &&
            !skipAutoUnlockRef.current &&
            !runtimeExpiry.expired
          ) {
            const candidateIds = Array.from(
              new Set(
                [
                  getActiveVaultIdPref(),
                  ...vaults.filter((v) => v.source === 'cloud').map((v) => v.vaultId),
                  ...vaults.map((v) => v.vaultId),
                  'cloud-main',
                ].filter((id): id is string => Boolean(id))
              )
            );

            for (const candidateId of candidateIds) {
              if (skipAutoUnlockRef.current) break;
              const trusted = await getTrustedVaultKey(user.uid, candidateId);
              if (!trusted) continue;

              setStartupPhase('decrypting-vault');
              setStartupDetail(
                `信頼済み鍵でボルト「${candidateId}」を自動復号しています...`
              );

              const loaded = await loadEncryptedVault(candidateId, 'cloud', user);
              if (!loaded.envelope || skipAutoUnlockRef.current) continue;

              try {
                const decrypted = await decryptVaultWithKey(loaded.envelope, trusted.key);
                const nowMs = Date.now();
                activeKeyRef.current = {
                  key: trusted.key,
                  saltB64: trusted.saltB64,
                  iterations: trusted.iterations,
                };
                lastActivityRef.current = nowMs;
                recordUnlockedActivity(decrypted.autoLockMinutes, nowMs);
                clearVaultLocked();
                setLockNotice(null);
                setVault(decrypted);
                setEnvelope(loaded.envelope);
                setActiveVaultIdPref(decrypted.vaultId);
                setInitialVaultId(decrypted.vaultId);
                setSyncStatus({
                  savedTo: loaded.source === 'cloud' ? 'cloud+cookie' : 'cookie-only',
                  cloudSynced: loaded.source === 'cloud',
                  serverSynced: false,
                  cookieSynced: true,
                  cookieTier: 'cookie',
                  cookieBytes: JSON.stringify(loaded.envelope).length,
                });
                pushToast(
                  `信頼済みブラウザ鍵で「${decrypted.vaultName}」を自動解除しました`,
                  'success'
                );
                break;
              } catch {
                await clearTrustedVaultKey(user.uid, candidateId);
              }
            }
          }
        } else {
          if (!skipAutoUnlockRef.current && !isAutostartSessionRef.current) {
            setStartupPhase('fetching-vaults');
            setStartupDetail('サーバーおよび暗号化Cookieの保存済みボルトを確認中...');
          }
          const [health, vaults] = await Promise.all([
            checkServerHealth(),
            listAvailableVaults(null),
          ]);
          loadedVaults = vaults;
          setServerHealth(health);
          setAvailableVaults(vaults);
        }

        const enrolledFaceIds = await syncEnrolledFaceVaultIds();
        setFaceVaultIds(enrolledFaceIds);
        const camCaps = detectCameraCapabilities();

        if (
          !vaultRef.current &&
          !isAutostartSessionRef.current &&
          !skipAutoUnlockRef.current &&
          loadedVaults.length > 0
        ) {
          if (!runtimeExpiry.expired) {
            setStartupUnlockReason((prev) =>
              prev ?? (manualLockRef.current || readPersistedLockFlag() ? 'locked' : 'saved-session')
            );
          }

          const target = resolveStartupUnlockTarget({
            availableVaults: loadedVaults,
            initialVaultId: getActiveVaultIdPref(),
            faceEnrolledVaultIds: enrolledFaceIds,
            cameraSupported: camCaps.supported,
          });

          if (target.shouldAutoStartFaceAuth && !autoStartedFaceRef.current) {
            autoStartedFaceRef.current = true;
            setStartupSubView('select');
            setStartupPhase('idle');
            setFaceModal({
              open: true,
              mode: 'verify',
              vaultId: target.vaultId,
              vaultName: target.vaultId,
              storageMode: target.storageMode,
            });
          } else {
            setStartupSubView('select');
            setStartupPhase('choose-unlock');
          }
        } else {
          if (!user && loadedVaults.length === 0 && !vaultRef.current) {
            clearVaultLocked();
            clearUnlockedActivitySession();
            setLockNotice(null);
          }
          setStartupPhase('idle');
        }
      } catch {
        setStartupPhase('idle');
      }
    });

    return () => unsubscribe();
  }, [handleSelectStorageMode, pushToast, markVaultLocked, clearVaultLocked]);

  const handleGoogleSignIn = async () => {
    clearVaultLocked();
    skipAutoUnlockRef.current = false;
    setStartupPhase('signing-in');
    setStartupDetail('Googleアカウントを選択してログインしてください...');
    try {
      const result = await signInWithPopup(auth, googleProvider);
      if (result.user) {
        setStartupPhase('fetching-vaults');
        setStartupDetail(
          `${result.user.email || 'Googleアカウント'} のクラウドボルトを同期中...`
        );
        await ensureUserProfile(result.user);
        handleSelectStorageMode('cloud');
        await refreshDiagnostics(result.user);
        pushToast(`${result.user.email || 'Google'} でログインしました`, 'success');
      }
    } finally {
      setStartupPhase('idle');
    }
  };

  const handleGoogleSignOut = async () => {
    const uid = googleUser?.uid;
    if (uid) {
      await clearAllTrustedKeysForUser(uid);
      clearProfileSessionCache(uid);
    }
    clearVaultLocked();
    clearUnlockedActivitySession();
    setLockNotice(null);
    await signOut(auth);
    activeKeyRef.current = null;
    setVault(null);
    setPassphrase('');
    setEnvelope(null);
    setTotpMap({});
    setAutoBackupSnapshots([]);
    handleSelectStorageMode('auto');
    await refreshDiagnostics(null);
    pushToast('Googleアカウントからログアウトしました', 'info');
  };

  // Persist & encrypt vault helper
  const persistVault = useCallback(
    async (
      nextVault: VaultPayload,
      cryptoSession: ActiveCryptoSession,
      nextRevision: number,
      modeOverride?: StorageMode,
      userOverride?: User | null
    ): Promise<StorageSyncResult> => {
      const mode = modeOverride ?? storageMode;
      const targetUser = userOverride !== undefined ? userOverride : googleUser;
      const encrypted = await encryptVaultWithKey(
        nextVault,
        cryptoSession.key,
        cryptoSession.saltB64,
        cryptoSession.iterations,
        nextRevision
      );
      const result = await saveEncryptedVault(encrypted, mode, targetUser);
      setVault(nextVault);
      setEnvelope(encrypted);
      setSyncStatus(result);
      setActiveVaultIdPref(nextVault.vaultId);
      setInitialVaultId(nextVault.vaultId);
      void refreshDiagnostics(targetUser);

      // Capture encrypted auto-backup snapshot on change (deduplicated by checksum)
      if (
        autoBackupSettingsRef.current.enabled &&
        autoBackupSettingsRef.current.frequency !== 'off'
      ) {
        void saveAutoBackupSnapshot({
          envelope: encrypted,
          accountCount: nextVault.accounts.length,
          reason: 'auto-change',
          settings: autoBackupSettingsRef.current,
        }).then((bak) => {
          setAutoBackupSnapshots(bak.snapshots);
          if (bak.saved) {
            setAutoBackupSettings(bak.updatedSettings);
          }
        });
      }

      return result;
    },
    [storageMode, googleUser, refreshDiagnostics]
  );

  // Sync auto-backup snapshot list when unlocking a vault & run periodic auto-backup scheduler
  useEffect(() => {
    if (!vault) {
      setAutoBackupSnapshots([]);
      return;
    }

    let cancelled = false;
    void listAutoBackupSnapshots(vault.vaultId).then((snaps) => {
      if (!cancelled) setAutoBackupSnapshots(snaps);
    });

    if (
      !autoBackupSettings.enabled ||
      (autoBackupSettings.frequency !== 'every-15m' &&
        autoBackupSettings.frequency !== 'every-1h')
    ) {
      return () => {
        cancelled = true;
      };
    }

    const timer = window.setInterval(() => {
      const currentEnv = envelopeRef.current;
      const currentVault = vaultRef.current;
      if (!currentEnv || !currentVault) return;
      void saveAutoBackupSnapshot({
        envelope: currentEnv,
        accountCount: currentVault.accounts.length,
        reason: 'auto-schedule',
        settings: autoBackupSettingsRef.current,
      }).then((bak) => {
        if (cancelled) return;
        setAutoBackupSnapshots(bak.snapshots);
        if (bak.saved) {
          setAutoBackupSettings(bak.updatedSettings);
          pushToast(
            `定期自動バックアップを保存しました (Rev.${currentEnv.revision})`,
            'info'
          );
        }
      });
    }, 60_000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [vault?.vaultId, autoBackupSettings.enabled, autoBackupSettings.frequency, pushToast]);

  // Real-time Firestore cloud sync when unlocked
  useEffect(() => {
    if (!googleUser || !vault || (storageMode !== 'cloud' && storageMode !== 'auto')) {
      return;
    }

    const unsub = subscribeCloudVault(
      googleUser.uid,
      vault.vaultId,
      async (remoteEnvelope) => {
        if (!remoteEnvelope || !activeKeyRef.current) return;
        const currentRev = envelopeRevisionRef.current;
        if (remoteEnvelope.revision <= currentRev) return;
        try {
          const decrypted = await decryptVaultWithKey(
            remoteEnvelope,
            activeKeyRef.current.key
          );
          setVault(decrypted);
          setEnvelope(remoteEnvelope);
          pushToast('別端末での変更をGoogleクラウドから同期しました', 'info');
        } catch {
          // Ignore if encrypted under different key
        }
      },
      () => {
        // Ignore transient offline listener errors
      }
    );

    return () => unsub();
  }, [googleUser, vault?.vaultId, storageMode, pushToast]);

  const handleCreateVault = async (params: {
    vaultId: string;
    vaultName: string;
    passphrase: string;
    storageMode: StorageMode;
    trustDevice: boolean;
  }) => {
    const now = new Date().toISOString();
    const newVault: VaultPayload = {
      vaultId: params.vaultId,
      vaultName: params.vaultName,
      accounts: [],
      autoLockMinutes: 15,
      createdAt: now,
      updatedAt: now,
    };
    const derived = await deriveKeyAndSalt(
      params.passphrase,
      undefined,
      DEFAULT_PBKDF2_ITERATIONS
    );
    const nowMs = Date.now();
    activeKeyRef.current = derived;
    clearVaultLocked();
    lastActivityRef.current = nowMs;
    recordUnlockedActivity(newVault.autoLockMinutes, nowMs);
    setLockNotice(null);
    setStartupPhase('idle');

    handleSelectStorageMode(params.storageMode);
    setTrustDevice(params.trustDevice);
    try {
      localStorage.setItem('kv_trust_device', String(params.trustDevice));
    } catch {
      // ignore
    }

    if (googleUser && params.trustDevice && !sessionOnlyLockRef.current) {
      await saveTrustedVaultKey({
        uid: googleUser.uid,
        vaultId: params.vaultId,
        ...derived,
      });
    }

    const res = await persistVault(newVault, derived, 1, params.storageMode);
    setPassphrase(params.passphrase);
    setActiveSection('all');
    setSelectedFolder(null);
    pushToast(
      res.savedTo === 'cloud+cookie'
        ? 'ボルトを作成し、Googleクラウド(Firestore)とCookieに暗号化保存しました'
        : res.savedTo === 'server+cookie'
        ? 'ボルトを作成し、サーバーとCookieの両方に暗号化保存しました'
        : 'ボルトを作成し、暗号化Cookieに保存しました',
      'success'
    );
  };

  const handleUnlockVault = async (params: {
    vaultId: string;
    passphrase: string;
    storageMode: StorageMode;
    trustDevice: boolean;
  }) => {
    handleSelectStorageMode(params.storageMode);
    const loaded = await loadEncryptedVault(params.vaultId, params.storageMode, googleUser);
    if (!loaded.envelope) {
      throw new Error(`ボルト "${params.vaultId}" が見つかりませんでした。`);
    }
    const decrypted = await decryptVault(loaded.envelope, params.passphrase);
    const derived = await deriveKeyAndSalt(
      params.passphrase,
      loaded.envelope.salt,
      loaded.envelope.iterations
    );
    const nowMs = Date.now();
    activeKeyRef.current = derived;
    clearVaultLocked();
    lastActivityRef.current = nowMs;
    recordUnlockedActivity(decrypted.autoLockMinutes, nowMs);
    setLockNotice(null);
    setStartupPhase('idle');

    setTrustDevice(params.trustDevice);
    try {
      localStorage.setItem('kv_trust_device', String(params.trustDevice));
    } catch {
      // ignore
    }

    if (googleUser && params.trustDevice && !sessionOnlyLockRef.current) {
      await saveTrustedVaultKey({
        uid: googleUser.uid,
        vaultId: decrypted.vaultId,
        ...derived,
      });
    }

    setVault(decrypted);
    setPassphrase(params.passphrase);
    setEnvelope(loaded.envelope);
    setActiveVaultIdPref(decrypted.vaultId);
    setInitialVaultId(decrypted.vaultId);
    setSyncStatus({
      savedTo:
        loaded.source === 'cloud'
          ? 'cloud+cookie'
          : loaded.source === 'server'
          ? 'server+cookie'
          : 'cookie-only',
      cloudSynced: loaded.source === 'cloud',
      serverSynced: loaded.source === 'server',
      cookieSynced: loaded.source === 'cookie',
      cookieTier: 'cookie',
      cookieBytes: JSON.stringify(loaded.envelope).length,
    });
    setActiveSection('all');
    setSelectedFolder(null);
    pushToast(`ボルト「${decrypted.vaultName}」をロック解除しました`, 'success');
  };

  const handleCloseFaceModal = useCallback(() => {
    setFaceModal((prev) => ({ ...prev, open: false }));
  }, []);

  const handleOpenFaceEnroll = useCallback(() => {
    const currentVault = vaultRef.current;
    if (!currentVault) return;
    setFaceModal({
      open: true,
      mode: 'enroll',
      vaultId: currentVault.vaultId,
      vaultName: currentVault.vaultName,
      storageMode,
    });
  }, [storageMode]);

  const handleFaceEnrollComplete = useCallback(
    async (samples: number[][]) => {
      const currentVault = vaultRef.current;
      const currentSession = activeKeyRef.current;
      if (!currentVault || !currentSession) {
        throw new Error('ボルトのロック解除後にWeb顔認証を登録してください。');
      }
      const updatedIds = await saveEnrolledFaceForVault({
        vaultId: currentVault.vaultId,
        samples,
        key: currentSession.key,
        saltB64: currentSession.saltB64,
        iterations: currentSession.iterations,
      });
      setFaceVaultIds(updatedIds);
      setFaceBannerDismissed(false);
      pushToast(
        'Webカメラ顔認証を登録しました。次回ロック時からカメラ顔認証で解除できます',
        'success'
      );
    },
    [pushToast]
  );

  const handleRemoveFaceAuth = useCallback(async () => {
    const currentVault = vaultRef.current;
    if (!currentVault) return;
    const updatedIds = await removeFaceForVault(currentVault.vaultId);
    setFaceVaultIds(updatedIds);
    pushToast('このブラウザのWeb顔認証データを削除しました', 'info');
  }, [pushToast]);

  const handleOpenFaceUnlock = useCallback(
    (targetVaultId: string, mode: StorageMode) => {
      setFaceModal({
        open: true,
        mode: 'verify',
        vaultId: targetVaultId,
        vaultName: targetVaultId,
        storageMode: mode,
      });
    },
    []
  );

  const handleFaceVerifySuccess = useCallback(
    async (verifiedSession: {
      key: CryptoKey;
      saltB64: string;
      iterations: number;
      confidencePct: number;
    }) => {
      const targetVaultId = faceModal.vaultId;
      const requestedMode = faceModal.storageMode;
      const modesToTry: StorageMode[] = Array.from(
        new Set<StorageMode>([requestedMode, 'auto', 'cookie'])
      );

      let loadedEnv: EncryptedEnvelope | null = null;
      let loadedSource: 'cloud' | 'server' | 'cookie' | null = null;
      let decrypted: VaultPayload | null = null;
      let resolvedMode: StorageMode = requestedMode;

      for (const candidateMode of modesToTry) {
        const loaded = await loadEncryptedVault(targetVaultId, candidateMode, googleUser);
        if (!loaded.envelope) continue;
        try {
          decrypted = await decryptVaultWithKey(loaded.envelope, verifiedSession.key);
          loadedEnv = loaded.envelope;
          loadedSource = loaded.source;
          resolvedMode =
            loaded.source === 'cloud'
              ? 'cloud'
              : loaded.source === 'cookie' && candidateMode === 'cookie'
              ? 'cookie'
              : candidateMode;
          break;
        } catch {
          // Try next storage candidate before reporting mismatch
        }
      }

      if (!loadedEnv) {
        throw new Error(`ボルト "${targetVaultId}" が見つかりませんでした。`);
      }
      if (!decrypted) {
        throw new Error(
          'このボルトの暗号鍵が現在の顔認証データと一致しませんでした（パスフレーズ変更等）。マスターパスフレーズで解除後、必要に応じて再登録してください。'
        );
      }

      handleSelectStorageMode(resolvedMode);
      const nowMs = Date.now();
      activeKeyRef.current = {
        key: verifiedSession.key,
        saltB64: verifiedSession.saltB64,
        iterations: verifiedSession.iterations,
      };
      clearVaultLocked();
      lastActivityRef.current = nowMs;
      recordUnlockedActivity(decrypted.autoLockMinutes, nowMs);
      setLockNotice(null);
      setStartupPhase('idle');
      setVault(decrypted);
      setPassphrase('');
      setEnvelope(loadedEnv);
      setActiveVaultIdPref(decrypted.vaultId);
      setInitialVaultId(decrypted.vaultId);
      setSyncStatus({
        savedTo:
          loadedSource === 'cloud'
            ? 'cloud+cookie'
            : loadedSource === 'server'
            ? 'server+cookie'
            : 'cookie-only',
        cloudSynced: loadedSource === 'cloud',
        serverSynced: loadedSource === 'server',
        cookieSynced: loadedSource === 'cookie',
        cookieTier: 'cookie',
        cookieBytes: JSON.stringify(loadedEnv).length,
      });
      setActiveSection('all');
      setSelectedFolder(null);
      setFaceModal((prev) => ({ ...prev, open: false }));
      pushToast(
        `Web顔認証 (一致度 ${verifiedSession.confidencePct}%) で「${decrypted.vaultName}」をロック解除しました`,
        'success'
      );
    },
    [faceModal.vaultId, faceModal.storageMode, googleUser, handleSelectStorageMode, clearVaultLocked, pushToast]
  );

  const handleImportEnvelope = async (
    imported: EncryptedEnvelope,
    secretPassphrase: string
  ) => {
    const decrypted = await decryptVault(imported, secretPassphrase);
    const derived = await deriveKeyAndSalt(
      secretPassphrase,
      imported.salt,
      imported.iterations
    );
    const nowMs = Date.now();
    activeKeyRef.current = derived;
    clearVaultLocked();
    lastActivityRef.current = nowMs;
    recordUnlockedActivity(decrypted.autoLockMinutes, nowMs);
    setLockNotice(null);
    setStartupPhase('idle');

    const nextRev = (imported.revision ?? 1) + 1;
    const res = await persistVault(decrypted, derived, nextRev);
    setPassphrase(secretPassphrase);
    setActiveSection('all');
    pushToast(
      `バックアップ「${decrypted.vaultId}」を復号・復元しました (${
        res.cloudSynced
          ? 'Googleクラウド + Cookie'
          : res.serverSynced
          ? 'サーバー + Cookie'
          : 'Cookie'
      })`,
      'success'
    );
  };

  const handleStartDemo = useCallback(async () => {
    setStartupPhase('idle');
    const demoPass = 'KagiVault-Demo#2026';
    const freshPayload = createDemoVaultPayload('demo-vault');

    // Check if demo-vault already exists so we preserve existing salt, accounts, and enrolled Face Auth
    const existingLoaded = await loadEncryptedVault('demo-vault', storageMode, googleUser);
    let existingDecrypted: VaultPayload | null = null;
    if (existingLoaded.envelope) {
      try {
        existingDecrypted = await decryptVault(existingLoaded.envelope, demoPass);
      } catch {
        existingDecrypted = null;
      }
    }

    const plan = planDemoVaultStart({
      existingEnvelope: existingLoaded.envelope,
      existingDecrypted,
      freshPayload,
      defaultIterations: DEFAULT_PBKDF2_ITERATIONS,
    });

    const derived = await deriveKeyAndSalt(
      demoPass,
      plan.saltB64,
      plan.iterations
    );
    const nowMs = Date.now();
    activeKeyRef.current = derived;
    clearVaultLocked();
    lastActivityRef.current = nowMs;
    recordUnlockedActivity(plan.payload.autoLockMinutes, nowMs);
    setLockNotice(null);

    if (plan.reuseExisting && existingLoaded.envelope) {
      setVault(plan.payload);
      setEnvelope(existingLoaded.envelope);
      setActiveVaultIdPref(plan.payload.vaultId);
      setInitialVaultId(plan.payload.vaultId);
      setSyncStatus({
        savedTo:
          existingLoaded.source === 'cloud'
            ? 'cloud+cookie'
            : existingLoaded.source === 'server'
            ? 'server+cookie'
            : 'cookie-only',
        cloudSynced: existingLoaded.source === 'cloud',
        serverSynced: existingLoaded.source === 'server',
        cookieSynced: existingLoaded.source === 'cookie',
        cookieTier: 'cookie',
        cookieBytes: JSON.stringify(existingLoaded.envelope).length,
      });
      setPassphrase(demoPass);
      setActiveSection('all');
      setSelectedFolder(null);
      pushToast('保存済みのデモ用ボルトを再開しました（登録済みのアカウントと顔認証を保持）', 'success');
      return;
    }

    const res = await persistVault(plan.payload, derived, plan.revision, storageMode);
    setPassphrase(demoPass);
    setActiveSection('all');
    setSelectedFolder(null);
    pushToast(
      `デモ用ボルトを起動しました (保存先: ${
        res.cloudSynced
          ? 'Googleクラウド + Cookie'
          : res.serverSynced
          ? 'サーバー + 暗号化Cookie'
          : '暗号化Cookie'
      })`,
      'success'
    );
  }, [persistVault, storageMode, googleUser, pushToast, clearVaultLocked]);

  // ?autostart=1 support (only runs if not explicitly locked/expired, and strips autostart from URL so reloads enforce lock)
  useEffect(() => {
    if (autostartRanRef.current) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get('autostart') === '1') {
      autostartRanRef.current = true;
      url.searchParams.delete('autostart');
      window.history.replaceState({}, '', url.toString());
      if (!manualLockRef.current && !readPersistedLockFlag() && !initialExpiryRef.current.expired) {
        void handleStartDemo();
      } else {
        isAutostartSessionRef.current = false;
      }
    }
  }, [handleStartDemo]);

  // Lock vault cleanly (wipe plaintext state and persist lock across reloads)
  const lockVault = useCallback(
    (reason?: 'manual' | 'auto' | 'session' | unknown, minutes?: number) => {
      markVaultLocked();
      activeKeyRef.current = null;
      setVault(null);
      setPassphrase('');
      setEnvelope(null);
      setTotpMap({});
      setAddModalOpen(false);
      setEditingAccount(null);
      setQrAccount(null);
      setRecoveryAccountId(null);
      setDeletingAccount(null);
      if (reason === 'auto') {
        const msg = `${minutes ?? 15}分間操作がなかったため自動ロックしました。`;
        setLockNotice(
          `${msg} 顔認証（登録済みの場合）またはマスターパスフレーズでロック解除できます。`
        );
        pushToast(msg, 'warning');
      } else if (reason === 'session') {
        void clearAllTrustedKeys();
        setLockNotice(
          '「離脱時自動ロック（Session Onlyモード）」が有効なため、ページ離脱・ブラウザ終了時にボルトを即時ロックしました。'
        );
      } else {
        setLockNotice(
          'ボルトを手動ロックしました。再アクセスするにはWeb顔認証（登録済みの場合）またはマスターパスフレーズを入力してください。'
        );
        pushToast('ボルトを安全にロックしました', 'info');
      }
    },
    [pushToast, markVaultLocked]
  );

  // Detect fresh browser session after closing with Session Only Lock active
  useEffect(() => {
    try {
      const wasSessionOnly = localStorage.getItem(SESSION_ONLY_PREF_KEY) === 'true';
      const hadTabSession = Boolean(sessionStorage.getItem(SESSION_TAB_ALIVE_KEY));
      const pendingClosedLock = localStorage.getItem(SESSION_CLOSED_LOCK_KEY) === '1';

      if (wasSessionOnly && (!hadTabSession || pendingClosedLock)) {
        void clearAllTrustedKeys();
        if (pendingClosedLock) {
          localStorage.removeItem(SESSION_CLOSED_LOCK_KEY);
          setLockNotice(
            '「離脱時自動ロック（Session Onlyモード）」により、前回のブラウザ終了時にボルトを即時ロックしました。'
          );
        }
      }
      sessionStorage.setItem(SESSION_TAB_ALIVE_KEY, '1');
    } catch {
      // ignore storage errors
    }
  }, []);

  // Immediate lock on tab/browser close or page departure when Session Only mode is active
  useEffect(() => {
    if (!sessionOnlyLock) return;

    const handleExitLock = () => {
      try {
        if (vaultRef.current || activeKeyRef.current) {
          localStorage.setItem(SESSION_CLOSED_LOCK_KEY, '1');
        }
        sessionStorage.removeItem(SESSION_TAB_ALIVE_KEY);
      } catch {
        // ignore
      }
      void clearAllTrustedKeys();
      if (vaultRef.current || activeKeyRef.current) {
        lockVault('session');
      }
    };

    window.addEventListener('pagehide', handleExitLock);
    window.addEventListener('beforeunload', handleExitLock);

    return () => {
      window.removeEventListener('pagehide', handleExitLock);
      window.removeEventListener('beforeunload', handleExitLock);
    };
  }, [sessionOnlyLock, lockVault]);

  const handleToggleSessionOnlyLock = useCallback(async () => {
    const next = !sessionOnlyLockRef.current;
    setSessionOnlyLock(next);
    try {
      localStorage.setItem(SESSION_ONLY_PREF_KEY, String(next));
      if (!next) {
        localStorage.removeItem(SESSION_CLOSED_LOCK_KEY);
      }
    } catch {
      // ignore
    }

    if (next) {
      await clearAllTrustedKeys();
      pushToast(
        '離脱時自動ロック（Session Onlyモード）を有効にしました。ブラウザを閉じると即時ロックします',
        'success'
      );
    } else {
      if (googleUser && trustDeviceRef.current && activeKeyRef.current && vaultRef.current) {
        await saveTrustedVaultKey({
          uid: googleUser.uid,
          vaultId: vaultRef.current.vaultId,
          ...activeKeyRef.current,
        });
      }
      pushToast('離脱時自動ロック（Session Onlyモード）を解除しました', 'info');
    }
  }, [googleUser, pushToast]);

  // Auto-lock timer (persists activity timestamps & checks immediately on resume/interaction)
  useEffect(() => {
    if (!vault || vault.autoLockMinutes <= 0) return;

    const initNow = Date.now();
    lastActivityRef.current = initNow;
    recordUnlockedActivity(vault.autoLockMinutes, initNow);
    let lastMoveBump = 0;
    let lastPersistMs = initNow;

    const checkAndLockIfExpired = (): boolean => {
      const check = isAutoLockExpired({
        nowMs: Date.now(),
        lastActivityMs: lastActivityRef.current,
        autoLockMinutes: vault.autoLockMinutes,
      });
      if (check.expired) {
        lockVault('auto', vault.autoLockMinutes);
        return true;
      }
      return false;
    };

    const persistThrottled = (now: number) => {
      if (now - lastPersistMs >= 1000) {
        lastPersistMs = now;
        recordUnlockedActivity(vault.autoLockMinutes, now);
      }
    };

    const bumpActivity = () => {
      if (checkAndLockIfExpired()) return;
      const now = Date.now();
      lastActivityRef.current = now;
      persistThrottled(now);
    };
    const bumpMoveThrottled = () => {
      const now = Date.now();
      if (now - lastMoveBump >= 1000) {
        if (checkAndLockIfExpired()) return;
        lastMoveBump = now;
        lastActivityRef.current = now;
        persistThrottled(now);
      }
    };
    const handleResumeCheck = () => {
      checkAndLockIfExpired();
    };

    window.addEventListener('pointerdown', bumpActivity, { passive: true });
    window.addEventListener('keydown', bumpActivity);
    window.addEventListener('wheel', bumpActivity, { passive: true });
    window.addEventListener('touchstart', bumpActivity, { passive: true });
    window.addEventListener('pointermove', bumpMoveThrottled, { passive: true });
    document.addEventListener('visibilitychange', handleResumeCheck);
    window.addEventListener('focus', handleResumeCheck);
    window.addEventListener('pageshow', handleResumeCheck);

    const interval = window.setInterval(() => {
      checkAndLockIfExpired();
    }, 5000);

    return () => {
      window.removeEventListener('pointerdown', bumpActivity);
      window.removeEventListener('keydown', bumpActivity);
      window.removeEventListener('wheel', bumpActivity);
      window.removeEventListener('touchstart', bumpActivity);
      window.removeEventListener('pointermove', bumpMoveThrottled);
      document.removeEventListener('visibilitychange', handleResumeCheck);
      window.removeEventListener('focus', handleResumeCheck);
      window.removeEventListener('pageshow', handleResumeCheck);
      window.clearInterval(interval);
    };
  }, [vault, lockVault]);

  // Live 1-second TOTP ticker
  useEffect(() => {
    if (!vault || vault.accounts.length === 0) {
      setTotpMap({});
      return;
    }

    let cancelled = false;

    const computeAll = async () => {
      const nowMs = Date.now();
      const entries = await Promise.all(
        vault.accounts.map(async (acc) => {
          try {
            const res = await generateTotp({
              secret: acc.secret,
              algorithm: acc.algorithm,
              digits: acc.digits,
              period: acc.period,
              timestampMs: nowMs,
            });
            return [acc.id, res] as const;
          } catch {
            return null;
          }
        })
      );
      if (cancelled) return;
      const next: Record<string, TotpResult> = {};
      for (const item of entries) {
        if (item) next[item[0]] = item[1];
      }
      setTotpMap(next);
    };

    void computeAll();
    const timer = window.setInterval(() => {
      void computeAll();
    }, 1000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [vault]);

  // Account CRUD handlers
  const handleSaveAccount = async (data: {
    id?: string;
    issuer: string;
    label: string;
    secret: string;
    algorithm: TotpAlgorithm;
    digits: 6 | 8;
    period: 30 | 60;
    folder: string;
    loginUrl?: string;
    note: string;
    recoveryCodes: RecoveryCodeItem[];
  }) => {
    if (!vault || !activeKeyRef.current) return;
    const now = new Date().toISOString();
    let updatedAccounts: TotpAccount[];

    if (data.id) {
      updatedAccounts = vault.accounts.map((acc) =>
        acc.id === data.id
          ? {
              ...acc,
              issuer: data.issuer,
              label: data.label,
              secret: data.secret,
              algorithm: data.algorithm,
              digits: data.digits,
              period: data.period,
              folder: data.folder,
              loginUrl: data.loginUrl,
              note: data.note,
              recoveryCodes: data.recoveryCodes,
              updatedAt: now,
            }
          : acc
      );
    } else {
      const newAccount: TotpAccount = {
        id: `acc-${crypto.randomUUID().slice(0, 8)}`,
        issuer: data.issuer,
        label: data.label,
        secret: data.secret,
        algorithm: data.algorithm,
        digits: data.digits,
        period: data.period,
        folder: data.folder,
        loginUrl: data.loginUrl,
        favorite: false,
        note: data.note,
        recoveryCodes: data.recoveryCodes,
        createdAt: now,
        updatedAt: now,
      };
      updatedAccounts = [newAccount, ...vault.accounts];
    }

    const nextVault: VaultPayload = {
      ...vault,
      accounts: updatedAccounts,
      updatedAt: now,
    };
    const nextRev = (envelope?.revision ?? 1) + 1;
    await persistVault(nextVault, activeKeyRef.current, nextRev);
    pushToast(
      data.id
        ? `「${data.issuer}」を更新しAES-256-GCMで再暗号化しました`
        : `「${data.issuer}」を追加し暗号化保存しました`,
      'success'
    );
  };

  const handleToggleFavorite = async (accountId: string) => {
    if (!vault || !activeKeyRef.current) return;
    const target = vault.accounts.find((a) => a.id === accountId);
    const now = new Date().toISOString();
    const nextVault: VaultPayload = {
      ...vault,
      accounts: vault.accounts.map((a) =>
        a.id === accountId ? { ...a, favorite: !a.favorite, updatedAt: now } : a
      ),
      updatedAt: now,
    };
    await persistVault(nextVault, activeKeyRef.current, (envelope?.revision ?? 1) + 1);
    if (target) {
      pushToast(
        target.favorite
          ? `「${target.issuer}」をお気に入りから解除しました`
          : `「${target.issuer}」をお気に入りに登録しました`,
        'info'
      );
    }
  };

  const handleConfirmDeleteAccount = async () => {
    if (!vault || !deletingAccount || !activeKeyRef.current) return;
    const now = new Date().toISOString();
    const nextVault: VaultPayload = {
      ...vault,
      accounts: vault.accounts.filter((a) => a.id !== deletingAccount.id),
      updatedAt: now,
    };
    const deletedName = deletingAccount.issuer;
    setDeletingAccount(null);
    await persistVault(nextVault, activeKeyRef.current, (envelope?.revision ?? 1) + 1);
    pushToast(`「${deletedName}」をボルトから削除しました`, 'warning');
  };

  const handleUpdateRecoveryCodes = async (
    accountId: string,
    codes: RecoveryCodeItem[]
  ) => {
    if (!vault || !activeKeyRef.current) return;
    const now = new Date().toISOString();
    const nextVault: VaultPayload = {
      ...vault,
      accounts: vault.accounts.map((a) =>
        a.id === accountId ? { ...a, recoveryCodes: codes, updatedAt: now } : a
      ),
      updatedAt: now,
    };
    await persistVault(nextVault, activeKeyRef.current, (envelope?.revision ?? 1) + 1);
  };

  const handleChangeStorageAndSync = async (mode: StorageMode) => {
    handleSelectStorageMode(mode);
    if (!vault || !activeKeyRef.current) return;
    const nextVault = { ...vault, updatedAt: new Date().toISOString() };
    const res = await persistVault(
      nextVault,
      activeKeyRef.current,
      (envelope?.revision ?? 1) + 1,
      mode
    );
    pushToast(
      res.savedTo === 'cloud+cookie'
        ? 'Googleクラウド (Firestore) とCookieに暗号化同期しました'
        : res.savedTo === 'server+cookie'
        ? '保存先を更新し、サーバーとCookieに同期しました'
        : res.savedTo === 'cookie-only'
        ? '暗号化Cookieのみに保存しました'
        : 'サーバーに同期しました',
      'success'
    );
  };

  const handleForceSync = async () => {
    if (!vault || !activeKeyRef.current) return;
    const nextVault = { ...vault, updatedAt: new Date().toISOString() };
    const res = await persistVault(
      nextVault,
      activeKeyRef.current,
      (envelope?.revision ?? 1) + 1
    );
    pushToast(
      res.cloudSynced
        ? 'Googleクラウド (Firestore) およびCookieへの暗号化同期が完了しました'
        : res.serverSynced
        ? 'サーバーおよびCookieへの暗号化同期が完了しました'
        : '暗号化Cookieへ保存しました',
      'success'
    );
  };

  const handleChangeAutoLock = async (minutes: number) => {
    if (!vault || !activeKeyRef.current) return;
    const nextVault: VaultPayload = {
      ...vault,
      autoLockMinutes: minutes,
      updatedAt: new Date().toISOString(),
    };
    updatePersistedAutoLockMinutes(minutes);
    if (minutes > 0) {
      recordUnlockedActivity(minutes, Date.now());
    }
    await persistVault(nextVault, activeKeyRef.current, (envelope?.revision ?? 1) + 1);
    pushToast(
      minutes > 0
        ? `自動ロックを ${minutes}分 に設定しました`
        : '自動ロックを無効にしました',
      'info'
    );
  };

  const handleToggleTrustDeviceInSettings = async (next: boolean) => {
    setTrustDevice(next);
    try {
      localStorage.setItem('kv_trust_device', String(next));
    } catch {
      // ignore
    }
    if (googleUser && vault) {
      if (next && activeKeyRef.current) {
        await saveTrustedVaultKey({
          uid: googleUser.uid,
          vaultId: vault.vaultId,
          ...activeKeyRef.current,
        });
        pushToast('このブラウザを信頼済み端末として登録しました', 'success');
      } else {
        await clearTrustedVaultKey(googleUser.uid, vault.vaultId);
        pushToast('信頼済み鍵を削除しました。次回からパスフレーズが必要です', 'info');
      }
    }
  };

  const handleChangePassphrase = async (current: string, next: string) => {
    if (!vault || !envelope) return;
    // Verify current passphrase mathematically against the current encrypted envelope
    await decryptVault(envelope, current);

    const newSession = await deriveKeyAndSalt(
      next,
      undefined,
      DEFAULT_PBKDF2_ITERATIONS
    );
    activeKeyRef.current = newSession;
    setPassphrase(next);

    if (googleUser && trustDevice) {
      await saveTrustedVaultKey({
        uid: googleUser.uid,
        vaultId: vault.vaultId,
        ...newSession,
      });
    }

    if (faceVaultIds.includes(vault.vaultId)) {
      await updateFaceVaultKey({
        vaultId: vault.vaultId,
        ...newSession,
      });
    }

    const nextVault = { ...vault, updatedAt: new Date().toISOString() };
    await persistVault(nextVault, newSession, (envelope.revision ?? 1) + 1);
    pushToast('マスターパスフレーズを変更し、ボルト全体を再暗号化しました', 'success');
  };

  const handleChangeAutoBackupSettings = useCallback(
    (next: AutoBackupSettings) => {
      setAutoBackupSettings(next);
      saveAutoBackupSettings(next);
      pushToast(
        next.enabled && next.frequency !== 'off'
          ? '自動バックアップ設定を更新しました'
          : '自動バックアップを停止しました',
        'info'
      );
    },
    [pushToast]
  );

  const handleCreateBackupNow = useCallback(async () => {
    const currentVault = vaultRef.current;
    if (!currentVault) return;
    let targetEnvelope = envelope;
    if (!targetEnvelope && activeKeyRef.current) {
      targetEnvelope = await encryptVaultWithKey(
        currentVault,
        activeKeyRef.current.key,
        activeKeyRef.current.saltB64,
        activeKeyRef.current.iterations,
        1
      );
    }
    if (!targetEnvelope) return;
    const res = await saveAutoBackupSnapshot({
      envelope: targetEnvelope,
      accountCount: currentVault.accounts.length,
      reason: 'manual',
      settings: autoBackupSettingsRef.current,
    });
    setAutoBackupSnapshots(res.snapshots);
    if (res.saved) {
      setAutoBackupSettings(res.updatedSettings);
      pushToast(
        `暗号化スナップショット (Rev.${targetEnvelope.revision}) を保存しました`,
        'success'
      );
    }
  }, [envelope, pushToast]);

  const handleRestoreBackupSnapshot = useCallback(
    async (snapshot: AutoBackupSnapshot) => {
      if (!activeKeyRef.current) {
        pushToast('復元するにはボルトのロックを解除してください', 'error');
        return;
      }
      try {
        const restored = await decryptVaultWithKey(
          snapshot.envelope,
          activeKeyRef.current.key
        );
        const nextVault: VaultPayload = {
          ...restored,
          updatedAt: new Date().toISOString(),
        };
        const nextRev = Math.max(envelopeRevisionRef.current, snapshot.revision) + 1;
        await persistVault(nextVault, activeKeyRef.current, nextRev);
        pushToast(
          `バックアップ (Rev.${snapshot.revision} · ${snapshot.accountCount}件) から復元しました`,
          'success'
        );
      } catch {
        pushToast(
          'このバックアップは異なるマスターパスフレーズで暗号化されています。ログイン画面の「バックアップ復元」からパスフレーズを入力して復元してください。',
          'error'
        );
      }
    },
    [persistVault, pushToast]
  );

  const handleDeleteBackupSnapshot = useCallback(
    async (snapshotId: string) => {
      const targetVaultId = vaultRef.current?.vaultId;
      if (!targetVaultId) return;
      const refreshed = await deleteAutoBackupSnapshot(snapshotId, targetVaultId);
      setAutoBackupSnapshots(refreshed);
      pushToast('バックアップ履歴を削除しました', 'info');
    },
    [pushToast]
  );

  const handleDeleteVault = async () => {
    if (!vault) return;
    const targetId = vault.vaultId;
    if (googleUser) {
      await clearTrustedVaultKey(googleUser.uid, targetId);
    }
    const updatedFaceIds = await removeFaceForVault(targetId);
    setFaceVaultIds(updatedFaceIds);
    await clearAutoBackupsForVault(targetId);
    setAutoBackupSnapshots([]);
    await deleteVaultEverywhere(targetId, googleUser);
    if (initialVaultId === targetId) {
      setActiveVaultIdPref(null);
      setInitialVaultId(null);
    }
    lockVault();
    await refreshDiagnostics(googleUser);
    pushToast(`ボルト「${targetId}」を完全に削除しました`, 'warning');
  };

  const folders = useMemo(() => {
    if (!vault) return [];
    const set = new Set<string>();
    for (const acc of vault.accounts) {
      set.add(acc.folder || '未分類');
    }
    return Array.from(set).sort();
  }, [vault]);

  const filteredAccounts = useMemo(() => {
    if (!vault) return [];
    const q = searchQuery.trim().toLowerCase();
    return vault.accounts.filter((acc) => {
      if (activeSection === 'favorites' && !acc.favorite) return false;
      if (selectedFolder && (acc.folder || '未分類') !== selectedFolder) return false;
      if (q) {
        const hay = `${acc.issuer} ${acc.label} ${acc.folder} ${acc.note ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [vault, activeSection, selectedFolder, searchQuery]);

  const auditReport = useMemo(() => {
    if (!vault) return null;
    return runVaultSecurityAudit(vault, passphrase, syncStatus);
  }, [vault, passphrase, syncStatus]);

  const recoveryAccount = useMemo(() => {
    if (!vault || !recoveryAccountId) return null;
    return vault.accounts.find((a) => a.id === recoveryAccountId) ?? null;
  }, [vault, recoveryAccountId]);

  const sectionTitle =
    activeSection === 'autofill'
      ? '自動入力・ワンタップ連携'
      : activeSection === 'audit'
      ? 'セキュリティ診断'
      : activeSection === 'sync'
      ? '保存先・クラウドバックアップ'
      : activeSection === 'favorites'
      ? 'お気に入りコード'
      : selectedFolder
      ? `フォルダ: ${selectedFolder}`
      : 'すべての認証コード';

  const syncLabel =
    syncStatus?.savedTo === 'cloud+cookie'
      ? 'Googleクラウド同期済み'
      : syncStatus?.savedTo === 'server+cookie'
      ? 'サーバー + Cookie 保存済み'
      : syncStatus?.savedTo === 'server-only'
      ? 'サーバー保存済み'
      : 'Cookie保存済み (ローカル)';

  const contentViewKey =
    activeSection === 'autofill'
      ? 'autofill'
      : activeSection === 'audit'
      ? 'audit'
      : activeSection === 'sync'
      ? 'sync'
      : `codes-${activeSection}-${selectedFolder || 'all'}`;

  return (
    <MotionConfig reducedMotion="user">
      <AnimatePresence mode="wait">
        {!vault ? (
          <motion.div
            key="screen-auth"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.22 }}
          >
            <VaultAuthScreen
              googleUser={googleUser}
              authLoading={authLoading}
              onGoogleSignIn={handleGoogleSignIn}
              onGoogleSignOut={handleGoogleSignOut}
              trustDevice={trustDevice}
              onToggleTrustDevice={(next) => {
                setTrustDevice(next);
                try {
                  localStorage.setItem('kv_trust_device', String(next));
                } catch {
                  // ignore
                }
              }}
              initialVaultId={initialVaultId}
              storageMode={storageMode}
              onChangeStorageMode={handleSelectStorageMode}
              serverHealth={serverHealth}
              availableVaults={availableVaults}
              onRefreshVaults={() => refreshDiagnostics(googleUser)}
              onCreateVault={handleCreateVault}
              onUnlockVault={handleUnlockVault}
              onImportEnvelope={handleImportEnvelope}
              onStartDemo={handleStartDemo}
              faceVaultIds={faceVaultIds}
              cameraCapabilities={cameraCapabilities}
              onOpenFaceUnlock={handleOpenFaceUnlock}
              lockNotice={lockNotice}
              onDismissLockNotice={() => setLockNotice(null)}
              isDark={isDark}
              onToggleTheme={() => setIsDark((d) => !d)}
              onToast={pushToast}
            />
          </motion.div>
        ) : (
          <motion.div
            key="screen-workspace"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="liquid-canvas min-h-screen text-slate-900 dark:text-slate-100 flex lg:gap-4 lg:p-4"
          >
            {/* Desktop Sidebar */}
            <aside className="hidden lg:flex w-72 shrink-0 flex-col glass-surface rounded-[26px] h-[calc(100vh-2rem)] sticky top-4 overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-900/8 dark:border-white/10 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-xl glass-primary-btn flex items-center justify-center shrink-0">
                    <ShieldCheck className="w-4 h-4 text-white" aria-hidden="true" />
                  </div>
                  <span className="text-base font-bold tracking-tight">KagiVault</span>
                </div>
                <motion.button
                  type="button"
                  whileHover={{ scale: 1.08 }}
                  whileTap={{ scale: 0.92 }}
                  onClick={() => setIsDark((d) => !d)}
                  aria-label={isDark ? 'ライトテーマに切り替え' : 'ダークテーマに切り替え'}
                  className="p-1.5 rounded-xl glass-btn text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
                >
                  {isDark ? (
                    <Sun className="w-4 h-4" aria-hidden="true" />
                  ) : (
                    <Moon className="w-4 h-4" aria-hidden="true" />
                  )}
                </motion.button>
              </div>

              <div className="px-4 py-3 border-b border-slate-900/8 dark:border-white/10 space-y-2">
                <div>
                  <p className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                    {vault.vaultName}
                  </p>
                  <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate mt-0.5 tabular-nums">
                    ID: {vault.vaultId} · {vault.accounts.length}件
                  </p>
                </div>
                {googleUser && (
                  <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-900/8 dark:border-white/10">
                    <div className="flex items-center gap-2 min-w-0">
                      {googleUser.photoURL ? (
                        <img
                          src={googleUser.photoURL}
                          alt={googleUser.displayName || 'Googleユーザー'}
                          referrerPolicy="no-referrer"
                          className="w-5 h-5 rounded-full shrink-0"
                        />
                      ) : (
                        <div className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center text-[10px] font-bold shrink-0">
                          {(googleUser.email || 'G').slice(0, 1).toUpperCase()}
                        </div>
                      )}
                      <span className="text-[11px] text-slate-600 dark:text-slate-300 truncate">
                        {googleUser.email}
                      </span>
                    </div>
                    <motion.button
                      type="button"
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.9 }}
                      onClick={() => void handleGoogleSignOut()}
                      aria-label="Googleからログアウト"
                      title="ログアウト"
                      className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 shrink-0"
                    >
                      <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
                    </motion.button>
                  </div>
                )}
              </div>

              <nav aria-label="メインメニュー" className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
                <motion.button
                  type="button"
                  whileHover={{ x: 2 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => {
                    setActiveSection('all');
                    setSelectedFolder(null);
                  }}
                  className={`relative w-full flex items-center justify-between px-3 py-2 text-xs font-semibold rounded-xl transition-colors ${
                    activeSection === 'all' && !selectedFolder
                      ? 'text-blue-700 dark:text-blue-200'
                      : 'text-slate-700 dark:text-slate-300 hover:bg-white/45 dark:hover:bg-white/6'
                  }`}
                >
                  {activeSection === 'all' && !selectedFolder && (
                    <motion.span
                      layoutId="sidebar-nav-active"
                      transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                      className="absolute inset-0 rounded-xl glass-pill-active"
                    />
                  )}
                  <span className="relative z-10 flex items-center gap-2.5">
                    <KeyRound className="w-4 h-4" aria-hidden="true" />
                    すべてのコード
                  </span>
                  <span className="relative z-10 font-mono tabular-nums text-[11px]">
                    {vault.accounts.length}
                  </span>
                </motion.button>

                <motion.button
                  type="button"
                  whileHover={{ x: 2 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => {
                    setActiveSection('favorites');
                    setSelectedFolder(null);
                  }}
                  className={`relative w-full flex items-center justify-between px-3 py-2 text-xs font-semibold rounded-xl transition-colors ${
                    activeSection === 'favorites'
                      ? 'text-blue-700 dark:text-blue-200'
                      : 'text-slate-700 dark:text-slate-300 hover:bg-white/45 dark:hover:bg-white/6'
                  }`}
                >
                  {activeSection === 'favorites' && (
                    <motion.span
                      layoutId="sidebar-nav-active"
                      transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                      className="absolute inset-0 rounded-xl glass-pill-active"
                    />
                  )}
                  <span className="relative z-10 flex items-center gap-2.5">
                    <Star className="w-4 h-4" aria-hidden="true" />
                    お気に入り
                  </span>
                  <span className="relative z-10 font-mono tabular-nums text-[11px]">
                    {vault.accounts.filter((a) => a.favorite).length}
                  </span>
                </motion.button>

                {folders.length > 0 && (
                  <div className="pt-4 pb-1">
                    <p className="px-3 text-[11px] font-medium text-slate-400 dark:text-slate-500 mb-1.5">
                      フォルダ
                    </p>
                    <div className="space-y-0.5">
                      {folders.map((folderName) => {
                        const count = vault.accounts.filter(
                          (a) => (a.folder || '未分類') === folderName
                        ).length;
                        const active =
                          activeSection === 'all' && selectedFolder === folderName;
                        return (
                          <motion.button
                            key={folderName}
                            type="button"
                            whileHover={{ x: 2 }}
                            whileTap={{ scale: 0.98 }}
                            onClick={() => {
                              setActiveSection('all');
                              setSelectedFolder(folderName);
                            }}
                            className={`relative w-full flex items-center justify-between px-3 py-1.5 text-xs font-medium rounded-xl transition-colors ${
                              active
                                ? 'text-blue-700 dark:text-blue-200'
                                : 'text-slate-600 dark:text-slate-400 hover:bg-white/45 dark:hover:bg-white/6'
                            }`}
                          >
                            {active && (
                              <motion.span
                                layoutId="sidebar-nav-active"
                                transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                                className="absolute inset-0 rounded-xl glass-pill-active"
                              />
                            )}
                            <span className="relative z-10 flex items-center gap-2 truncate">
                              <Folder className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                              <span className="truncate">{folderName}</span>
                            </span>
                            <span className="relative z-10 font-mono tabular-nums text-[11px]">
                              {count}
                            </span>
                          </motion.button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="pt-4 space-y-1 border-t border-slate-900/8 dark:border-white/10">
                  <motion.button
                    type="button"
                    whileHover={{ x: 2 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => {
                      setActiveSection('autofill');
                      setSelectedFolder(null);
                    }}
                    className={`relative w-full flex items-center justify-between px-3 py-2 text-xs font-semibold rounded-xl transition-colors ${
                      activeSection === 'autofill'
                        ? 'text-blue-700 dark:text-blue-200'
                        : 'text-slate-700 dark:text-slate-300 hover:bg-white/45 dark:hover:bg-white/6'
                    }`}
                  >
                    {activeSection === 'autofill' && (
                      <motion.span
                        layoutId="sidebar-nav-active"
                        transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                        className="absolute inset-0 rounded-xl glass-pill-active"
                      />
                    )}
                    <span className="relative z-10 flex items-center gap-2.5">
                      <Zap className="w-4 h-4" aria-hidden="true" />
                      自動入力連携
                    </span>
                  </motion.button>

                  <motion.button
                    type="button"
                    whileHover={{ x: 2 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => {
                      setActiveSection('audit');
                      setSelectedFolder(null);
                    }}
                    className={`relative w-full flex items-center justify-between px-3 py-2 text-xs font-semibold rounded-xl transition-colors ${
                      activeSection === 'audit'
                        ? 'text-blue-700 dark:text-blue-200'
                        : 'text-slate-700 dark:text-slate-300 hover:bg-white/45 dark:hover:bg-white/6'
                    }`}
                  >
                    {activeSection === 'audit' && (
                      <motion.span
                        layoutId="sidebar-nav-active"
                        transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                        className="absolute inset-0 rounded-xl glass-pill-active"
                      />
                    )}
                    <span className="relative z-10 flex items-center gap-2.5">
                      <ShieldAlert className="w-4 h-4" aria-hidden="true" />
                      セキュリティ診断
                    </span>
                    {auditReport && (
                      <span className="relative z-10 font-mono tabular-nums text-[11px]">
                        {auditReport.score}点
                      </span>
                    )}
                  </motion.button>

                  <motion.button
                    type="button"
                    whileHover={{ x: 2 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => {
                      setActiveSection('sync');
                      setSelectedFolder(null);
                    }}
                    className={`relative w-full flex items-center gap-2.5 px-3 py-2 text-xs font-semibold rounded-xl transition-colors ${
                      activeSection === 'sync'
                        ? 'text-blue-700 dark:text-blue-200'
                        : 'text-slate-700 dark:text-slate-300 hover:bg-white/45 dark:hover:bg-white/6'
                    }`}
                  >
                    {activeSection === 'sync' && (
                      <motion.span
                        layoutId="sidebar-nav-active"
                        transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                        className="absolute inset-0 rounded-xl glass-pill-active"
                      />
                    )}
                    <span className="relative z-10 flex items-center gap-2.5">
                      <HardDrive className="w-4 h-4" aria-hidden="true" />
                      保存先・バックアップ
                    </span>
                  </motion.button>
                </div>
              </nav>

              <div className="p-4 border-t border-slate-900/8 dark:border-white/10 space-y-3">
                <div className="flex items-center gap-2 text-[11px] text-slate-600 dark:text-slate-400">
                  {syncStatus?.cloudSynced ? (
                    <Cloud className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" aria-hidden="true" />
                  ) : syncStatus?.serverSynced ? (
                    <Server className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" aria-hidden="true" />
                  ) : (
                    <Cookie className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" aria-hidden="true" />
                  )}
                  <span className="truncate">{syncLabel}</span>
                </div>

                <div className="space-y-1.5">
                  {cameraCapabilities.supported && (
                    <motion.button
                      type="button"
                      data-testid="sidebar-biometric-btn"
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.96 }}
                      onClick={() => {
                        if (faceVaultIds.includes(vault.vaultId)) {
                          setActiveSection('sync');
                          setSelectedFolder(null);
                        } else {
                          handleOpenFaceEnroll();
                        }
                      }}
                      className={`w-full py-1.5 px-2.5 rounded-xl text-xs font-semibold inline-flex items-center justify-between gap-2 transition-colors ${
                        faceVaultIds.includes(vault.vaultId)
                          ? 'glass-subtle border-emerald-500/45 text-emerald-700 dark:text-emerald-300'
                          : 'glass-btn text-blue-700 dark:text-blue-300'
                      }`}
                    >
                      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                        <ScanFace className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                        <span>
                          {faceVaultIds.includes(vault.vaultId)
                            ? 'Web顔認証: 有効'
                            : 'Web顔認証を登録'}
                        </span>
                      </span>
                      <span className="text-[10px] opacity-75 whitespace-nowrap">
                        {faceVaultIds.includes(vault.vaultId) ? '設定' : '登録'}
                      </span>
                    </motion.button>
                  )}
                  <div className="flex items-stretch gap-2">
                    <motion.button
                      type="button"
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.96 }}
                      onClick={() => lockVault('manual')}
                      className="flex-1 py-2 px-2.5 rounded-xl glass-btn text-xs font-semibold text-slate-700 dark:text-slate-200 inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0"
                    >
                      <Lock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                      <span>今すぐロック</span>
                    </motion.button>

                    <motion.button
                      type="button"
                      role="switch"
                      aria-checked={sessionOnlyLock}
                      aria-label="離脱時自動ロック（Session Onlyモード）"
                      data-testid="session-only-lock-toggle"
                      title="ブラウザやタブを閉じた瞬間にメモリと鍵を破棄して即時ロックします"
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.96 }}
                      onClick={() => void handleToggleSessionOnlyLock()}
                      className={`flex-1 py-1.5 px-2.5 rounded-xl text-left flex items-center justify-between gap-1.5 shrink-0 ${
                        sessionOnlyLock
                          ? 'glass-subtle border-blue-500/70 bg-blue-500/15 dark:bg-blue-500/20 text-blue-700 dark:text-blue-200'
                          : 'glass-btn text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      <span className="min-w-0 leading-tight">
                        <span className="block text-[11px] font-semibold whitespace-nowrap">
                          離脱時ロック
                        </span>
                        <span className="block text-[10px] opacity-75 whitespace-nowrap font-mono">
                          Session Only
                        </span>
                      </span>
                      <span
                        aria-hidden="true"
                        className={`w-7 h-4 rounded-full p-0.5 transition-colors flex items-center shrink-0 ${
                          sessionOnlyLock
                            ? 'bg-blue-600 justify-end'
                            : 'bg-slate-400/50 dark:bg-white/20 justify-start'
                        }`}
                      >
                        <span className="w-3 h-3 rounded-full bg-white shadow-xs" />
                      </span>
                    </motion.button>
                  </div>
                  <AnimatePresence>
                    {sessionOnlyLock && (
                      <motion.p
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="text-[11px] text-blue-700 dark:text-blue-300 leading-snug"
                      >
                        ブラウザ終了で即ロック（信頼鍵も保持しません）
                      </motion.p>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </aside>

            {/* Mobile Drawer */}
            <AnimatePresence>
              {mobileMenuOpen && (
                <motion.div
                  key="mobile-drawer-backdrop"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="fixed inset-0 z-50 lg:hidden bg-slate-950/35 backdrop-blur-md flex"
                >
                  <motion.div
                    key="mobile-drawer-panel"
                    initial={{ x: -288 }}
                    animate={{ x: 0 }}
                    exit={{ x: -288 }}
                    transition={{ type: 'spring', stiffness: 360, damping: 32 }}
                    className="w-72 glass-modal rounded-r-3xl h-full p-5 flex flex-col justify-between"
                  >
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="text-base font-bold">KagiVault</span>
                        <button
                          type="button"
                          onClick={() => setMobileMenuOpen(false)}
                          aria-label="メニューを閉じる"
                          className="p-1.5 rounded-xl glass-btn"
                        >
                          <X className="w-4 h-4" aria-hidden="true" />
                        </button>
                      </div>
                      {googleUser && (
                        <div className="p-2.5 rounded-xl glass-subtle text-xs truncate">
                          {googleUser.email}
                        </div>
                      )}
                      <div className="space-y-1">
                        <button
                          type="button"
                          onClick={() => {
                            setActiveSection('all');
                            setSelectedFolder(null);
                            setMobileMenuOpen(false);
                          }}
                          className="w-full text-left px-3 py-2 text-sm font-medium rounded-xl hover:bg-white/45 dark:hover:bg-white/10"
                        >
                          すべてのコード ({vault.accounts.length})
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setActiveSection('favorites');
                            setSelectedFolder(null);
                            setMobileMenuOpen(false);
                          }}
                          className="w-full text-left px-3 py-2 text-sm font-medium rounded-xl hover:bg-white/45 dark:hover:bg-white/10"
                        >
                          お気に入り
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setActiveSection('autofill');
                            setSelectedFolder(null);
                            setMobileMenuOpen(false);
                          }}
                          className="w-full text-left px-3 py-2 text-sm font-medium rounded-xl hover:bg-white/45 dark:hover:bg-white/10"
                        >
                          自動入力連携
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setActiveSection('audit');
                            setMobileMenuOpen(false);
                          }}
                          className="w-full text-left px-3 py-2 text-sm font-medium rounded-xl hover:bg-white/45 dark:hover:bg-white/10"
                        >
                          セキュリティ診断
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setActiveSection('sync');
                            setMobileMenuOpen(false);
                          }}
                          className="w-full text-left px-3 py-2 text-sm font-medium rounded-xl hover:bg-white/45 dark:hover:bg-white/10"
                        >
                          保存先・バックアップ
                        </button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      {cameraCapabilities.supported && (
                        <button
                          type="button"
                          onClick={() => {
                            setMobileMenuOpen(false);
                            if (faceVaultIds.includes(vault.vaultId)) {
                              setActiveSection('sync');
                              setSelectedFolder(null);
                            } else {
                              handleOpenFaceEnroll();
                            }
                          }}
                          className={`w-full py-2 px-3 rounded-xl text-xs font-semibold inline-flex items-center justify-between gap-2 ${
                            faceVaultIds.includes(vault.vaultId)
                              ? 'glass-subtle border-emerald-500/45 text-emerald-700 dark:text-emerald-300'
                              : 'glass-btn text-blue-700 dark:text-blue-300'
                          }`}
                        >
                          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                            <ScanFace className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                            <span>
                              {faceVaultIds.includes(vault.vaultId)
                                ? 'Web顔認証: 有効'
                                : 'Web顔認証を登録'}
                            </span>
                          </span>
                          <span className="text-[10px] opacity-75">
                            {faceVaultIds.includes(vault.vaultId) ? '設定' : '登録'}
                          </span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setIsDark((d) => !d)}
                        className="w-full py-2 px-3 rounded-xl glass-btn text-xs font-semibold"
                      >
                        {isDark ? 'ライトテーマに切り替え' : 'ダークテーマに切り替え'}
                      </button>
                      <div className="flex items-stretch gap-2">
                        <button
                          type="button"
                          onClick={() => lockVault('manual')}
                          className="flex-1 py-2 px-2.5 rounded-xl glass-btn text-xs font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap"
                        >
                          <Lock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                          <span>今すぐロック</span>
                        </button>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={sessionOnlyLock}
                          aria-label="離脱時自動ロック（Session Onlyモード）"
                          onClick={() => void handleToggleSessionOnlyLock()}
                          className={`flex-1 py-1.5 px-2.5 rounded-xl text-left flex items-center justify-between gap-1.5 shrink-0 ${
                            sessionOnlyLock
                              ? 'glass-subtle border-blue-500/70 bg-blue-500/15 dark:bg-blue-500/20 text-blue-700 dark:text-blue-200'
                              : 'glass-btn text-slate-700 dark:text-slate-300'
                          }`}
                        >
                          <span className="leading-tight">
                            <span className="block text-[11px] font-semibold whitespace-nowrap">
                              離脱時ロック
                            </span>
                            <span className="block text-[10px] opacity-75 font-mono whitespace-nowrap">
                              Session Only
                            </span>
                          </span>
                          <span
                            aria-hidden="true"
                            className={`w-7 h-4 rounded-full p-0.5 flex items-center shrink-0 ${
                              sessionOnlyLock
                                ? 'bg-blue-600 justify-end'
                                : 'bg-slate-400/50 dark:bg-white/20 justify-start'
                            }`}
                          >
                            <span className="w-3 h-3 rounded-full bg-white shadow-xs" />
                          </span>
                        </button>
                      </div>
                      {googleUser && (
                        <button
                          type="button"
                          onClick={() => void handleGoogleSignOut()}
                          className="w-full py-2 px-3 rounded-xl border border-red-400/45 bg-red-500/10 text-red-600 dark:text-red-300 text-xs font-semibold"
                        >
                          Googleログアウト
                        </button>
                      )}
                    </div>
                  </motion.div>
                  <div className="flex-1" onClick={() => setMobileMenuOpen(false)} />
                </motion.div>
              )}
            </AnimatePresence>

            {/* Main Content Area */}
            <div className="flex-1 flex flex-col min-w-0 lg:gap-4">
              {/* Top Bar Contract: 3 clean zones */}
              <header className="sticky top-0 lg:top-4 z-30 glass-surface lg:rounded-[22px] px-4 sm:px-6 py-3.5 flex items-center justify-between gap-3 sm:gap-6">
                <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.94 }}
                    onClick={() => setMobileMenuOpen(true)}
                    aria-label="ナビゲーションメニューを開く"
                    className="lg:hidden p-1.5 rounded-xl glass-btn shrink-0"
                  >
                    <Menu className="w-4 h-4" aria-hidden="true" />
                  </motion.button>
                  <motion.h1
                    key={sectionTitle}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.18 }}
                    className="text-sm sm:text-base font-bold text-slate-900 dark:text-white truncate"
                  >
                    {sectionTitle}
                  </motion.h1>
                </div>

                <div className="hidden md:flex items-center flex-1 max-w-md">
                  {(activeSection === 'all' || activeSection === 'favorites') && (
                    <div className="relative w-full">
                      <Search
                        className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                        aria-hidden="true"
                      />
                      <input
                        type="search"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="サービス名・アカウント名・フォルダで検索..."
                        aria-label="認証アカウントを検索"
                        className="w-full pl-9 pr-3 py-1.5 text-sm rounded-xl glass-input text-slate-900 dark:text-slate-100"
                      />
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <div className="hidden sm:block">
                    <PWAInstallButton
                      compact
                      onInstalled={() => pushToast('KagiVault をPWAアプリとしてインストールしました', 'success')}
                    />
                  </div>
                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.96 }}
                    onClick={() => {
                      setEditingAccount(null);
                      setAddModalOpen(true);
                    }}
                    className="px-3.5 sm:px-4 py-2 text-xs font-semibold rounded-xl glass-primary-btn inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                  >
                    <Plus className="w-4 h-4" aria-hidden="true" />
                    <span>アカウント追加</span>
                  </motion.button>
                </div>
              </header>

              <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 lg:px-2 py-5 lg:py-2 space-y-6">
                {/* Mobile search bar */}
                {(activeSection === 'all' || activeSection === 'favorites') && (
                  <div className="md:hidden relative">
                    <Search
                      className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                      aria-hidden="true"
                    />
                    <input
                      type="search"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="サービス名・アカウント名で検索..."
                      aria-label="認証アカウントを検索"
                      className="w-full pl-9 pr-3 py-2 text-sm rounded-xl glass-input text-slate-900 dark:text-slate-100"
                    />
                  </div>
                )}

                {/* Dismissible In-Web Face Auth Enrollment Banner */}
                <AnimatePresence>
                  {cameraCapabilities.supported &&
                    !faceVaultIds.includes(vault.vaultId) &&
                    !faceBannerDismissed &&
                    activeSection !== 'sync' && (
                      <motion.div
                        key="biometric-enroll-banner"
                        initial={{ opacity: 0, y: -8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        className="glass-surface rounded-[22px] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border border-blue-400/35 bg-blue-500/8"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-9 h-9 rounded-xl glass-primary-btn flex items-center justify-center shrink-0">
                            <ScanFace className="w-4 h-4 text-white" aria-hidden="true" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-slate-900 dark:text-white">
                              Webカメラ顔認証でスムーズにロック解除
                            </p>
                            <p className="text-[11px] text-slate-600 dark:text-slate-300 mt-0.5">
                              端末OSに依存せずブラウザ内のAI顔認識だけで、ロック後の再解除を行えます。
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <motion.button
                            type="button"
                            data-testid="enroll-biometric-banner-btn"
                            whileHover={{ scale: 1.03 }}
                            whileTap={{ scale: 0.96 }}
                            onClick={handleOpenFaceEnroll}
                            className="px-3.5 py-2 text-xs font-semibold rounded-xl glass-primary-btn inline-flex items-center gap-1.5 whitespace-nowrap"
                          >
                            <ScanFace className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>顔認証を登録</span>
                          </motion.button>
                          <button
                            type="button"
                            onClick={() => setFaceBannerDismissed(true)}
                            className="px-2.5 py-2 text-xs font-medium rounded-xl glass-btn text-slate-600 dark:text-slate-300 whitespace-nowrap"
                          >
                            あとで
                          </button>
                        </div>
                      </motion.div>
                    )}
                </AnimatePresence>

                <AnimatePresence mode="wait">
                  {(activeSection === 'all' || activeSection === 'favorites') && (
                    <motion.div
                      key={contentViewKey}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -12 }}
                      transition={{ duration: 0.2 }}
                    >
                      {filteredAccounts.length === 0 ? (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.97 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ type: 'spring', stiffness: 320, damping: 26 }}
                          className="glass-surface rounded-[24px] p-10 text-center space-y-4"
                        >
                          <div className="w-12 h-12 rounded-2xl glass-subtle flex items-center justify-center mx-auto">
                            <KeyRound className="w-6 h-6 text-slate-500 dark:text-slate-300" aria-hidden="true" />
                          </div>
                          <div className="space-y-1 max-w-md mx-auto">
                            <h2 className="text-base font-bold text-slate-900 dark:text-white">
                              {vault.accounts.length === 0
                                ? 'まだ認証アカウントがありません'
                                : '条件に一致するアカウントが見つかりません'}
                            </h2>
                            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                              {vault.accounts.length === 0
                                ? 'QRコード画像の読み取り、otpauth:// URIの貼り付け、またはBase32シークレットキーの手動入力から最初の二段階認証アカウントを追加できます。'
                                : '検索キーワードや選択中のフォルダを変更してください。'}
                            </p>
                          </div>
                          {vault.accounts.length === 0 && (
                            <motion.button
                              type="button"
                              whileHover={{ scale: 1.03 }}
                              whileTap={{ scale: 0.96 }}
                              onClick={() => {
                                setEditingAccount(null);
                                setAddModalOpen(true);
                              }}
                              className="px-4 py-2 text-xs font-semibold rounded-xl glass-primary-btn inline-flex items-center gap-1.5"
                            >
                              <Plus className="w-4 h-4" aria-hidden="true" />
                              最初のアカウントを追加
                            </motion.button>
                          )}
                        </motion.div>
                      ) : (
                        <div
                          data-testid="totp-grid"
                          className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4"
                        >
                          <AnimatePresence mode="popLayout">
                            {filteredAccounts.map((acc, idx) => (
                              <TotpCard
                                key={acc.id}
                                index={idx}
                                account={acc}
                                totp={totpMap[acc.id]}
                                onToast={pushToast}
                                onToggleFavorite={(id) => void handleToggleFavorite(id)}
                                onEdit={(account) => {
                                  setEditingAccount(account);
                                  setAddModalOpen(true);
                                }}
                                onDelete={(account) => setDeletingAccount(account)}
                                onShowQr={(account) => setQrAccount(account)}
                                onShowRecovery={(account) => setRecoveryAccountId(account.id)}
                              />
                            ))}
                          </AnimatePresence>
                        </div>
                      )}
                    </motion.div>
                  )}

                  {activeSection === 'autofill' && (
                    <motion.div
                      key="section-autofill"
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -12 }}
                      transition={{ duration: 0.2 }}
                    >
                      <AutofillBridgeView
                        accounts={vault.accounts}
                        totpMap={totpMap}
                        onToast={pushToast}
                      />
                    </motion.div>
                  )}

                  {activeSection === 'audit' && auditReport && (
                    <motion.div
                      key="section-audit"
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -12 }}
                      transition={{ duration: 0.2 }}
                    >
                      <SecurityAuditView
                        report={auditReport}
                        onNavigateToSyncSettings={() => setActiveSection('sync')}
                      />
                    </motion.div>
                  )}

                  {activeSection === 'sync' && (
                    <motion.div
                      key="section-sync"
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -12 }}
                      transition={{ duration: 0.2 }}
                    >
                      <SyncBackupView
                        googleUser={googleUser}
                        onGoogleSignIn={handleGoogleSignIn}
                        trustDevice={trustDevice}
                        onToggleTrustDevice={handleToggleTrustDeviceInSettings}
                        vault={vault}
                        envelope={envelope}
                        storageMode={storageMode}
                        syncStatus={syncStatus}
                        serverHealth={serverHealth}
                        onChangeStorageMode={handleChangeStorageAndSync}
                        onForceSync={handleForceSync}
                        onChangeAutoLock={handleChangeAutoLock}
                        onChangePassphrase={handleChangePassphrase}
                        onDeleteVault={handleDeleteVault}
                        isFaceEnrolled={faceVaultIds.includes(vault.vaultId)}
                        cameraCapabilities={cameraCapabilities}
                        onOpenFaceEnroll={handleOpenFaceEnroll}
                        onRemoveFaceAuth={handleRemoveFaceAuth}
                        autoBackupSettings={autoBackupSettings}
                        autoBackupSnapshots={autoBackupSnapshots}
                        onChangeAutoBackupSettings={handleChangeAutoBackupSettings}
                        onCreateBackupNow={handleCreateBackupNow}
                        onRestoreBackupSnapshot={handleRestoreBackupSnapshot}
                        onDeleteBackupSnapshot={handleDeleteBackupSnapshot}
                        onToast={pushToast}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              </main>
            </div>

            {/* Add / Edit Account Modal */}
            <AddEditAccountModal
              open={addModalOpen}
              editingAccount={editingAccount}
              existingFolders={folders}
              onClose={() => {
                setAddModalOpen(false);
                setEditingAccount(null);
              }}
              onToast={pushToast}
              onSave={handleSaveAccount}
            />

            {/* QR Export Modal */}
            <QrExportModal
              account={qrAccount}
              onClose={() => setQrAccount(null)}
              onToast={pushToast}
            />

            {/* Recovery Codes Modal */}
            <RecoveryCodesModal
              account={recoveryAccount}
              onClose={() => setRecoveryAccountId(null)}
              onUpdateRecoveryCodes={handleUpdateRecoveryCodes}
              onToast={pushToast}
            />

            {/* Delete Confirmation Modal */}
            <AnimatePresence>
              {deletingAccount && (
                <motion.div
                  key="delete-acc-backdrop"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="delete-acc-title"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  onClick={(e) => {
                    if (e.target === e.currentTarget) setDeletingAccount(null);
                  }}
                  className="fixed inset-0 z-50 bg-slate-950/35 backdrop-blur-md flex items-center justify-center p-4"
                >
                  <motion.div
                    key="delete-acc-dialog"
                    initial={{ opacity: 0, scale: 0.9, y: 18 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.92, y: 14 }}
                    transition={{ type: 'spring', stiffness: 360, damping: 28 }}
                    className="glass-modal rounded-[26px] w-full max-w-sm p-6 space-y-4"
                  >
                    <h2
                      id="delete-acc-title"
                      className="text-base font-bold text-slate-900 dark:text-white"
                    >
                      アカウントを削除しますか？
                    </h2>
                    <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                      「{deletingAccount.issuer} ({deletingAccount.label})」をボルトから削除します。削除するとこのサービスの二段階認証コードを生成できなくなります。
                    </p>
                    <div className="flex items-center justify-end gap-2 pt-2">
                      <motion.button
                        type="button"
                        whileHover={{ scale: 1.03 }}
                        whileTap={{ scale: 0.96 }}
                        onClick={() => setDeletingAccount(null)}
                        className="px-3.5 py-2 text-xs font-medium rounded-xl glass-btn text-slate-700 dark:text-slate-200"
                      >
                        キャンセル
                      </motion.button>
                      <motion.button
                        type="button"
                        whileHover={{ scale: 1.03 }}
                        whileTap={{ scale: 0.96 }}
                        onClick={() => void handleConfirmDeleteAccount()}
                        className="px-4 py-2 text-xs font-semibold rounded-xl bg-red-600 hover:bg-red-700 text-white"
                      >
                        削除する
                      </motion.button>
                    </div>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Global Centered Startup Wait Popup, Web Camera Face Auth Modal, Offline Status & Bottom Toast Notifications */}
      <FaceAuthModal
        open={faceModal.open}
        mode={faceModal.mode}
        vaultId={faceModal.vaultId}
        vaultName={faceModal.vaultName}
        lockNotice={lockNotice}
        onClose={handleCloseFaceModal}
        onSwitchToPassword={() => {
          if (faceModal.vaultId) {
            setInitialVaultId(faceModal.vaultId);
          }
          setFaceModal((prev) => ({ ...prev, open: false }));
          setStartupSubView('password');
          setStartupPhase('choose-unlock');
        }}
        onEnrollComplete={handleFaceEnrollComplete}
        onVerifySuccess={handleFaceVerifySuccess}
      />
      <StartupLoadingModal
        phase={startupPhase}
        statusDetail={startupDetail}
        availableVaults={availableVaults}
        initialVaultId={initialVaultId}
        faceEnrolledVaultIds={faceVaultIds}
        cameraSupported={cameraCapabilities.supported}
        unlockReason={startupUnlockReason}
        lockNotice={lockNotice}
        initialSubView={startupSubView}
        onSkipWait={handleSkipStartupWait}
        onChooseFaceUnlock={(targetId, mode) => {
          setStartupSubView('select');
          setStartupPhase('idle');
          handleOpenFaceUnlock(targetId, mode);
        }}
        onSubmitPasswordUnlock={async ({ vaultId: targetId, passphrase: pw, storageMode: mode }) => {
          await handleUnlockVault({
            vaultId: targetId,
            passphrase: pw,
            storageMode: mode,
            trustDevice: trustDeviceRef.current,
          });
          setStartupSubView('select');
          setStartupPhase('idle');
        }}
      />
      <OfflineIndicator />
      <BottomToastHost toasts={toasts} onDismiss={dismissToast} />
    </MotionConfig>
  );
}
