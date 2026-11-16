import React, { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { User } from 'firebase/auth';
import {
  CheckCircle2,
  Clock,
  Cloud,
  Cookie,
  Download,
  History,
  KeyRound,
  Loader2,
  RefreshCw,
  RotateCcw,
  ScanFace,
  Server,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import type { CameraCapabilities } from '../crypto/faceAuthVault';
import { buildOtpAuthUri } from '../crypto/totp';
import { evaluatePassphraseStrength } from '../crypto/vaultCrypto';
import type {
  AutoBackupFrequency,
  AutoBackupSettings,
  AutoBackupSnapshot,
} from '../storage/autoBackupStore';
import type { ServerHealthStatus } from '../storage/vaultStorage';
import type {
  EncryptedEnvelope,
  StorageMode,
  StorageSyncResult,
  VaultPayload,
} from '../types/vault';
import type { ToastTone } from './BottomToastHost';
import { PWAInstallButton } from './PWAInstallButton';

interface SyncBackupViewProps {
  googleUser: User | null;
  onGoogleSignIn: () => Promise<void>;
  trustDevice: boolean;
  onToggleTrustDevice: (next: boolean) => Promise<void>;
  vault: VaultPayload;
  envelope: EncryptedEnvelope | null;
  storageMode: StorageMode;
  syncStatus: StorageSyncResult | null;
  serverHealth: ServerHealthStatus;
  onChangeStorageMode: (mode: StorageMode) => Promise<void>;
  onForceSync: () => Promise<void>;
  onChangeAutoLock: (minutes: number) => Promise<void>;
  onChangePassphrase: (currentPassphrase: string, newPassphrase: string) => Promise<void>;
  onDeleteVault: () => Promise<void>;
  isFaceEnrolled: boolean;
  cameraCapabilities: CameraCapabilities;
  onOpenFaceEnroll: () => void;
  onRemoveFaceAuth: () => Promise<void>;
  autoBackupSettings: AutoBackupSettings;
  autoBackupSnapshots: AutoBackupSnapshot[];
  onChangeAutoBackupSettings: (next: AutoBackupSettings) => void;
  onCreateBackupNow: () => Promise<void>;
  onRestoreBackupSnapshot: (snapshot: AutoBackupSnapshot) => Promise<void>;
  onDeleteBackupSnapshot: (snapshotId: string) => Promise<void>;
  onToast?: (message: string, tone?: ToastTone) => void;
}

export const SyncBackupView: React.FC<SyncBackupViewProps> = ({
  googleUser,
  onGoogleSignIn,
  trustDevice,
  onToggleTrustDevice,
  vault,
  envelope,
  storageMode,
  syncStatus,
  serverHealth,
  onChangeStorageMode,
  onForceSync,
  onChangeAutoLock,
  onChangePassphrase,
  onDeleteVault,
  isFaceEnrolled,
  cameraCapabilities,
  onOpenFaceEnroll,
  onRemoveFaceAuth,
  autoBackupSettings,
  autoBackupSnapshots,
  onChangeAutoBackupSettings,
  onCreateBackupNow,
  onRestoreBackupSnapshot,
  onDeleteBackupSnapshot,
  onToast,
}) => {
  const [currentPass, setCurrentPass] = useState('');
  const [newPass, setNewPass] = useState('');
  const [confirmNewPass, setConfirmNewPass] = useState('');
  const [passMessage, setPassMessage] = useState('');
  const [passError, setPassError] = useState('');
  const [changingPass, setChangingPass] = useState(false);

  const [syncing, setSyncing] = useState(false);
  const [creatingBackup, setCreatingBackup] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [confirmRestoreId, setConfirmRestoreId] = useState<string | null>(null);
  const [faceRemoving, setFaceRemoving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [plainExportConfirm, setPlainExportConfirm] = useState(false);

  const newStrength = evaluatePassphraseStrength(newPass);

  const handleDownloadSnapshot = (snap: AutoBackupSnapshot) => {
    const blob = new Blob([JSON.stringify(snap.envelope, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const stamp = snap.createdAt.slice(0, 16).replace(/[:T]/g, '-');
    a.download = `${snap.vaultId}-rev${snap.revision}-${stamp}.kagivault.json`;
    a.click();
    URL.revokeObjectURL(url);
    onToast?.(
      `自動バックアップ (Rev.${snap.revision}) を .kagivault.json で保存しました`,
      'success'
    );
  };

  const handleManualSync = async () => {
    setSyncing(true);
    try {
      await onForceSync();
    } finally {
      setSyncing(false);
    }
  };

  const handleDownloadEncryptedBackup = () => {
    if (!envelope) return;
    const blob = new Blob([JSON.stringify(envelope, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${vault.vaultId}.kagivault.json`;
    a.click();
    URL.revokeObjectURL(url);
    onToast?.('暗号化バックアップ (.kagivault.json) をダウンロードしました', 'success');
  };

  const handleDownloadPlaintextUris = () => {
    const lines = vault.accounts.map((acc) => buildOtpAuthUri(acc)).join('\n');
    const blob = new Blob([lines], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${vault.vaultId}-otpauth-uris.txt`;
    a.click();
    URL.revokeObjectURL(url);
    setPlainExportConfirm(false);
    onToast?.('移行用 otpauth URI リストをダウンロードしました', 'warning');
  };

  const handlePassphraseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPassError('');
    setPassMessage('');

    if (newPass.length < 8) {
      setPassError('新しいパスフレーズは8文字以上で設定してください。');
      return;
    }
    if (newPass !== confirmNewPass) {
      setPassError('確認用の新しいパスフレーズが一致しません。');
      return;
    }

    setChangingPass(true);
    try {
      await onChangePassphrase(currentPass, newPass);
      setCurrentPass('');
      setNewPass('');
      setConfirmNewPass('');
      setPassMessage('新しいマスターパスフレーズでボルト全体を再暗号化し、保存しました。');
    } catch (err) {
      setPassError(err instanceof Error ? err.message : 'パスフレーズの変更に失敗しました。');
    } finally {
      setChangingPass(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Storage Mode & Diagnostics */}
      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 26 }}
        className="glass-surface rounded-2xl p-6 space-y-5"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              データ保存先とクラウド同期
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              暗号化済みエンベロープの保存方式を切り替えます。Googleクラウドへ保存すると他のPC・スマートフォンからも同じアカウントで同期できます。
            </p>
          </div>
          <motion.button
            type="button"
            whileHover={{ scale: syncing ? 1 : 1.03 }}
            whileTap={{ scale: syncing ? 1 : 0.96 }}
            onClick={() => void handleManualSync()}
            disabled={syncing}
            className="px-4 py-2 text-xs font-semibold rounded-xl glass-btn text-slate-700 dark:text-slate-200 inline-flex items-center gap-1.5 whitespace-nowrap self-start"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} aria-hidden="true" />
            {syncing ? '暗号化同期を実行中...' : '今すぐ暗号化同期'}
          </motion.button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          {[
            {
              id: 'cloud' as StorageMode,
              title: 'Googleクラウド (Firestore)',
              desc: googleUser
                ? `${googleUser.email} に暗号化同期＋Cookie退避`
                : 'Googleアカウントでログインして有効化',
              disabled: !googleUser,
            },
            {
              id: 'auto' as StorageMode,
              title: '自動ハイブリッド',
              desc: 'クラウド/サーバーに保存しCookieにも二重保存',
              disabled: false,
            },
            {
              id: 'server' as StorageMode,
              title: 'ローカルサーバー優先',
              desc: 'サーバー側ストレージへ保存 (障害時Cookie退避)',
              disabled: false,
            },
            {
              id: 'cookie' as StorageMode,
              title: '暗号化Cookieのみ',
              desc: '外部送信せずブラウザCookieのみに暗号化保存',
              disabled: false,
            },
          ].map((opt) => {
            const active = storageMode === opt.id;
            return (
              <motion.button
                key={opt.id}
                type="button"
                disabled={opt.disabled}
                whileHover={{ scale: opt.disabled ? 1 : 1.02 }}
                whileTap={{ scale: opt.disabled ? 1 : 0.97 }}
                onClick={() => void onChangeStorageMode(opt.id)}
                className={`relative p-4 rounded-2xl text-left transition-colors disabled:opacity-50 ${
                  active
                    ? 'glass-subtle bg-blue-500/12 dark:bg-blue-500/16 border-blue-500/60'
                    : 'glass-subtle hover:bg-white/70 dark:hover:bg-white/10'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="sync-storage-mode-active"
                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                    className="absolute inset-0 rounded-2xl border-2 border-blue-500/75 dark:border-blue-400/75 pointer-events-none"
                  />
                )}
                <p className="text-xs font-semibold text-slate-900 dark:text-white">
                  {opt.title}
                </p>
                <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
                  {opt.desc}
                </p>
              </motion.button>
            );
          })}
        </div>

        {!googleUser && (
          <div className="p-4 rounded-2xl border border-blue-400/35 bg-blue-500/10 backdrop-blur-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="text-xs text-slate-700 dark:text-slate-200">
              Googleアカウントでログインすると、現在のボルトをそのままクラウドへ同期できます。
            </div>
            <motion.button
              type="button"
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.96 }}
              onClick={() => void onGoogleSignIn()}
              className="px-4 py-2 text-xs font-semibold rounded-xl glass-primary-btn whitespace-nowrap self-start"
            >
              Googleでログインして同期
            </motion.button>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 pt-3 border-t border-slate-900/8 dark:border-white/10 text-xs">
          <div className="flex items-start gap-2.5">
            <Cloud className="w-4 h-4 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-semibold text-slate-800 dark:text-slate-200">クラウド状態</p>
              <p className="text-slate-500 dark:text-slate-400">
                {googleUser
                  ? syncStatus?.cloudSynced
                    ? 'Firestore 同期済み'
                    : 'ログイン済み (待機)'
                  : '未ログイン'}
              </p>
            </div>
          </div>

          <div className="flex items-start gap-2.5">
            <Server className="w-4 h-4 text-slate-500 mt-0.5 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-semibold text-slate-800 dark:text-slate-200">サーバー状態</p>
              <p className="text-slate-500 dark:text-slate-400 tabular-nums">
                {serverHealth.available ? '接続正常' : 'オフライン'}
                {' · '}
                {syncStatus?.serverSynced ? '同期済み' : '未送信'}
              </p>
            </div>
          </div>

          <div className="flex items-start gap-2.5">
            <Cookie className="w-4 h-4 text-slate-500 mt-0.5 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-semibold text-slate-800 dark:text-slate-200">Cookie保存状態</p>
              <p className="text-slate-500 dark:text-slate-400 tabular-nums">
                {syncStatus?.cookieSynced
                  ? `${syncStatus.cookieTier} (${syncStatus.cookieBytes} bytes)`
                  : '無効'}
              </p>
            </div>
          </div>

          <div className="flex items-start gap-2.5">
            <ShieldCheck className="w-4 h-4 text-slate-500 mt-0.5 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-semibold text-slate-800 dark:text-slate-200">暗号化アルゴリズム</p>
              <p className="text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                AES-256-GCM · Rev.{envelope?.revision ?? 1}
              </p>
            </div>
          </div>
        </div>
      </motion.section>

      {/* Auto Backup + Export & Trusted Browser Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Automatic Backup & Snapshot History Section */}
        <motion.section
          data-testid="auto-backup-section"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 320, damping: 26, delay: 0.06 }}
          className="glass-surface rounded-2xl p-6 space-y-4 lg:col-span-2"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <div className="w-9 h-9 rounded-xl glass-primary-btn flex items-center justify-center shrink-0">
                <History className="w-4 h-4 text-white" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-white">
                  自動バックアップ（世代管理・復元）
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
                  変更時や指定間隔ごとに AES-256-GCM 暗号化済みのスナップショットをブラウザ内 (IndexedDB) に自動保存します。誤削除時でも過去の世代へワンクリックで復元できます。
                </p>
              </div>
            </div>

            <motion.button
              type="button"
              data-testid="create-backup-now-btn"
              disabled={creatingBackup}
              whileHover={{ scale: creatingBackup ? 1 : 1.03 }}
              whileTap={{ scale: creatingBackup ? 1 : 0.96 }}
              onClick={async () => {
                setCreatingBackup(true);
                try {
                  await onCreateBackupNow();
                } finally {
                  setCreatingBackup(false);
                }
              }}
              className="px-3.5 py-2 text-xs font-semibold rounded-xl glass-primary-btn disabled:opacity-70 inline-flex items-center gap-1.5 whitespace-nowrap self-start shrink-0"
            >
              {creatingBackup ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
              )}
              <span>今すぐバックアップを作成</span>
            </motion.button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-4 rounded-2xl glass-subtle">
            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                data-testid="auto-backup-toggle"
                checked={autoBackupSettings.enabled}
                onChange={(e) =>
                  onChangeAutoBackupSettings({
                    ...autoBackupSettings,
                    enabled: e.target.checked,
                    frequency:
                      e.target.checked && autoBackupSettings.frequency === 'off'
                        ? 'on-change'
                        : autoBackupSettings.frequency,
                  })
                }
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-600"
              />
              <div>
                <span className="block text-xs font-semibold text-slate-900 dark:text-white">
                  自動バックアップを有効にする
                </span>
                <span className="block text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                  保存済み世代: {autoBackupSnapshots.length} / 最大 {autoBackupSettings.maxSnapshots}
                </span>
              </div>
            </label>

            <div>
              <label
                htmlFor="auto-backup-frequency"
                className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1"
              >
                自動保存タイミング
              </label>
              <select
                id="auto-backup-frequency"
                data-testid="auto-backup-frequency"
                value={autoBackupSettings.frequency}
                onChange={(e) => {
                  const freq = e.target.value as AutoBackupFrequency;
                  onChangeAutoBackupSettings({
                    ...autoBackupSettings,
                    frequency: freq,
                    enabled: freq !== 'off',
                  });
                }}
                className="w-full px-3 py-1.5 text-xs rounded-xl glass-input text-slate-900 dark:text-slate-100 [&_option]:bg-white dark:[&_option]:bg-slate-900"
              >
                <option value="on-change">変更ごとに自動保存 (推奨)</option>
                <option value="every-15m">変更時 ＋ 15分ごとに自動保存</option>
                <option value="every-1h">変更時 ＋ 1時間ごとに自動保存</option>
                <option value="off">自動オフ（手動のみ）</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="auto-backup-retention"
                className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1"
              >
                最大保持世代数
              </label>
              <select
                id="auto-backup-retention"
                value={autoBackupSettings.maxSnapshots}
                onChange={(e) =>
                  onChangeAutoBackupSettings({
                    ...autoBackupSettings,
                    maxSnapshots: Number(e.target.value),
                  })
                }
                className="w-full px-3 py-1.5 text-xs rounded-xl glass-input text-slate-900 dark:text-slate-100 [&_option]:bg-white dark:[&_option]:bg-slate-900"
              >
                <option value={5}>最新 5世代まで保持</option>
                <option value={10}>最新 10世代まで保持 (推奨)</option>
                <option value={20}>最新 20世代まで保持</option>
              </select>
            </div>
          </div>

          {autoBackupSnapshots.length === 0 ? (
            <div className="p-4 rounded-2xl glass-subtle text-center text-xs text-slate-500 dark:text-slate-400">
              まだバックアップ履歴がありません。上の「今すぐバックアップを作成」またはアカウント追加時に自動保存されます。
            </div>
          ) : (
            <div
              data-testid="auto-backup-list"
              className="space-y-2 max-h-64 overflow-y-auto pr-1"
            >
              {autoBackupSnapshots.map((snap) => {
                const reasonLabel =
                  snap.reason === 'auto-change'
                    ? '変更時自動'
                    : snap.reason === 'auto-schedule'
                    ? '定期自動'
                    : '手動作成';
                const formattedDate = new Date(snap.createdAt).toLocaleString('ja-JP', {
                  month: '2-digit',
                  day: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                });
                const isConfirmingRestore = confirmRestoreId === snap.id;
                const isRestoring = restoringId === snap.id;

                return (
                  <div
                    key={snap.id}
                    className="p-3 rounded-xl glass-subtle flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Clock className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" aria-hidden="true" />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono font-semibold text-slate-900 dark:text-white tabular-nums">
                            {formattedDate}
                          </span>
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-700 dark:text-blue-300 font-medium">
                            {reasonLabel}
                          </span>
                          <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                            Rev.{snap.revision} · {snap.accountCount}件 · {(snap.bytes / 1024).toFixed(1)} KB
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleDownloadSnapshot(snap)}
                        className="px-2.5 py-1.5 text-[11px] font-medium rounded-lg glass-btn text-slate-700 dark:text-slate-200 inline-flex items-center gap-1"
                      >
                        <Download className="w-3 h-3" aria-hidden="true" />
                        JSON保存
                      </button>

                      {isConfirmingRestore ? (
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            disabled={isRestoring}
                            onClick={async () => {
                              setRestoringId(snap.id);
                              try {
                                await onRestoreBackupSnapshot(snap);
                                setConfirmRestoreId(null);
                              } finally {
                                setRestoringId(null);
                              }
                            }}
                            className="px-2.5 py-1.5 text-[11px] font-semibold rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-70"
                          >
                            {isRestoring ? '復元中...' : 'この時点へ復元'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmRestoreId(null)}
                            className="px-2 py-1.5 text-[11px] rounded-lg glass-btn text-slate-600 dark:text-slate-300"
                          >
                            中止
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmRestoreId(snap.id)}
                          className="px-2.5 py-1.5 text-[11px] font-medium rounded-lg glass-btn text-slate-700 dark:text-slate-200 inline-flex items-center gap-1"
                        >
                          <RotateCcw className="w-3 h-3" aria-hidden="true" />
                          復元
                        </button>
                      )}

                      <button
                        type="button"
                        aria-label="このバックアップを削除"
                        onClick={() => void onDeleteBackupSnapshot(snap.id)}
                        className="p-1.5 rounded-lg glass-btn text-slate-500 hover:text-red-600 dark:hover:text-red-400"
                      >
                        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 320, damping: 26, delay: 0.08 }}
          className="glass-surface rounded-2xl p-6 space-y-4"
        >
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
            バックアップのエクスポート
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            暗号化バックアップ (.kagivault.json) はマスターパスフレーズで暗号化されたまま出力されるため、USBメモリやクラウドストレージに安全に保管できます。
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <motion.button
              type="button"
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.96 }}
              onClick={handleDownloadEncryptedBackup}
              className="px-4 py-2 text-xs font-semibold rounded-xl glass-primary-btn inline-flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              暗号化バックアップを保存 (.json)
            </motion.button>

            <AnimatePresence mode="wait">
              {!plainExportConfirm ? (
                <motion.button
                  key="plain-btn"
                  type="button"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.96 }}
                  onClick={() => setPlainExportConfirm(true)}
                  className="px-3 py-2 text-xs font-medium rounded-xl glass-btn text-slate-700 dark:text-slate-200"
                >
                  他アプリ移行用 URI 出力
                </motion.button>
              ) : (
                <motion.div
                  key="plain-confirm"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="w-full p-3 rounded-xl border border-amber-400/45 bg-amber-500/12 backdrop-blur-sm space-y-2"
                >
                  <p className="text-xs text-amber-900 dark:text-amber-200">
                    注意: otpauth URIリストは暗号化されていないシークレットを含みます。出力しますか？
                  </p>
                  <div className="flex items-center gap-2">
                    <motion.button
                      type="button"
                      whileHover={{ scale: 1.03 }}
                      whileTap={{ scale: 0.96 }}
                      onClick={handleDownloadPlaintextUris}
                      className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-600 text-white hover:bg-amber-700"
                    >
                      理解してダウンロード
                    </motion.button>
                    <button
                      type="button"
                      onClick={() => setPlainExportConfirm(false)}
                      className="px-3 py-1.5 text-xs font-medium rounded-lg glass-btn text-slate-700 dark:text-slate-200"
                    >
                      キャンセル
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 320, damping: 26, delay: 0.1 }}
          className="glass-surface rounded-2xl p-6 space-y-4"
        >
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
            端末の信頼設定と自動ロック
          </h2>

          {googleUser && (
            <label className="flex items-start gap-2.5 cursor-pointer select-none pb-3 border-b border-slate-900/8 dark:border-white/10">
              <input
                type="checkbox"
                checked={trustDevice}
                onChange={(e) => void onToggleTrustDevice(e.target.checked)}
                className="mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
              />
              <span className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                このブラウザを信頼済み端末として記憶する（非抽出型CryptoKeyをIndexedDBに保存し、再読込時の自動解除を許可）
              </span>
            </label>
          )}

          <div>
            <label
              htmlFor="autolock-select"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
            >
              自動ロックまでの時間
            </label>
            <select
              id="autolock-select"
              value={vault.autoLockMinutes}
              onChange={(e) => void onChangeAutoLock(Number(e.target.value))}
              className="w-full px-3 py-2 text-sm rounded-xl glass-input text-slate-900 dark:text-slate-100 [&_option]:bg-white dark:[&_option]:bg-slate-900"
            >
              <option value={1}>1分 (高セキュリティ)</option>
              <option value={5}>5分</option>
              <option value={15}>15分 (推奨・標準)</option>
              <option value={30}>30分</option>
              <option value={60}>60分</option>
              <option value={0}>無効 (手動ロックのみ)</option>
            </select>
          </div>

          <div className="pt-3 border-t border-slate-900/8 dark:border-white/10 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5 min-w-0">
                <ScanFace className="w-4 h-4 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" aria-hidden="true" />
                <div>
                  <h3 className="text-xs font-bold text-slate-900 dark:text-white">
                    Webカメラ顔認証ロック解除（ブラウザ内AI認識）
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
                    {isFaceEnrolled
                      ? '登録済み — 端末OS（Windows Hello / Face ID）に依存せず、Web内のカメラ顔認識だけで再解除できます。'
                      : '端末OSの生体認証を使わず、Webブラウザ内のAI顔認識（128次元特徴ベクトル照合）でロック解除できるよう登録します。'}
                  </p>
                </div>
              </div>
              <span
                className={`text-[11px] font-semibold whitespace-nowrap shrink-0 ${
                  isFaceEnrolled
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                {isFaceEnrolled ? '登録済み' : '未登録'}
              </span>
            </div>

            {!cameraCapabilities.supported ? (
              <p className="text-[11px] text-amber-700 dark:text-amber-300">
                現在のブラウザはカメラ API (getUserMedia) に対応していません。
              </p>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <motion.button
                  type="button"
                  data-testid="enroll-biometric-settings-btn"
                  disabled={faceRemoving}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={onOpenFaceEnroll}
                  className="px-3.5 py-2 text-xs font-semibold rounded-xl glass-primary-btn disabled:opacity-70 inline-flex items-center gap-1.5 whitespace-nowrap"
                >
                  <ScanFace className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{isFaceEnrolled ? 'Web顔認証を再登録する' : 'Web顔認証を登録する'}</span>
                </motion.button>

                {isFaceEnrolled && (
                  <motion.button
                    type="button"
                    data-testid="remove-biometric-settings-btn"
                    disabled={faceRemoving}
                    whileHover={{ scale: faceRemoving ? 1 : 1.02 }}
                    whileTap={{ scale: faceRemoving ? 1 : 0.97 }}
                    onClick={async () => {
                      setFaceRemoving(true);
                      try {
                        await onRemoveFaceAuth();
                      } finally {
                        setFaceRemoving(false);
                      }
                    }}
                    className="px-3 py-2 text-xs font-medium rounded-xl glass-btn text-slate-700 dark:text-slate-200 whitespace-nowrap"
                  >
                    登録を解除
                  </motion.button>
                )}
              </div>
            )}

            <div className="pt-2 border-t border-slate-900/8 dark:border-white/10 flex items-center justify-between gap-3 flex-wrap">
              <div>
                <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                  PWA（オフライン対応アプリ化）
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  端末へインストールするとオフライン時もTOTP生成とWeb顔認証を利用できます
                </p>
              </div>
              <PWAInstallButton
                compact
                onInstalled={() => onToast?.('KagiVault をPWAとしてインストールしました', 'success')}
              />
            </div>
          </div>
        </motion.section>
      </div>

      {/* Passphrase Rotation */}
      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 26, delay: 0.14 }}
        className="glass-surface rounded-2xl p-6 space-y-4"
      >
        <div className="flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-blue-600 dark:text-blue-400" aria-hidden="true" />
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
            マスターパスフレーズの変更 (鍵の再暗号化)
          </h2>
        </div>

        <form onSubmit={handlePassphraseSubmit} className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
          <div>
            <label
              htmlFor="current-pass-change"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
            >
              現在のパスフレーズ
            </label>
            <input
              id="current-pass-change"
              type="password"
              value={currentPass}
              onChange={(e) => setCurrentPass(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-xl glass-input text-slate-900 dark:text-slate-100"
              required
            />
          </div>

          <div>
            <label
              htmlFor="new-pass-change"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
            >
              新しいパスフレーズ ({newStrength.label})
            </label>
            <input
              id="new-pass-change"
              type="password"
              value={newPass}
              onChange={(e) => setNewPass(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-xl glass-input text-slate-900 dark:text-slate-100"
              required
            />
          </div>

          <div>
            <label
              htmlFor="confirm-pass-change"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
            >
              新しいパスフレーズ (確認)
            </label>
            <input
              id="confirm-pass-change"
              type="password"
              value={confirmNewPass}
              onChange={(e) => setConfirmNewPass(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-xl glass-input text-slate-900 dark:text-slate-100"
              required
            />
          </div>

          <div className="md:col-span-3 flex items-center justify-between gap-4 flex-wrap">
            <div className="text-xs">
              {passError && <span className="text-red-600 dark:text-red-400">{passError}</span>}
              {passMessage && (
                <span className="text-emerald-700 dark:text-emerald-400">{passMessage}</span>
              )}
            </div>
            <motion.button
              type="submit"
              disabled={changingPass}
              whileHover={{ scale: changingPass ? 1 : 1.03 }}
              whileTap={{ scale: changingPass ? 1 : 0.96 }}
              className="px-4 py-2 text-xs font-semibold rounded-xl glass-primary-btn disabled:opacity-70 inline-flex items-center gap-2"
            >
              {changingPass && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
              {changingPass
                ? 'PBKDF2 鍵再導出・再暗号化中...'
                : 'パスフレーズを変更して再暗号化'}
            </motion.button>
          </div>
        </form>
      </motion.section>

      {/* Danger Zone */}
      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 26, delay: 0.18 }}
        className="glass-surface border-red-400/45 bg-red-500/8 rounded-2xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
      >
        <div>
          <h2 className="text-sm font-bold text-red-700 dark:text-red-400">
            このボルトを完全に削除
          </h2>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
            クラウド・サーバー・Cookieから暗号化データを完全に削除します。この操作は取り消せません。
          </p>
        </div>

        <AnimatePresence mode="wait">
          {!confirmDelete ? (
            <motion.button
              key="del-init"
              type="button"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.96 }}
              onClick={() => setConfirmDelete(true)}
              className="px-4 py-2 text-xs font-semibold rounded-xl border border-red-400/55 bg-red-500/10 text-red-700 dark:text-red-300 hover:bg-red-500/20 inline-flex items-center gap-1.5 self-start whitespace-nowrap"
            >
              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
              ボルトを削除
            </motion.button>
          ) : (
            <motion.div
              key="del-confirm"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="flex items-center gap-2 shrink-0"
            >
              <motion.button
                type="button"
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.96 }}
                onClick={() => void onDeleteVault()}
                className="px-4 py-2 text-xs font-semibold rounded-xl bg-red-600 hover:bg-red-700 text-white"
              >
                削除を確定する
              </motion.button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="px-3 py-2 text-xs font-medium rounded-xl glass-btn text-slate-700 dark:text-slate-200"
              >
                中止
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.section>
    </div>
  );
};
