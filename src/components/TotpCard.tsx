import React, { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Check,
  Copy,
  Edit3,
  ExternalLink,
  Key,
  QrCode,
  Star,
  Trash2,
  Zap,
} from 'lucide-react';
import { formatOtpCode, type TotpResult } from '../crypto/totp';
import type { TotpAccount } from '../types/vault';
import {
  broadcastAutofillOtp,
  extractDomainLabel,
  inferServiceLoginUrl,
} from '../utils/autofillBridge';
import type { ToastTone } from './BottomToastHost';

interface TotpCardProps {
  account: TotpAccount;
  totp: TotpResult | undefined;
  index?: number;
  onToggleFavorite: (id: string) => void;
  onEdit: (account: TotpAccount) => void;
  onDelete: (account: TotpAccount) => void;
  onShowQr: (account: TotpAccount) => void;
  onShowRecovery: (account: TotpAccount) => void;
  onToast?: (message: string, tone?: ToastTone) => void;
}

export const TotpCard: React.FC<TotpCardProps> = ({
  account,
  totp,
  index = 0,
  onToggleFavorite,
  onEdit,
  onDelete,
  onShowQr,
  onShowRecovery,
  onToast,
}) => {
  const [copied, setCopied] = useState(false);
  const [autofillReady, setAutofillReady] = useState(false);

  const resolvedLoginUrl = inferServiceLoginUrl(account.issuer, account.loginUrl);
  const serviceDomain = extractDomainLabel(resolvedLoginUrl);

  const remaining = totp?.remainingSeconds ?? account.period;
  const period = totp?.period ?? account.period;
  const progress = Math.max(0, Math.min(1, remaining / period));
  const isExpiring = remaining <= 5;
  const isWarning = remaining <= 10 && remaining > 5;

  const radius = 14;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - progress);

  const ringColor = isExpiring
    ? 'stroke-red-600 dark:stroke-red-500'
    : isWarning
    ? 'stroke-amber-500 dark:stroke-amber-400'
    : 'stroke-blue-600 dark:stroke-blue-400';

  const codeColor = isExpiring
    ? 'text-red-600 dark:text-red-400'
    : 'text-slate-900 dark:text-white';

  const handleCopy = async () => {
    if (!totp?.code) return;
    try {
      await navigator.clipboard.writeText(totp.code);
    } catch {
      const el = document.createElement('textarea');
      el.value = totp.code;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    }
    setCopied(true);
    onToast?.(`${account.issuer} のコード (${formatOtpCode(totp.code)}) をコピーしました`, 'success');
    window.setTimeout(() => setCopied(false), 1800);
  };

  const handleOneTapAutofill = async (openedLogin = false) => {
    if (!totp?.code) return;
    await broadcastAutofillOtp({
      accountId: account.id,
      issuer: account.issuer,
      label: account.label,
      code: totp.code,
      loginUrl: resolvedLoginUrl ?? undefined,
    });
    setAutofillReady(true);
    onToast?.(
      openedLogin
        ? `${account.issuer} を開き、コード (${formatOtpCode(totp.code)}) を自動入力バッファへ送信しました`
        : `${account.issuer} のコード (${formatOtpCode(totp.code)}) をワンタップ自動入力へ送信しました`,
      'success'
    );
    window.setTimeout(() => setAutofillReady(false), 2000);
  };

  const unusedRecoveryCount =
    account.recoveryCodes?.filter((c) => !c.used).length ?? 0;

  return (
    <motion.article
      layout
      data-testid={`totp-card-${account.id}`}
      initial={{ opacity: 0, y: 22, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9, y: -12 }}
      whileHover={{ y: -4, scale: 1.012 }}
      transition={{
        type: 'spring',
        stiffness: 360,
        damping: 25,
        delay: Math.min(index * 0.04, 0.24),
      }}
      className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex flex-col justify-between gap-4 hover:border-blue-300 dark:hover:border-blue-800 hover:shadow-md transition-colors"
    >
      {/* Header Row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <motion.div
            aria-hidden="true"
            whileHover={{ rotate: [0, -6, 6, 0] }}
            transition={{ duration: 0.35 }}
            className="w-10 h-10 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-sm font-bold text-slate-700 dark:text-slate-200 shrink-0"
          >
            {account.issuer.slice(0, 2).toUpperCase()}
          </motion.div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white truncate">
              {account.issuer}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
              {account.label}
            </p>
          </div>
        </div>

        <motion.button
          type="button"
          whileHover={{ scale: 1.16 }}
          whileTap={{ scale: 0.85 }}
          onClick={() => onToggleFavorite(account.id)}
          aria-label={
            account.favorite
              ? `${account.issuer} (${account.label}) をお気に入りから解除`
              : `${account.issuer} (${account.label}) をお気に入りに追加`
          }
          aria-pressed={account.favorite}
          className="p-2 rounded-lg text-slate-400 hover:text-amber-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
        >
          <motion.div
            animate={
              account.favorite
                ? { scale: [1, 1.38, 1], rotate: [0, -14, 10, 0] }
                : { scale: 1, rotate: 0 }
            }
            transition={{ duration: 0.35 }}
          >
            <Star
              className={`w-4 h-4 ${
                account.favorite ? 'fill-amber-400 text-amber-500' : ''
              }`}
              aria-hidden="true"
            />
          </motion.div>
        </motion.button>
      </div>

      {/* Live Code & Countdown Ring */}
      <div className="flex items-center justify-between gap-3 py-1">
        <motion.button
          type="button"
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => void handleCopy()}
          aria-label={`${account.issuer} のワンタイムコード ${totp?.code ?? ''} をコピー`}
          className="group text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded-lg px-2 py-1.5 -ml-2 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60"
        >
          <div className="flex items-center gap-2.5 overflow-hidden">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={totp?.code ?? 'empty'}
                initial={{ opacity: 0, y: 12, scale: 0.94 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -12, scale: 0.94 }}
                transition={{ type: 'spring', stiffness: 420, damping: 26 }}
                className={`inline-block font-mono text-2xl sm:text-3xl font-bold tracking-wider tabular-nums ${codeColor}`}
              >
                {totp ? formatOtpCode(totp.code) : '--- ---'}
              </motion.span>
            </AnimatePresence>

            <AnimatePresence mode="wait" initial={false}>
              {copied ? (
                <motion.span
                  key="copied"
                  initial={{ opacity: 0, scale: 0.7, x: -4 }}
                  animate={{ opacity: 1, scale: 1, x: 0 }}
                  exit={{ opacity: 0, scale: 0.7 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 24 }}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400"
                >
                  <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                  <span>コピー済み</span>
                </motion.span>
              ) : (
                <motion.span
                  key="copy"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  className="inline-flex items-center text-slate-500 dark:text-slate-400 group-hover:text-blue-600 dark:group-hover:text-blue-400"
                >
                  <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                </motion.span>
              )}
            </AnimatePresence>
          </div>
          <AnimatePresence>
            {totp && isExpiring && (
              <motion.p
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="text-[11px] font-mono text-slate-500 dark:text-slate-400 mt-1 tabular-nums"
              >
                間もなく更新 · 次: {formatOtpCode(totp.nextCode)}
              </motion.p>
            )}
          </AnimatePresence>
        </motion.button>

        <motion.div
          animate={isExpiring ? { scale: [1, 1.07, 1] } : { scale: 1 }}
          transition={{ duration: 0.4 }}
          className="relative w-10 h-10 flex items-center justify-center shrink-0"
          title={`残り ${remaining} 秒`}
        >
          <svg className="w-10 h-10 -rotate-90" viewBox="0 0 36 36" aria-hidden="true">
            <circle
              cx="18"
              cy="18"
              r={radius}
              fill="none"
              strokeWidth="3"
              className="stroke-slate-200 dark:stroke-slate-800"
            />
            <circle
              cx="18"
              cy="18"
              r={radius}
              fill="none"
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              className={`transition-[stroke-dashoffset] duration-150 ${ringColor}`}
            />
          </svg>
          <span className="absolute text-[11px] font-mono font-semibold tabular-nums text-slate-700 dark:text-slate-200">
            {remaining}
          </span>
        </motion.div>
      </div>

      {/* One-Tap Autofill Quick Bar */}
      <div className="flex items-center justify-between gap-2">
        <motion.button
          type="button"
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.96 }}
          onClick={() => void handleOneTapAutofill(false)}
          disabled={!totp?.code}
          aria-label={`${account.issuer} のコードをワンタップ自動入力`}
          className={`flex-1 px-3 py-1.5 rounded-lg border text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap ${
            autofillReady
              ? 'border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
              : 'border-blue-200 dark:border-blue-900 bg-blue-50/70 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 hover:bg-blue-100/80 dark:hover:bg-blue-950/70'
          }`}
        >
          {autofillReady ? (
            <>
              <Check className="w-3.5 h-3.5" aria-hidden="true" />
              <span>自動入力準備完了</span>
            </>
          ) : (
            <>
              <Zap className="w-3.5 h-3.5" aria-hidden="true" />
              <span>ワンタップ自動入力</span>
            </>
          )}
        </motion.button>

        {resolvedLoginUrl && (
          <motion.a
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.96 }}
            href={resolvedLoginUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => void handleOneTapAutofill(true)}
            title={serviceDomain ? `${serviceDomain} を開いて自動入力準備` : 'ログイン画面を開く'}
            aria-label={`${account.issuer} のログインページを開いてOTP準備`}
            className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center gap-1 whitespace-nowrap shrink-0 transition-colors"
          >
            <span>ログイン</span>
            <ExternalLink className="w-3 h-3" aria-hidden="true" />
          </motion.a>
        )}
      </div>

      {/* Unboxed Metadata + Actions Footer */}
      <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
        <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
          <span>{account.algorithm}</span>
          <span aria-hidden="true"> · </span>
          <span className="tabular-nums">{account.period}秒</span>
          <span aria-hidden="true"> · </span>
          <span>{account.folder || '未分類'}</span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <motion.button
            type="button"
            whileHover={{ scale: 1.12 }}
            whileTap={{ scale: 0.88 }}
            onClick={() => onShowRecovery(account)}
            aria-label={`${account.issuer} (${account.label}) のリカバリーコード`}
            title={`リカバリーコード (残り${unusedRecoveryCount}件)`}
            className="px-2 py-1.5 rounded-md text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center gap-1 transition-colors"
          >
            <Key className="w-3.5 h-3.5" aria-hidden="true" />
            <span className="tabular-nums">{unusedRecoveryCount}</span>
          </motion.button>
          <motion.button
            type="button"
            whileHover={{ scale: 1.14 }}
            whileTap={{ scale: 0.88 }}
            onClick={() => onShowQr(account)}
            aria-label={`${account.issuer} (${account.label}) のQRコードを表示`}
            title="QRコードを表示"
            className="p-1.5 rounded-md text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <QrCode className="w-3.5 h-3.5" aria-hidden="true" />
          </motion.button>
          <motion.button
            type="button"
            whileHover={{ scale: 1.14 }}
            whileTap={{ scale: 0.88 }}
            onClick={() => onEdit(account)}
            aria-label={`${account.issuer} (${account.label}) を編集`}
            title="アカウントを編集"
            className="p-1.5 rounded-md text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <Edit3 className="w-3.5 h-3.5" aria-hidden="true" />
          </motion.button>
          <motion.button
            type="button"
            whileHover={{ scale: 1.14 }}
            whileTap={{ scale: 0.88 }}
            onClick={() => onDelete(account)}
            aria-label={`${account.issuer} (${account.label}) を削除`}
            title="アカウントを削除"
            className="p-1.5 rounded-md text-slate-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
          </motion.button>
        </div>
      </div>
    </motion.article>
  );
};

