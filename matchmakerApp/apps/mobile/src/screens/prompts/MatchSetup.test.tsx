import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { MatchSetup } from '@/screens/prompts/MatchSetup';
import { mockDb } from '@/services/mock/database';
import { MockAuthAdapter } from '@/services/auth/MockAuthAdapter';
import { useAuthStore } from '@/stores/authStore';
import { hasCompleteQuestionnaire } from '@/services/profile';
import { questionnaireProgress, isStepAnswered, remainingSteps, TOTAL_STEPS } from '@/prompts';
import type { QuestionnaireStep } from '@/prompts';
import {
  PartnerValue,
  PromptChoice,
  PromptTag,
  ScheduleType,
  ExerciseLevel,
  SmokingStatus,
  DrinkingStatus,
  PetsPreference,
} from '@match-makers/shared';
import type { UserQuestionnaire } from '@match-makers/shared';

jest.setTimeout(120_000);

function wait(callback: () => unknown, options?: { timeout?: number }) {
  return waitFor(callback, { timeout: 20_000, ...options });
}

const ACCOUNT = {
  email: 'session@example.com',
  password: 'Str0ngPass',
  name: 'Session Tester',
  dateOfBirth: '1994-02-02',
};

afterEach(async () => {
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await mockDb.reset();
  useAuthStore.setState({ state: 'unknown', user: null, error: null });
});

beforeEach(async () => {
  useAuthStore.setState({ state: 'unknown', user: null, error: null });
  await mockDb.reset();
});

async function signedIn() {
  await new MockAuthAdapter().register({ ...ACCOUNT, gender: 'female' as never });
  const user = await mockDb.findUserByEmail(ACCOUNT.email);
  useAuthStore.setState({ state: 'authenticated', user: user ?? null });
  return user;
}

function currentQuestionnaire(): UserQuestionnaire | undefined {
  return useAuthStore.getState().user?.questionnaire;
}

function answer(choice: string) {
  fireEvent.press(within(screen.getByTestId('prompt-choices')).getByText(choice));
}

/** Differs from the shipped default in one field, which is what marks it asked. */
const NIGHT_OWL_LIFESTYLE = {
  schedule: ScheduleType.NIGHT_OWL,
  exercise: ExerciseLevel.LIGHT,
  smoking: SmokingStatus.NEVER,
  drinking: DrinkingStatus.SOCIALLY,
  pets: PetsPreference.LOVE_PETS,
};

const TAGS_BY_ID: Record<string, PromptTag> = {
  family: PromptTag.FAMILY,
  outdoors: PromptTag.LEISURE,
  kitchen: PromptTag.FOOD,
  playlist: PromptTag.MUSIC,
  learning: PromptTag.LEARNING,
  far: PromptTag.TRAVEL,
  slow: PromptTag.RECOVERY,
  respect: PromptTag.CHARACTER,
};

function tagForId(id: string): PromptTag {
  const tag = TAGS_BY_ID[id];
  if (!tag) throw new Error(`No tag for ${id}`);
  return tag;
}

function emptyQuestionnaire(overrides: Partial<UserQuestionnaire> = {}): UserQuestionnaire {
  return {
    values: [],
    importance: {},
    dealBreakers: [],
    prompts: [],
    lifestyle: { ...NIGHT_OWL_LIFESTYLE },
    ...overrides,
  };
}

