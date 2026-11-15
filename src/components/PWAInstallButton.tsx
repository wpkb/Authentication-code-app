import React, { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Download, Share, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  compact?: boolean;
  onInstalled?: () => void;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({
  compact = false,
  onInstalled,
}) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  // Suppress button completely when already running in standalone PWA mode
  if (isInstalled) {
    return null;
  }

  const handleInstallClick = async () => {
    if (isInstallable) {
      const ok = await install();
      if (ok) onInstalled?.();
      return;
    }
    setShowGuide(true);
  };

  // Chromium beforeinstallprompt ready OR iOS Safari guide OR desktop browser fallback guide
  const label = isInstallable
    ? compact
      ? 'アプリを入れる'
      : 'PWAインストール'
    : isIOS
    ? 'ホーム画面に追加'
    : compact
    ? 'アプリ化'
    : 'アプリとして追加';

  return (
    <>
      <motion.button
        type="button"
        data-testid="pwa-install-btn"
        whileHover={{ scale: 1.03 }}
        whileTap={{ scale: 0.96 }}
        onClick={() => void handleInstallClick()}
        className={`${
          compact ? 'px-3 py-1.5 text-xs' : 'px-3.5 py-2 text-xs'
        } font-semibold rounded-xl glass-btn text-slate-800 dark:text-slate-100 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0`}
      >
        {isInstallable ? (
          <Download className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
        ) : (
          <Smartphone className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
        )}
        <span>{label}</span>
      </motion.button>

      <AnimatePresence>
        {showGuide && (
          <motion.div
            key="pwa-guide-backdrop"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pwa-guide-title"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-md flex items-center justify-center p-4"
            onClick={() => setShowGuide(false)}
          >
            <motion.div
              key="pwa-guide-modal"
              initial={{ opacity: 0, scale: 0.92, y: 14 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.92, y: 12 }}
              transition={{ type: 'spring', stiffness: 360, damping: 28 }}
              onClick={(e) => e.stopPropagation()}
              className="glass-modal rounded-3xl w-full max-w-sm p-6 space-y-4 text-slate-900 dark:text-slate-100"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl glass-primary-btn flex items-center justify-center shrink-0">
                    <Smartphone className="w-4 h-4 text-white" aria-hidden="true" />
                  </div>
                  <h3 id="pwa-guide-title" className="text-sm font-bold">
                    {isIOS
                      ? 'iPhone / iPad にインストール'
                      : 'PWAとして端末にインストール'}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setShowGuide(false)}
                  aria-label="閉じる"
                  className="p-1.5 rounded-xl glass-btn"
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>

              {isIOS ? (
                <ol className="text-xs text-slate-600 dark:text-slate-300 space-y-2 leading-relaxed list-decimal list-inside">
                  <li>
                    Safari 下部または右上の{' '}
                    <span className="inline-flex items-center gap-1 font-semibold text-slate-900 dark:text-white">
                      <Share className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
                      共有ボタン
                    </span>{' '}
                    をタップします。
                  </li>
                  <li>
                    メニューから <strong className="text-slate-900 dark:text-white">「ホーム画面に追加」</strong> を選択します。
                  </li>
                  <li>右上の「追加」をタップすると、独立したアプリとしてオフラインでも起動できます。</li>
                </ol>
              ) : (
                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  ブラウザのアドレスバー右端にあるインストールアイコン、またはメニューの「アプリをインストール」「ホーム画面に追加」から KagiVault をスタンドアロンアプリとしてインストールできます。オフライン時でもキャッシュされたアプリとWeb顔認証・TOTP生成が動作します。
                </p>
              )}

              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="w-full py-2.5 px-4 rounded-xl glass-primary-btn text-xs font-semibold"
              >
                閉じる
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};
