import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { HelperText } from 'react-native-paper';

import { Stepper } from './Stepper';
import { APP_CONFIG, SPACING } from '@/constants';

export interface AgeRange {
  min: number;
  max: number;
}

interface Props {
  value: AgeRange;
  onChange: (next: AgeRange) => void;
  /** The youngest age that may be selected. */
  minAge?: number;
  /** The oldest age that may be selected. */
  maxAge?: number;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

/**
 * The range after a number is typed into one end.
 *
 * The number that was typed wins. It is the most deliberate thing in the
 * interaction, so it is not thrown away to satisfy the ordering rule; instead
 * the other end moves out of its way and comes back when the number no longer
 * needs it to.
 *
 * `anchor` is the other end as it was before this edit began, which is what
 * lets it fall back down instead of staying wherever the last crossing pushed
 * it. Returns null when there is nothing to commit.
 */
function withTypedValue(
  range: AgeRange,
  key: 'min' | 'max',
  typed: number,
  anchor: number,
  minAge: number,
  maxAge: number
): AgeRange | null {
  if (!Number.isFinite(typed)) return null;

  if (key === 'min') {
    const next = clamp(typed, minAge, maxAge - 1);
    // The upper end has to stay above the lower one, or the range is empty.
    const max = anchor > next ? anchor : next + 1;
    return { min: next, max: clamp(max, minAge + 1, maxAge) };
  }

  const next = clamp(typed, minAge + 1, maxAge);
  const min = anchor < next ? anchor : next - 1;
  return { min: clamp(min, minAge, maxAge - 1), max: next };
}

/**
 * The range after a press of - or +.
 *
 * A button is a nudge, not a number somebody chose, so it gives way rather
 * than dragging the other end with it: the press is refused outright if it
 * would cross the other end or leave the legal window.
 */
function withStep(
  range: AgeRange,
  key: 'min' | 'max',
  delta: number,
  minAge: number,
  maxAge: number
): AgeRange | null {
  const next = range[key] + delta;

  if (key === 'min') {
    if (next < minAge || next > maxAge - 1 || next >= range.max) return null;
    return { ...range, min: next };
  }

  if (next < minAge + 1 || next > maxAge || next <= range.min) return null;
  return { ...range, max: next };
}

/**
 * The age range: two numbers, typed or nudged.
 *
 * The rules are the ones the schema and the database already enforce -- 18 at
 * the bottom, a realistic oldest age at the top, and a range that is never
 * empty -- so nothing here can produce a preference the server would reject.
 *
 * Both ways of changing the number are always available. The buttons move by
 * one, because a range of five at a time skips over the age somebody was
 * actually looking for; the field takes the number directly, because sometimes
 * the number is known and moving towards it one year at a time is a waste of
 * anybody's time.
 *
 * While a number is being typed the field shows exactly what was typed,
 * including a half-finished "1" on the way to "19", and only snaps to the
 * committed value on blur. Clamping happens silently, but the line underneath
 * always states the range that is actually in force.
 */
export function AgeRangeField({
  value,
  onChange,
  minAge = APP_CONFIG.MIN_AGE,
  maxAge = APP_CONFIG.MAX_AGE,
}: Props) {
  // What is on screen while a number is being typed, per end. Null means
  // "nothing being typed", and the committed value is shown instead.
  const [draft, setDraft] = useState<{ min: string | null; max: string | null }>({
    min: null,
    max: null,
  });

  // The range as it was before the current edit began, so the end that had to
  // move can move back.
  const session = useRef<AgeRange | null>(null);

  const shown = (key: 'min' | 'max') => draft[key] ?? String(value[key]);

  const handleChangeText = (key: 'min' | 'max') => (text: string) => {
    setDraft((current) => ({ ...current, [key]: text }));

    const digits = text.replace(/\D/g, '');
    if (digits.length === 0) return;

    const typed = Number.parseInt(digits, 10);
    if (!Number.isFinite(typed)) return;

    if (!session.current) session.current = value;

    const other = key === 'min' ? 'max' : 'min';
    const next = withTypedValue(value, key, typed, session.current[other], minAge, maxAge);
    if (next) onChange(next);
  };

  const handleBlur = (key: 'min' | 'max') => () => {
    setDraft((current) => ({ ...current, [key]: null }));
    session.current = null;
  };

  const handleStep = (key: 'min' | 'max', delta: number) => () => {
    // The buttons work on the committed number, not on a half-typed one.
    setDraft((current) => ({ ...current, [key]: null }));
    session.current = null;

    const next = withStep(value, key, delta, minAge, maxAge);
    if (next) onChange(next);
  };

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <Stepper
          label="From"
          value={shown('min')}
          onChangeText={handleChangeText('min')}
          onBlur={handleBlur('min')}
          onSubmitEditing={handleBlur('min')}
          inputAccessibilityLabel="Minimum age"
          onDecrease={handleStep('min', -1)}
          onIncrease={handleStep('min', 1)}
        />
        <Stepper
          label="To"
          value={shown('max')}
          onChangeText={handleChangeText('max')}
          onBlur={handleBlur('max')}
          onSubmitEditing={handleBlur('max')}
          inputAccessibilityLabel="Maximum age"
          onDecrease={handleStep('max', -1)}
          onIncrease={handleStep('max', 1)}
        />
      </View>

      <HelperText type="info" visible padding="none" testID="age-range-summary">
        {`People aged ${value.min} to ${value.max}.`}
      </HelperText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: SPACING.xs },
  row: { flexDirection: 'row', gap: SPACING.md },
});
