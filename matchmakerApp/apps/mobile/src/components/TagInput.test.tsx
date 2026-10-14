import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { MAX_POST_TAGS, normaliseTag } from '@match-makers/shared';

import { TagInput } from './TagInput';

/**
 * Wraps the input so the assertions read against real state rather than a mock
 * `onChange`. The interesting behaviour of a controlled chip input is what it
 * does *after* a commit, and a spy would only record the argument.
 */
function Harness({
  initial = [],
  suggestions = [],
}: {
  initial?: string[];
  suggestions?: Array<{ tag: string; count: number }>;
}) {
  const [tags, setTags] = useState<string[]>(initial);
  return (
    <>
      <TagInput tags={tags} onChange={setTags} suggestions={suggestions} />
      <Textish value={tags.join('|')} />
    </>
  );
}

/** Mirrors state out as text so a test can assert on the whole tag list at once. */
function Textish({ value }: { value: string }) {
  return <Text testID="committed">{value}</Text>;
}

function typeAndEnter(word: string) {
  fireEvent.changeText(screen.getByTestId('tag-input-field'), word);
  pressEnter();
}

/**
 * Enter with no text change at all.
 *
 * Deliberately separate from `typeAndEnter('')` because those are different
 * events on a real keyboard: Enter on an empty field fires `onSubmitEditing` and
 * nothing else, whereas routing through `changeText('')` is indistinguishable
 * from a backspace, which is a removal.
 */
function pressEnter() {
  fireEvent(screen.getByTestId('tag-input-field'), 'submitEditing');
}

function committed(): string {
  const value = screen.getByTestId('committed').props.children;
  return typeof value === 'string' ? value : '';
}

afterEach(cleanup);

