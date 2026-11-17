import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowLeft,
  CheckCircle2,
  Cloud,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Lock,
  ScanFace,
  ShieldCheck,
  SkipForward,
} from 'lucide-react';
import type { StorageMode, VaultSummary } from '../types/vault';
import { resolveStorageModeForVault } from '../utils/startupUnlockTarget';

export type StartupPhase =
  | 'checking-auth'
  | 'fetching-vaults'
  | 'decrypting-vault'
  | 'signing-in'
  | 'choose-unlock'
  | 'idle';

export type StartupUnlockReason = 'auto-expired' | 'locked' | 'saved-session' | null;

interface StartupLoadingModalProps {
  phase: StartupPhase;
  statusDetail?: string;
  availableVaults?: VaultSummary[];
  initialVaultId?: string | null;
  faceEnrolledVaultIds?: string[];
  cameraSupported?: boolean;
  unlockReason?: StartupUnlockReason;
  lockNotice?: string | null;
  initialSubView?: 'select' | 'password';
  onSkipWait: () => void;
  onChooseFaceUnlock?: (vaultId: string, storageMode: StorageMode) => void;
  onSubmitPasswordUnlock?: (params: {
    vaultId: string;
    passphrase: string;
    storageMode: StorageMode;
  }) => Promise<void>;
}

const STEPS: Array<{
  id: 'checking-auth' | 'fetching-vaults' | 'decrypting-vault';
  label: string;
  desc: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    id: 'checking-auth',
    label: '前回のGoogleログイン状態を確認',
    desc: '認証セッションとアカウント情報を照合しています',
    icon: ShieldCheck,
  },
  {
    id: 'fetching-vaults',
    label: '保存済みボルトを取得',
    desc: 'Firestoreクラウド・ローカルサーバー・Cookieを確認しています',
    icon: Cloud,
  },
  {
    id: 'decrypting-vault',
    label: '信頼済みブラウザ鍵で自動復号',
    desc: 'Web Crypto API (AES-256-GCM) でボルトを安全に復号しています',
    icon: KeyRound,
  },
];

const PHASE_ORDER: Record<StartupPhase, number> = {
  'checking-auth': 0,
  'fetching-vaults': 1,
  'decrypting-vault': 2,
  'signing-in': 0,
  'choose-unlock': 3,
  idle: 3,
};

function formatSourceBadge(source: VaultSummary['source']): string {
  switch (source) {
    case 'cloud':
      return 'クラウド';
    case 'both':
      return 'サーバー + Cookie';
    case 'server':
      return 'ローカルサーバー';
    case 'cookie':
      return '暗号化Cookie';
  }
}

