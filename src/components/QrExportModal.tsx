import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import QRCode from 'qrcode';
import { Check, Copy, Eye, EyeOff, X } from 'lucide-react';
import { buildOtpAuthUri } from '../crypto/totp';
import type { TotpAccount } from '../types/vault';
import type { ToastTone } from './BottomToastHost';

interface QrExportModalProps {
  account: TotpAccount | null;
  onClose: () => void;
  onToast?: (message: string, tone?: ToastTone) => void;
}

export const QrExportModal: React.FC<QrExportModalProps> = ({
  account,
  onClose,
  onToast,
}) => {
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [showSecret, setShowSecret] = useState(false);
  const [copiedUri, setCopiedUri] = useState(false);

  useEffect(() => {
    setShowSecret(false);
    setCopiedUri(false);
    if (!account) {
      setQrDataUrl('');
      return;
    }
    const uri = buildOtpAuthUri(account);
    QRCode.toDataURL(uri, {
      width: 240,
      margin: 2,
      color: {
        dark: '#0f172a',
        light: '#ffffff',
      },
    })
      .then((url) => setQrDataUrl(url))
      .catch(() => setQrDataUrl(''));
  }, [account]);

  useEffect(() => {
    if (!account) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [account, onClose]);

  const handleCopyUri = async () => {
    if (!account) return;
    const uri = buildOtpAuthUri(account);
    try {
      await navigator.clipboard.writeText(uri);
      setCopiedUri(true);
      onToast?.(`${account.issuer} の移行用URIをコピーしました`, 'info');
      setTimeout(() => setCopiedUri(false), 1800);
    } catch {
      // ignore
    }
  };

  return (
    <AnimatePresence>
      {account && (
        <motion.div
          key="qr-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="qr-export-title"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
          className="fixed inset-0 z-50 bg-slate-950/35 backdrop-blur-md flex items-center justify-center p-4"
        >
          <motion.div
            key="qr-modal-panel"
            initial={{ opacity: 0, scale: 0.9, y: 24 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 16 }}
            transition={{ type: 'spring', stiffness: 380, damping: 26 }}
            className="glass-modal rounded-[26px] w-full max-w-md p-6 space-y-5"
          >
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 id="qr-export-title" className="text-base font-bold text-slate-900 dark:text-white">
                  他端末への移行用QRコード
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {account.issuer} · {account.label}
                </p>
              </div>
              <motion.button
                type="button"
                whileHover={{ scale: 1.08 }}
                whileTap={{ scale: 0.92 }}
                onClick={onClose}
                aria-label="QRモーダルを閉じる"
                className="p-1.5 rounded-xl glass-btn text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </motion.button>
            </div>

            <div className="glass-subtle flex flex-col items-center justify-center p-5 rounded-2xl">
              {qrDataUrl ? (
                <motion.img
                  initial={{ opacity: 0, scale: 0.85 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ type: 'spring', stiffness: 320, damping: 24 }}
                  src={qrDataUrl}
                  alt={`${account.issuer} の TOTP QRコード`}
                  className="w-52 h-52 rounded-lg bg-white p-2 border border-slate-200"
                />
              ) : (
                <div className="w-52 h-52 flex items-center justify-center text-xs text-slate-500">
                  QRコードを生成中...
                </div>
              )}
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-3 text-center">
                スマートフォンの認証アプリでスキャンすると、同じワンタイムコードを生成できます。
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  Base32 シークレットキー
                </span>
                <motion.button
                  type="button"
                  whileHover={{ scale: 1.04 }}
                  whileTap={{ scale: 0.94 }}
                  onClick={() => setShowSecret((v) => !v)}
                  className="text-xs text-blue-600 dark:text-blue-400 inline-flex items-center gap-1 hover:underline"
                >
                  {showSecret ? (
                    <>
                      <EyeOff className="w-3.5 h-3.5" aria-hidden="true" />
                      隠す
                    </>
                  ) : (
                    <>
                      <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                      表示する
                    </>
                  )}
                </motion.button>
              </div>
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={showSecret ? 'revealed' : 'masked'}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.15 }}
                  className="glass-subtle px-3 py-2 rounded-xl font-mono text-xs break-all select-all"
                >
                  {showSecret ? account.secret : '••••••••••••••••••••••••'}
                </motion.div>
              </AnimatePresence>
            </div>

            <div className="flex items-center justify-between gap-3 pt-1">
              <motion.button
                type="button"
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => void handleCopyUri()}
                className="glass-btn px-3.5 py-2 text-xs font-semibold rounded-xl text-slate-700 dark:text-slate-100 inline-flex items-center gap-1.5"
              >
                {copiedUri ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
                    URIをコピー済み
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                    otpauth URIをコピー
                  </>
                )}
              </motion.button>
              <motion.button
                type="button"
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.95 }}
                onClick={onClose}
                className="glass-primary-btn px-4 py-2 text-xs font-semibold rounded-xl"
              >
                閉じる
              </motion.button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

