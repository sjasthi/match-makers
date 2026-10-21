import { useState } from 'react';
import { Text } from 'react-native';
import { cleanup, fireEvent, render, screen } from '@testing-library/react-native';

import { AgeRangeField, type AgeRange } from './AgeRangeField';

/**
 * Wraps the field so the assertions read against real state rather than a
 * mocked `onChange`. The interesting behaviour is what the range *is* after the
 * interaction, and a spy would only record the argument.
 */
function Harness({ initial = { min: 18, max: 35 } }: { initial?: AgeRange }) {
  const [range, setRange] = useState<AgeRange>(initial);
  return (
    <>
      <AgeRangeField value={range} onChange={setRange} />
      <Text testID="committed">{`${range.min}-${range.max}`}</Text>
    </>
  );
}

function committed(): string {
  const value = screen.getByTestId('committed').props.children;
  return typeof value === 'string' ? value : '';
}

function type(field: 'from' | 'to', text: string) {
  fireEvent.changeText(screen.getByTestId(`stepper-input-${field}`), text);
}

function blur(field: 'from' | 'to') {
  fireEvent(screen.getByTestId(`stepper-input-${field}`), 'blur');
}

function shown(field: 'from' | 'to'): string {
  const value = screen.getByTestId(`stepper-input-${field}`).props.value;
  return typeof value === 'string' ? value : '';
}

afterEach(cleanup);

describe('AgeRangeField', () => {
  it('moves the lower end by one', () => {
    render(<Harness />);

    fireEvent.press(screen.getByTestId('stepper-increase-from'));

    expect(committed()).toBe('19-35');
  });

  it('moves the upper end by one', () => {
    render(<Harness />);

    fireEvent.press(screen.getByTestId('stepper-decrease-to'));

    expect(committed()).toBe('18-34');
  });

  it('will not take the lower end below the minimum age', () => {
    render(<Harness initial={{ min: 18, max: 35 }} />);

    fireEvent.press(screen.getByTestId('stepper-decrease-from'));

    expect(committed()).toBe('18-35');
  });

  it('will not let the ends cross over', () => {
    render(<Harness initial={{ min: 34, max: 35 }} />);

    fireEvent.press(screen.getByTestId('stepper-increase-from'));

    expect(committed()).toBe('34-35');
  });

  it('will not let the upper end fall to the lower end', () => {
    render(<Harness initial={{ min: 18, max: 19 }} />);

    fireEvent.press(screen.getByTestId('stepper-decrease-to'));

    expect(committed()).toBe('18-19');
  });

  it('takes a typed age', () => {
    render(<Harness />);

    type('from', '25');

    expect(committed()).toBe('25-35');
  });

  it('clamps a typed age below the minimum age', () => {
    render(<Harness initial={{ min: 20, max: 35 }} />);

    type('from', '12');

    expect(committed()).toBe('18-35');
  });

  it('clamps a typed age above the oldest age', () => {
    render(<Harness />);

    type('to', '500');

    expect(committed()).toBe('18-100');
  });

  it('moves the other end out of the way of a typed age, and back again', () => {
    render(<Harness initial={{ min: 18, max: 45 }} />);

    type('from', '60');
    expect(committed()).toBe('60-61');

    // Back to a number that fits under the upper end again, so the upper end
    // returns to where it was rather than staying wherever it was pushed.
    type('from', '30');
    expect(committed()).toBe('30-45');
  });

  it('keeps the last valid age when the field is emptied', () => {
    render(<Harness initial={{ min: 24, max: 38 }} />);

    type('from', '');

    expect(committed()).toBe('24-38');
  });

  it('shows what was typed while it is being typed, and the committed value after', () => {
    render(<Harness initial={{ min: 20, max: 35 }} />);

    type('from', '4');
    expect(shown('from')).toBe('4');

    blur('from');
    expect(shown('from')).toBe('18');
  });

  it('states the range that is in force', () => {
    render(<Harness initial={{ min: 24, max: 38 }} />);

    expect(screen.getByTestId('age-range-summary').props.children).toBe('People aged 24 to 38.');
  });
});
