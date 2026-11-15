import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  return (
    <AnimatePresence>
      {!isOnline && (
        <motion.div
          key="offline-indicator"
          role="status"
          aria-live="polite"
          data-testid="offline-indicator"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          transition={{ type: 'spring', stiffness: 360, damping: 28 }}
          className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-5 sm:bottom-5 z-50 glass-surface border border-amber-400/50 bg-amber-500/15 dark:bg-amber-500/20 px-3.5 py-2 rounded-2xl flex items-center gap-2 text-xs font-semibold text-amber-900 dark:text-amber-100 shadow-lg max-w-md"
        >
          <WifiOff className="w-3.5 h-3.5 text-amber-600 dark:text-amber-300 shrink-0" aria-hidden="true" />
          <span>オフライン動作中（TOTP生成・Web顔認証・Cookie保存は利用可能）</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
