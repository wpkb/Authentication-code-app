import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { User } from 'firebase/auth';
import {
  Check,
  CheckCircle2,
  Cloud,
  Cookie,
  Copy,
  Eye,
  EyeOff,
  HardDrive,
  KeyRound,
  Loader2,
  Lock,
  LogOut,
  Plus,
  RefreshCw,
  ScanFace,
  Server,
  ShieldCheck,
  Upload,
} from 'lucide-react';
import type { CameraCapabilities } from '../crypto/faceAuthVault';
import {
  evaluatePassphraseStrength,
  generateStrongPassphrase,
} from '../crypto/vaultCrypto';
import type { ServerHealthStatus } from '../storage/vaultStorage';
import { sanitizeVaultId } from '../storage/vaultStorage';
import type { EncryptedEnvelope, StorageMode, VaultSummary } from '../types/vault';
import type { ToastTone } from './BottomToastHost';
import { PWAInstallButton } from './PWAInstallButton';

interface VaultAuthScreenProps {
  googleUser: User | null;
  authLoading: boolean;
  onGoogleSignIn: () => Promise<void>;
  onGoogleSignOut: () => Promise<void>;
  trustDevice: boolean;
  onToggleTrustDevice: (next: boolean) => void;
  initialVaultId: string | null;
  storageMode: StorageMode;
  onChangeStorageMode: (mode: StorageMode) => void;
  serverHealth: ServerHealthStatus;
  availableVaults: VaultSummary[];
  onRefreshVaults: () => Promise<void>;
  onCreateVault: (params: {
    vaultId: string;
    vaultName: string;
    passphrase: string;
    storageMode: StorageMode;
    trustDevice: boolean;
  }) => Promise<void>;
  onUnlockVault: (params: {
    vaultId: string;
    passphrase: string;
    storageMode: StorageMode;
    trustDevice: boolean;
  }) => Promise<void>;
  onImportEnvelope: (envelope: EncryptedEnvelope, passphrase: string) => Promise<void>;
  onStartDemo: () => Promise<void>;
  faceVaultIds: string[];
  cameraCapabilities: CameraCapabilities;
  onOpenFaceUnlock: (vaultId: string, storageMode: StorageMode) => void;
  lockNotice?: string | null;
  onDismissLockNotice?: () => void;
  isDark: boolean;
  onToggleTheme: () => void;
  onToast?: (message: string, tone?: ToastTone) => void;
}

