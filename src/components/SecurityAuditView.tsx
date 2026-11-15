import React from 'react';
import { motion } from 'motion/react';
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  ShieldAlert,
} from 'lucide-react';
import type { SecurityAuditReport } from '../utils/securityAudit';

interface SecurityAuditViewProps {
  report: SecurityAuditReport;
  onNavigateToSyncSettings: () => void;
}

export const SecurityAuditView: React.FC<SecurityAuditViewProps> = ({
  report,
  onNavigateToSyncSettings,
}) => {
  const severityMeta = {
    high: {
      icon: ShieldAlert,
      label: '要対応',
      textClass: 'text-red-700 dark:text-red-400',
      borderClass: 'border-red-200 dark:border-red-900',
      bgClass: 'bg-red-50/70 dark:bg-red-950/30',
    },
    medium: {
      icon: AlertTriangle,
      label: '推奨改善',
      textClass: 'text-amber-700 dark:text-amber-400',
      borderClass: 'border-amber-200 dark:border-amber-900',
      bgClass: 'bg-amber-50/70 dark:bg-amber-950/30',
    },
    low: {
      icon: Info,
      label: '情報',
      textClass: 'text-slate-700 dark:text-slate-300',
      borderClass: 'border-slate-200 dark:border-slate-800',
      bgClass: 'bg-white dark:bg-slate-900',
    },
    ok: {
      icon: CheckCircle2,
      label: '良好',
      textClass: 'text-emerald-700 dark:text-emerald-400',
      borderClass: 'border-slate-200 dark:border-slate-800',
      bgClass: 'bg-white dark:bg-slate-900',
    },
  };

  return (
    <div className="space-y-6">
      {/* Summary Strip */}
      <motion.div
        initial={{ opacity: 0, y: 18, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 340, damping: 25 }}
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 grid grid-cols-1 md:grid-cols-3 gap-6"
      >
        <div>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            ボルト保護評価
          </p>
          <motion.p
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'spring', stiffness: 360, damping: 20, delay: 0.08 }}
            className="text-3xl font-bold font-mono tabular-nums text-slate-900 dark:text-white mt-1"
          >
            {report.score}
            <span className="text-sm font-normal text-slate-500 dark:text-slate-400"> / 100</span>
          </motion.p>
        </div>

        <div>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            登録アカウント数
          </p>
          <motion.p
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'spring', stiffness: 360, damping: 20, delay: 0.14 }}
            className="text-3xl font-bold font-mono tabular-nums text-slate-900 dark:text-white mt-1"
          >
            {report.totalAccounts}
            <span className="text-sm font-normal text-slate-500 dark:text-slate-400"> 件</span>
          </motion.p>
        </div>

        <div>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            リカバリーコード登録率
          </p>
          <motion.p
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'spring', stiffness: 360, damping: 20, delay: 0.2 }}
            className="text-3xl font-bold font-mono tabular-nums text-slate-900 dark:text-white mt-1"
          >
            {report.accountsWithRecovery}
            <span className="text-sm font-normal text-slate-500 dark:text-slate-400">
              {' '}
              / {report.totalAccounts} 件
            </span>
          </motion.p>
        </div>
      </motion.div>

      {/* Findings List */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
            診断結果の詳細
          </h2>
          <motion.button
            type="button"
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.95 }}
            onClick={onNavigateToSyncSettings}
            className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline"
          >
            暗号化・自動ロック設定を開く
          </motion.button>
        </div>

        {report.findings.map((item, idx) => {
          const meta = severityMeta[item.severity];
          const Icon = meta.icon;
          return (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              whileHover={{ x: 4 }}
              transition={{
                type: 'spring',
                stiffness: 360,
                damping: 26,
                delay: Math.min(idx * 0.06, 0.3),
              }}
              className={`border rounded-xl p-5 ${meta.borderClass} ${meta.bgClass}`}
            >
              <div className="flex items-start gap-3">
                <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${meta.textClass}`} aria-hidden="true" />
                <div className="space-y-1.5 min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-xs font-semibold ${meta.textClass}`}>
                      [{meta.label}]
                    </span>
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                      {item.title}
                    </h3>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                    {item.description}
                  </p>
                  {item.affectedAccounts && item.affectedAccounts.length > 0 && (
                    <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400 pt-1">
                      対象: {item.affectedAccounts.join(' · ')}
                    </p>
                  )}
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
};

