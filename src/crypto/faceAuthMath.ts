export const FACE_DESCRIPTOR_LENGTH = 128;
export const DEFAULT_FACE_MATCH_THRESHOLD = 0.48;
export const STRONG_SINGLE_MATCH_THRESHOLD = 0.42;
export const MAX_ENROLLMENT_SAMPLE_SPREAD = 0.44;

export interface FaceMatchEvaluation {
  matched: boolean;
  bestDistance: number;
  confidencePct: number;
}

export function euclideanDistance(
  a: ArrayLike<number>,
  b: ArrayLike<number>
): number {
  if (a.length === 0 || a.length !== b.length) {
    throw new Error('顔特徴ベクトルの次元が一致しません。');
  }
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

export function averageDescriptors(samples: ArrayLike<number>[]): number[] {
  if (samples.length === 0) {
    throw new Error('平均化する顔特徴サンプルがありません。');
  }
  const dims = samples[0].length;
  if (dims === 0) {
    throw new Error('顔特徴ベクトルが空です。');
  }
  const acc = new Array<number>(dims).fill(0);
  for (const sample of samples) {
    if (sample.length !== dims) {
      throw new Error('サンプル間のベクトル次元が一致しません。');
    }
    for (let i = 0; i < dims; i++) {
      acc[i] += sample[i];
    }
  }
  for (let i = 0; i < dims; i++) {
    acc[i] /= samples.length;
  }
  return acc;
}

export function distanceToConfidencePct(
  distance: number,
  threshold = DEFAULT_FACE_MATCH_THRESHOLD
): number {
  if (!Number.isFinite(distance) || distance < 0) return 0;
  if (distance <= 0.12) return 99;
  // Linear scale: 0.12 -> 99%, threshold (0.48) -> 70%, 0.90 -> 0%
  if (distance <= threshold) {
    const ratio = (distance - 0.12) / Math.max(0.01, threshold - 0.12);
    return Math.round(99 - ratio * 29);
  }
  const tailRatio = (distance - threshold) / Math.max(0.01, 0.9 - threshold);
  return Math.max(0, Math.round(70 * (1 - tailRatio)));
}

export function areEnrollmentSamplesConsistent(
  samples: ArrayLike<number>[],
  maxSpread = MAX_ENROLLMENT_SAMPLE_SPREAD
): boolean {
  if (samples.length < 2) return samples.length === 1;
  for (let i = 0; i < samples.length; i++) {
    for (let j = i + 1; j < samples.length; j++) {
      if (euclideanDistance(samples[i], samples[j]) > maxSpread) {
        return false;
      }
    }
  }
  return true;
}

export function evaluateFaceMatch(
  liveDescriptor: ArrayLike<number>,
  referenceDescriptors: number[][],
  threshold = DEFAULT_FACE_MATCH_THRESHOLD
): FaceMatchEvaluation {
  if (referenceDescriptors.length === 0) {
    return { matched: false, bestDistance: Infinity, confidencePct: 0 };
  }
  let bestDistance = Infinity;
  for (const ref of referenceDescriptors) {
    const d = euclideanDistance(liveDescriptor, ref);
    if (d < bestDistance) {
      bestDistance = d;
    }
  }
  return {
    matched: bestDistance <= threshold,
    bestDistance,
    confidencePct: distanceToConfidencePct(bestDistance, threshold),
  };
}
