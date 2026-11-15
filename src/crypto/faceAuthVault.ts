import {
  averageDescriptors,
  DEFAULT_FACE_MATCH_THRESHOLD,
  evaluateFaceMatch,
  type FaceMatchEvaluation,
} from './faceAuthMath';

const FACE_DB_NAME = 'kagivault_inweb_face_auth';
const FACE_STORE_NAME = 'face_vaults';
const FACE_DB_VERSION = 1;
const FACE_ENROLLED_INDEX_KEY = 'kv_face_enrolled_ids';
const MODEL_URI = '/models/face-api';

export interface InWebFaceVaultRecord {
  vaultId: string;
  descriptors: number[][];
  key: CryptoKey;
  saltB64: string;
  iterations: number;
  enrolledAt: string;
  sampleCount: number;
}

export interface CameraCapabilities {
  supported: boolean;
  secureContext: boolean;
}

export interface LiveFaceDetection {
  box: { x: number; y: number; width: number; height: number };
  score: number;
  landmarks: Array<{ x: number; y: number }>;
  descriptor: number[];
}

export interface FaceVerifyOutcome extends FaceMatchEvaluation {
  session?: {
    key: CryptoKey;
    saltB64: string;
    iterations: number;
  };
}

type FaceApiModule = typeof import('@vladmandic/face-api');

let faceApiPromise: Promise<FaceApiModule> | null = null;
let modelsLoadPromise: Promise<FaceApiModule> | null = null;

async function getFaceApi(): Promise<FaceApiModule> {
  if (!faceApiPromise) {
    faceApiPromise = import('@vladmandic/face-api');
  }
  return faceApiPromise;
}

let scratchCanvas: HTMLCanvasElement | null = null;

function isSoftwareWebGLRenderer(): boolean {
  try {
    const probe = document.createElement('canvas');
    const gl =
      (probe.getContext('webgl2') as WebGL2RenderingContext | null) ||
      (probe.getContext('webgl') as WebGLRenderingContext | null);
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (!ext) return false;
    const renderer = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '');
    return /swiftshader|llvmpipe|software|subzero/i.test(renderer);
  } catch {
    return false;
  }
}

export async function loadFaceModels(
  onStep?: (message: string) => void
): Promise<FaceApiModule> {
  if (!modelsLoadPromise) {
    modelsLoadPromise = (async () => {
      onStep?.('Web顔認識エンジンを読み込み中...');
      const faceapi = await getFaceApi();
      const tfRef = (faceapi as unknown as {
        tf?: {
          setBackend?: (name: string) => Promise<boolean>;
          ready?: () => Promise<void>;
        };
      }).tf;
      if (tfRef?.setBackend && isSoftwareWebGLRenderer()) {
        try {
          await tfRef.setBackend('cpu');
        } catch {
          // keep default backend if cpu unavailable
        }
      }
      if (tfRef?.ready) {
        await tfRef.ready();
      }

      onStep?.('顔検出・68点特徴点・128次元識別モデルを読み込み中...');
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URI),
        faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URI),
        faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URI),
      ]);
      return faceapi;
    })().catch((err) => {
      modelsLoadPromise = null;
      throw err;
    });
  }
  return modelsLoadPromise;
}

export async function detectLiveFace(
  input: HTMLVideoElement | HTMLCanvasElement
): Promise<LiveFaceDetection | null> {
  const faceapi = await loadFaceModels();
  const options = new faceapi.TinyFaceDetectorOptions({
    inputSize: 224,
    scoreThreshold: 0.45,
  });

  const srcWidth = input instanceof HTMLVideoElement ? input.videoWidth : input.width;
  const srcHeight = input instanceof HTMLVideoElement ? input.videoHeight : input.height;
  if (!srcWidth || !srcHeight) return null;

  const targetWidth = Math.min(400, srcWidth);
  const scale = targetWidth / srcWidth;
  const targetHeight = Math.max(1, Math.round(srcHeight * scale));

  if (!scratchCanvas) {
    scratchCanvas = document.createElement('canvas');
  }
  if (scratchCanvas.width !== targetWidth || scratchCanvas.height !== targetHeight) {
    scratchCanvas.width = targetWidth;
    scratchCanvas.height = targetHeight;
  }
  const ctx = scratchCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(input, 0, 0, targetWidth, targetHeight);

  const detection = await faceapi
    .detectSingleFace(scratchCanvas, options)
    .withFaceLandmarks(true)
    .withFaceDescriptor();

  if (!detection) return null;

  const invScale = 1 / scale;
  const { box, score } = detection.detection;
  return {
    box: {
      x: box.x * invScale,
      y: box.y * invScale,
      width: box.width * invScale,
      height: box.height * invScale,
    },
    score,
    landmarks: detection.landmarks.positions.map((pt) => ({
      x: pt.x * invScale,
      y: pt.y * invScale,
    })),
    descriptor: Array.from(detection.descriptor),
  };
}

export function detectCameraCapabilities(): CameraCapabilities {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return { supported: false, secureContext: false };
  }
  const supported = typeof navigator.mediaDevices?.getUserMedia === 'function';
  return {
    supported,
    secureContext: Boolean(window.isSecureContext),
  };
}