describe('TagInput', () => {
  it('commits a tag on enter', () => {
    render(<Harness />);
    typeAndEnter('hiking');
    expect(committed()).toBe('hiking');
  });

  it('commits several tags in a row, in the order they were typed', () => {
    // The order matters: the first tag is the primary one, and it is what a
    // co-like is credited to in the match reason.
    render(<Harness />);
    typeAndEnter('dog');
    typeAndEnter('outdoor');
    typeAndEnter('food');

    expect(committed()).toBe('dog|outdoor|food');
    expect(screen.getByTestId('tag-input-tag-dog')).toBeTruthy();
    expect(screen.getByTestId('tag-input-tag-food')).toBeTruthy();
  });

  it('clears the field after a commit so the next one can be typed', () => {
    render(<Harness />);
    typeAndEnter('dog');
    // Without this the second Enter would re-commit the first word.
    typeAndEnter('cat');
    expect(committed()).toBe('dog|cat');
  });

  it('shows the canonical form on the chip, not what was typed', () => {
    render(<Harness />);
    typeAndEnter('  Dogs ');

    // Stored and displayed as `dog`, so the admin can see the exact spelling
    // that will be compared against everybody else's. Otherwise a folded word
    // looks like a bug and gets "fixed" into two different tags.
    expect(committed()).toBe('dog');
    // The chip reads `Dog`, not what was typed. Asserted through the label
    // because Paper's Chip exposes its text as a prop rather than a Text node.
    expect(screen.getByLabelText(/^Dog, primary tag/)).toBeTruthy();
    expect(screen.queryByLabelText(/^Dogs/)).toBeNull();
  });

  it('marks the first chip as the primary one', () => {
    render(<Harness />);
    typeAndEnter('dog');
    typeAndEnter('cat');

    expect(screen.getByLabelText(/^Dog, primary tag/)).toBeTruthy();
    expect(screen.getByLabelText(/^Cat\. Tap to remove\./)).toBeTruthy();
  });

  it('rejects a duplicate rather than adding it twice', () => {
    render(<Harness />);
    typeAndEnter('dog');
    typeAndEnter('DOGS');

    // Same tag after folding. `dog, dog` would double-count the tag in the
    // taste vector and inflate anybody who liked that photo.
    expect(committed()).toBe('dog');
    expect(screen.getByTestId('tag-input-error')).toBeTruthy();
  });

  it('ignores enter on an empty field', () => {
    render(<Harness />);
    typeAndEnter('dog');

    // Enter on an empty field is somebody reaching for the next tag, not a
    // request to add a tag called nothing. It must not add an empty chip, and
    // it must not remove one either: that is what backspace does.
    pressEnter();
    pressEnter();

    expect(committed()).toBe('dog');
  });

  it('ignores enter on a whitespace-only field', () => {
    render(<Harness />);
    typeAndEnter('dog');
    typeAndEnter('   ');

    expect(committed()).toBe('dog');
  });

  it('removes the last chip on backspace in an empty field', () => {
    render(<Harness />);
    typeAndEnter('dog');
    typeAndEnter('cat');

    fireEvent.changeText(screen.getByTestId('tag-input-field'), '');
    expect(committed()).toBe('dog');
  });

  it('does not treat backspace as a removal while text is being typed', () => {
    render(<Harness />);
    typeAndEnter('dog');

    // Deleting a character somebody is halfway through typing must not also drop
    // a committed tag.
    fireEvent.changeText(screen.getByTestId('tag-input-field'), 'c');
    fireEvent.changeText(screen.getByTestId('tag-input-field'), '');

    expect(committed()).toBe('dog');
  });

  it('removes a chip when it is tapped', () => {
    render(<Harness />);
    typeAndEnter('dog');
    typeAndEnter('cat');

    fireEvent.press(screen.getByTestId('tag-input-tag-dog'));
    expect(committed()).toBe('cat');
  });

  it('stops accepting tags once the cap is reached', () => {
    render(<Harness />);
    for (let index = 0; index < MAX_POST_TAGS; index += 1) {
      typeAndEnter(`tag${index}`);
    }
    expect(committed().split('|')).toHaveLength(MAX_POST_TAGS);

    typeAndEnter('onemore');

    // The cap keeps the primary tag meaningful. Eight is enough to describe a
    // photo; fifteen ways means it has no subject.
    expect(committed().split('|')).toHaveLength(MAX_POST_TAGS);
  });

  it('disables the field at the cap and explains why', () => {
    // The cap is enforced by disabling the field rather than by rejecting a
    // ninth Enter with an error, so the person is told the limit before they
    // type rather than after. `commit` still checks, because the input is
    // controlled and a caller could hand it a full list.
    render(<Harness />);
    for (let index = 0; index < MAX_POST_TAGS; index += 1) {
      typeAndEnter(`tag${index}`);
    }

    // Asserted through the label rather than the `disabled` prop, because Paper
    // puts the testID on a wrapper and the prop is not on that node. The label
    // is also what a screen reader actually announces, so it is the more useful
    // thing to pin.
    expect(
      screen.getByLabelText(`Tag limit reached: ${MAX_POST_TAGS} of ${MAX_POST_TAGS}`)
    ).toBeTruthy();
    expect(
      screen.getByText(
        `${MAX_POST_TAGS} of ${MAX_POST_TAGS} tags. Remove one to add another.`
      )
    ).toBeTruthy();
  });

  it('accepts a phrase, not just a single word', () => {
    render(<Harness />);
    typeAndEnter('live music');

    expect(committed()).toBe('live music');
    expect(screen.getByLabelText(/^Live music, primary tag/)).toBeTruthy();
  });

  it('suggests tags already in the library', () => {
    render(<Harness suggestions={[{ tag: 'dog', count: 4 }, { tag: 'cat', count: 2 }]} />);

    expect(screen.getByTestId('tag-input-suggestion-dog')).toBeTruthy();
    expect(screen.getByTestId('tag-input-suggestion-cat')).toBeTruthy();
  });

  it('filters suggestions by what has been typed', () => {
    render(<Harness suggestions={[{ tag: 'dog', count: 4 }, { tag: 'cat', count: 2 }]} />);

    fireEvent.changeText(screen.getByTestId('tag-input-field'), 'do');

    expect(screen.getByTestId('tag-input-suggestion-dog')).toBeTruthy();
    expect(screen.queryByTestId('tag-input-suggestion-cat')).toBeNull();
  });

  it('commits a suggestion on tap', () => {
    render(<Harness suggestions={[{ tag: 'dog', count: 4 }]} />);

    fireEvent.press(screen.getByTestId('tag-input-suggestion-dog'));
    expect(committed()).toBe('dog');
  });

  it('never suggests a tag that is already on the photo', () => {
    // Offering one would invite a duplicate, and a duplicate is rejected, so the
    // suggestion would be something that cannot be used.
    render(<Harness suggestions={[{ tag: 'dog', count: 4 }, { tag: 'cat', count: 2 }]} />);
    typeAndEnter('dog');

    expect(screen.queryByTestId('tag-input-suggestion-dog')).toBeNull();
    expect(screen.getByTestId('tag-input-suggestion-cat')).toBeTruthy();
  });

  it('suggests nothing once the cap is reached', () => {
    render(<Harness suggestions={[{ tag: 'dog', count: 4 }]} />);
    for (let index = 0; index < MAX_POST_TAGS; index += 1) {
      typeAndEnter(`tag${index}`);
    }

    expect(screen.queryByTestId('tag-input-suggestions')).toBeNull();
  });

  it('treats a differently-spelled suggestion as the same tag when tapped', () => {
    // The library holds canonical tags, but an older record or a different code
    // path could hand over anything. Committing goes through normaliseTag.
    const suggestion = normaliseTag('Dogs');
    render(<Harness suggestions={[{ tag: suggestion, count: 1 }]} />);

    fireEvent.press(screen.getByTestId('tag-input-suggestion-dog'));
    expect(committed()).toBe('dog');
  });
});