describe('questionnaireProgress', () => {
  it('offers every step to someone with no questionnaire', () => {
    const progress = questionnaireProgress(undefined);
    expect(progress.complete).toBe(false);
    expect(progress.remaining).toHaveLength(TOTAL_STEPS);
    expect(progress.remaining.map((step) => step.id)).toEqual([
      'values',
      'lifestyle',
      'family',
      'outdoors',
      'kitchen',
      'playlist',
      'learning',
      'far',
      'slow',
      'respect',
    ]);
  });

  it('stops offering lifestyle once anything differs from the default', () => {
    // It is offered once rather than required, so leaving it untouched is fine
    // but answering it should not come round again.
    const step: QuestionnaireStep = { kind: 'lifestyle', id: 'lifestyle' };
    expect(isStepAnswered(step, undefined)).toBe(false);

    const answered: UserQuestionnaire = {
      values: [],
      importance: {},
      dealBreakers: [],
      prompts: [],
      lifestyle: NIGHT_OWL_LIFESTYLE,
    };
    expect(isStepAnswered(step, answered)).toBe(true);
  });

  it('needs values graded, not just picked', () => {
    const step: QuestionnaireStep = { kind: 'values', id: 'values' };
    const picked = emptyQuestionnaire({ values: [PartnerValue.KINDNESS] });

    expect(isStepAnswered(step, picked)).toBe(false);
    expect(isStepAnswered(step, { ...picked, importance: { [PartnerValue.KINDNESS]: 4 } })).toBe(
      true
    );
  });

  it('treats a tagged prompt as answered only by its own id', () => {
    const step: QuestionnaireStep = {
      kind: 'tagged',
      id: 'family',
      tag: PromptTag.FAMILY,
      question: 'I want kids',
    };
    const questionnaire = emptyQuestionnaire({
      prompts: [{ promptId: 'kitchen', tag: PromptTag.FOOD, choice: PromptChoice.YES }],
    });

    expect(isStepAnswered(step, questionnaire)).toBe(false);
  });

  it('leaves exactly the tagged prompts outstanding once values are done', () => {
    const remaining = remainingSteps(
      emptyQuestionnaire({
        values: [PartnerValue.KINDNESS],
        importance: { [PartnerValue.KINDNESS]: 4 },
        lifestyle: NIGHT_OWL_LIFESTYLE,
      })
    );

    expect(remaining).toHaveLength(8);
    expect(remaining.every((step) => step.kind === 'tagged')).toBe(true);
  });
});

