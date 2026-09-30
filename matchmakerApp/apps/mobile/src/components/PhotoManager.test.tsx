import { render, screen, fireEvent, act } from '@testing-library/react-native';
import type { Photo, User } from '@match-makers/shared';
import { PhotoManager } from './PhotoManager';
import { avatarColor, initialsFor, hashString, ProfileImage } from './ProfileImage';
import { generateDemoUser, generateMockUsers } from '@/utils/mockData';

const user = generateDemoUser();

function photo(id: string, isPrimary = false): Photo {
  return { id, url: `file:///photos/${id}.jpg`, isPrimary, order: 0 };
}

describe('avatar generation helpers', () => {
  it('produces a stable colour for the same seed', () => {
    expect(avatarColor(user.id)).toBe(avatarColor(user.id));
    expect(avatarColor('user_0001')).not.toBe(avatarColor('user_0002'));
  });

  it('hashes deterministically and without sign flips', () => {
    expect(hashString('abc')).toBe(hashString('abc'));
    expect(hashString('abc')).toBeGreaterThanOrEqual(0);
  });

  it('derives initials from one or two names', () => {
    expect(initialsFor('Ada Lovelace')).toBe('AL');
    expect(initialsFor('Prince')).toBe('P');
    expect(initialsFor('  ')).toBe('?');
  });
});

describe('ProfileImage', () => {
  it('draws a generated avatar when there is no url', () => {
    render(<ProfileImage user={user} url="" testID="img" />);
    expect(screen.getByText(initialsFor(user.name))).toBeTruthy();
  });

  it('falls back to a generated avatar when the image fails to load', () => {
    render(<ProfileImage user={user} url="https://example.invalid/gone.jpg" testID="img" />);
    // RN Image has no onError in the test renderer, so drive it directly.
    const image = screen.UNSAFE_getByProps({ accessibilityLabel: `${user.name}'s photo` });
    act(() => {
      image.props.onError();
    });
    expect(screen.getByText(initialsFor(user.name))).toBeTruthy();
  });
});

describe('PhotoManager', () => {
  it('refuses to delete the last remaining photo', () => {
    const onChange = jest.fn();
    render(<PhotoManager user={user} photos={[photo('a', true)]} onChange={onChange} />);

    fireEvent(screen.getByLabelText(/Main photo/), 'longPress');

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText(/Keep at least one photo/)).toBeTruthy();
  });

  it('deletes a non-primary photo and keeps the current primary', () => {
    const onChange = jest.fn();
    render(
      <PhotoManager
        user={user}
        photos={[photo('a', true), photo('b'), photo('c')]}
        onChange={onChange}
      />
    );

    // Only non-primary thumbs carry the "Photo by ..." label.
    fireEvent(screen.getAllByLabelText(/Photo by/)[0]!, 'longPress');

    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as Photo[];
    expect(next.map((p) => p.id)).toEqual(['a', 'c']);
    expect(next.find((p) => p.id === 'a')?.isPrimary).toBe(true);
  });

  it('promotes another photo when the primary one is deleted', () => {
    const onChange = jest.fn();
    render(
      <PhotoManager user={user} photos={[photo('a', true), photo('b')]} onChange={onChange} />
    );

    fireEvent(screen.getByLabelText('Main photo. Tap another to change'), 'longPress');

    const next = onChange.mock.calls[0][0] as Photo[];
    expect(next.map((p) => p.id)).toEqual(['b']);
    // A deletion must never leave the profile without a primary photo.
    expect(next.some((p) => p.isPrimary)).toBe(true);
  });

  it('promotes a tapped photo to primary', () => {
    const onChange = jest.fn();
    render(
      <PhotoManager user={user} photos={[photo('a', true), photo('b')]} onChange={onChange} />
    );

    fireEvent.press(screen.getByLabelText(/Photo by/));

    const next = onChange.mock.calls[0][0] as Photo[];
    expect(next.find((p) => p.id === 'b')?.isPrimary).toBe(true);
    expect(next.find((p) => p.id === 'a')?.isPrimary).toBe(false);
  });

  it('shows a seeded placeholder photo as an avatar, not a broken image', () => {
    render(
      <PhotoManager
        user={user}
        photos={[{ id: 'p1', url: '', isPrimary: true, order: 0 }]}
        onChange={jest.fn()}
      />
    );
    expect(screen.getByText(initialsFor(user.name))).toBeTruthy();
  });
});

describe('seeded mock data', () => {
  it('never stores a remote image url', () => {
    const everyone = [...generateMockUsers(20), generateDemoUser()];

    for (const person of everyone as User[]) {
      for (const p of person.photos) {
        expect(p.url).toBe('');
      }
    }
  });

  it('gives each user exactly one photo with a unique id', () => {
    const users = generateMockUsers(20);

    expect(users.every((u) => u.photos.length === 1)).toBe(true);
    const ids = users.flatMap((u) => u.photos.map((p) => p.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
});
