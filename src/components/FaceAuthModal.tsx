import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Camera,
  CheckCircle2,
  Loader2,
  RefreshCw,
  ScanFace,
  ShieldCheck,
  X,
} from 'lucide-react';
import {
  areEnrollmentSamplesConsistent,
  STRONG_SINGLE_MATCH_THRESHOLD,
} from '../crypto/faceAuthMath';
import {
  detectLiveFace,
  loadFaceModels,
  translateCameraError,
  verifyLiveDescriptorForVault,
} from '../crypto/faceAuthVault';

type ModalPhase =
  | 'loading-models'
  | 'starting-camera'
  | 'scanning'
  | 'completing'
  | 'success'
  | 'error';

interface FaceAuthModalProps {
  open: boolean;
  mode: 'enroll' | 'verify';
  vaultId: string;
  vaultName?: string;
  onClose: () => void;
  onEnrollComplete?: (samples: number[][]) => Promise<void>;
  onVerifySuccess?: (session: {
    key: CryptoKey;
    saltB64: string;
    iterations: number;
    confidencePct: number;
  }) => Promise<void>;
}

const REQUIRED_ENROLL_SAMPLES = 3;

export const FaceAuthModal: React.FC<FaceAuthModalProps> = ({
  open,
  mode,
  vaultId,
  vaultName,
  onClose,
  onEnrollComplete,
  onVerifySuccess,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cancelledRef = useRef<boolean>(false);
  const onCloseRef = useRef(onClose);
  const onEnrollCompleteRef = useRef(onEnrollComplete);
  const onVerifySuccessRef = useRef(onVerifySuccess);

  useEffect(() => {
    onCloseRef.current = onClose;
    onEnrollCompleteRef.current = onEnrollComplete;
    onVerifySuccessRef.current = onVerifySuccess;
  }, [onClose, onEnrollComplete, onVerifySuccess]);

  const [phase, setPhase] = useState<ModalPhase>('loading-models');
  const [statusText, setStatusText] = useState<string>('Web顔認識モデルを準備中...');
  const [errorText, setErrorText] = useState<string>('');
  const [sampleProgress, setSampleProgress] = useState<number>(0);
  const [confidencePct, setConfidencePct] = useState<number | null>(null);
  const [faceDetected, setFaceDetected] = useState<boolean>(false);
  const [attemptSeed, setAttemptSeed] = useState<number>(0);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // ignore
        }
      });
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const drawOverlay = useCallback(
    (
      detection: {
        box: { x: number; y: number; width: number; height: number };
        landmarks: Array<{ x: number; y: number }>;
      } | null,
      matched: boolean
    ) => {
      const canvas = canvasRef.current;
      const video = videoRef.current;
      if (!canvas || !video) return;
      const w = video.videoWidth || 640;
      const h = video.videoHeight || 480;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, w, h);
      if (!detection) return;

      // Mirror horizontally to align with CSS scaleX(-1) video preview
      ctx.save();
      ctx.translate(w, 0);
      ctx.scale(-1, 1);

      const { x, y, width, height } = detection.box;
      const accent = matched ? '#10b981' : '#3b82f6';
      ctx.strokeStyle = accent;
      ctx.lineWidth = 3;

      const corner = Math.min(28, width * 0.22, height * 0.22);
      ctx.beginPath();
      // Top-left
      ctx.moveTo(x, y + corner);
      ctx.lineTo(x, y);
      ctx.lineTo(x + corner, y);
      // Top-right
      ctx.moveTo(x + width - corner, y);
      ctx.lineTo(x + width, y);
      ctx.lineTo(x + width, y + corner);
      // Bottom-right
      ctx.moveTo(x + width, y + height - corner);
      ctx.lineTo(x + width, y + height);
      ctx.lineTo(x + width - corner, y + height);
      // Bottom-left
      ctx.moveTo(x + corner, y + height);
      ctx.lineTo(x, y + height);
      ctx.lineTo(x, y + height - corner);
      ctx.stroke();

      // Subtle 68-point facial landmark mesh dots
      ctx.fillStyle = matched ? 'rgba(16, 185, 129, 0.8)' : 'rgba(96, 165, 250, 0.78)';
      for (const pt of detection.landmarks) {
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 1.8, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    },
    []
  );

  useEffect(() => {
    if (!open) {
      cancelledRef.current = true;
      stopCamera();
      return;
    }

    cancelledRef.current = false;
    setPhase('loading-models');
    setErrorText('');
    setSampleProgress(0);
    setConfidencePct(null);
    setFaceDetected(false);
    setStatusText('Web顔認識エンジンとモデルを読み込み中...');

    let loopTimer: number | undefined;

    const runPipeline = async () => {
      try {
        await loadFaceModels((msg) => {
          if (!cancelledRef.current) setStatusText(msg);
        });
        if (cancelledRef.current) return;

        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error(
            'このブラウザは Webカメラ (getUserMedia) に対応していません。'
          );
        }

        setPhase('starting-camera');
        setStatusText('カメラを起動しています...');

        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'user',
            width: { ideal: 640 },
            height: { ideal: 480 },
          },
          audio: false,
        });

        if (cancelledRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) {
          throw new Error('カメラ映像の初期化に失敗しました。');
        }
        video.muted = true;
        video.playsInline = true;
        video.autoplay = true;
        video.srcObject = stream;
        await Promise.race([
          video.play().catch(() => {}),
          new Promise((resolve) => window.setTimeout(resolve, 1200)),
        ]);

        if (cancelledRef.current) return;

        setPhase('scanning');
        setStatusText(
          mode === 'enroll'
            ? '枠内に顔を映してください（自動で3サンプル取得します）'
            : '登録済みの顔と照合しています。カメラ正面をご覧ください'
        );

        const collectedSamples: number[][] = [];
        let consecutiveMatches = 0;

        const scanTick = async () => {
          if (cancelledRef.current) return;
          const v = videoRef.current;
          if (!v || v.readyState < 2 || v.videoWidth === 0 || v.videoHeight === 0) {
            loopTimer = window.setTimeout(() => void scanTick(), 150);
            return;
          }

          try {
            const live = await detectLiveFace(v);
            if (cancelledRef.current) return;

            if (!live) {
              setFaceDetected(false);
              drawOverlay(null, false);
              if (mode === 'verify') {
                consecutiveMatches = 0;
                setConfidencePct(null);
                setStatusText('顔を検出しています... 明るい場所でカメラ正面を向いてください');
              } else if (collectedSamples.length === 0) {
                setStatusText('枠内に顔が収まるよう調整してください');
              }
              loopTimer = window.setTimeout(() => void scanTick(), 180);
              return;
            }

            setFaceDetected(true);

            if (mode === 'enroll') {
              drawOverlay(live, false);
              if (live.score < 0.52) {
                setStatusText('顔をもう少しはっきり映してください');
                loopTimer = window.setTimeout(() => void scanTick(), 200);
                return;
              }

              collectedSamples.push(live.descriptor);
              if (
                collectedSamples.length >= 2 &&
                !areEnrollmentSamplesConsistent(collectedSamples)
              ) {
                collectedSamples.length = 0;
                setSampleProgress(0);
                setStatusText('ブレが検出されました。動かずに正面を向いてください...');
                loopTimer = window.setTimeout(() => void scanTick(), 300);
                return;
              }

              setSampleProgress(collectedSamples.length);
              setStatusText(
                `顔特徴ベクトルを抽出中 (${collectedSamples.length} / ${REQUIRED_ENROLL_SAMPLES})...`
              );

              if (collectedSamples.length >= REQUIRED_ENROLL_SAMPLES) {
                drawOverlay(live, true);
                setPhase('completing');
                setStatusText('128次元特徴データと暗号鍵を安全に紐付け中...');
                await onEnrollCompleteRef.current?.(collectedSamples);
                if (cancelledRef.current) return;
                setPhase('success');
                setStatusText('Web顔認証の登録が完了しました');
                stopCamera();
                window.setTimeout(() => {
                  if (!cancelledRef.current) onCloseRef.current();
                }, 550);
                return;
              }

              loopTimer = window.setTimeout(() => void scanTick(), 220);
              return;
            }

            // mode === 'verify'
            const outcome = await verifyLiveDescriptorForVault(vaultId, live.descriptor);
            if (cancelledRef.current) return;

            setConfidencePct(outcome.confidencePct);
            drawOverlay(live, outcome.matched);

            if (outcome.matched && outcome.session) {
              consecutiveMatches += 1;
              if (
                outcome.bestDistance <= STRONG_SINGLE_MATCH_THRESHOLD ||
                consecutiveMatches >= 2
              ) {
                setPhase('completing');
                setStatusText(`本人確認完了 (一致度 ${outcome.confidencePct}%) — ボルトを復号中...`);
                await onVerifySuccessRef.current?.({
                  ...outcome.session,
                  confidencePct: outcome.confidencePct,
                });
                if (cancelledRef.current) return;
                setPhase('success');
                stopCamera();
                return;
              }
              setStatusText(`一致を確認中... (${outcome.confidencePct}%)`);
            } else {
              consecutiveMatches = 0;
              setStatusText(
                `照合中 (一致度 ${outcome.confidencePct}%) — 登録時と同じ角度で正面をご覧ください`
              );
            }
          } catch (err) {
            if (!cancelledRef.current) {
              setPhase('error');
              setErrorText(translateCameraError(err));
              stopCamera();
            }
            return;
          }

          loopTimer = window.setTimeout(() => void scanTick(), 180);
        };

        loopTimer = window.setTimeout(() => void scanTick(), 200);
      } catch (err) {
        if (!cancelledRef.current) {
          setPhase('error');
          setErrorText(translateCameraError(err));
          stopCamera();
        }
      }
    };

    void runPipeline();

    return () => {
      cancelledRef.current = true;
      if (loopTimer !== undefined) {
        window.clearTimeout(loopTimer);
      }
      stopCamera();
    };
  }, [
    open,
    mode,
    vaultId,
    attemptSeed,
    drawOverlay,
    stopCamera,
  ]);

  const handleClose = () => {
    cancelledRef.current = true;
    stopCamera();
    onClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="face-auth-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="face-auth-modal-title"
          data-testid="face-auth-modal"
          data-phase={phase}
          data-confidence={confidencePct ?? ''}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-md flex items-center justify-center p-4"
        >
          <motion.div
            key="face-auth-card"
            initial={{ opacity: 0, scale: 0.92, y: 18 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: 14 }}
            transition={{ type: 'spring', stiffness: 360, damping: 28 }}
            className="glass-modal rounded-3xl w-full max-w-md p-5 sm:p-6 space-y-4 text-slate-900 dark:text-slate-100"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-9 h-9 rounded-xl glass-primary-btn flex items-center justify-center shrink-0">
                  <ScanFace className="w-5 h-5 text-white" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <h2 id="face-auth-modal-title" className="text-sm font-bold truncate">
                    {mode === 'enroll'
                      ? 'Webカメラ顔認証を登録'
                      : 'Webカメラ顔認証でロック解除'}
                  </h2>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                    端末OSに依存しないブラウザ完結型AI顔認識 · ボルト「{vaultName || vaultId}」
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleClose}
                aria-label="閉じる"
                className="p-1.5 rounded-xl glass-btn shrink-0"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            {/* Camera Viewfinder */}
            <div className="relative aspect-[4/3] w-full rounded-2xl overflow-hidden bg-slate-900/90 border border-white/20 shadow-inner flex items-center justify-center">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover"
                style={{ transform: 'scaleX(-1)' }}
              />
              <canvas
                ref={canvasRef}
                className="absolute inset-0 w-full h-full object-cover pointer-events-none"
              />

              {(phase === 'loading-models' || phase === 'starting-camera') && (
                <div className="absolute inset-0 bg-slate-950/65 backdrop-blur-sm flex flex-col items-center justify-center gap-3 text-white p-4 text-center">
                  <Loader2 className="w-8 h-8 animate-spin text-blue-400" aria-hidden="true" />
                  <p className="text-xs font-medium">{statusText}</p>
                </div>
              )}

              {phase === 'success' && (
                <div className="absolute inset-0 bg-emerald-950/65 backdrop-blur-sm flex flex-col items-center justify-center gap-2 text-white p-4 text-center">
                  <CheckCircle2 className="w-10 h-10 text-emerald-400" aria-hidden="true" />
                  <p className="text-sm font-bold">{statusText}</p>
                </div>
              )}

              {phase === 'error' && (
                <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm flex flex-col items-center justify-center gap-3 text-white p-5 text-center">
                  <Camera className="w-8 h-8 text-red-400" aria-hidden="true" />
                  <p className="text-xs leading-relaxed text-red-200">{errorText}</p>
                  <button
                    type="button"
                    onClick={() => setAttemptSeed((s) => s + 1)}
                    className="px-4 py-2 text-xs font-semibold rounded-xl glass-primary-btn inline-flex items-center gap-1.5"
                  >
                    <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                    カメラを再試行
                  </button>
                </div>
              )}

              {/* Live status chip inside camera top */}
              {phase === 'scanning' && (
                <div className="absolute top-3 left-3 right-3 flex items-center justify-between gap-2 pointer-events-none">
                  <span className="px-2.5 py-1 rounded-lg bg-slate-950/65 backdrop-blur-md text-[11px] font-medium text-white inline-flex items-center gap-1.5">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        faceDetected ? 'bg-emerald-400' : 'bg-blue-400 animate-pulse'
                      }`}
                    />
                    {faceDetected ? '顔を検出中' : '待機中'}
                  </span>
                  {mode === 'verify' && confidencePct !== null && (
                    <span className="px-2.5 py-1 rounded-lg bg-slate-950/65 backdrop-blur-md text-[11px] font-mono tabular-nums text-white">
                      一致度 {confidencePct}%
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Progress & Status */}
            <div className="space-y-2">
              {mode === 'enroll' && (
                <div className="h-1.5 w-full rounded-full bg-slate-900/10 dark:bg-white/10 overflow-hidden">
                  <motion.div
                    initial={{ width: '0%' }}
                    animate={{
                      width: `${Math.round((sampleProgress / REQUIRED_ENROLL_SAMPLES) * 100)}%`,
                    }}
                    transition={{ type: 'spring', stiffness: 280, damping: 24 }}
                    className="h-full rounded-full bg-blue-600 dark:bg-blue-400"
                  />
                </div>
              )}

              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="text-slate-700 dark:text-slate-200 font-medium">
                  {phase === 'error' ? 'カメラを利用できません' : statusText}
                </span>
              </div>

              <div className="p-3 rounded-xl glass-subtle flex items-start gap-2 text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
                <ShieldCheck className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" aria-hidden="true" />
                <span>
                  顔画像そのものは保存されません。ブラウザ内のAIモデルが抽出した128次元の数値特徴ベクトルと暗号鍵のみをこのブラウザ内にローカル保持し、サーバーへ顔データを送信することはありません。
                </span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={handleClose}
                className="px-4 py-2 text-xs font-semibold rounded-xl glass-btn text-slate-700 dark:text-slate-200"
              >
                {mode === 'verify' ? 'パスフレーズで解除に戻る' : 'キャンセル'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
