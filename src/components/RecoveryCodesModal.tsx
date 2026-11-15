import React, { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, Copy, Plus, X } from 'lucide-react';
import type { RecoveryCodeItem, TotpAccount } from '../types/vault';
import type { ToastTone } from './BottomToastHost';

interface RecoveryCodesModalProps {
  account: TotpAccount | null;
  onClose: () => void;
  onUpdateRecoveryCodes: (accountId: string, codes: RecoveryCodeItem[]) => Promise<void>;
  onToast?: (message: string, tone?: ToastTone) => void;
}

export const RecoveryCodesModal: React.FC<RecoveryCodesModalProps> = ({
  account,
  onClose,
  onUpdateRecoveryCodes,
  onToast,
}) => {
  const [newCode, setNewCode] = useState('');
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const codes = account?.recoveryCodes ?? [];

  const handleToggleUsed = async (index: number) => {
    if (!account) return;
    const updated = codes.map((c, i) => (i === index ? { ...c, used: !c.used } : c));
    await onUpdateRecoveryCodes(account.id, updated);
    onToast?.('リカバリーコードの使用状態を更新・再暗号化しました', 'info');
  };

  const handleAddCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!account) return;
    const trimmed = newCode.trim();
    if (!trimmed) return;
    const updated = [...codes, { code: trimmed, used: false }];
    await onUpdateRecoveryCodes(account.id, updated);
    setNewCode('');
    onToast?.('新しいリカバリーコードを暗号化保存しました', 'success');
  };

  const handleCopy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(code);
      onToast?.(`リカバリーコード「${code}」をコピーしました`, 'success');
      setTimeout(() => setCopiedCode(null), 1500);
    } catch {
      // ignore
    }
  };

  return (
    <AnimatePresence>
      {account && (
        <motion.div
          key="recovery-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="recovery-modal-title"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <motion.div
            key="recovery-modal-panel"
            initial={{ opacity: 0, scale: 0.9, y: 24 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 16 }}
            transition={{ type: 'spring', stiffness: 380, damping: 26 }}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-md p-6 space-y-5 shadow-2xl"
          >
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 id="recovery-modal-title" className="text-base font-bold text-slate-900 dark:text-white">
                  緊急用リカバリーコード
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {account.issuer} · {account.label}
                </p>
              </div>
              <motion.button
                type="button"
                whileHover={{ scale: 1.12, rotate: 90 }}
                whileTap={{ scale: 0.88 }}
                transition={{ duration: 0.18 }}
                onClick={onClose}
                aria-label="リカバリーコードモーダルを閉じる"
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </motion.button>
            </div>

            <div className="space-y-2 max-h-64 overflow-y-auto pr-0.5">
              {codes.length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-slate-400 py-6 text-center border border-dashed border-slate-200 dark:border-slate-800 rounded-lg">
                  登録されているリカバリーコードはありません。下から追加できます。
                </p>
              ) : (
                <AnimatePresence mode="popLayout">
                  {codes.map((item, idx) => (
                    <motion.div
                      key={`${item.code}-${idx}`}
                      layout
                      initial={{ opacity: 0, x: -16 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 16 }}
                      transition={{ type: 'spring', stiffness: 380, damping: 26 }}
                      className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
                    >
                      <label className="flex items-center gap-2.5 cursor-pointer min-w-0">
                        <input
                          type="checkbox"
                          checked={item.used}
                          onChange={() => void handleToggleUsed(idx)}
                          className="rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                        />
                        <span
                          className={`font-mono text-xs truncate transition-colors ${
                            item.used
                              ? 'line-through text-slate-400 dark:text-slate-500'
                              : 'text-slate-900 dark:text-slate-100 font-semibold'
                          }`}
                        >
                          {item.code}
                        </span>
                      </label>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[11px] text-slate-500">
                          {item.used ? '使用済み' : '未使用'}
                        </span>
                        <motion.button
                          type="button"
                          whileHover={{ scale: 1.15 }}
                          whileTap={{ scale: 0.85 }}
                          onClick={() => void handleCopy(item.code)}
                          aria-label={`コード ${item.code} をコピー`}
                          className="p-1 text-slate-500 hover:text-slate-900 dark:hover:text-white"
                        >
                          {copiedCode === item.code ? (
                            <Check className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                          )}
                        </motion.button>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              )}
            </div>

            <form onSubmit={handleAddCode} className="flex items-center gap-2">
              <input
                type="text"
                value={newCode}
                onChange={(e) => setNewCode(e.target.value)}
                placeholder="新しいリカバリーコードを追加..."
                aria-label="新しいリカバリーコード"
                className="flex-1 px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
              <motion.button
                type="submit"
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.95 }}
                className="px-3 py-2 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white inline-flex items-center gap-1 whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                追加
              </motion.button>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