export const StartupLoadingModal: React.FC<StartupLoadingModalProps> = ({
  phase,
  statusDetail,
  availableVaults = [],
  initialVaultId,
  faceEnrolledVaultIds = [],
  cameraSupported = true,
  unlockReason = null,
  lockNotice = null,
  initialSubView = 'select',
  onSkipWait,
  onChooseFaceUnlock,
  onSubmitPasswordUnlock,
}) => {
  const [showSkip, setShowSkip] = useState(false);
  const [subView, setSubView] = useState<'select' | 'password'>(initialSubView);
  const [selectedVaultId, setSelectedVaultId] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [unlocking, setUnlocking] = useState<boolean>(false);
  const [unlockError, setUnlockError] = useState<string>('');

  // Reset choose-unlock subview and pick best default vault when popup enters choose-unlock
  useEffect(() => {
    if (phase === 'idle') {
      setShowSkip(false);
      setPassword('');
      setUnlockError('');
      setUnlocking(false);
      setSubView(initialSubView);
      return;
    }

    if (phase === 'choose-unlock') {
      setShowSkip(false);
      setSubView(initialSubView);
      setPassword('');
      setUnlockError('');
      setUnlocking(false);

      const preferred =
        initialVaultId && availableVaults.some((v) => v.vaultId === initialVaultId)
          ? initialVaultId
          : availableVaults.find((v) => faceEnrolledVaultIds.includes(v.vaultId))?.vaultId ??
            availableVaults[0]?.vaultId ??
            initialVaultId ??
            '';
      setSelectedVaultId(preferred);
      return;
    }

    const timer = window.setTimeout(() => {
      setShowSkip(true);
    }, 5500);
    return () => window.clearTimeout(timer);
  }, [phase, availableVaults, initialVaultId, faceEnrolledVaultIds, initialSubView]);

  const selectedSummary = useMemo(
    () => availableVaults.find((v) => v.vaultId === selectedVaultId) ?? availableVaults[0],
    [availableVaults, selectedVaultId]
  );

  const effectiveVaultId = selectedSummary?.vaultId || selectedVaultId || initialVaultId || '';
  const effectiveStorageMode = resolveStorageModeForVault(selectedSummary);
  const isFaceEnrolled =
    Boolean(effectiveVaultId) && faceEnrolledVaultIds.includes(effectiveVaultId);

  const currentIdx = PHASE_ORDER[phase];
  const isSigningIn = phase === 'signing-in';
  const isChooseUnlock = phase === 'choose-unlock';

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!effectiveVaultId) {
      setUnlockError('解除するボルトを選択してください。');
      return;
    }
    if (!password) {
      setUnlockError('マスターパスフレーズを入力してください。');
      return;
    }
    setUnlockError('');
    setUnlocking(true);
    try {
      await onSubmitPasswordUnlock?.({
        vaultId: effectiveVaultId,
        passphrase: password,
        storageMode: effectiveStorageMode,
      });
      setPassword('');
    } catch (err) {
      setUnlockError(
        err instanceof Error
          ? err.message
          : 'パスフレーズが正しくないか、復号に失敗しました。'
      );
    } finally {
      setUnlocking(false);
    }
  };

  return (
    <AnimatePresence>
      {phase !== 'idle' && (
        <motion.div
          key="startup-loading-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="startup-loading-title"
          data-testid="startup-modal"
          data-phase={phase}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22 }}
          className="fixed inset-0 z-[65] bg-slate-950/40 backdrop-blur-md flex items-center justify-center p-4"
        >
          <motion.div
            key="startup-loading-card"
            initial={{ opacity: 0, scale: 0.88, y: 24 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: -16 }}
            transition={{ type: 'spring', stiffness: 360, damping: 26 }}
            className="w-full max-w-md glass-modal rounded-[26px] p-6 space-y-4"
          >
            {/* Header */}
            <div className="flex items-center gap-3.5">
              {isChooseUnlock ? (
                <div className="w-11 h-11 rounded-2xl glass-primary-btn flex items-center justify-center shrink-0">
                  <Lock className="w-5 h-5 text-white" aria-hidden="true" />
                </div>
              ) : (
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ repeat: Infinity, duration: 1.4, ease: 'linear' }}
                  className="w-11 h-11 rounded-2xl glass-subtle border border-blue-400/40 flex items-center justify-center shrink-0"
                >
                  <Loader2 className="w-5 h-5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
                </motion.div>
              )}

              <div className="min-w-0">
                <h2
                  id="startup-loading-title"
                  className="text-base font-bold text-slate-900 dark:text-white"
                >
                  {isChooseUnlock
                    ? unlockReason === 'auto-expired'
                      ? '自動ロック中 — 認証方法を選択'
                      : 'ロック解除方法を選択'
                    : isSigningIn
                    ? 'Googleアカウントでログイン中...'
                    : '前回のログイン情報を読み込み中...'}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">
                  {isChooseUnlock
                    ? 'Webカメラ顔認証またはパスワードでボルトを復号します'
                    : statusDetail || '安全にデータを読み込んでいます。しばらくお待ちください。'}
                </p>
              </div>
            </div>

            {isChooseUnlock ? (
              <div className="space-y-3.5">
                {lockNotice && (
                  <div
                    role="status"
                    className="p-3 rounded-2xl border border-amber-400/45 bg-amber-500/12 text-xs text-amber-900 dark:text-amber-200 leading-relaxed"
                  >
                    {lockNotice}
                  </div>
                )}

                {/* Target Vault Selector / Display */}
                {availableVaults.length > 0 && (
                  <div className="p-3 rounded-2xl glass-subtle flex items-center justify-between gap-3">
                    <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 shrink-0">
                      対象ボルト
                    </span>
                    {availableVaults.length > 1 ? (
                      <select
                        aria-label="解除するボルトを選択"
                        value={effectiveVaultId}
                        onChange={(e) => {
                          setSelectedVaultId(e.target.value);
                          setUnlockError('');
                        }}
                        className="text-xs font-mono font-semibold rounded-xl glass-input px-2.5 py-1.5 text-slate-900 dark:text-slate-100 min-w-0 max-w-[190px] sm:max-w-[230px] [&_option]:bg-white dark:[&_option]:bg-slate-900"
                      >
                        {availableVaults.map((v) => (
                          <option key={v.vaultId} value={v.vaultId}>
                            {v.vaultId} ({formatSourceBadge(v.source)})
                          </option>
                        ))}
                      </select>
                    ) : (
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-xs font-mono font-semibold text-slate-900 dark:text-white truncate">
                          {effectiveVaultId}
                        </span>
                        {selectedSummary && (
                          <>
                            <span aria-hidden="true" className="text-slate-400">·</span>
                            <span className="text-[11px] text-slate-500 dark:text-slate-400 shrink-0">
                              {formatSourceBadge(selectedSummary.source)}
                            </span>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <AnimatePresence mode="wait">
                  {subView === 'select' ? (
                    <motion.div
                      key="choose-method-select"
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      transition={{ duration: 0.16 }}
                      className="space-y-2.5"
                    >
                      {/* Choice 1: Web Camera Face Auth */}
                      <motion.button
                        type="button"
                        data-testid="startup-choose-face-btn"
                        disabled={!isFaceEnrolled || !cameraSupported}
                        whileHover={isFaceEnrolled && cameraSupported ? { scale: 1.02 } : undefined}
                        whileTap={isFaceEnrolled && cameraSupported ? { scale: 0.97 } : undefined}
                        onClick={() =>
                          onChooseFaceUnlock?.(effectiveVaultId, effectiveStorageMode)
                        }
                        className={`w-full p-3.5 rounded-2xl text-left flex items-center gap-3 transition-all ${
                          isFaceEnrolled && cameraSupported
                            ? 'glass-primary-btn text-white shadow-md'
                            : 'glass-subtle opacity-60 cursor-not-allowed text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        <div
                          className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                            isFaceEnrolled && cameraSupported
                              ? 'bg-white/20'
                              : 'bg-slate-900/10 dark:bg-white/10'
                          }`}
                        >
                          <ScanFace className="w-5 h-5" aria-hidden="true" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-bold">
                              Webカメラ顔認証で解除
                            </span>
                            <span
                              className={`text-[11px] font-semibold shrink-0 ${
                                isFaceEnrolled && cameraSupported
                                  ? 'text-blue-100'
                                  : 'text-slate-500 dark:text-slate-400'
                              }`}
                            >
                              {!cameraSupported
                                ? 'カメラ非対応'
                                : isFaceEnrolled
                                ? '登録済み'
                                : '未登録'}
                            </span>
                          </div>
                          <p
                            className={`text-[11px] mt-0.5 leading-snug ${
                              isFaceEnrolled && cameraSupported
                                ? 'text-blue-100'
                                : 'text-slate-500 dark:text-slate-400'
                            }`}
                          >
                            {isFaceEnrolled
                              ? '端末OSに依存しないブラウザ内AI顔認識で即座に復号します'
                              : 'パスワードで解除後に「Web顔認証」を登録すると利用できます'}
                          </p>
                        </div>
                      </motion.button>

                      {/* Choice 2: Master Password */}
                      <motion.button
                        type="button"
                        data-testid="startup-choose-password-btn"
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.97 }}
                        onClick={() => {
                          setUnlockError('');
                          setSubView('password');
                        }}
                        className="w-full p-3.5 rounded-2xl glass-btn text-left flex items-center gap-3 text-slate-900 dark:text-slate-100"
                      >
                        <div className="w-9 h-9 rounded-xl bg-blue-600/12 dark:bg-blue-400/15 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                          <KeyRound className="w-5 h-5" aria-hidden="true" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <span className="block text-sm font-bold">
                            パスワード（パスフレーズ）で解除
                          </span>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">
                            マスターパスフレーズを入力してこのポップアップから直接解除します
                          </p>
                        </div>
                      </motion.button>
                    </motion.div>
                  ) : (
                    <motion.form
                      key="choose-method-password"
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      transition={{ duration: 0.16 }}
                      onSubmit={(e) => void handlePasswordSubmit(e)}
                      className="space-y-3"
                    >
                      <div className="flex items-center justify-between">
                        <button
                          type="button"
                          onClick={() => {
                            setSubView('select');
                            setUnlockError('');
                          }}
                          className="text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white inline-flex items-center gap-1"
                        >
                          <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
                          選択に戻る
                        </button>
                        {isFaceEnrolled && cameraSupported && (
                          <button
                            type="button"
                            onClick={() =>
                              onChooseFaceUnlock?.(effectiveVaultId, effectiveStorageMode)
                            }
                            className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
                          >
                            <ScanFace className="w-3.5 h-3.5" aria-hidden="true" />
                            顔認証に切替
                          </button>
                        )}
                      </div>

                      <div>
                        <label
                          htmlFor="startup-passphrase-input"
                          className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                        >
                          マスターパスフレーズ
                        </label>
                        <div className="relative">
                          <input
                            id="startup-passphrase-input"
                            data-testid="startup-password-input"
                            type={showPassword ? 'text' : 'password'}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="マスターパスフレーズを入力"
                            autoComplete="current-password"
                            autoFocus
                            className="w-full pl-3 pr-10 py-2.5 text-sm rounded-xl glass-input text-slate-900 dark:text-slate-100"
                            required
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword((v) => !v)}
                            aria-label={showPassword ? 'パスフレーズを隠す' : 'パスフレーズを表示'}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                          >
                            {showPassword ? (
                              <EyeOff className="w-4 h-4" aria-hidden="true" />
                            ) : (
                              <Eye className="w-4 h-4" aria-hidden="true" />
                            )}
                          </button>
                        </div>
                      </div>

                      <AnimatePresence>
                        {unlockError && (
                          <motion.div
                            role="alert"
                            initial={{ opacity: 0, x: -6 }}
                            animate={{ opacity: 1, x: [0, -4, 4, -2, 0] }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.28 }}
                            className="p-2.5 rounded-xl border border-red-400/40 bg-red-500/12 text-xs text-red-700 dark:text-red-300"
                          >
                            {unlockError}
                          </motion.div>
                        )}
                      </AnimatePresence>

                      <motion.button
                        type="submit"
                        data-testid="startup-password-submit-btn"
                        disabled={unlocking}
                        whileHover={{ scale: unlocking ? 1 : 1.02 }}
                        whileTap={{ scale: unlocking ? 1 : 0.97 }}
                        className="w-full py-2.5 px-4 rounded-xl glass-primary-btn disabled:opacity-70 text-sm font-semibold inline-flex items-center justify-center gap-2"
                      >
                        {unlocking ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                            <span>PBKDF2 鍵導出・復号中...</span>
                          </>
                        ) : (
                          <>
                            <Lock className="w-4 h-4" aria-hidden="true" />
                            <span>ロックを解除</span>
                          </>
                        )}
                      </motion.button>
                    </motion.form>
                  )}
                </AnimatePresence>

                <div className="pt-2 border-t border-slate-900/10 dark:border-white/10 flex items-center justify-between gap-2">
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    新規作成・バックアップ復元など
                  </span>
                  <button
                    type="button"
                    data-testid="startup-dismiss-btn"
                    onClick={onSkipWait}
                    className="text-xs font-semibold text-slate-700 dark:text-slate-200 hover:text-blue-600 dark:hover:text-blue-400 inline-flex items-center gap-1"
                  >
                    詳細画面を開く
                  </button>
                </div>
              </div>
            ) : !isSigningIn ? (
              <>
                <div className="space-y-2.5">
                  {STEPS.map((step, index) => {
                    const Icon = step.icon;
                    const isDone = currentIdx > index;
                    const isActive = currentIdx === index;
                    return (
                      <motion.div
                        key={step.id}
                        initial={false}
                        animate={{
                          scale: isActive ? 1.02 : 1,
                          opacity: isDone || isActive ? 1 : 0.55,
                        }}
                        transition={{ type: 'spring', stiffness: 380, damping: 28 }}
                        className={`flex items-start gap-3 p-3 rounded-2xl border transition-colors ${
                          isActive
                            ? 'border-blue-500/60 bg-blue-500/10 dark:bg-blue-500/15 dark:border-blue-400/45'
                            : isDone
                            ? 'border-emerald-500/40 bg-emerald-500/10 dark:bg-emerald-500/15'
                            : 'glass-subtle'
                        }`}
                      >
                        <div className="mt-0.5 shrink-0">
                          {isDone ? (
                            <motion.div
                              initial={{ scale: 0.5, opacity: 0 }}
                              animate={{ scale: 1, opacity: 1 }}
                              transition={{ type: 'spring', stiffness: 450, damping: 20 }}
                            >
                              <CheckCircle2
                                className="w-4 h-4 text-emerald-600 dark:text-emerald-400"
                                aria-hidden="true"
                              />
                            </motion.div>
                          ) : isActive ? (
                            <Loader2
                              className="w-4 h-4 text-blue-600 dark:text-blue-400 animate-spin"
                              aria-hidden="true"
                            />
                          ) : (
                            <Icon
                              className="w-4 h-4 text-slate-400 dark:text-slate-500"
                              aria-hidden="true"
                            />
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                            {step.label}
                          </p>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
                            {step.desc}
                          </p>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>

                {/* Animated progress bar */}
                <div className="h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                  <motion.div
                    className="h-full bg-blue-600 dark:bg-blue-500 rounded-full"
                    initial={{ width: '15%' }}
                    animate={{
                      width:
                        phase === 'checking-auth'
                          ? '35%'
                          : phase === 'fetching-vaults'
                          ? '70%'
                          : '94%',
                    }}
                    transition={{ type: 'spring', stiffness: 180, damping: 24 }}
                  />
                </div>
              </>
            ) : (
              <>
                <div className="p-4 rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50/60 dark:bg-blue-950/30 text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                  Google認証ポップアップでアカウントを選択後、暗号化ボルトの一覧と信頼済み鍵の照合を自動的に開始します。
                </div>
                <div className="h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                  <motion.div
                    className="h-full bg-blue-600 dark:bg-blue-500 rounded-full"
                    initial={{ width: '25%' }}
                    animate={{ width: '60%' }}
                    transition={{ type: 'spring', stiffness: 180, damping: 24 }}
                  />
                </div>
              </>
            )}

            <AnimatePresence>
              {!isChooseUnlock && showSkip && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, transition: { duration: 0.08 } }}
                  className="pt-1 flex items-center justify-between gap-3 border-t border-slate-100 dark:border-slate-800"
                >
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    通信に時間がかかっています
                  </span>
                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.96 }}
                    onClick={onSkipWait}
                    className="glass-btn px-3.5 py-1.5 text-xs font-semibold rounded-xl text-slate-700 dark:text-slate-100 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                  >
                    <SkipForward className="w-3.5 h-3.5" aria-hidden="true" />
                    スキップして手動操作へ
                  </motion.button>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
