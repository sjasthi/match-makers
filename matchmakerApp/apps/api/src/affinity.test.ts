import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { TAG_STRENGTH_SQL } from './affinity';
import { bandFor, describeAffinity } from './matching';

describe('tag strength', () => {
  test('is net approval scaled by library rarity, not by elapsed time', () => {
    assert.match(TAG_STRENGTH_SQL, /a\.likes - a\.dislikes/);
    assert.match(TAG_STRENGTH_SQL, /ln\(1 \+ l\.p::float8 \/ d\.docs\)/);
    /*
     * The Laplace denominator is gone on purpose: cosine bounds the pair
     * result by itself, so the +1 only flattened the honest gap between a
     * tag liked once and a tag liked six times. If it ever comes back, this
     * is the line that should fail first.
     */
    assert.doesNotMatch(TAG_STRENGTH_SQL, /dislikes\) \+ 1\)/);
    assert.doesNotMatch(TAG_STRENGTH_SQL, /last_activity_at|now\(\)|exp\(/i);
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