export const VaultAuthScreen: React.FC<VaultAuthScreenProps> = ({
  googleUser,
  authLoading,
  onGoogleSignIn,
  onGoogleSignOut,
  trustDevice,
  onToggleTrustDevice,
  initialVaultId,
  storageMode,
  onChangeStorageMode,
  serverHealth,
  availableVaults,
  onRefreshVaults,
  onCreateVault,
  onUnlockVault,
  onImportEnvelope,
  onStartDemo,
  faceVaultIds,
  cameraCapabilities,
  onOpenFaceUnlock,
  lockNotice,
  onDismissLockNotice,
  isDark,
  onToggleTheme,
  onToast,
}) => {
  const hasExisting = availableVaults.length > 0 || Boolean(initialVaultId);
  const [tab, setTab] = useState<'unlock' | 'create' | 'import'>(
    hasExisting ? 'unlock' : 'create'
  );

  const [vaultId, setVaultId] = useState<string>(
    initialVaultId || availableVaults[0]?.vaultId || (googleUser ? 'cloud-main' : 'main-vault')
  );
  const [vaultName, setVaultName] = useState<string>(
    googleUser ? 'クラウド認証ボルト' : 'メイン認証ボルト'
  );
  const [passphrase, setPassphrase] = useState<string>('');
  const [confirmPassphrase, setConfirmPassphrase] = useState<string>('');
  const [showPassphrase, setShowPassphrase] = useState<boolean>(false);
  const [importedEnvelope, setImportedEnvelope] = useState<EncryptedEnvelope | null>(null);
  const [importFileName, setImportFileName] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [cryptoStep, setCryptoStep] = useState<string>('');
  const [signingIn, setSigningIn] = useState<boolean>(false);
  const [startingDemo, setStartingDemo] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [copiedGen, setCopiedGen] = useState<boolean>(false);

  const selectedCleanId = sanitizeVaultId(vaultId);
  const isFaceAuthReady =
    tab === 'unlock' &&
    selectedCleanId.length >= 3 &&
    faceVaultIds.includes(selectedCleanId);

  useEffect(() => {
    if (googleUser) {
      const cloudVault = availableVaults.find((v) => v.source === 'cloud');
      if (cloudVault) {
        setVaultId(cloudVault.vaultId);
        setTab('unlock');
      } else if (availableVaults.length === 0) {
        setVaultId('cloud-main');
        setVaultName('クラウド認証ボルト');
        setTab('create');
      }
      return;
    }

    if (initialVaultId) {
      setVaultId(initialVaultId);
      setTab('unlock');
    } else if (availableVaults.length > 0 && !vaultId) {
      setVaultId(availableVaults[0].vaultId);
    }
  }, [googleUser, initialVaultId, availableVaults]);

  const strength = evaluatePassphraseStrength(passphrase);

  const handleGoogleLoginClick = async () => {
    setError('');
    setSigningIn(true);
    try {
      await onGoogleSignIn();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Googleログインがキャンセルされたか、失敗しました。'
      );
    } finally {
      setSigningIn(false);
    }
  };

  const handleGeneratePassphrase = () => {
    const generated = generateStrongPassphrase(4);
    setPassphrase(generated);
    setConfirmPassphrase(generated);
    setShowPassphrase(true);
    setError('');
    onToast?.('強力なパスフレーズを自動生成しました。安全な場所に控えてください。', 'info');
  };

  const handleCopyPassphrase = async () => {
    if (!passphrase) return;
    try {
      await navigator.clipboard.writeText(passphrase);
      setCopiedGen(true);
      onToast?.('マスターパスフレーズをコピーしました', 'success');
      setTimeout(() => setCopiedGen(false), 1800);
    } catch {
      onToast?.('クリップボードへのコピーに失敗しました', 'error');
    }
  };

  const handleDemoClick = async () => {
    setStartingDemo(true);
    try {
      await onStartDemo();
    } finally {
      setStartingDemo(false);
    }
  };

  const handleFaceUnlockClick = () => {
    const cleanId = sanitizeVaultId(vaultId);
    if (cleanId.length < 3) {
      setError('ボルトIDを確認してください。');
      return;
    }
    setError('');
    onOpenFaceUnlock(cleanId, storageMode);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const cleanId = sanitizeVaultId(vaultId);
    if (tab !== 'import' && cleanId.length < 3) {
      setError('ボルトIDは3文字以上の半角英数字で入力してください。');
      return;
    }

    if (tab === 'create') {
      if (passphrase.length < 8) {
        setError('マスターパスフレーズは8文字以上で設定してください。');
        return;
      }
      if (passphrase !== confirmPassphrase) {
        setError('確認用パスフレーズが一致しません。');
        return;
      }
      setSubmitting(true);
      setCryptoStep('鍵を導出中 (PBKDF2 600,000回)...');
      try {
        await onCreateVault({
          vaultId: cleanId,
          vaultName: vaultName.trim() || 'マイ認証ボルト',
          passphrase,
          storageMode,
          trustDevice,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'ボルトの作成に失敗しました。');
      } finally {
        setSubmitting(false);
        setCryptoStep('');
      }
      return;
    }

    if (tab === 'unlock') {
      if (!passphrase) {
        setError('マスターパスフレーズを入力してください。');
        return;
      }
      setSubmitting(true);
      setCryptoStep('ボルト取得・AES-256-GCM 復号中...');
      try {
        await onUnlockVault({
          vaultId: cleanId,
          passphrase,
          storageMode,
          trustDevice,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'ボルトのロック解除に失敗しました。');
      } finally {
        setSubmitting(false);
        setCryptoStep('');
      }
      return;
    }

    if (tab === 'import') {
      if (!importedEnvelope) {
        setError('暗号化バックアップファイル (.json) を選択してください。');
        return;
      }
      if (!passphrase) {
        setError('バックアップのマスターパスフレーズを入力してください。');
        return;
      }
      setSubmitting(true);
      setCryptoStep('バックアップをPBKDF2・AES-256-GCMで復号中...');
      try {
        await onImportEnvelope(importedEnvelope, passphrase);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'インポートに失敗しました。');
      } finally {
        setSubmitting(false);
        setCryptoStep('');
      }
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as EncryptedEnvelope;
      if (parsed.cipher !== 'AES-256-GCM' || !parsed.ciphertext || !parsed.salt || !parsed.iv) {
        throw new Error('有効なKagiVault暗号化バックアップではありません。');
      }
      setImportedEnvelope(parsed);
      setImportFileName(file.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ファイルの読み込みに失敗しました。');
      setImportedEnvelope(null);
      setImportFileName('');
    }
  };

  const strengthColors = [
    'bg-slate-200 dark:bg-slate-800',
    'bg-red-600',
    'bg-amber-500',
    'bg-blue-600',
    'bg-emerald-600',
  ];

  return (
    <div className="liquid-canvas min-h-screen overflow-x-hidden text-slate-900 dark:text-slate-100 flex flex-col">
      <header className="sticky top-0 z-30 glass-surface border-x-0 border-t-0">
        <div className="max-w-6xl mx-auto px-3.5 sm:px-6 py-3 sm:py-4 flex items-center justify-between gap-2 sm:gap-6">
          <div className="flex items-center gap-2 whitespace-nowrap shrink-0">
            <div className="w-8 h-8 rounded-xl glass-primary-btn flex items-center justify-center shrink-0">
              <ShieldCheck className="w-4 h-4 text-white" aria-hidden="true" />
            </div>
            <span className="text-base sm:text-lg font-bold tracking-tight">KagiVault</span>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
            <PWAInstallButton
              compact
              onInstalled={() => onToast?.('KagiVault をPWAアプリとしてインストールしました', 'success')}
            />
            <motion.button
              type="button"
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.96 }}
              onClick={onToggleTheme}
              className="px-2.5 sm:px-3.5 py-1.5 text-[11px] sm:text-xs font-medium rounded-xl glass-btn text-slate-700 dark:text-slate-200 transition-colors whitespace-nowrap"
            >
              {isDark ? 'ライト' : 'ダーク'}
              <span className="hidden sm:inline">表示</span>
            </motion.button>
            <motion.button
              type="button"
              disabled={startingDemo}
              whileHover={{ scale: startingDemo ? 1 : 1.03 }}
              whileTap={{ scale: startingDemo ? 1 : 0.96 }}
              onClick={() => void handleDemoClick()}
              className="px-2.5 sm:px-4 py-1.5 sm:py-2 text-[11px] sm:text-xs font-semibold rounded-xl glass-primary-btn transition-colors whitespace-nowrap inline-flex items-center gap-1.5 disabled:opacity-70"
            >
              {startingDemo && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
              {startingDemo ? '生成中...' : (
                <>
                  <span className="sm:hidden">デモ試す</span>
                  <span className="hidden sm:inline">デモボルトで試す</span>
                </>
              )}
            </motion.button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-7 lg:py-12 grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-start">
        {/* Left: Security Architecture & Storage Diagnostics */}
        <motion.section
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 26 }}
          className="lg:col-span-5 space-y-6"
        >
          <div className="space-y-3">
            <p className="text-xs font-medium text-blue-600 dark:text-blue-400">
              ゼロ知識暗号化 · クラウド ＆ ローカル二段階認証
            </p>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white leading-tight [text-wrap:balance]">
              Googleアカウント連携で、どの端末からも安全に2FAを同期。
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
              Googleアカウントでログインすると暗号化ボルトをクラウド（Cloud Firestore）に保存し、どの端末からでも同じアカウントでアクセスできます。すべての秘密鍵はブラウザ内で
              <strong className="font-semibold text-slate-800 dark:text-slate-200">
                {' '}AES-256-GCM{' '}
              </strong>
              暗号化されてから送信されます。
            </p>
          </div>

          <div className="glass-surface rounded-2xl p-5 space-y-4">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              ストレージ接続状態
            </h2>

            <div className="space-y-3 text-sm">
              <div className="flex items-start justify-between gap-4 pb-3 border-b border-slate-900/8 dark:border-white/10">
                <div className="flex items-center gap-2.5">
                  <Cloud className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" aria-hidden="true" />
                  <div>
                    <p className="font-medium text-slate-800 dark:text-slate-200">
                      Googleクラウド保存 (Firestore)
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {googleUser
                        ? `${googleUser.email} で同期可能`
                        : 'Googleログインでマルチ端末クラウド同期を有効化'}
                    </p>
                  </div>
                </div>
                <span
                  className={`text-xs font-medium whitespace-nowrap ${
                    googleUser
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {googleUser ? 'ログイン中' : '未ログイン'}
                </span>
              </div>

              <div className="flex items-start justify-between gap-4 pb-3 border-b border-slate-900/8 dark:border-white/10">
                <div className="flex items-center gap-2.5">
                  <Server className="w-4 h-4 text-slate-500 dark:text-slate-400 shrink-0" aria-hidden="true" />
                  <div>
                    <p className="font-medium text-slate-800 dark:text-slate-200">
                      ローカルサーバー暗号化保存
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {serverHealth.available
                        ? '接続済み · AES-256-GCM 暗号文のみを保存'
                        : 'オフライン — Cookieフォールバックが動作します'}
                    </p>
                  </div>
                </div>
                <span
                  className={`text-xs font-medium whitespace-nowrap ${
                    serverHealth.available
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : 'text-amber-700 dark:text-amber-400'
                  }`}
                >
                  {serverHealth.available ? '利用可能' : 'Cookie待機'}
                </span>
              </div>

              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-2.5">
                  <Cookie className="w-4 h-4 text-slate-500 dark:text-slate-400 shrink-0" aria-hidden="true" />
                  <div>
                    <p className="font-medium text-slate-800 dark:text-slate-200">
                      暗号化Cookieフォールバック
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      SameSite=Lax 分割Cookieに暗号文を自動ミラー保存
                    </p>
                  </div>
                </div>
                <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
                  有効
                </span>
              </div>
            </div>
          </div>

          <div className="glass-surface rounded-2xl p-5 space-y-2.5">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              「普通のアプリ」のように使える信頼済み端末モード
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              一度マスターパスフレーズでロック解除すると、抽出不可能な Web Crypto 鍵をブラウザに安全保持し、次回からはGoogleアカウントで開くだけで即座にコード一覧へアクセスできます。
            </p>
          </div>
        </motion.section>

        {/* Right: Google Sign-In + Vault Unlock / Create / Import Card */}
        <motion.section
          initial={{ opacity: 0, y: 22, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: 'spring', stiffness: 300, damping: 26, delay: 0.06 }}
          className="lg:col-span-7 glass-modal rounded-3xl p-6 sm:p-8 space-y-6"
        >
          {/* Google Account Banner */}
          <div className="p-4 rounded-2xl glass-subtle">
            <AnimatePresence mode="wait">
              {authLoading ? (
                <motion.p
                  key="auth-loading"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="text-xs text-slate-500 dark:text-slate-400 inline-flex items-center gap-2"
                >
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" aria-hidden="true" />
                  認証状態を確認中...
                </motion.p>
              ) : googleUser ? (
                <motion.div
                  key="auth-signed-in"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2 }}
                  className="flex items-center justify-between gap-4 flex-wrap"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {googleUser.photoURL ? (
                      <img
                        src={googleUser.photoURL}
                        alt={googleUser.displayName || 'Googleユーザー'}
                        referrerPolicy="no-referrer"
                        className="w-9 h-9 rounded-full border border-slate-200 dark:border-slate-700 shrink-0"
                      />
                    ) : (
                      <div className="w-9 h-9 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold shrink-0">
                        {(googleUser.displayName || googleUser.email || 'G')
                          .slice(0, 1)
                          .toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                        {googleUser.displayName || 'Googleアカウント'}
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        {googleUser.email}
                      </p>
                    </div>
                  </div>
                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.96 }}
                    onClick={() => void onGoogleSignOut()}
                    className="px-3 py-1.5 text-xs font-medium rounded-xl glass-btn text-slate-700 dark:text-slate-200 inline-flex items-center gap-1.5 whitespace-nowrap"
                  >
                    <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
                    ログアウト
                  </motion.button>
                </motion.div>
              ) : (
                <motion.div
                  key="auth-signed-out"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2 }}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div>
                    <p className="text-xs font-semibold text-slate-900 dark:text-white">
                      クラウド保存を使う（推奨）
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      Googleアカウントでログインして暗号化ボルトをクラウド同期
                    </p>
                  </div>
                  <motion.button
                    type="button"
                    disabled={signingIn}
                    whileHover={{ scale: signingIn ? 1 : 1.03 }}
                    whileTap={{ scale: signingIn ? 1 : 0.96 }}
                    onClick={() => void handleGoogleLoginClick()}
                    className="px-4 py-2 text-xs font-semibold rounded-xl glass-btn text-slate-800 dark:text-slate-100 inline-flex items-center justify-center gap-2 whitespace-nowrap shrink-0"
                  >
                    {signingIn ? (
                      <Loader2 className="w-4 h-4 animate-spin text-blue-600" aria-hidden="true" />
                    ) : (
                      <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
                        <path
                          fill="#4285F4"
                          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                        />
                        <path
                          fill="#34A853"
                          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                        />
                        <path
                          fill="#FBBC05"
                          d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                        />
                        <path
                          fill="#EA4335"
                          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                        />
                      </svg>
                    )}
                    {signingIn ? 'ログイン中...' : 'Googleでログイン'}
                  </motion.button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <AnimatePresence>
            {lockNotice && (
              <motion.div
                role="status"
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="p-3.5 rounded-2xl border border-amber-400/45 bg-amber-500/12 backdrop-blur-sm flex items-center justify-between gap-3 text-xs text-amber-900 dark:text-amber-200"
              >
                <span>{lockNotice}</span>
                {onDismissLockNotice && (
                  <button
                    type="button"
                    onClick={onDismissLockNotice}
                    className="text-[11px] font-semibold underline shrink-0"
                  >
                    閉じる
                  </button>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          <div
            role="tablist"
            aria-label="ボルト操作の切り替え"
            className="grid grid-cols-3 gap-1 p-1 glass-subtle rounded-xl"
          >
            {(
              [
                { id: 'unlock', label: '既存ボルトを開く' },
                { id: 'create', label: '新規ボルト作成' },
                { id: 'import', label: 'バックアップ復元' },
              ] as const
            ).map((item) => {
              const active = tab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => {
                    setTab(item.id);
                    setError('');
                  }}
                  className={`relative px-1.5 sm:px-3 py-2 text-[11px] sm:text-xs font-semibold rounded-lg transition-colors whitespace-nowrap truncate ${
                    active
                      ? 'text-slate-900 dark:text-white'
                      : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="auth-mode-tab-pill"
                      transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                      className="absolute inset-0 bg-white/90 dark:bg-white/15 backdrop-blur-md rounded-lg shadow-sm border border-white/80 dark:border-white/15"
                    />
                  )}
                  <span className="relative z-10">{item.label}</span>
                </button>
              );
            })}
          </div>

          <AnimatePresence>
            {isFaceAuthReady && (
              <motion.div
                key={`biometric-unlock-card-${selectedCleanId}`}
                initial={{ opacity: 0, y: 10, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ type: 'spring', stiffness: 340, damping: 26 }}
                className="p-4 sm:p-5 rounded-2xl glass-surface border border-blue-400/45 bg-blue-500/10 space-y-3"
              >
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl glass-primary-btn flex items-center justify-center shrink-0">
                    <ScanFace className="w-5 h-5 text-white" aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                      Webカメラ顔認証でロック解除
                    </h2>
                    <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5 leading-relaxed">
                      端末OSに依存せずブラウザ内で完結するAI顔認識により、ボルト「
                      <span className="font-mono font-semibold">{selectedCleanId}</span>
                      」をパスフレーズ入力なしで復号します。
                    </p>
                  </div>
                </div>

                {!cameraCapabilities.supported && (
                  <p className="text-[11px] text-amber-800 dark:text-amber-200">
                    現在のブラウザ環境ではカメラ API を利用できません。下のマスターパスフレーズをご利用ください。
                  </p>
                )}

                <motion.button
                  type="button"
                  data-testid="biometric-unlock-btn"
                  disabled={submitting || !cameraCapabilities.supported}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={handleFaceUnlockClick}
                  className="w-full py-2.5 px-4 rounded-xl glass-primary-btn disabled:opacity-70 text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors"
                >
                  <ScanFace className="w-4 h-4" aria-hidden="true" />
                  <span>顔認証でロック解除</span>
                </motion.button>

                <div className="flex items-center gap-2 pt-1 text-[11px] text-slate-500 dark:text-slate-400">
                  <div className="h-px flex-1 bg-slate-900/10 dark:bg-white/10" />
                  <span>またはマスターパスフレーズで解除</span>
                  <div className="h-px flex-1 bg-slate-900/10 dark:bg-white/10" />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <form onSubmit={handleSubmit} className="space-y-5">
            <AnimatePresence mode="wait">
              {tab === 'unlock' && availableVaults.length > 0 && (
                <motion.div
                  key="unlock-vault-list"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.18 }}
                  className="space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                      保存済みのボルト一覧
                    </span>
                    <motion.button
                      type="button"
                      whileHover={{ scale: 1.04 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={() => void onRefreshVaults()}
                      className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      <RefreshCw className="w-3 h-3" aria-hidden="true" />
                      再読込
                    </motion.button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {availableVaults.slice(0, 6).map((v) => {
                      const selected = sanitizeVaultId(vaultId) === v.vaultId;
                      const sourceLabel =
                        v.source === 'cloud'
                          ? 'Googleクラウド'
                          : v.source === 'both'
                          ? 'サーバー + Cookie'
                          : v.source === 'server'
                          ? 'サーバー保存'
                          : 'Cookie保存';
                      return (
                        <motion.button
                          key={v.vaultId}
                          type="button"
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.97 }}
                          onClick={() => setVaultId(v.vaultId)}
                          className={`text-left px-3 py-2.5 rounded-xl transition-colors ${
                            selected
                              ? 'glass-subtle border-blue-500/70 bg-blue-500/12 dark:bg-blue-500/16'
                              : 'glass-subtle hover:bg-white/70 dark:hover:bg-white/10'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold font-mono truncate">
                              {v.vaultId}
                            </span>
                            {selected && (
                              <motion.span
                                initial={{ scale: 0.5, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                transition={{ type: 'spring', stiffness: 450, damping: 20 }}
                              >
                                <CheckCircle2
                                  className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0"
                                  aria-hidden="true"
                                />
                              </motion.span>
                            )}
                          </div>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
                            {sourceLabel} · Rev.{v.revision}
                          </p>
                        </motion.button>
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {tab !== 'import' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="vault-id-input"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                  >
                    ボルトID (半角英数字・ハイフン)
                  </label>
                  <input
                    id="vault-id-input"
                    type="text"
                    value={vaultId}
                    onChange={(e) => setVaultId(e.target.value)}
                    placeholder="例: cloud-main"
                    className="w-full px-3 py-2 text-sm font-mono rounded-xl glass-input text-slate-900 dark:text-slate-100"
                    required
                  />
                </div>

                {tab === 'create' && (
                  <div>
                    <label
                      htmlFor="vault-name-input"
                      className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                    >
                      ボルトの表示名
                    </label>
                    <input
                      id="vault-name-input"
                      type="text"
                      value={vaultName}
                      onChange={(e) => setVaultName(e.target.value)}
                      placeholder="例: クラウド認証ボルト"
                      className="w-full px-3 py-2 text-sm rounded-xl glass-input text-slate-900 dark:text-slate-100"
                    />
                  </div>
                )}

                {tab === 'unlock' && (
                  <div>
                    <label
                      htmlFor="storage-mode-select"
                      className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                    >
                      保存・読み込み先
                    </label>
                    <select
                      id="storage-mode-select"
                      value={storageMode}
                      onChange={(e) => onChangeStorageMode(e.target.value as StorageMode)}
                      className="w-full px-3 py-2 text-sm rounded-xl glass-input text-slate-900 dark:text-slate-100 [&_option]:bg-white dark:[&_option]:bg-slate-900"
                    >
                      {googleUser && (
                        <option value="cloud">Googleクラウド (Firestore + Cookie)</option>
                      )}
                      <option value="auto">自動 (クラウド/サーバー + Cookie)</option>
                      <option value="server">ローカルサーバー優先</option>
                      <option value="cookie">暗号化Cookieのみ (オフライン)</option>
                    </select>
                  </div>
                )}
              </div>
            )}

            {tab === 'create' && (
              <div>
                <span className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  保存先の選択
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {googleUser ? (
                    <motion.button
                      type="button"
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.97 }}
                      onClick={() => onChangeStorageMode('cloud')}
                      className={`p-3 rounded-xl text-left transition-colors ${
                        storageMode === 'cloud'
                          ? 'glass-subtle border-blue-500/70 bg-blue-500/12 dark:bg-blue-500/16'
                          : 'glass-subtle hover:bg-white/70 dark:hover:bg-white/10'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 text-xs font-semibold">
                        <Cloud className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
                        <span>Googleクラウド</span>
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                        Firestore + Cookie同期
                      </p>
                    </motion.button>
                  ) : (
                    <motion.button
                      type="button"
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.97 }}
                      onClick={() => onChangeStorageMode('server')}
                      className={`p-3 rounded-xl text-left transition-colors ${
                        storageMode === 'server'
                          ? 'glass-subtle border-blue-500/70 bg-blue-500/12 dark:bg-blue-500/16'
                          : 'glass-subtle hover:bg-white/70 dark:hover:bg-white/10'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 text-xs font-semibold">
                        <Server className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
                        <span>サーバー保存</span>
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                        暗号文をサーバーへ保存
                      </p>
                    </motion.button>
                  )}
                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.97 }}
                    onClick={() => onChangeStorageMode('auto')}
                    className={`p-3 rounded-xl text-left transition-colors ${
                      storageMode === 'auto'
                        ? 'glass-subtle border-blue-500/70 bg-blue-500/12 dark:bg-blue-500/16'
                        : 'glass-subtle hover:bg-white/70 dark:hover:bg-white/10'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 text-xs font-semibold">
                      <HardDrive className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
                      <span>自動ハイブリッド</span>
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                      サーバー＋Cookie二重保存
                    </p>
                  </motion.button>
                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.97 }}
                    onClick={() => onChangeStorageMode('cookie')}
                    className={`p-3 rounded-xl text-left transition-colors ${
                      storageMode === 'cookie'
                        ? 'glass-subtle border-blue-500/70 bg-blue-500/12 dark:bg-blue-500/16'
                        : 'glass-subtle hover:bg-white/70 dark:hover:bg-white/10'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 text-xs font-semibold">
                      <Cookie className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
                      <span>Cookieのみ</span>
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                      ブラウザCookieのみ保存
                    </p>
                  </motion.button>
                </div>
              </div>
            )}

            {tab === 'import' && (
              <div>
                <label
                  htmlFor="backup-file-input"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                >
                  暗号化バックアップファイル (.kagivault.json)
                </label>
                <label
                  htmlFor="backup-file-input"
                  className="flex flex-col items-center justify-center gap-2 p-6 glass-subtle border-2 border-dashed border-slate-400/50 dark:border-white/20 rounded-2xl cursor-pointer hover:border-blue-500/70 transition-colors"
                >
                  <Upload className="w-5 h-5 text-slate-500 dark:text-slate-300" aria-hidden="true" />
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-200">
                    {importFileName || 'クリックして暗号化バックアップを選択'}
                  </span>
                  {importedEnvelope && (
                    <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                      ボルトID: {importedEnvelope.vaultId} · Rev.{importedEnvelope.revision}
                    </span>
                  )}
                  <input
                    id="backup-file-input"
                    type="file"
                    accept=".json,application/json"
                    onChange={handleFileSelect}
                    className="sr-only"
                  />
                </label>
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label
                  htmlFor="master-passphrase-input"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                >
                  マスターパスフレーズ
                </label>
                {tab === 'create' && (
                  <div className="flex items-center gap-3">
                    {passphrase && (
                      <motion.button
                        type="button"
                        whileHover={{ scale: 1.03 }}
                        whileTap={{ scale: 0.95 }}
                        onClick={() => void handleCopyPassphrase()}
                        className="text-xs text-slate-600 dark:text-slate-300 hover:underline inline-flex items-center gap-1"
                      >
                        {copiedGen ? (
                          <Check className="w-3 h-3 text-emerald-600" aria-hidden="true" />
                        ) : (
                          <Copy className="w-3 h-3" aria-hidden="true" />
                        )}
                        {copiedGen ? 'コピー済み' : 'コピー'}
                      </motion.button>
                    )}
                    <button
                      type="button"
                      onClick={handleGeneratePassphrase}
                      className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      強力なパスフレーズを自動生成
                    </button>
                  </div>
                )}
              </div>

              <div className="relative">
                <input
                  id="master-passphrase-input"
                  type={showPassphrase ? 'text' : 'password'}
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  placeholder={
                    tab === 'create'
                      ? '12文字以上の強力なパスフレーズ'
                      : 'ボルトのマスターパスフレーズを入力'
                  }
                  autoComplete={tab === 'create' ? 'new-password' : 'current-password'}
                  className="w-full pl-3 pr-10 py-2.5 text-sm rounded-xl glass-input text-slate-900 dark:text-slate-100"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassphrase((v) => !v)}
                  aria-label={showPassphrase ? 'パスフレーズを隠す' : 'パスフレーズを表示'}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                >
                  {showPassphrase ? (
                    <EyeOff className="w-4 h-4" aria-hidden="true" />
                  ) : (
                    <Eye className="w-4 h-4" aria-hidden="true" />
                  )}
                </button>
              </div>

              {tab === 'create' && (
                <div className="mt-2.5 space-y-1.5">
                  <div className="h-2 rounded-full bg-slate-900/10 dark:bg-white/10 overflow-hidden">
                    <motion.div
                      initial={{ width: '0%' }}
                      animate={{
                        width: `${Math.min(100, Math.max(8, strength.score * 25))}%`,
                      }}
                      transition={{ type: 'spring', stiffness: 280, damping: 24 }}
                      className={`h-full rounded-full ${
                        strength.score > 0 ? strengthColors[strength.score] : 'bg-slate-400/50'
                      }`}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                    <span>
                      強度:{' '}
                      <strong className="font-semibold text-slate-700 dark:text-slate-200">
                        {strength.label}
                      </strong>
                    </span>
                    <span className="font-mono tabular-nums">
                      推定エントロピー {strength.entropyBits} bits
                    </span>
                  </div>
                </div>
              )}
            </div>

            {tab === 'create' && (
              <div>
                <label
                  htmlFor="confirm-passphrase-input"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                >
                  マスターパスフレーズ (確認)
                </label>
                <input
                  id="confirm-passphrase-input"
                  type={showPassphrase ? 'text' : 'password'}
                  value={confirmPassphrase}
                  onChange={(e) => setConfirmPassphrase(e.target.value)}
                  placeholder="同じパスフレーズを再入力"
                  autoComplete="new-password"
                  className="w-full px-3 py-2.5 text-sm rounded-xl glass-input text-slate-900 dark:text-slate-100"
                  required
                />
              </div>
            )}

            {googleUser && tab !== 'import' && (
              <label className="flex items-start gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={trustDevice}
                  onChange={(e) => onToggleTrustDevice(e.target.checked)}
                  className="mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                />
                <span className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  このブラウザを信頼済み端末として記憶する（次回からはGoogleログインだけで自動的にロック解除されます）
                </span>
              </label>
            )}

            <AnimatePresence>
              {error && (
                <motion.div
                  role="alert"
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: [0, -5, 5, -3, 0] }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.3 }}
                  className="p-3 rounded-xl border border-red-400/40 bg-red-500/12 backdrop-blur-sm text-xs text-red-700 dark:text-red-300"
                >
                  {error}
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {submitting && cryptoStep && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="p-3 rounded-xl border border-blue-400/40 bg-blue-500/12 backdrop-blur-sm space-y-2"
                >
                  <div className="flex items-center gap-2 text-xs font-medium text-blue-800 dark:text-blue-200">
                    <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" aria-hidden="true" />
                    <span>{cryptoStep}</span>
                  </div>
                  <div className="h-1 w-full rounded-full bg-blue-500/20 overflow-hidden">
                    <motion.div
                      initial={{ width: '15%' }}
                      animate={{ width: '88%' }}
                      transition={{ duration: 1.4, ease: 'easeOut' }}
                      className="h-full bg-blue-600 dark:bg-blue-400 rounded-full"
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <motion.button
              type="submit"
              disabled={submitting}
              whileHover={{ scale: submitting ? 1 : 1.02 }}
              whileTap={{ scale: submitting ? 1 : 0.97 }}
              className="w-full py-2.5 px-4 rounded-xl glass-primary-btn disabled:opacity-70 text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                  <span>{cryptoStep || '処理中...'}</span>
                </>
              ) : tab === 'create' ? (
                <>
                  <Plus className="w-4 h-4" aria-hidden="true" />
                  <span>ボルトを作成して暗号化</span>
                </>
              ) : tab === 'unlock' ? (
                <>
                  <Lock className="w-4 h-4" aria-hidden="true" />
                  <span>ボルトのロックを解除</span>
                </>
              ) : (
                <>
                  <KeyRound className="w-4 h-4" aria-hidden="true" />
                  <span>暗号化バックアップを復号して復元</span>
                </>
              )}
            </motion.button>
          </form>
        </motion.section>
      </main>
    </div>
  );
};
