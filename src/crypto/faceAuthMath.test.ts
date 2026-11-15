import test from 'node:test';
import assert from 'node:assert/strict';
import {
  areEnrollmentSamplesConsistent,
  averageDescriptors,
  distanceToConfidencePct,
  euclideanDistance,
  evaluateFaceMatch,
} from './faceAuthMath';

function makeVector(base: number, length = 128): number[] {
  return Array.from({ length }, (_, idx) => base + (idx % 5) * 0.001);
}

test('euclideanDistance calculates exact L2 distance and validates length', () => {
  assert.equal(euclideanDistance([0, 0, 0], [3, 4, 0]), 5);
  assert.throws(() => euclideanDistance([1, 2], [1, 2, 3]));
});

test('averageDescriptors computes centroid across 128-d face embeddings', () => {
  const s1 = makeVector(0.1);
  const s2 = makeVector(0.3);
  const avg = averageDescriptors([s1, s2]);
  assert.equal(avg.length, 128);
  assert.ok(Math.abs(avg[0] - 0.2) < 1e-9);
});

test('areEnrollmentSamplesConsistent accepts tight cluster and rejects outliers', () => {
  const a = makeVector(0.1);
  const b = makeVector(0.11);
  const outlier = makeVector(0.8);

  assert.equal(areEnrollmentSamplesConsistent([a, b]), true);
  assert.equal(areEnrollmentSamplesConsistent([a, b, outlier]), false);
});

test('evaluateFaceMatch matches close face descriptors and rejects distant ones', () => {
  const enrolled = [makeVector(0.2)];
  const sameUser = makeVector(0.21);
  const imposter = makeVector(0.4); // 128 dims * (0.2)^2 = sqrt(5.12) ~ 2.26

  const ok = evaluateFaceMatch(sameUser, enrolled);
  assert.equal(ok.matched, true);
  assert.ok(ok.confidencePct >= 80);

  const fail = evaluateFaceMatch(imposter, enrolled);
  assert.equal(fail.matched, false);
  assert.equal(distanceToConfidencePct(fail.bestDistance), 0);
});
