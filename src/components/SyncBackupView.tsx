import React, { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { User } from 'firebase/auth';
import {
  Cloud,
  Cookie,
  Download,
  KeyRound,
  Loader2,
  RefreshCw,
  Server,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { buildOtpAuthUri } from '../crypto/totp';
import { evaluatePassphraseStrength } from '../crypto/vaultCrypto';
import type { ServerHealthStatus } from '../storage/vaultStorage';
import type {
  EncryptedEnvelope,
  StorageMode,
  StorageSyncResult,
  VaultPayload,
} from '../types/vault';
import type { ToastTone } from './BottomToastHost';

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
  onToast,
}) => {
  const [currentPass, setCurrentPass] = useState('');
  const [newPass, setNewPass] = useState('');
  const [confirmNewPass, setConfirmNewPass] = useState('');
  const [passMessage, setPassMessage] = useState('');
  const [passError, setPassError] = useState('');
  const [changingPass, setChangingPass] = useState(false);

  const [syncing, setSyncing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [plainExportConfirm, setPlainExportConfirm] = useState(false);

  const newStrength = evaluatePassphraseStrength(newPass);

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
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5"
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
            className="px-4 py-2 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-1.5 whitespace-nowrap self-start"
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
                className={`relative p-4 rounded-xl border text-left transition-colors disabled:opacity-50 ${
                  active
                    ? 'border-blue-600 bg-blue-50/70 dark:bg-blue-950/40 dark:border-blue-500'
                    : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="sync-storage-mode-active"
                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                    className="absolute inset-0 rounded-xl border-2 border-blue-600/70 dark:border-blue-400/70 pointer-events-none"
                  />
                )}
                <p className="text-xs font-semibold text-slate-900 dark:text-white">
                  {opt.title}
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                  {opt.desc}
                </p>
              </motion.button>
            );
          })}
        </div>

        {!googleUser && (
          <div className="p-4 rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50/50 dark:bg-blue-950/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="text-xs text-slate-700 dark:text-slate-300">
              Googleアカウントでログインすると、現在のボルトをそのままクラウドへ同期できます。
            </div>
            <motion.button
              type="button"
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.96 }}
              onClick={() => void onGoogleSignIn()}
              className="px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white whitespace-nowrap self-start"
            >
              Googleでログインして同期
            </motion.button>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 pt-3 border-t border-slate-100 dark:border-slate-800 text-xs">
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

      {/* Trusted Browser & Auto Lock */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 320, damping: 26, delay: 0.06 }}
          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4"
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
              className="px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white inline-flex items-center gap-1.5"
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
                  className="px-3 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  他アプリ移行用 URI 出力
                </motion.button>
              ) : (
                <motion.div
                  key="plain-confirm"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="w-full p-3 rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 space-y-2"
                >
                  <p className="text-xs text-amber-800 dark:text-amber-200">
                    注意: otpauth URIリストは暗号化されていないシークレットを含みます。出力しますか？
                  </p>
                  <div className="flex items-center gap-2">
                    <motion.button
                      type="button"
                      whileHover={{ scale: 1.03 }}
                      whileTap={{ scale: 0.96 }}
                      onClick={handleDownloadPlaintextUris}
                      className="px-3 py-1.5 text-xs font-semibold rounded-md bg-amber-600 text-white hover:bg-amber-700"
                    >
                      理解してダウンロード
                    </motion.button>
                    <button
                      type="button"
                      onClick={() => setPlainExportConfirm(false)}
                      className="px-3 py-1.5 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700"
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
          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4"
        >
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
            端末の信頼設定と自動ロック
          </h2>

          {googleUser && (
            <label className="flex items-start gap-2.5 cursor-pointer select-none pb-3 border-b border-slate-100 dark:border-slate-800">
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
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            >
              <option value={1}>1分 (高セキュリティ)</option>
              <option value={5}>5分</option>
              <option value={15}>15分 (推奨・標準)</option>
              <option value={30}>30分</option>
              <option value={60}>60分</option>
              <option value={0}>無効 (手動ロックのみ)</option>
            </select>
          </div>
        </motion.section>
      </div>

      {/* Passphrase Rotation */}
      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 26, delay: 0.14 }}
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4"
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
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
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
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
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
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
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
              className="px-4 py-2 text-xs font-semibold rounded-lg bg-slate-900 dark:bg-blue-600 text-white hover:opacity-90 disabled:opacity-70 inline-flex items-center gap-2"
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
        className="bg-white dark:bg-slate-900 border border-red-200 dark:border-red-950 rounded-xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
      >
        <div>
          <h2 className="text-sm font-bold text-red-700 dark:text-red-400">
            このボルトを完全に削除
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
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
              className="px-4 py-2 text-xs font-semibold rounded-lg border border-red-300 dark:border-red-800 text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 inline-flex items-center gap-1.5 self-start whitespace-nowrap"
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
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-red-600 hover:bg-red-700 text-white"
              >
                削除を確定する
              </motion.button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="px-3 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700"
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
