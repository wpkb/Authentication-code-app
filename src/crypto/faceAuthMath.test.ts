import test from 'node:test';
import assert from 'node:assert/strict';
import {
  areEnrollmentSamplesConsistent,
  averageDescriptors,
  cosineSimilarity,
  distanceToConfidencePct,
  euclideanDistance,
  evaluateFaceMatch,
} from './faceAuthMath';

function makeNormalizedVector(seed: number, length = 128): number[] {
  const raw = Array.from({ length }, (_, idx) => Math.sin(seed * 17.3 + idx * 0.71) + Math.cos(seed * 3.1 - idx * 0.23));
  const norm = Math.sqrt(raw.reduce((acc, v) => acc + v * v, 0));
  return raw.map((v) => v / norm);
}

test('euclideanDistance and cosineSimilarity compute exact geometric metrics', () => {
  assert.equal(euclideanDistance([0, 0, 0], [3, 4, 0]), 5);
  assert.throws(() => euclideanDistance([1, 2], [1, 2, 3]));
  assert.ok(Math.abs(cosineSimilarity([1, 0, 0], [1, 0, 0]) - 1) < 1e-9);
  assert.ok(Math.abs(cosineSimilarity([1, 0, 0], [0, 1, 0])) < 1e-9);
});

test('averageDescriptors computes centroid across 128-d face embeddings', () => {
  const s1 = makeNormalizedVector(1);
  const s2 = makeNormalizedVector(1);
  const avg = averageDescriptors([s1, s2]);
  assert.equal(avg.length, 128);
  assert.ok(Math.abs(avg[0] - s1[0]) < 1e-9);
});

test('areEnrollmentSamplesConsistent accepts tight cluster and rejects outliers', () => {
  const a = makeNormalizedVector(1);
  const b = a.map((v, i) => v + (i % 2 === 0 ? 0.005 : -0.005));
  const outlier = makeNormalizedVector(42);

  assert.equal(areEnrollmentSamplesConsistent([a, b]), true);
  assert.equal(areEnrollmentSamplesConsistent([a, b, outlier]), false);
});

test('evaluateFaceMatch requires >=90% strict match and rejects strangers even at near-miss distances', () => {
  const sample1 = makeNormalizedVector(3);
  const sample2 = sample1.map((v, i) => v + (i % 3 === 0 ? 0.006 : -0.004));
  const centroid = averageDescriptors([sample1, sample2]);
  const enrolled = [centroid, sample1, sample2];

  // Genuine user live vector (tiny noise, distance ~0.06, cosine > 0.995)
  const genuine = sample1.map((v, i) => v + (i % 4 === 0 ? 0.005 : -0.003));
  const ok = evaluateFaceMatch(genuine, enrolled);
  assert.equal(ok.matched, true);
  assert.ok(ok.confidencePct >= 95);
  assert.ok(ok.cosineSimilarity >= 0.99);

  // Near-miss stranger (distance ~0.43, which passed old 0.48 threshold!) MUST FAIL now
  const nearMissBase = makeNormalizedVector(9);
  const nearMiss = centroid.map((v, i) => v * 0.89 + nearMissBase[i] * 0.45);
  const nearResult = evaluateFaceMatch(nearMiss, enrolled);
  assert.equal(nearResult.matched, false);
  assert.ok(nearResult.confidencePct < 90);

  // Completely different person
  const stranger = makeNormalizedVector(77);
  const fail = evaluateFaceMatch(stranger, enrolled);
  assert.equal(fail.matched, false);
  assert.ok(distanceToConfidencePct(fail.centroidDistance) < 50);
});
