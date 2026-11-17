import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Bookmark,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  ExternalLink,
  KeyRound,
  ShieldCheck,
  Smartphone,
  Wand2,
  Zap,
} from 'lucide-react';
import { formatOtpCode, type TotpResult } from '../crypto/totp';
import type { TotpAccount } from '../types/vault';
import {
  broadcastAutofillOtp,
  buildAutofillBookmarkletCode,
  detectBrowserAutofillCapabilities,
  extractDomainLabel,
  fillOtpIntoElement,
  inferServiceLoginUrl,
  listenWebOtpCredential,
  subscribeAutofillOtp,
  syncAccountWithCredentialApi,
} from '../utils/autofillBridge';
import type { ToastTone } from './BottomToastHost';

interface AutofillBridgeViewProps {
  accounts: TotpAccount[];
  totpMap: Record<string, TotpResult>;
  onToast?: (message: string, tone?: ToastTone) => void;
}

export const AutofillBridgeView: React.FC<AutofillBridgeViewProps> = ({
  accounts,
  totpMap,
  onToast,
}) => {
  const capabilities = useMemo(() => detectBrowserAutofillCapabilities(), []);
  const bookmarkletHref = useMemo(() => buildAutofillBookmarkletCode(), []);

  const [copiedBookmarklet, setCopiedBookmarklet] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState<string>(
    accounts[0]?.id ?? ''
  );
  const [formInputMode, setFormInputMode] = useState<'single' | 'split'>('single');
  const [otpFieldValue, setOtpFieldValue] = useState('');
  const [splitDigits, setSplitDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [filledSource, setFilledSource] = useState<string>('');
  const [verifyStatus, setVerifyStatus] = useState<'idle' | 'matched' | 'mismatch'>('idle');
  const [webOtpListening, setWebOtpListening] = useState(false);

  const singleInputRef = useRef<HTMLInputElement | null>(null);
  const splitInputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const webOtpAbortRef = useRef<AbortController | null>(null);
  const bookmarkLinkRef = useRef<HTMLAnchorElement | null>(null);

  useEffect(() => {
    if (bookmarkLinkRef.current) {
      bookmarkLinkRef.current.setAttribute('href', bookmarkletHref);
    }
  }, [bookmarkletHref]);

  useEffect(() => {
    if (!accounts.some((a) => a.id === selectedAccountId) && accounts[0]) {
      setSelectedAccountId(accounts[0].id);
    }
  }, [accounts, selectedAccountId]);

  useEffect(() => {
    const unsub = subscribeAutofillOtp((payload) => {
      setSelectedAccountId(payload.accountId);
      setFilledSource(`${payload.issuer} (${payload.label})`);
      setVerifyStatus('idle');

      if (formInputMode === 'single' && singleInputRef.current) {
        fillOtpIntoElement(singleInputRef.current, payload.code);
        singleInputRef.current.focus();
      } else {
        const chars = payload.code.split('').slice(0, 6);
        setSplitDigits(
          Array.from({ length: 6 }, (_, i) => chars[i] ?? '')
        );
        chars.forEach((ch, idx) => {
          const box = splitInputRefs.current[idx];
          if (box) fillOtpIntoElement(box, ch);
        });
      }
      setOtpFieldValue(payload.code);
    });

    return () => {
      unsub();
      webOtpAbortRef.current?.abort();
    };
  }, [formInputMode]);

  const handleCopyBookmarklet = async () => {
    try {
      await navigator.clipboard.writeText(bookmarkletHref);
      setCopiedBookmarklet(true);
      onToast?.('ワンタップ自動入力ブックマークレットをコピーしました', 'success');
      window.setTimeout(() => setCopiedBookmarklet(false), 1800);
    } catch {
      onToast?.('ブックマークレットのコピーに失敗しました', 'error');
    }
  };

  const handleTriggerOneTapAutofill = async (acc: TotpAccount) => {
    const totp = totpMap[acc.id];
    if (!totp?.code) return;
    const loginUrl = inferServiceLoginUrl(acc.issuer, acc.loginUrl) ?? undefined;
    await broadcastAutofillOtp({
      accountId: acc.id,
      issuer: acc.issuer,
      label: acc.label,
      code: totp.code,
      loginUrl,
    });
    onToast?.(
      `${acc.issuer} のコード (${formatOtpCode(totp.code)}) をワンタップ自動入力へ送信しました`,
      'success'
    );
  };

  const handleCredentialApiSync = async (acc: TotpAccount) => {
    const totp = totpMap[acc.id];
    if (!totp?.code) return;
    const res = await syncAccountWithCredentialApi({
      id: `${acc.issuer} (${acc.label})`,
      name: acc.issuer,
      otpCode: totp.code,
    });
    if (res.stored) {
      onToast?.(
        `${acc.issuer} をブラウザの Credential Management API に保存しました`,
        'success'
      );
    } else {
      onToast?.(
        res.reason || 'このブラウザでは Credential Management API の自動保存が制限されています',
        'info'
      );
    }
  };

  const handleToggleWebOtp = async () => {
    if (webOtpListening) {
      webOtpAbortRef.current?.abort();
      setWebOtpListening(false);
      return;
    }
    const controller = new AbortController();
    webOtpAbortRef.current = controller;
    setWebOtpListening(true);
    onToast?.('ブラウザ WebOTP (OTPCredential) API でコード待機を開始しました', 'info');

    const res = await listenWebOtpCredential(controller.signal);
    setWebOtpListening(false);
    if (res.code) {
      if (singleInputRef.current) {
        fillOtpIntoElement(singleInputRef.current, res.code);
      }
      setOtpFieldValue(res.code);
      setFilledSource('ブラウザ WebOTP API');
      onToast?.(`WebOTP からコード (${res.code}) を自動入力しました`, 'success');
    } else if (res.error) {
      onToast?.(res.error, res.supported ? 'info' : 'warning');
    }
  };

  const handleVerifyFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const entered =
      formInputMode === 'single'
        ? otpFieldValue.replace(/\s+/g, '')
        : splitDigits.join('').replace(/\s+/g, '');

    const targetTotp = totpMap[selectedAccountId];
    if (!targetTotp || !entered) {
      setVerifyStatus('mismatch');
      onToast?.('検証するコードを入力してください', 'warning');
      return;
    }

    if (entered === targetTotp.code) {
      setVerifyStatus('matched');
      onToast?.('ワンタイムコードの自動入力・検証に成功しました', 'success');
    } else {
      setVerifyStatus('mismatch');
      onToast?.('コードが一致しません（更新周期が切り替わった可能性があります）', 'error');
    }
  };

  return (
    <div className="space-y-6">
      {/* Capabilities Overview */}
      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 26 }}
        className="glass-surface rounded-[24px] p-6 space-y-5"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Zap className="w-4 h-4 text-blue-600 dark:text-blue-400" aria-hidden="true" />
              ブラウザ自動入力 (Autofill) API 連携ステータス
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              HTML標準の <code className="font-mono">autocomplete=&quot;one-time-code&quot;</code>・Credential Management API・ワンタップブックマークレットを組み合わせて、ログイン画面へ1タップ入力します。
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-3 border-t border-slate-900/8 dark:border-white/10 text-xs">
          <div className="flex items-start gap-2.5">
            <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-semibold text-slate-800 dark:text-slate-200">
                autocomplete=&quot;one-time-code&quot;
              </p>
              <p className="text-emerald-700 dark:text-emerald-400">
                標準対応 (単一 / 分割ボックス)
              </p>
            </div>
          </div>

          <div className="flex items-start gap-2.5">
            <ClipboardCheck
              className={`w-4 h-4 mt-0.5 shrink-0 ${
                capabilities.clipboardWrite
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-amber-600'
              }`}
              aria-hidden="true"
            />
            <div>
              <p className="font-semibold text-slate-800 dark:text-slate-200">
                Clipboard Async API
              </p>
              <p className="text-slate-500 dark:text-slate-400">
                {capabilities.clipboardWrite
                  ? capabilities.clipboardRead
                    ? '書込・読取ともに利用可能'
                    : '書込可能 (読取は権限確認)'
                  : 'フォールバック使用'}
              </p>
            </div>
          </div>

          <div className="flex items-start gap-2.5">
            <KeyRound
              className={`w-4 h-4 mt-0.5 shrink-0 ${
                capabilities.credentialManagement
                  ? 'text-blue-600 dark:text-blue-400'
                  : 'text-slate-400'
              }`}
              aria-hidden="true"
            />
            <div>
              <p className="font-semibold text-slate-800 dark:text-slate-200">
                Credential Management API
              </p>
              <p className="text-slate-500 dark:text-slate-400">
                {capabilities.passwordCredential
                  ? 'PasswordCredential 対応'
                  : capabilities.credentialManagement
                  ? 'ブラウザ基本対応'
                  : '非対応ブラウザ'}
              </p>
            </div>
          </div>

          <div className="flex items-start gap-2.5">
            <Smartphone
              className={`w-4 h-4 mt-0.5 shrink-0 ${
                capabilities.webOtp
                  ? 'text-blue-600 dark:text-blue-400'
                  : 'text-slate-400'
              }`}
              aria-hidden="true"
            />
            <div>
              <p className="font-semibold text-slate-800 dark:text-slate-200">
                WebOTP (OTPCredential)
              </p>
              <p className="text-slate-500 dark:text-slate-400">
                {capabilities.webOtp ? 'API 検出済み' : 'デスクトップ環境 (任意)'}
              </p>
            </div>
          </div>
        </div>
      </motion.section>

      {/* One-Tap External Site Bookmarklet */}
      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 26, delay: 0.06 }}
        className="glass-surface rounded-[24px] p-6 space-y-4"
      >
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Bookmark className="w-4 h-4 text-blue-600 dark:text-blue-400" aria-hidden="true" />
              全サイト対応「1タップOTP自動入力」ブックマークレット
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              ブラウザの仕様上、別ドメインのログイン画面へ直接スクリプトを送り込むことはできないため、ブックマークバーへ登録しておくと GitHub / AWS / Google 等の 2FA 入力欄をワンタップで自動検出し、KagiVault のコードを入力できます。
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <motion.a
              ref={bookmarkLinkRef}
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.96 }}
              onClick={(e) => {
                e.preventDefault();
                onToast?.(
                  'このボタンをブックマークバーにドラッグするか、「ブックマーク用URLをコピー」で登録してください',
                  'info'
                );
              }}
              className="px-4 py-2 text-xs font-semibold rounded-xl glass-primary-btn inline-flex items-center gap-1.5 whitespace-nowrap cursor-grab active:cursor-grabbing"
              title="ブックマークバーへドラッグ＆ドロップ"
            >
              <Zap className="w-3.5 h-3.5" aria-hidden="true" />
              KagiVault 1タップ入力
            </motion.a>

            <motion.button
              type="button"
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.96 }}
              onClick={() => void handleCopyBookmarklet()}
              className="px-3.5 py-2 text-xs font-semibold rounded-xl glass-btn text-slate-700 dark:text-slate-200 inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              {copiedBookmarklet ? (
                <Check className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
              ) : (
                <Copy className="w-3.5 h-3.5" aria-hidden="true" />
              )}
              {copiedBookmarklet ? 'コピー済み' : 'ブックマーク用URLをコピー'}
            </motion.button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2">
          {[
            {
              step: '1',
              title: 'カードから「入力して開く」',
              desc: '各アカウントカードのワンタップ連携ボタンでライブOTPを準備し、サービスのログイン画面を開きます。',
            },
            {
              step: '2',
              title: '2FA画面でブックマークをタップ',
              desc: '二段階認証の入力欄が表示されたら、ブックマークバーの「KagiVault 1タップ入力」を1回クリックします。',
            },
            {
              step: '3',
              title: 'フォームを自動認識して入力',
              desc: 'autocomplete="one-time-code" や6桁分割ボックスを検出し、React/Vue等の状態変更イベント込みで即入力します。',
            },
          ].map((item) => (
            <div
              key={item.step}
              className="p-3.5 rounded-2xl glass-subtle space-y-1"
            >
              <p className="text-xs font-bold text-slate-900 dark:text-white tabular-nums">
                Step {item.step} · {item.title}
              </p>
              <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
                {item.desc}
              </p>
            </div>
          ))}
        </div>
      </motion.section>

      {/* Interactive Live Autofill Playground & Account Launcher */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Vault Accounts Quick One-Tap Autofill Triggers */}
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 320, damping: 26, delay: 0.1 }}
          className="lg:col-span-7 glass-surface rounded-[24px] p-6 space-y-4"
        >
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              アカウント別 ワンタップ入力ランチャー
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              アカウントを選択して「1タップ自動入力」を押すと、右側の <code className="font-mono">one-time-code</code> フォームへ即座に自動入力＋クリップボード同期されます。
            </p>
          </div>

          {accounts.length === 0 ? (
            <div className="p-6 rounded-2xl glass-subtle border-dashed text-center text-xs text-slate-500 dark:text-slate-400">
              まずは認証アカウントを1つ以上追加してください。
            </div>
          ) : (
            <div className="space-y-2.5">
              {accounts.map((acc) => {
                const totp = totpMap[acc.id];
                const loginUrl = inferServiceLoginUrl(acc.issuer, acc.loginUrl);
                const domain = extractDomainLabel(loginUrl);
                const isSelected = selectedAccountId === acc.id;

                return (
                  <motion.div
                    key={acc.id}
                    whileHover={{ x: 2 }}
                    className={`p-3.5 rounded-2xl transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                      isSelected
                        ? 'glass-subtle border-blue-500/70 bg-blue-500/12 dark:bg-blue-500/16'
                        : 'glass-subtle'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                          {acc.issuer}
                        </p>
                        {domain && (
                          <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate">
                            {domain}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        {acc.label} ·{' '}
                        <span className="font-mono font-semibold text-slate-800 dark:text-slate-200 tabular-nums">
                          {totp ? formatOtpCode(totp.code) : '--- ---'}
                        </span>
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <motion.button
                        type="button"
                        whileHover={{ scale: 1.03 }}
                        whileTap={{ scale: 0.95 }}
                        onClick={() => void handleTriggerOneTapAutofill(acc)}
                        className="px-3 py-1.5 text-xs font-semibold rounded-xl glass-primary-btn inline-flex items-center gap-1.5 whitespace-nowrap"
                      >
                        <Wand2 className="w-3.5 h-3.5" aria-hidden="true" />
                        1タップ自動入力
                      </motion.button>

                      {loginUrl && (
                        <motion.a
                          whileHover={{ scale: 1.03 }}
                          whileTap={{ scale: 0.95 }}
                          href={loginUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => void handleTriggerOneTapAutofill(acc)}
                          className="px-3 py-1.5 text-xs font-medium rounded-xl glass-btn text-slate-700 dark:text-slate-200 inline-flex items-center gap-1 whitespace-nowrap"
                        >
                          <span>開く</span>
                          <ExternalLink className="w-3 h-3" aria-hidden="true" />
                        </motion.a>
                      )}

                      {capabilities.passwordCredential && (
                        <motion.button
                          type="button"
                          whileHover={{ scale: 1.03 }}
                          whileTap={{ scale: 0.95 }}
                          onClick={() => void handleCredentialApiSync(acc)}
                          title="Credential Management API に登録"
                          className="px-2.5 py-1.5 text-[11px] font-medium rounded-xl glass-btn text-slate-600 dark:text-slate-300 whitespace-nowrap"
                        >
                          Autofill保存
                        </motion.button>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </motion.section>

        {/* Right: Live autocomplete="one-time-code" Verification Form */}
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 320, damping: 26, delay: 0.14 }}
          className="lg:col-span-5 glass-surface rounded-[24px] p-6 space-y-4"
        >
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              自動入力テストフォーム
            </h2>
            <div className="flex items-center gap-1 p-1 glass-subtle rounded-xl text-[11px] font-semibold">
              {(
                [
                  { id: 'single', label: '単一欄' },
                  { id: 'split', label: '6分割欄' },
                ] as const
              ).map((item) => {
                const active = formInputMode === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setFormInputMode(item.id)}
                    className={`relative px-2.5 py-1 rounded-lg transition-colors whitespace-nowrap ${
                      active
                        ? 'text-slate-900 dark:text-white'
                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                    }`}
                  >
                    {active && (
                      <motion.span
                        layoutId="autofill-form-mode-pill"
                        transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                        className="absolute inset-0 glass-pill-active rounded-lg"
                      />
                    )}
                    <span className="relative z-10">{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            実際のサービス側2FAフォーム（<code className="font-mono">autocomplete=&quot;one-time-code&quot;</code>）への自動入力動作を即座にテストできます。
          </p>

          <form onSubmit={handleVerifyFormSubmit} className="space-y-4">
            {formInputMode === 'single' ? (
              <div>
                <label
                  htmlFor="autofill-test-otp-input"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                >
                  認証コード (autocomplete=&quot;one-time-code&quot;)
                </label>
                <input
                  ref={singleInputRef}
                  id="autofill-test-otp-input"
                  name="otp"
                  type="text"
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={8}
                  value={otpFieldValue}
                  onChange={(e) => {
                    setOtpFieldValue(e.target.value);
                    setVerifyStatus('idle');
                  }}
                  placeholder="左の「1タップ自動入力」をクリック"
                  className="w-full px-3.5 py-2.5 text-lg font-mono tracking-widest rounded-xl glass-input text-slate-900 dark:text-slate-100 tabular-nums"
                />
              </div>
            ) : (
              <div>
                <span className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  6桁分割入力ボックス (各欄 maxlength=&quot;1&quot;)
                </span>
                <div className="grid grid-cols-6 gap-2">
                  {splitDigits.map((digit, idx) => (
                    <input
                      key={idx}
                      ref={(el) => {
                        splitInputRefs.current[idx] = el;
                      }}
                      type="text"
                      inputMode="numeric"
                      autoComplete={idx === 0 ? 'one-time-code' : 'off'}
                      maxLength={1}
                      aria-label={`認証コード ${idx + 1}桁目`}
                      value={digit}
                      onChange={(e) => {
                        const val = e.target.value.slice(-1);
                        setSplitDigits((prev) => {
                          const next = [...prev];
                          next[idx] = val;
                          return next;
                        });
                        setVerifyStatus('idle');
                        if (val && idx < 5) {
                          splitInputRefs.current[idx + 1]?.focus();
                        }
                      }}
                      className="w-full h-11 text-center text-lg font-mono font-bold rounded-xl glass-input text-slate-900 dark:text-slate-100 tabular-nums"
                    />
                  ))}
                </div>
              </div>
            )}

            <AnimatePresence>
              {filledSource && (
                <motion.p
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="text-[11px] text-blue-700 dark:text-blue-300 font-medium"
                >
                  自動入力ソース: {filledSource}
                </motion.p>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {verifyStatus === 'matched' && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  className="p-3 rounded-xl border border-emerald-400/40 bg-emerald-500/12 backdrop-blur-sm text-xs text-emerald-800 dark:text-emerald-200 flex items-center gap-2"
                >
                  <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>自動入力されたOTPコードは現在のTOTPと一致しました。</span>
                </motion.div>
              )}
              {verifyStatus === 'mismatch' && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  className="p-3 rounded-xl border border-red-400/40 bg-red-500/12 backdrop-blur-sm text-xs text-red-700 dark:text-red-300"
                >
                  入力コードが選択アカウントの現在のTOTPと一致しませんでした。
                </motion.div>
              )}
            </AnimatePresence>

            <div className="flex flex-wrap items-center gap-2.5 pt-1">
              <motion.button
                type="submit"
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.96 }}
                className="px-4 py-2 text-xs font-semibold rounded-xl glass-primary-btn whitespace-nowrap"
              >
                入力コードを検証
              </motion.button>

              <motion.button
                type="button"
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.96 }}
                onClick={() => void handleToggleWebOtp()}
                className="px-3 py-2 text-xs font-medium rounded-xl glass-btn text-slate-700 dark:text-slate-200 whitespace-nowrap"
              >
                {webOtpListening ? 'WebOTP 待機を停止' : 'WebOTP API で待機'}
              </motion.button>
            </div>
          </form>
        </motion.section>
      </div>
    </div>
  );
};
