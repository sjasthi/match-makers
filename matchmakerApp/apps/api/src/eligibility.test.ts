import assert from 'node:assert/strict';
import { test } from 'node:test';
import { eligibilitySql } from './eligibility';

test('feed eligibility hides people the viewer has already swiped on', () => {
  assert.match(eligibilitySql(), /NOT EXISTS\s*\(\s*SELECT 1 FROM swipes/);
});

test('score eligibility includes swiped pairs so the reverse score stays fresh', () => {
  assert.doesNotMatch(eligibilitySql({ excludeSwiped: false }), /NOT EXISTS\s*\(\s*SELECT 1 FROM swipes/);
});
