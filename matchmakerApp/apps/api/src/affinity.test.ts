import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { HALF_LIFE_SECONDS, decayFactor, effectiveWeight } from './affinity';
import { bandFor, describeAffinity } from './matching';

describe('decayFactor', () => {
  test('is 1 for something that just happened', () => {
    assert.equal(decayFactor(0), 1);
  });

  test('is a half after one half-life', () => {
    assert.ok(Math.abs(decayFactor(HALF_LIFE_SECONDS) - 0.5) < 1e-9);
  });

  test('is a quarter after two', () => {
    assert.ok(Math.abs(decayFactor(HALF_LIFE_SECONDS * 2) - 0.25) < 1e-9);
  });

  test('falls off with age, never below zero', () => {
    assert.ok(decayFactor(HALF_LIFE_SECONDS * 10) < 0.01);
    assert.ok(decayFactor(HALF_LIFE_SECONDS * 100) >= 0);
  });
});

describe('effectiveWeight', () => {
  const now = new Date('2026-01-01T00:00:00.000Z');

  test('is the net approval, full weight when fresh', () => {
    const weight = effectiveWeight({
      likes: 3,
      dislikes: 0,
      lastActivityAt: now,
      now,
    });
    assert.equal(weight, 3);
  });

  test('is negative for a tag somebody has pushed away', () => {
    const weight = effectiveWeight({
      likes: 1,
      dislikes: 4,
      lastActivityAt: now,
      now,
    });
    assert.equal(weight, -3);
  });

  test('decays with age', () => {
    const stale = effectiveWeight({
      likes: 3,
      dislikes: 0,
      lastActivityAt: new Date(now.getTime() - HALF_LIFE_SECONDS * 1000),
      now,
    });
    const fresh = effectiveWeight({ likes: 3, dislikes: 0, lastActivityAt: now, now });

    assert.ok(stale < fresh);
    assert.ok(stale >= 0);
  });

  test('does not decay a negative opinion into a positive one', () => {
    const weight = effectiveWeight({
      likes: 0,
      dislikes: 2,
      lastActivityAt: new Date(now.getTime() - HALF_LIFE_SECONDS * 1000),
      now,
    });
    assert.ok(weight <= 0);
  });
});

describe('bandFor', () => {
  test('uses the 50 / 75 / 90 floors', () => {
    assert.equal(bandFor(100), '90+');
    assert.equal(bandFor(90), '90+');
    assert.equal(bandFor(89), '75+');
    assert.equal(bandFor(75), '75+');
    assert.equal(bandFor(74), '50+');
    assert.equal(bandFor(50), '50+');
    assert.equal(bandFor(49), 'below-50');
    assert.equal(bandFor(0), 'below-50');
  });
});

describe('describeAffinity', () => {
  test('names the specific evidence first', () => {
    const reason = describeAffinity(3, ['dogs', 'outdoor']);
    assert.ok(reason?.startsWith('You both liked 3 of the same photos'));
    assert.ok(reason?.includes('dogs'));
  });

  test('says nothing when there is no evidence', () => {
    assert.equal(describeAffinity(0, []), null);
  });

  test('can speak about a shared tag alone', () => {
    assert.equal(describeAffinity(0, ['pets']), 'You both like photos tagged pets');
  });

  test('uses the singular for one shared photo', () => {
    assert.equal(describeAffinity(1, []), 'You both liked the same photo');
  });
});