export function translateCameraError(err: unknown): string {
  if (err instanceof DOMException) {
    switch (err.name) {
      case 'NotAllowedError':
      case 'PermissionDeniedError':
        return 'カメラの使用が許可されませんでした。ブラウザのアドレスバー付近のカメラ権限を確認してください。';
      case 'NotFoundError':
      case 'DevicesNotFoundError':
        return '利用可能なカメラ（Webカメラ・インカメラ）が見つかりませんでした。';
      case 'NotReadableError':
      case 'TrackStartError':
        return 'カメラが他のアプリで使用中のため起動できませんでした。';
      case 'OverconstrainedError':
        return 'カメラ解像度の設定に対応していません。';
      default:
        return `カメラ起動エラー (${err.name}): ${err.message}`;
    }
  }
  if (err instanceof Error) {
    return err.message;
  }
  return 'Webカメラの起動または顔認証処理に失敗しました。';
}

export function getEnrolledFaceVaultIds(): string[] {
  try {
    const raw = localStorage.getItem(FACE_ENROLLED_INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === 'string' && id.length > 0);
  } catch {
    return [];
  }
}

function saveEnrolledFaceVaultIds(ids: string[]): void {
  try {
    const unique = Array.from(new Set(ids));
    if (unique.length === 0) {
      localStorage.removeItem(FACE_ENROLLED_INDEX_KEY);
    } else {
      localStorage.setItem(FACE_ENROLLED_INDEX_KEY, JSON.stringify(unique));
    }
  } catch {
    // ignore storage errors
  }
}

function openFaceDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(FACE_DB_NAME, FACE_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(FACE_STORE_NAME)) {
        db.createObjectStore(FACE_STORE_NAME, { keyPath: 'vaultId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function syncEnrolledFaceVaultIds(): Promise<string[]> {
  try {
    const db = await openFaceDb();
    const ids = await new Promise<string[]>((resolve, reject) => {
      const tx = db.transaction(FACE_STORE_NAME, 'readonly');
      const store = tx.objectStore(FACE_STORE_NAME);
      const req = store.getAllKeys();
      req.onsuccess = () =>
        resolve((req.result as IDBValidKey[]).map((k) => String(k)));
      req.onerror = () => reject(req.error);
    });
    db.close();
    saveEnrolledFaceVaultIds(ids);
    return ids;
  } catch {
    return getEnrolledFaceVaultIds();
  }
}

export async function getEnrolledFaceRecord(
  vaultId: string
): Promise<InWebFaceVaultRecord | null> {
  try {
    const db = await openFaceDb();
    const record = await new Promise<InWebFaceVaultRecord | null>((resolve, reject) => {
      const tx = db.transaction(FACE_STORE_NAME, 'readonly');
      const store = tx.objectStore(FACE_STORE_NAME);
      const req = store.get(vaultId);
      req.onsuccess = () => resolve((req.result as InWebFaceVaultRecord) ?? null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return record;
  } catch {
    return null;
  }
}

export async function saveEnrolledFaceForVault(params: {
  vaultId: string;
  samples: number[][];
  key: CryptoKey;
  saltB64: string;
  iterations: number;
}): Promise<string[]> {
  if (params.samples.length === 0) {
    throw new Error('顔特徴データのサンプルが取得できませんでした。');
  }

  const centroid = averageDescriptors(params.samples);
  const record: InWebFaceVaultRecord = {
    vaultId: params.vaultId,
    descriptors: [centroid, ...params.samples],
    key: params.key,
    saltB64: params.saltB64,
    iterations: params.iterations,
    enrolledAt: new Date().toISOString(),
    sampleCount: params.samples.length,
  };

  const db = await openFaceDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(FACE_STORE_NAME, 'readwrite');
    const store = tx.objectStore(FACE_STORE_NAME);
    store.put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();

  return await syncEnrolledFaceVaultIds();
}

export async function updateFaceVaultKey(params: {
  vaultId: string;
  key: CryptoKey;
  saltB64: string;
  iterations: number;
}): Promise<void> {
  const existing = await getEnrolledFaceRecord(params.vaultId);
  if (!existing) return;
  const db = await openFaceDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(FACE_STORE_NAME, 'readwrite');
    const store = tx.objectStore(FACE_STORE_NAME);
    store.put({
      ...existing,
      key: params.key,
      saltB64: params.saltB64,
      iterations: params.iterations,
    } satisfies InWebFaceVaultRecord);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function verifyLiveDescriptorForVault(
  vaultId: string,
  liveDescriptor: number[],
  threshold = DEFAULT_FACE_MATCH_THRESHOLD
): Promise<FaceVerifyOutcome> {
  const record = await getEnrolledFaceRecord(vaultId);
  if (!record) {
    saveEnrolledFaceVaultIds(
      getEnrolledFaceVaultIds().filter((id) => id !== vaultId)
    );
    throw new Error(
      'このブラウザにボルトのWeb顔認証データが登録されていません。パスフレーズで解除後、再登録してください。'
    );
  }

  const result = evaluateFaceMatch(liveDescriptor, record.descriptors, threshold);
  if (!result.matched) {
    return result;
  }

  return {
    ...result,
    session: {
      key: record.key,
      saltB64: record.saltB64,
      iterations: record.iterations,
    },
  };
}

export async function removeFaceForVault(vaultId: string): Promise<string[]> {
  try {
    const db = await openFaceDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(FACE_STORE_NAME, 'readwrite');
      const store = tx.objectStore(FACE_STORE_NAME);
      store.delete(vaultId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // ignore
  }
  const next = getEnrolledFaceVaultIds().filter((id) => id !== vaultId);
  saveEnrolledFaceVaultIds(next);
  return await syncEnrolledFaceVaultIds();
}

export async function clearAllFaceVaultKeys(): Promise<void> {
  saveEnrolledFaceVaultIds([]);
  try {
    const db = await openFaceDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(FACE_STORE_NAME, 'readwrite');
      const store = tx.objectStore(FACE_STORE_NAME);
      store.clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // ignore
  }
}
