import assert from 'node:assert/strict';
import { test } from 'node:test';
import { eligibilitySql } from './eligibility';

test('feed eligibility hides people the viewer has already swiped on', () => {
  assert.match(eligibilitySql(), /NOT EXISTS\s*\(\s*SELECT 1 FROM swipes/);
});

test('score eligibility includes swiped pairs so the reverse score stays fresh', () => {
  assert.doesNotMatch(
    eligibilitySql({ excludeSwiped: false }),
    /NOT EXISTS\s*\(\s*SELECT 1 FROM swipes/
  );
});

test('requires explicit goal compatibility in both directions; an empty list means any', () => {
  const sql = eligibilitySql().replace(/\s+/g, ' ');

  assert.match(
    sql,
    /cardinality\(v\.wants_goals\) = 0 OR c\.relationship_goal = ANY \(v\.wants_goals\)/
  );
  assert.match(
    sql,
    /cp\.user_id IS NULL OR cardinality\(cp\.relationship_goals\) = 0 OR v\.relationship_goal = ANY \(cp\.relationship_goals\)/
  );
  assert.doesNotMatch(sql, /relationship_goal = 'not_sure'/);
});
