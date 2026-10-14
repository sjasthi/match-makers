import { StyleSheet } from 'react-native';
import { cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import type { Post } from '@match-makers/shared';

import { PostViewer } from './PostViewer';
import { PhotoPostCard } from './PhotoPostCard';

jest.setTimeout(30_000);

const CAT: Post = {
  id: 'post_cat',
  imageUri: '',
  tags: ['pet', 'animal'],
  createdAt: '2026-01-01T00:00:00.000Z',
};

const DOG: Post = {
  id: 'post_dog',
  imageUri: '',
  tags: ['pet'],
  createdAt: '2026-01-02T00:00:00.000Z',
};

function renderViewer(overrides: Partial<Parameters<typeof PostViewer>[0]> = {}) {
  const onAnswer = jest.fn();
  const onClose = jest.fn();
  const onSeeMatches = jest.fn();

  const props = {
    post: CAT as Post | null,
    onAnswer,
    onClose,
    onSeeMatches,
    ...overrides,
  };

  const { rerender } = render(<PostViewer {...props} />);

  return {
    onAnswer,
    onClose,
    onSeeMatches,
    /** Same tree, same spies, different photo. */
    show: (post: Post | null) => rerender(<PostViewer {...props} post={post} />),
  };
}

afterEach(cleanup);

describe('PostViewer', () => {
  it('shows the photo it was handed, with its tags', () => {
    renderViewer();

    // The whole reason the decision happens here and not on a grid tile: at tile
    // size the tags are unreadable, and a like is only meaningful as taste if you
    // can see what you are liking.
    expect(screen.getByTestId('post-viewer-card')).toBeTruthy();
    expect(screen.getByText('Pet')).toBeTruthy();
    expect(screen.getByText('Animal')).toBeTruthy();
  });

  it('answers with the id of the photo on screen', () => {
    const { onAnswer } = renderViewer();

    fireEvent.press(screen.getByTestId('post-like'));

    expect(onAnswer).toHaveBeenCalledWith('post_cat', 'like');
  });

  it('answers with the photo on screen rather than a captured one', () => {
    // The post prop changes underneath the viewer when you move between photos. An
    // id captured at mount would answer for whatever happened to be first.
    const { onAnswer, show } = renderViewer();

    show(DOG);
    fireEvent.press(screen.getByTestId('post-like'));

    expect(onAnswer).toHaveBeenCalledWith('post_dog', 'like');
  });

  it('records a dislike as a dislike', () => {
    const { onAnswer } = renderViewer();

    fireEvent.press(screen.getByTestId('post-dislike'));

    expect(onAnswer).toHaveBeenCalledWith('post_cat', 'dislike');
  });

  it('names the photo in the reaction labels', () => {
    renderViewer();

    // A bare "Like" against an unlabelled control is what a screen reader
    // announces, and it says nothing about what is being liked.
    expect(screen.getByLabelText('I like this pet photo')).toBeTruthy();
    expect(screen.getByLabelText('Show me fewer this pet photo')).toBeTruthy();
  });

  it('closes on the close button', () => {
    const { onClose } = renderViewer();

    fireEvent.press(screen.getByTestId('post-viewer-close'));

    expect(onClose).toHaveBeenCalled();
  });

  it('closes before jumping to the deck', () => {
    const { onClose, onSeeMatches } = renderViewer();

    fireEvent.press(screen.getByTestId('post-viewer-go-to-likes'));

    expect(onClose).toHaveBeenCalled();
    expect(onSeeMatches).toHaveBeenCalled();
  });

  it('renders nothing visible when there is no photo', () => {
    renderViewer({ post: null });

    expect(screen.queryByTestId('post-viewer-card')).toBeNull();
    expect(screen.queryByTestId('post-like')).toBeNull();
  });

  it('stays on the photo after answering, so changing your mind is one tap', () => {
    // It used to advance to the next photo. That was right while answering removed
    // the photo and the only way back was to reopen it from the grid; now that
    // answers can be undone, stepping away turns a change of mind into a round trip.
    renderViewer();

    fireEvent.press(screen.getByTestId('post-like'));

    expect(screen.getByTestId('post-viewer-card')).toBeTruthy();
  });

  it('registers two presses, because unlike is the same button pressed twice', () => {
    // No double-tap guard any more, and deliberately: the store toggles, so a
    // second press has to reach it in order to take the answer back.
    const { onAnswer } = renderViewer();

    fireEvent.press(screen.getByTestId('post-like'));
    fireEvent.press(screen.getByTestId('post-like'));

    expect(onAnswer).toHaveBeenCalledTimes(2);
    expect(onAnswer).toHaveBeenNthCalledWith(1, 'post_cat', 'like');
    expect(onAnswer).toHaveBeenNthCalledWith(2, 'post_cat', 'like');
  });

  it('offers unlike on the button that is already lit', () => {
    renderViewer({ reaction: 'like' });

    // The label has to say pressing it again clears the answer, or the toggle is
    // only discoverable by experiment.
    expect(screen.getByLabelText(/Unlike this pet photo again to clear your answer/)).toBeTruthy();
  });

  it('offers to clear a pass the same way', () => {
    renderViewer({ reaction: 'dislike' });

    expect(screen.getByLabelText(/Clear your answer to this pet photo/)).toBeTruthy();
  });
});

describe('showing the whole photo', () => {
  /** A post as the importer stores one: a real file and its real dimensions. */
  const imported: Post = {
    id: 'post_imported',
    imageUri: 'file:///cache/1200.jpg',
    thumbUri: 'file:///cache/640.jpg',
    width: 1200,
    height: 900,
    tags: ['pet'],
    createdAt: '2026-01-03T00:00:00.000Z',
  };

  function renderedCard(post: Post) {
    render(<PhotoPostCard post={post} testID="card" />);
    return screen.getByTestId('card');
  }

  it('sizes the card to the photo rather than cropping it to fill the screen', () => {
    const card = renderedCard(imported);

    // This component used to fill its box with `cover`, so a landscape photo in
    // a tall viewer was cut off top and bottom. "Full view" was full *screen*,
    // not full *image*.
    expect(StyleSheet.flatten(card.props.style)).toMatchObject({ aspectRatio: 1200 / 900 });
  });

  it('shows the full image, not the grid copy', () => {
    render(<PhotoPostCard post={imported} testID="card" />);

    // The thumbnail exists for the grid. Loading it here would defeat the entire
    // reason for writing a second file.
    expect(screen.getByTestId('card-image').props.source).toEqual({ uri: 'file:///cache/1200.jpg' });
  });

  it('will not crop even by a rounding error', () => {
    render(<PhotoPostCard post={imported} testID="card" />);

    // With the ratio applied the two modes agree, but sub-pixel rounding can
    // shave a row off. This is the only component whose job is showing the photo.
    expect(screen.getByTestId('card-image').props.resizeMode).toBe('contain');
  });

  it('stays bounded on both axes so a portrait photo shrinks rather than overflows', () => {
    const card = renderedCard(imported);
    const style = StyleSheet.flatten(card.props.style);

    expect(style.maxWidth).toBe('100%');
    expect(style.maxHeight).toBe('100%');
    // It must not also claim flex: 1 or the two fight and the result depends on
    // which one the layout pass happens to honour.
    expect(style.flex).toBeUndefined();
  });

  it('falls back to filling the box when the dimensions are unknown', () => {
    // Seeded posts and anything imported before dimensions were recorded have
    // none, and they must look exactly as they did rather than collapsing.
    const card = renderedCard(CAT);

    const style = StyleSheet.flatten(card.props.style);
    expect(style.aspectRatio).toBeUndefined();
    expect(style.flex).toBe(1);
    expect(screen.queryByTestId('card-image')).toBeNull();
  });

  it('fills the box when only one dimension is known', () => {
    // Half a ratio is not a ratio. Treating it as one would size the card from a
    // number that does not describe the photo.
    const card = renderedCard({ ...imported, height: undefined });

    expect(StyleSheet.flatten(card.props.style).aspectRatio).toBeUndefined();
  });
});
