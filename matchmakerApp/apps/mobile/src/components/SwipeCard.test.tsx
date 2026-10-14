import { render, screen } from '@testing-library/react-native';
import { SwipeCard } from './SwipeCard';
import { generateDemoUser, generateMockUser } from '@/utils/mockData';
import type { User } from '@match-makers/shared';
import { scoreCompatibility, type TasteSignal } from '@/utils/matching';

function renderCard(viewer: User, candidate: User) {
  return render(
    <SwipeCard
      user={candidate}
      viewer={viewer}
      onLike={() => {}}
      onPass={() => {}}
      onSuperLike={() => {}}
    />
  );
}

/**
 * The taste signal the card is handed.
 *
 * The card takes the breakdown the deck was ordered by rather than re-scoring
 * itself, and these tests drive that prop directly. That matters because the
 * reason under the card is the whole legibility argument, and it only exists if
 * the card renders the score the deck actually sorted by.
 */
function tasteFor(affinity: number, reason: string | null = 'You both liked the same photos'): TasteSignal {
  return { affinity, coLikedPosts: 3, sharedTags: ['pet'], reason };
}

describe('SwipeCard', () => {
  const viewer = generateDemoUser() as User;
  const candidate = generateMockUser(4) as User;

  function renderWithTaste(taste?: TasteSignal) {
    return render(
      <SwipeCard
        user={candidate}
        viewer={viewer}
        compatibility={scoreCompatibility(viewer, candidate, taste)}
        onLike={() => {}}
        onPass={() => {}}
        onSuperLike={() => {}}
      />
    );
  }

  it('shows the percentage and not a raw id', () => {
    renderWithTaste();
    const text = JSON.stringify(screen.toJSON());
    expect(text).toContain('%');
    expect(text).not.toContain('compatibility');
  });

  it('shows the shared-taste reason in words', () => {
    // A percentage somebody cannot interrogate is the thing users distrust most,
    // and the sentence is the only part they actually chose.
    renderWithTaste(tasteFor(0.8));
    expect(screen.getByTestId('swipe-card-reason')).toBeTruthy();
    expect(screen.getByText('You both liked the same photos')).toBeTruthy();
  });

  it('shows no reason when there is no shared evidence', () => {
    renderWithTaste();
    // Silence is the honest rendering. An empty sentence would look like a bug and
    // a placeholder would look like a claim.
    expect(screen.queryByTestId('swipe-card-reason')).toBeNull();
  });

  it('renders the score it is handed rather than recomputing one', () => {
    const breakdown = scoreCompatibility(viewer, candidate, tasteFor(0.8));
    render(
      <SwipeCard
        user={candidate}
        viewer={viewer}
        compatibility={breakdown}
        onLike={() => {}}
        onPass={() => {}}
        onSuperLike={() => {}}
      />
    );
    expect(screen.getByTestId('swipe-card-reason')).toBeTruthy();
  });

  it('still renders a candidate who has answered no photos', () => {
    // Nobody is answered-nothing any more now the questionnaire is gone, but the
    // signal is still empty for a new pair and the card must not care.
    render(
      <SwipeCard
        user={candidate}
        viewer={viewer}
        onLike={() => {}}
        onPass={() => {}}
        onSuperLike={() => {}}
      />
    );
    expect(screen.getByText(candidate.name)).toBeTruthy();
  });
});

describe('distance on the card', () => {
  const viewer = generateDemoUser() as User;

  it('says how far away someone is', () => {
    // Now that the distance rules compute it, the card can report it. A city
    // name does not tell you whether a date is a drive or a flight.
    const candidate = {
      ...(generateMockUser(4) as User),
      location: { latitude: 30.5, longitude: -97.7431, city: 'Austin', country: 'United States' },
    };

    renderCard(viewer, candidate);

    expect(screen.getByText(new RegExp(`${candidate.location.city} · \\d+ km away`))).toBeTruthy();
  });

  it('omits the distance rather than guessing when a location is unknown', () => {
    // Better a missing number than a false one. 0,0 is a real point in the Gulf
    // of Guinea and is never where anyone lives.
    const candidate = {
      ...(generateMockUser(4) as User),
      location: { latitude: 0, longitude: 0, city: '', country: '' },
    };

    renderCard(viewer, candidate);

    expect(screen.queryByText(/km away/)).toBeNull();
  });

  it('still shows the distance for someone outside the radius, in global mode', () => {
    // Being on the card means the pair passed. The measurement is reported
    // whatever the filter decided.
    const globalViewer = {
      ...viewer,
      preferences: { ...viewer.preferences, distanceMode: 'global' as const, maxDistance: 5 },
    };
    const candidate = {
      ...(generateMockUser(4) as User),
      location: { latitude: 1.3521, longitude: 103.8198, city: 'Singapore', country: 'Singapore' },
    };

    renderCard(globalViewer, candidate);

    expect(screen.getByText(/Singapore · \d+ km away/)).toBeTruthy();
  });
});
