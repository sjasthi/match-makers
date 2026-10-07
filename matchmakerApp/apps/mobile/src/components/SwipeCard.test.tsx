import { render, screen } from '@testing-library/react-native';
import { SwipeCard } from './SwipeCard';
import { generateDemoUser, generateMockUser, generateMockUsers } from '@/utils/mockData';
import { questionnaireSchema, PromptChoice, type User } from '@match-makers/shared';
import { PROMPTS, promptQuestion } from '@/prompts';
import { scoreCompatibility } from '@/utils/matching';

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

/** A seeded candidate with one of their answers forced to match the viewer's. */
function agreeingCandidate(viewer: User): User {
  const candidate = generateMockUser(4) as User;
  const [first] = viewer.questionnaire!.prompts;
  return {
    ...candidate,
    questionnaire: {
      ...candidate.questionnaire!,
      prompts: [
        { ...first! },
        ...candidate.questionnaire!.prompts.filter((answer) => answer.tag !== first!.tag),
      ],
    },
  };
}

/**
 * A candidate who answers the opposite of the viewer on every prompt they share.
 *
 * `family` is dropped rather than flipped: the demo account answers it
 * "Sometimes", which has no zero-affinity partner among the four choices, so it
 * would register as partial agreement no matter what the other person said.
 */
function contradictingCandidate(viewer: User): User {
  const candidate = generateMockUser(4) as User;
  return {
    ...candidate,
    questionnaire: {
      ...candidate.questionnaire!,
      prompts: viewer
        .questionnaire!.prompts.filter((answer) => answer.choice !== PromptChoice.SOMETIMES)
        .map((answer) => ({
          ...answer,
          choice:
            answer.choice === PromptChoice.YES ? PromptChoice.NO : (PromptChoice.YES as const),
        })),
    },
  };
}

describe('SwipeCard', () => {
  const viewer = generateDemoUser() as User;

  it('shows the percentage and not a raw id', () => {
    renderCard(viewer, generateMockUser(4) as User);
    // The seeded prompt ids must be real, or every prompt surface has to
    // render a bare tag like "food_1".
    expect(screen.queryByText(/_[0-9]$/)).toBeNull();
  });

  it('surfaces an agreed prompt as an icebreaker', () => {
    const candidate = agreeingCandidate(viewer);
    const { agreements } = scoreCompatibility(viewer, candidate);
    expect(agreements.length).toBeGreaterThan(0);

    renderCard(viewer, candidate);

    // The card leads with the strongest agreement, which is the prompt that
    // justifies the score being what it is.
    const answer = candidate.questionnaire!.prompts.find(
      (candidateAnswer) => candidateAnswer.tag === agreements[0]!.tag
    )!;
    expect(screen.getByText(promptQuestion(answer.promptId, answer.tag))).toBeTruthy();
  });

  it('never leads with a prompt the two of you answered differently', () => {
    // The regression this guards: co-answering used to be enough to be called a
    // shared prompt, so the card could open with a question the viewer had
    // given the opposite answer to.
    const candidate = contradictingCandidate(viewer);
    const result = scoreCompatibility(viewer, candidate);
    expect(result.conflicts.length).toBeGreaterThan(0);
    expect(result.agreements).toEqual([]);

    renderCard(viewer, candidate);

    for (const conflict of result.conflicts) {
      const answer = candidate.questionnaire!.prompts.find((a) => a.tag === conflict.tag)!;
      expect(screen.queryByText(promptQuestion(answer.promptId, answer.tag))).toBeNull();
    }
    expect(screen.getByText(`${result.conflicts.length} differ`)).toBeTruthy();
    // No "agreed on" chip either, since there is no agreement to report.
    expect(screen.queryByText(/agreed on/)).toBeNull();
  });

  it('shows no icebreaker when the two people answered nothing in common', () => {
    const bare = { ...generateMockUser(9), questionnaire: undefined } as User;
    expect(scoreCompatibility(viewer, bare).agreements).toEqual([]);
    renderCard(viewer, bare);
    expect(screen.queryByText("I'd rather cook than eat out")).toBeNull();
  });

  it('still renders a candidate who has answered nothing', () => {
    const bare = { ...generateMockUser(9), questionnaire: undefined } as User;
    renderCard(viewer, bare);
    expect(screen.getByText(bare.name)).toBeTruthy();
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

describe('seeded prompt answers', () => {
  it('every seeded answer references a prompt that exists', () => {
    const ids = new Set(PROMPTS.map((prompt) => prompt.id));
    for (const user of generateMockUsers(20)) {
      for (const answer of user.questionnaire!.prompts) {
        expect(ids.has(answer.promptId)).toBe(true);
      }
    }
  });

  it('every seeded questionnaire satisfies the shared schema', () => {
    for (const user of generateMockUsers(20)) {
      expect(questionnaireSchema.safeParse(user.questionnaire).success).toBe(true);
    }
  });
});
