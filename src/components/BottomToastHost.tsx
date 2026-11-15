import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, CheckCircle2, Info, ShieldAlert, X } from 'lucide-react';

export type ToastTone = 'success' | 'info' | 'warning' | 'error';

export interface ToastItem {
  id: string;
  message: string;
  tone: ToastTone;
}

interface BottomToastHostProps {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}

const TONE_STYLES: Record<
  ToastTone,
  {
    icon: React.ComponentType<{ className?: string }>;
    container: string;
    iconClass: string;
    barClass: string;
  }
> = {
  success: {
    icon: CheckCircle2,
    container:
      'bg-slate-900 dark:bg-slate-800 text-white border-emerald-500/40 dark:border-emerald-500/50',
    iconClass: 'text-emerald-400',
    barClass: 'bg-emerald-400',
  },
  info: {
    icon: Info,
    container:
      'bg-slate-900 dark:bg-slate-800 text-white border-blue-500/40 dark:border-blue-500/50',
    iconClass: 'text-blue-400',
    barClass: 'bg-blue-400',
  },
  warning: {
    icon: AlertTriangle,
    container:
      'bg-amber-950 dark:bg-amber-950 text-amber-50 border-amber-500/50',
    iconClass: 'text-amber-400',
    barClass: 'bg-amber-400',
  },
  error: {
    icon: ShieldAlert,
    container:
      'bg-red-950 dark:bg-red-950 text-red-50 border-red-500/50',
    iconClass: 'text-red-400',
    barClass: 'bg-red-400',
  },
};

export const BottomToastHost: React.FC<BottomToastHostProps> = ({
  toasts,
  onDismiss,
}) => {
  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="fixed bottom-4 inset-x-0 z-[70] pointer-events-none flex flex-col items-center gap-2 px-4"
    >
      <AnimatePresence mode="popLayout">
        {toasts.map((toast) => {
          const style = TONE_STYLES[toast.tone];
          const Icon = style.icon;
          return (
            <motion.div
              key={toast.id}
              layout
              initial={{ opacity: 0, y: 36, scale: 0.88 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.9 }}
              transition={{ type: 'spring', stiffness: 420, damping: 28 }}
              className={`pointer-events-auto relative overflow-hidden w-full max-w-md rounded-xl border px-4 py-3 shadow-xl flex items-center justify-between gap-3 ${style.container}`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <motion.div
                  initial={{ scale: 0.6, rotate: -15 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 20 }}
                  className="shrink-0"
                >
                  <Icon className={`w-4 h-4 ${style.iconClass}`} aria-hidden="true" />
                </motion.div>
                <span className="text-xs font-medium leading-snug break-words">
                  {toast.message}
                </span>
              </div>

              <motion.button
                type="button"
                whileHover={{ scale: 1.12 }}
                whileTap={{ scale: 0.9 }}
                onClick={() => onDismiss(toast.id)}
                aria-label="通知を閉じる"
                className="p-1 rounded-md opacity-75 hover:opacity-100 shrink-0"
              >
                <X className="w-3.5 h-3.5" aria-hidden="true" />
              </motion.button>

              <motion.div
                initial={{ scaleX: 1 }}
                animate={{ scaleX: 0 }}
                transition={{ duration: 3.8, ease: 'linear' }}
                style={{ transformOrigin: 'left' }}
                className={`absolute bottom-0 left-0 right-0 h-0.5 opacity-80 ${style.barClass}`}
              />
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
};
