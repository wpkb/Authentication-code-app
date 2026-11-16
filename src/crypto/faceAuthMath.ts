export const FACE_DESCRIPTOR_LENGTH = 128;
export const DEFAULT_FACE_MATCH_THRESHOLD = 0.35;
export const MAX_SAMPLE_MEDIAN_THRESHOLD = 0.37;
export const MIN_COSINE_SIMILARITY = 0.935;
export const PASS_CONFIDENCE_PCT = 90;
export const MAX_ENROLLMENT_SAMPLE_SPREAD = 0.32;
export const REQUIRED_ENROLL_SAMPLES = 5;
export const REQUIRED_CONSECUTIVE_MATCHES = 3;

export interface FaceMatchEvaluation {
  matched: boolean;
  bestDistance: number;
  centroidDistance: number;
  medianDistance: number;
  cosineSimilarity: number;
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

export function cosineSimilarity(
  a: ArrayLike<number>,
  b: ArrayLike<number>
): number {
  if (a.length === 0 || a.length !== b.length) {
    throw new Error('顔特徴ベクトルの次元が一致しません。');
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const va = a[i];
    const vb = b[i];
    dot += va * vb;
    normA += va * va;
    normB += vb * vb;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0 || !Number.isFinite(denom)) return 0;
  return dot / denom;
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
  threshold = DEFAULT_FACE_MATCH_THRESHOLD,
  cosineSim?: number
): number {
  if (!Number.isFinite(distance) || distance < 0) return 0;
  let pct: number;
  if (distance <= 0.12) {
    pct = 99;
  } else if (distance <= threshold) {
    // Strict passing band: 0.12 -> 99%, 0.35 (pass cutoff) -> 90%
    const ratio = (distance - 0.12) / Math.max(0.01, threshold - 0.12);
    pct = Math.round(99 - ratio * (99 - PASS_CONFIDENCE_PCT));
  } else if (distance <= 0.48) {
    // Reject near-miss strangers clearly below 90%: 0.35 -> 89%, 0.48 -> 55%
    const nearRatio = (distance - threshold) / Math.max(0.01, 0.48 - threshold);
    pct = Math.round(89 - nearRatio * 34);
  } else {
    const tailRatio = (distance - 0.48) / 0.26;
    pct = Math.max(0, Math.round(55 * (1 - tailRatio)));
  }

  if (cosineSim !== undefined && cosineSim < MIN_COSINE_SIMILARITY) {
    pct = Math.min(pct, PASS_CONFIDENCE_PCT - 2);
  }
  return Math.max(0, Math.min(99, pct));
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
    return {
      matched: false,
      bestDistance: Infinity,
      centroidDistance: Infinity,
      medianDistance: Infinity,
      cosineSimilarity: 0,
      confidencePct: 0,
    };
  }

  // index 0 is centroid when multiple references exist; remaining entries are individual enrolled samples
  const centroid = referenceDescriptors[0];
  const samples =
    referenceDescriptors.length > 1
      ? referenceDescriptors.slice(1)
      : referenceDescriptors;

  const centroidDistance = euclideanDistance(liveDescriptor, centroid);
  const cos = cosineSimilarity(liveDescriptor, centroid);

  const sampleDistances = samples
    .map((ref) => euclideanDistance(liveDescriptor, ref))
    .sort((a, b) => a - b);
  const bestDistance = Math.min(centroidDistance, sampleDistances[0] ?? Infinity);
  const midIdx = Math.floor(sampleDistances.length / 2);
  const medianDistance =
    sampleDistances.length % 2 === 1
      ? sampleDistances[midIdx]
      : ((sampleDistances[midIdx - 1] ?? centroidDistance) +
          (sampleDistances[midIdx] ?? centroidDistance)) /
        2;

  const confidencePct = distanceToConfidencePct(centroidDistance, threshold, cos);
  const medianLimit = threshold + (MAX_SAMPLE_MEDIAN_THRESHOLD - DEFAULT_FACE_MATCH_THRESHOLD);

  const matched =
    centroidDistance <= threshold &&
    medianDistance <= medianLimit &&
    cos >= MIN_COSINE_SIMILARITY &&
    confidencePct >= PASS_CONFIDENCE_PCT;

  return {
    matched,
    bestDistance,
    centroidDistance,
    medianDistance,
    cosineSimilarity: cos,
    confidencePct,
  };
}
