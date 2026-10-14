import { render, screen } from '@testing-library/react-native';
import type { Post } from '@match-makers/shared';

import { PhotoTile } from './PhotoTile';

const imported: Post = {
  id: 'post_imported',
  imageUri: 'file:///cache/1200.jpg',
  thumbUri: 'file:///cache/640.jpg',
  width: 1200,
  height: 900,
  tags: ['pet'],
  createdAt: '2026-01-03T00:00:00.000Z',
};

/** A post written before the importer produced a second copy. */
const legacy: Post = {
  id: 'post_legacy',
  imageUri: 'file:///cache/1200.jpg',
  tags: ['pet'],
  createdAt: '2026-01-04T00:00:00.000Z',
};

function renderTile(post: Post) {
  render(
    <PhotoTile
      post={post}
      width={160}
      reaction={undefined}
      onPress={() => {}}
      onTagPress={() => {}}
      testID="tile"
    />
  );
  return screen.getByTestId('tile-image');
}

describe('which copy of the photo a tile loads', () => {
  it('uses the grid copy when there is one', () => {
    // Ten tiles at grid size decode roughly a quarter of the memory that ten
    // full-size ones do, which is the entire reason a second file is written.
    expect(renderTile(imported).props.source).toEqual({ uri: 'file:///cache/640.jpg' });
  });

  it('falls back to the full image for a post with no thumb', () => {
    // Not an edge case: every post in storage predates thumbUri, so this is the
    // normal path for old data.
    expect(renderTile(legacy).props.source).toEqual({ uri: 'file:///cache/1200.jpg' });
  });

  it('still draws the generated tile when there is no image at all', () => {
    render(
      <PhotoTile
        post={{ ...legacy, imageUri: '' }}
        width={160}
        reaction={undefined}
        onPress={() => {}}
        onTagPress={() => {}}
        testID="tile"
      />
    );

    expect(screen.queryByTestId('tile-image')).toBeNull();
    expect(screen.getByTestId('tile-tile')).toBeTruthy();
  });

  it('recovers when the thumb fails but the full image would not have', () => {
    // A broken thumbnail should not cost the admin their photo from the grid.
    // The component keeps the single failure flag, so what matters here is that
    // it is keyed on the uri actually in use.
    const { rerender } = render(
      <PhotoTile
        post={imported}
        width={160}
        reaction={undefined}
        onPress={() => {}}
        onTagPress={() => {}}
        testID="tile"
      />
    );
    fireEventError(screen.getByTestId('tile-image'));

    rerender(
      <PhotoTile
        post={{ ...imported, thumbUri: '' }}
        width={160}
        reaction={undefined}
        onPress={() => {}}
        onTagPress={() => {}}
        testID="tile"
      />
    );

    // The uri changed, so the failure is cleared and the full image is tried.
    expect(screen.getByTestId('tile-image').props.source).toEqual({ uri: 'file:///cache/1200.jpg' });
  });
});

/** Triggers the Image's onError, which is how a broken file presents. */
function fireEventError(image: { props: { onError?: () => void } }) {
  image.props.onError?.();
}