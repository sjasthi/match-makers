import { render, screen } from '@testing-library/react-native';

import { PersonTile } from './PersonTile';

/**
 * The band badge.
 *
 * The band comes from the server, which computed it from the score it stored.
 * It is optional, and deliberately so: mock mode has no stored score to band, so
 * a tile that assumed one would show a badge in mock mode and not in the real
 * app.
 */
describe('PersonTile band', () => {
  const base = {
    userId: 'u1',
    name: 'Priya Raman',
    score: 92,
    reason: 'You both liked 6 of the same photos',
    onPress: jest.fn(),
    testPrefix: 'deck-card',
  };

  it('badges a top match', () => {
    render(<PersonTile {...base} band="90+" />);

    expect(screen.getByTestId('deck-card-u1-band')).toBeTruthy();
    expect(screen.getByText('Top match')).toBeTruthy();
  });

  it('badges a strong match', () => {
    render(<PersonTile {...base} score={80} band="75+" />);

    expect(screen.getByText('Strong match')).toBeTruthy();
  });

  it('says nothing for the band the percentage already says', () => {
    // "50%" is on the tile already. A "50+" badge next to it is saying the
    // same thing twice.
    render(<PersonTile {...base} score={50} band="50+" />);

    expect(screen.queryByTestId('deck-card-u1-band')).toBeNull();
  });

  it('says nothing about a weak match', () => {
    // "Below 50%" is a thing to say about a stranger, not about the person in
    // front of you.
    render(<PersonTile {...base} score={30} band="below-50" />);

    expect(screen.queryByTestId('deck-card-u1-band')).toBeNull();
  });

  it('says nothing when the server sent no band', () => {
    render(<PersonTile {...base} />);

    expect(screen.queryByTestId('deck-card-u1-band')).toBeNull();
  });
});
