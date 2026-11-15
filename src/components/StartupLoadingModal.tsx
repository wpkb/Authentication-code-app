import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  CheckCircle2,
  Cloud,
  KeyRound,
  Loader2,
  ShieldCheck,
  SkipForward,
} from 'lucide-react';

export type StartupPhase =
  | 'checking-auth'
  | 'fetching-vaults'
  | 'decrypting-vault'
  | 'signing-in'
  | 'idle';

interface StartupLoadingModalProps {
  phase: StartupPhase;
  statusDetail?: string;
  onSkipWait: () => void;
}

const STEPS: Array<{
  id: Exclude<StartupPhase, 'idle' | 'signing-in'>;
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
  idle: 3,
};

export const StartupLoadingModal: React.FC<StartupLoadingModalProps> = ({
  phase,
  statusDetail,
  onSkipWait,
}) => {
  const [showSkip, setShowSkip] = useState(false);

  useEffect(() => {
    if (phase === 'idle') {
      setShowSkip(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setShowSkip(true);
    }, 5500);
    return () => window.clearTimeout(timer);
  }, [phase]);

  const currentIdx = PHASE_ORDER[phase];
  const isSigningIn = phase === 'signing-in';

  return (
    <AnimatePresence>
      {phase !== 'idle' && (
        <motion.div
          key="startup-loading-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="startup-loading-title"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22 }}
          className="fixed inset-0 z-[65] bg-slate-950/35 backdrop-blur-md flex items-center justify-center p-4"
        >
          <motion.div
            key="startup-loading-card"
            initial={{ opacity: 0, scale: 0.88, y: 24 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: -16 }}
            transition={{ type: 'spring', stiffness: 360, damping: 26 }}
            className="w-full max-w-md glass-modal rounded-3xl p-6 space-y-5"
          >
            <div className="flex items-center gap-3.5">
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ repeat: Infinity, duration: 1.4, ease: 'linear' }}
                className="w-11 h-11 rounded-2xl glass-subtle border border-blue-400/40 flex items-center justify-center shrink-0"
              >
                <Loader2 className="w-5 h-5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
              </motion.div>
              <div className="min-w-0">
                <h2
                  id="startup-loading-title"
                  className="text-base font-bold text-slate-900 dark:text-white"
                >
                  {isSigningIn
                    ? 'Googleアカウントでログイン中...'
                    : '前回のログイン情報を読み込み中...'}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                  {statusDetail || '安全にデータを読み込んでいます。しばらくお待ちください。'}
                </p>
              </div>
            </div>

            {!isSigningIn ? (
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
            ) : (
              <div className="p-4 rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50/60 dark:bg-blue-950/30 text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                Google認証ポップアップでアカウントを選択後、暗号化ボルトの一覧と信頼済み鍵の照合を自動的に開始します。
              </div>
            )}

            {/* Animated progress bar */}
            <div className="h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
              <motion.div
                className="h-full bg-blue-600 dark:bg-blue-500 rounded-full"
                initial={{ width: '15%' }}
                animate={{
                  width: isSigningIn
                    ? '60%'
                    : phase === 'checking-auth'
                    ? '35%'
                    : phase === 'fetching-vaults'
                    ? '70%'
                    : '94%',
                }}
                transition={{ type: 'spring', stiffness: 180, damping: 24 }}
              />
            </div>

            <AnimatePresence>
              {showSkip && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
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