describe('MatchSetup session', () => {
  it('starts on the values step and refuses to continue until every value is graded', async () => {
    await signedIn();
    render(<MatchSetup />);

    expect(screen.getByText('What matters to you?')).toBeTruthy();

    const values = within(screen.getByTestId('value-chips'));
    fireEvent.press(values.getByText('Kindness'));

    // Picked but not graded, so there is no weight to score with yet.
    expect(screen.getByText('Rate them all first')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Kindness, importance 4 of 5'));
    await wait(() => expect(screen.getByText('Continue')).toBeTruthy());

    fireEvent.press(screen.getByText('Continue'));
    await wait(() => expect(screen.getByText('Day to day')).toBeTruthy());
  });

  it('advances through the session with no navigation between steps', async () => {
    await signedIn();
    render(<MatchSetup />);

    fireEvent.press(within(screen.getByTestId('value-chips')).getByText('Kindness'));
    fireEvent.press(screen.getByLabelText('Kindness, importance 3 of 5'));
    fireEvent.press(screen.getByText('Continue'));

    await wait(() => expect(screen.getByText('Day to day')).toBeTruthy());
    fireEvent.press(screen.getByText('Continue'));

    // Straight into the first tagged prompt, same screen.
    await wait(() => expect(screen.getByText('I want kids')).toBeTruthy());
  });

  it('answers a tagged prompt and stores it', async () => {
    await signedIn();
    render(<MatchSetup />);

    // Skip past values and lifestyle.
    fireEvent.press(within(screen.getByTestId('value-chips')).getByText('Kindness'));
    fireEvent.press(screen.getByLabelText('Kindness, importance 3 of 5'));
    fireEvent.press(screen.getByText('Continue'));
    await wait(() => expect(screen.getByText('Day to day')).toBeTruthy());
    fireEvent.press(screen.getByText('Continue'));
    await wait(() => expect(screen.getByText('I want kids')).toBeTruthy());

    answer('Yes');
    await wait(() => expect(currentQuestionnaire()?.prompts).toHaveLength(1));
    expect(currentQuestionnaire()?.prompts[0]?.promptId).toBe('family');
  });

  it('cancel discards nothing that was already saved and leaves the prompt open', async () => {
    await signedIn();
    render(<MatchSetup />);

    fireEvent.press(within(screen.getByTestId('value-chips')).getByText('Kindness'));
    fireEvent.press(screen.getByLabelText('Kindness, importance 3 of 5'));
    fireEvent.press(screen.getByText('Continue'));
    await wait(() => expect(screen.getByText('Day to day')).toBeTruthy());
    fireEvent.press(screen.getByText('Continue'));
    await wait(() => expect(screen.getByText('I want kids')).toBeTruthy());

    fireEvent.press(screen.getByText('Cancel'));

    // Cancelling moves on to the next question rather than going back.
    await wait(() => expect(screen.getByText('My ideal weekend is spent outside')).toBeTruthy());
    // Nothing was saved for the cancelled prompt.
    expect(currentQuestionnaire()?.prompts).toHaveLength(0);
    // What was answered before the cancel is untouched.
    expect(currentQuestionnaire()?.values).toEqual(['kindness']);
  });

  it('lists cancelled steps at the end and can resume them', async () => {
    // Seed a state where only two prompts are left, so cancelling both ends the
    // walk and reaches the summary without a long chain of presses.
    const user = (await signedIn())!;
    const answered = ['kitchen', 'playlist', 'learning', 'far', 'slow', 'respect'];
    await mockDb.saveUser({
      ...user,
      questionnaire: {
        values: [PartnerValue.KINDNESS],
        importance: { [PartnerValue.KINDNESS]: 3 },
        dealBreakers: [],
        prompts: answered.map((id) => ({
          promptId: id,
          tag: tagForId(id),
          choice: PromptChoice.YES,
        })),
        lifestyle: NIGHT_OWL_LIFESTYLE,
      },
    });
    const fresh = await mockDb.findUserByEmail(ACCOUNT.email);
    useAuthStore.setState({ state: 'authenticated', user: fresh ?? null });

    render(<MatchSetup />);
    await wait(() => expect(screen.getByText('I want kids')).toBeTruthy());

    fireEvent.press(screen.getByText('Cancel'));
    await wait(() => expect(screen.getByText('My ideal weekend is spent outside')).toBeTruthy());
    fireEvent.press(screen.getByText('Cancel'));

    await wait(() => expect(screen.getByText('2 skipped')).toBeTruthy());
    // Nothing was stored for either of them.
    expect(currentQuestionnaire()?.prompts).toHaveLength(answered.length);

    fireEvent.press(screen.getByText('Answer the rest'));
    await wait(() => expect(screen.getByText('Skipped · 1 of 2')).toBeTruthy());
    expect(screen.getByText('I want kids')).toBeTruthy();

    // Answering one now moves into the other.
    answer('Yes');
    await wait(() => expect(screen.getByText('Skipped · 2 of 2')).toBeTruthy());
  });

  it('cancelling mid-session keeps walking and stores nothing for it', async () => {
    await signedIn();
    render(<MatchSetup />);

    fireEvent.press(within(screen.getByTestId('value-chips')).getByText('Kindness'));
    fireEvent.press(screen.getByLabelText('Kindness, importance 3 of 5'));
    fireEvent.press(screen.getByText('Continue'));
    await wait(() => expect(screen.getByText('Day to day')).toBeTruthy());
    fireEvent.press(screen.getByText('Continue'));
    await wait(() => expect(screen.getByText('I want kids')).toBeTruthy());

    fireEvent.press(screen.getByText('Cancel'));

    // Cancelling moves on to the next question rather than going back.
    await wait(() => expect(screen.getByText('My ideal weekend is spent outside')).toBeTruthy());
    expect(currentQuestionnaire()?.prompts).toHaveLength(0);
    // What was answered before the cancel is untouched.
    expect(currentQuestionnaire()?.values).toEqual(['kindness']);
  });

  it('locks the deck until the whole questionnaire is answered', async () => {
    const user = await signedIn();
    expect(hasCompleteQuestionnaire(user ?? null)).toBe(false);

    // One answered step is not enough.
    await mockDb.saveUser({
      ...user!,
      questionnaire: {
        values: ['kindness' as never],
        importance: { kindness: 4 },
        dealBreakers: [],
        prompts: [],
        lifestyle: {} as never,
      },
    });
    const partial = await mockDb.findUserByEmail(ACCOUNT.email);
    expect(hasCompleteQuestionnaire(partial ?? null)).toBe(false);
  });
});

describe('session draft writes', () => {
  it('stores something well formed even though the answer set is incomplete', async () => {
    await signedIn();
    render(<MatchSetup />);

    fireEvent.press(within(screen.getByTestId('value-chips')).getByText('Kindness'));
    fireEvent.press(screen.getByLabelText('Kindness, importance 3 of 5'));
    fireEvent.press(screen.getByText('Continue'));

    await wait(() => {
      const stored = currentQuestionnaire();
      expect(stored?.values).toEqual(['kindness']);
      // Lifestyle was filled in with valid defaults rather than left absent.
      expect(Object.keys(stored!.lifestyle).sort()).toEqual([
        'drinking',
        'exercise',
        'pets',
        'schedule',
        'smoking',
      ]);
      // Incomplete on purpose, so the deck stays locked.
      expect(hasCompleteQuestionnaire(stored ? { ...useAuthStore.getState().user! } : null)).toBe(
        false
      );
    });
  });
});
