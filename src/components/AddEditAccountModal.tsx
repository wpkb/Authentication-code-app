import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import jsQR from 'jsqr';
import {
  Camera,
  Eye,
  EyeOff,
  ImageUp,
  Link2,
  Loader2,
  RefreshCw,
  X,
} from 'lucide-react';
import {
  decodeBase32,
  generateRandomSecret,
  normalizeBase32,
  parseOtpAuthUri,
} from '../crypto/totp';
import type { TotpAccount, TotpAlgorithm } from '../types/vault';
import type { ToastTone } from './BottomToastHost';

interface AddEditAccountModalProps {
  open: boolean;
  editingAccount: TotpAccount | null;
  existingFolders: string[];
  onClose: () => void;
  onToast?: (message: string, tone?: ToastTone) => void;
  onSave: (accountData: {
    id?: string;
    issuer: string;
    label: string;
    secret: string;
    algorithm: TotpAlgorithm;
    digits: 6 | 8;
    period: 30 | 60;
    folder: string;
    loginUrl?: string;
    note: string;
    recoveryCodes: { code: string; used: boolean }[];
  }) => Promise<void>;
}

export const AddEditAccountModal: React.FC<AddEditAccountModalProps> = ({
  open,
  editingAccount,
  existingFolders,
  onClose,
  onToast,
  onSave,
}) => {
  const [entryMode, setEntryMode] = useState<'manual' | 'uri' | 'qr'>('manual');
  const [issuer, setIssuer] = useState('');
  const [label, setLabel] = useState('');
  const [secret, setSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [algorithm, setAlgorithm] = useState<TotpAlgorithm>('SHA-1');
  const [digits, setDigits] = useState<6 | 8>(6);
  const [period, setPeriod] = useState<30 | 60>(30);
  const [folder, setFolder] = useState('仕事');
  const [loginUrl, setLoginUrl] = useState('');
  const [note, setNote] = useState('');
  const [recoveryText, setRecoveryText] = useState('');
  const [uriInput, setUriInput] = useState('');
  const [error, setError] = useState('');
  const [infoMessage, setInfoMessage] = useState('');
  const [saving, setSaving] = useState(false);

  const [cameraActive, setCameraActive] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  const stopCamera = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  useEffect(() => {
    if (!open) {
      stopCamera();
      return;
    }
    setError('');
    setInfoMessage('');
    if (editingAccount) {
      setEntryMode('manual');
      setIssuer(editingAccount.issuer);
      setLabel(editingAccount.label);
      setSecret(editingAccount.secret);
      setAlgorithm(editingAccount.algorithm);
      setDigits(editingAccount.digits);
      setPeriod(editingAccount.period);
      setFolder(editingAccount.folder || '仕事');
      setLoginUrl(editingAccount.loginUrl || '');
      setNote(editingAccount.note || '');
      setRecoveryText(
        (editingAccount.recoveryCodes || []).map((r) => r.code).join('\n')
      );
    } else {
      setEntryMode('manual');
      setIssuer('');
      setLabel('');
      setSecret('');
      setAlgorithm('SHA-1');
      setDigits(6);
      setPeriod(30);
      setFolder(existingFolders[0] || '仕事');
      setLoginUrl('');
      setNote('');
      setRecoveryText('');
      setUriInput('');
    }
    return () => {
      stopCamera();
    };
  }, [open, editingAccount]);

  const applyParsedUri = (raw: string) => {
    const parsed = parseOtpAuthUri(raw);
    setIssuer(parsed.issuer);
    setLabel(parsed.label);
    setSecret(parsed.secret);
    setAlgorithm(parsed.algorithm);
    setDigits(parsed.digits);
    setPeriod(parsed.period);
    setEntryMode('manual');
    setInfoMessage(`「${parsed.issuer}」のQR / URI情報を読み込みました。内容を確認して保存してください。`);
    setError('');
    onToast?.(`「${parsed.issuer}」のURI情報を読み込みました`, 'info');
  };

  const handleParseUri = () => {
    setError('');
    try {
      applyParsedUri(uriInput);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'URIの解析に失敗しました。');
    }
  };

  const handleQrImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');

    try {
      const img = new Image();
      const objectUrl = URL.createObjectURL(file);
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('画像ファイルの読み込みに失敗しました。'));
        img.src = objectUrl;
      });
      URL.revokeObjectURL(objectUrl);

      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvasコンテキストを取得できませんでした。');
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height);
      if (!code || !code.data) {
        throw new Error('画像からQRコードを検出できませんでした。より鮮明な画像をお試しください。');
      }
      applyParsedUri(code.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'QRコードの解析に失敗しました。');
    }
  };

  const startCameraScan = async () => {
    setError('');
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('お使いのブラウザはカメラアクセスに対応していません。QR画像ファイルをアップロードしてください。');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      streamRef.current = stream;
      setCameraActive(true);

      requestAnimationFrame(() => {
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        void video.play();

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        const scanFrame = () => {
          if (!streamRef.current || !videoRef.current) return;
          if (video.readyState === video.HAVE_ENOUGH_DATA && ctx) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const result = jsQR(frame.data, frame.width, frame.height);
            if (result?.data) {
              try {
                applyParsedUri(result.data);
                stopCamera();
                return;
              } catch (err) {
                setError(
                  err instanceof Error
                    ? err.message
                    : '読み取ったQRコードはotpauth://形式ではありません。'
                );
              }
            }
          }
          rafRef.current = requestAnimationFrame(scanFrame);
        };
        rafRef.current = requestAnimationFrame(scanFrame);
      });
    } catch {
      setError('カメラの起動が許可されなかったか、利用可能なカメラが見つかりません。QR画像アップロードをご利用ください。');
      stopCamera();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!issuer.trim()) {
      setError('サービス名を入力してください。');
      return;
    }
    if (!label.trim()) {
      setError('アカウント名 (メールアドレス等) を入力してください。');
      return;
    }

    const cleanSecret = normalizeBase32(secret);
    try {
      decodeBase32(cleanSecret);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'シークレットキーが不正です。');
      return;
    }

    const existingRecoveryMap = new Map(
      (editingAccount?.recoveryCodes || []).map((r) => [r.code, r.used])
    );
    const recoveryCodes = recoveryText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((code) => ({
        code,
        used: existingRecoveryMap.get(code) ?? false,
      }));

    setSaving(true);
    try {
      await onSave({
        id: editingAccount?.id,
        issuer: issuer.trim(),
        label: label.trim(),
        secret: cleanSecret,
        algorithm,
        digits,
        period,
        folder: folder.trim() || '未分類',
        loginUrl: loginUrl.trim() || undefined,
        note: note.trim(),
        recoveryCodes,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存に失敗しました。');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="add-edit-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-edit-modal-title"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto"
        >
          <motion.div
            key="add-edit-dialog"
            initial={{ opacity: 0, scale: 0.9, y: 24 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 18 }}
            transition={{ type: 'spring', stiffness: 360, damping: 28 }}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-xl p-6 space-y-5 my-8 shadow-2xl"
          >
            <div className="flex items-center justify-between gap-4">
              <h2
                id="add-edit-modal-title"
                className="text-lg font-bold text-slate-900 dark:text-white"
              >
                {editingAccount ? '認証アカウントを編集' : '新しい認証アカウントを追加'}
              </h2>
              <motion.button
                type="button"
                whileHover={{ scale: 1.08 }}
                whileTap={{ scale: 0.92 }}
                onClick={onClose}
                aria-label="モーダルを閉じる"
                className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </motion.button>
            </div>

            {!editingAccount && (
              <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
                {(
                  [
                    { id: 'manual', label: '手動入力' },
                    { id: 'uri', label: 'URI貼付' },
                    { id: 'qr', label: 'QR読み取り' },
                  ] as const
                ).map((item) => {
                  const active = entryMode === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        if (item.id !== 'qr') stopCamera();
                        setEntryMode(item.id);
                      }}
                      className={`relative px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                        active
                          ? 'text-slate-900 dark:text-white'
                          : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      {active && (
                        <motion.span
                          layoutId="add-edit-entry-tab"
                          transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                          className="absolute inset-0 bg-white dark:bg-slate-900 rounded-md shadow-sm"
                        />
                      )}
                      <span className="relative z-10">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            )}

            <AnimatePresence>
              {infoMessage && (
                <motion.div
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  className="p-3 rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 text-xs text-blue-800 dark:text-blue-200"
                >
                  {infoMessage}
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {error && (
                <motion.div
                  role="alert"
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: [0, -4, 4, -2, 0] }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.28 }}
                  className="p-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300"
                >
                  {error}
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence mode="wait">
              {entryMode === 'uri' && (
                <motion.div
                  key="mode-uri"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  transition={{ duration: 0.18 }}
                  className="space-y-3"
                >
                  <label
                    htmlFor="otpauth-uri-input"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                  >
                    otpauth://totp/... URI を貼り付け
                  </label>
                  <textarea
                    id="otpauth-uri-input"
                    rows={3}
                    value={uriInput}
                    onChange={(e) => setUriInput(e.target.value)}
                    placeholder="otpauth://totp/GitHub:user@example.com?secret=JBSWY3DPEHPK3PXP&issuer=GitHub"
                    className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.96 }}
                    onClick={handleParseUri}
                    className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold inline-flex items-center gap-1.5"
                  >
                    <Link2 className="w-3.5 h-3.5" aria-hidden="true" />
                    URIを解析してフォームに反映
                  </motion.button>
                </motion.div>
              )}

              {entryMode === 'qr' && (
                <motion.div
                  key="mode-qr"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  transition={{ duration: 0.18 }}
                  className="space-y-4"
                >
                  <label
                    htmlFor="qr-image-upload"
                    className="flex flex-col items-center justify-center gap-2 p-6 border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-lg cursor-pointer hover:border-blue-500 transition-colors"
                  >
                    <ImageUp className="w-6 h-6 text-slate-500" aria-hidden="true" />
                    <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                      QRコードのスクリーンショット画像 (PNG / JPG) を選択
                    </span>
                    <span className="text-[11px] text-slate-500">
                      画像はブラウザ内でローカル解析され、外部へ送信されません
                    </span>
                    <input
                      id="qr-image-upload"
                      type="file"
                      accept="image/*"
                      onChange={handleQrImageUpload}
                      className="sr-only"
                    />
                  </label>

                  <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800">
                    <span className="text-xs text-slate-600 dark:text-slate-400">
                      カメラを使ってQRコードをスキャン
                    </span>
                    {!cameraActive ? (
                      <motion.button
                        type="button"
                        whileHover={{ scale: 1.03 }}
                        whileTap={{ scale: 0.96 }}
                        onClick={() => void startCameraScan()}
                        className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-1.5"
                      >
                        <Camera className="w-3.5 h-3.5" aria-hidden="true" />
                        カメラを起動
                      </motion.button>
                    ) : (
                      <motion.button
                        type="button"
                        whileHover={{ scale: 1.03 }}
                        whileTap={{ scale: 0.96 }}
                        onClick={stopCamera}
                        className="px-3 py-1.5 rounded-lg border border-red-300 text-red-600 text-xs font-semibold hover:bg-red-50"
                      >
                        カメラを停止
                      </motion.button>
                    )}
                  </div>

                  {cameraActive && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 bg-black aspect-video"
                    >
                      <video
                        ref={videoRef}
                        playsInline
                        muted
                        className="w-full h-full object-cover"
                      />
                    </motion.div>
                  )}
                </motion.div>
              )}

              {entryMode === 'manual' && (
                <motion.form
                  key="mode-manual"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  transition={{ duration: 0.18 }}
                  onSubmit={handleSubmit}
                  className="space-y-4"
                >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="acc-issuer-input"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                >
                  サービス名 *
                </label>
                <input
                  id="acc-issuer-input"
                  type="text"
                  value={issuer}
                  onChange={(e) => setIssuer(e.target.value)}
                  placeholder="例: GitHub, Google, AWS"
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  required
                />
              </div>

              <div>
                <label
                  htmlFor="acc-label-input"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                >
                  アカウント名 / メール *
                </label>
                <input
                  id="acc-label-input"
                  type="text"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="例: dev@example.jp"
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  required
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label
                  htmlFor="acc-secret-input"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                >
                  シークレットキー (Base32) *
                </label>
                <motion.button
                  type="button"
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => {
                    setSecret(generateRandomSecret(20));
                    setShowSecret(true);
                    onToast?.('テスト用シークレットキーを生成しました', 'info');
                  }}
                  className="text-xs text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
                >
                  <RefreshCw className="w-3 h-3" aria-hidden="true" />
                  テスト用シークレット生成
                </motion.button>
              </div>
              <div className="relative">
                <input
                  id="acc-secret-input"
                  type={showSecret ? 'text' : 'password'}
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  placeholder="例: JBSWY3DPEHPK3PXP"
                  className="w-full pl-3 pr-10 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowSecret((v) => !v)}
                  aria-label={showSecret ? 'シークレットを隠す' : 'シークレットを表示'}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-500"
                >
                  {showSecret ? (
                    <EyeOff className="w-4 h-4" aria-hidden="true" />
                  ) : (
                    <Eye className="w-4 h-4" aria-hidden="true" />
                  )}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label
                  htmlFor="acc-algo-select"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                >
                  アルゴリズム
                </label>
                <select
                  id="acc-algo-select"
                  value={algorithm}
                  onChange={(e) => setAlgorithm(e.target.value as TotpAlgorithm)}
                  className="w-full px-2.5 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                >
                  <option value="SHA-1">SHA-1</option>
                  <option value="SHA-256">SHA-256</option>
                  <option value="SHA-512">SHA-512</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="acc-digits-select"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                >
                  桁数
                </label>
                <select
                  id="acc-digits-select"
                  value={digits}
                  onChange={(e) => setDigits(Number(e.target.value) === 8 ? 8 : 6)}
                  className="w-full px-2.5 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                >
                  <option value={6}>6桁</option>
                  <option value={8}>8桁</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="acc-period-select"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                >
                  更新周期
                </label>
                <select
                  id="acc-period-select"
                  value={period}
                  onChange={(e) => setPeriod(Number(e.target.value) === 60 ? 60 : 30)}
                  className="w-full px-2.5 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                >
                  <option value={30}>30秒</option>
                  <option value={60}>60秒</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="acc-folder-input"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                >
                  フォルダ
                </label>
                <input
                  id="acc-folder-input"
                  type="text"
                  list="folder-suggestions"
                  value={folder}
                  onChange={(e) => setFolder(e.target.value)}
                  placeholder="仕事"
                  className="w-full px-2.5 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
                <datalist id="folder-suggestions">
                  {existingFolders.map((f) => (
                    <option key={f} value={f} />
                  ))}
                  <option value="仕事" />
                  <option value="個人" />
                  <option value="開発・クラウド" />
                  <option value="金融・決済" />
                </datalist>
              </div>
            </div>

            <div>
              <label
                htmlFor="acc-recovery-textarea"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
              >
                緊急用リカバリーコード (任意・1行に1つ)
              </label>
              <textarea
                id="acc-recovery-textarea"
                rows={2}
                value={recoveryText}
                onChange={(e) => setRecoveryText(e.target.value)}
                placeholder={'例:\n8492a-19c04\n3f7b2-90e11'}
                className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div>
              <label
                htmlFor="acc-login-url-input"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
              >
                ログインページURL (任意・自動入力連携用)
              </label>
              <input
                id="acc-login-url-input"
                type="url"
                value={loginUrl}
                onChange={(e) => setLoginUrl(e.target.value)}
                placeholder="例: https://github.com/login (未入力でも主要サービスは自動判定)"
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div>
              <label
                htmlFor="acc-note-input"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
              >
                メモ (任意)
              </label>
              <input
                id="acc-note-input"
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="用途やアカウント補足など"
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div className="pt-2 flex items-center justify-end gap-3">
              <motion.button
                type="button"
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.96 }}
                onClick={onClose}
                className="px-4 py-2 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                キャンセル
              </motion.button>
              <motion.button
                type="submit"
                disabled={saving}
                whileHover={{ scale: saving ? 1 : 1.03 }}
                whileTap={{ scale: saving ? 1 : 0.96 }}
                className="px-5 py-2 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-70 text-white inline-flex items-center gap-2"
              >
                {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
                {saving
                  ? 'AES-256-GCMで暗号化して保存中...'
                  : editingAccount
                  ? '変更を保存'
                  : '暗号化して追加'}
              </motion.button>
            </div>
          </motion.form>
        )}
            </AnimatePresence>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
