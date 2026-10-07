import { MockDatabase } from './database';
import {
  normaliseLocation,
  normalisePreferences,
  normaliseQuestionnaire,
  normaliseStateUsers,
} from './migrate';
import { writeJson, persistentStore } from '@/services/storage/keyValueStore';
import { scoreCompatibility } from '@/utils/matching';
import { checkEligibility } from '@/utils/eligibility';
import { generateDemoUser, DEMO_EMAIL } from '@/utils/mockData';
import {
  Gender,
  RelationshipGoal,
  preferencesSchema,
  partnerValueSchema,
  lifestyleSchema,
} from '@match-makers/shared';
import type { User } from '@match-makers/shared';

const DB_KEY = 'mock.db.v2';

/** A questionnaire as it was stored before prompts existed. */
const LEGACY_QUESTIONNAIRE = {
  values: ['kindness', 'emotional_openness'],
  importance: { kindness: 5, emotional_openness: 3 },
  dealBreakers: ['kindness'],
  interests: ['cooking', 'trail_running'],
  lifestyle: {
    schedule: 'flexible',
    exercise: 'moderate',
    kids: 'open',
    smoking: 'never',
    drinking: 'socially',
    pets: 'love_pets',
  },
};

describe('normaliseQuestionnaire', () => {
  it('fills in prompts for a record written before prompts existed', () => {
    const result = normaliseQuestionnaire(LEGACY_QUESTIONNAIRE);

    // The interest tags are dropped rather than turned into invented prompts.
    expect(result.prompts).toEqual([]);
    expect(result.values).toEqual(['kindness', 'emotional_openness']);
    expect(result.importance).toEqual({ kindness: 5, emotional_openness: 3 });
  });

  it('drops kids from lifestyle, which moved to a prompt', () => {
    const result = normaliseQuestionnaire(LEGACY_QUESTIONNAIRE);
    expect(result.lifestyle).not.toHaveProperty('kids');
    expect(lifestyleSchema.safeParse(result.lifestyle).success).toBe(true);
  });

  it('produces something the scoring code can read', () => {
    const legacy = {
      ...generateDemoUser(),
      questionnaire: { ...LEGACY_QUESTIONNAIRE, prompts: undefined },
    } as unknown as User;

    const viewer = generateDemoUser() as User;
    // This used to throw "Cannot read properties of undefined (reading
    // 'map')", which is what a stale record did to the feed.
    const result = scoreCompatibility(viewer, legacy);

    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.promptOverlap).toBe(0);
    expect(result.agreements).toEqual([]);
  });

  it('repairs a deal breaker that is not one of the values', () => {
    // An earlier build could store this, and the questionnaire schema rejects
    // it, so it used to wedge the flow.
    const result = normaliseQuestionnaire({
      values: ['kindness'],
      importance: { kindness: 4 },
      dealBreakers: ['family'],
      prompts: [],
      lifestyle: {},
    });

    expect(result.dealBreakers).toEqual([]);
  });

  it('discards a grade for a value that was never picked', () => {
    const result = normaliseQuestionnaire({
      values: ['kindness'],
      importance: { kindness: 4, family: 5 },
      dealBreakers: [],
      prompts: [],
      lifestyle: {},
    });

    expect(result.importance).toEqual({ kindness: 4 });
  });

  it('keeps only prompt answers it understands', () => {
    const result = normaliseQuestionnaire({
      values: [],
      importance: {},
      dealBreakers: [],
      prompts: [
        { promptId: 'family', tag: 'family', choice: 'yes' },
        { promptId: 'bad', tag: 'knitting', choice: 'yes' },
        { promptId: 'bad2', tag: 'food', choice: 'maybe' },
        { promptId: '', tag: 'food', choice: 'yes' },
        'not an object',
      ],
      lifestyle: {},
    });

    expect(result.prompts).toEqual([{ promptId: 'family', tag: 'family', choice: 'yes' }]);
  });

  it('never keeps two answers to the same tag', () => {
    const result = normaliseQuestionnaire({
      values: [],
      importance: {},
      dealBreakers: [],
      prompts: [
        { promptId: 'a', tag: 'food', choice: 'yes' },
        { promptId: 'b', tag: 'food', choice: 'no' },
      ],
      lifestyle: {},
    });

    expect(result.prompts).toHaveLength(1);
  });

  it('survives junk instead of throwing', () => {
    for (const junk of [undefined, null, 'nope', 42, []]) {
      const result = normaliseQuestionnaire(junk);
      expect(partnerValueSchema).toBeDefined();
      expect(result.values).toEqual([]);
      expect(result.prompts).toEqual([]);
      expect(result.importance).toEqual({});
    }
  });

  it('leaves an already valid questionnaire untouched', () => {
    const demo = generateDemoUser();
    const result = normaliseQuestionnaire(demo.questionnaire);
    expect(result).toEqual(demo.questionnaire);
  });
});

describe('normalisePreferences', () => {
  it('reads a record with no distance mode as nearby', () => {
    // Every record written before the mode existed has a maxDistance and no way
    // of saying whether it was ever live. Reading it as global would quietly
    // double everyone's radius on upgrade.
    const { distanceMode: _absent, ...legacy } = generateDemoUser().preferences;
    expect(normalisePreferences(legacy).distanceMode).toBe('nearby');
  });

  it('keeps a global record global', () => {
    const result = normalisePreferences({
      ...generateDemoUser().preferences,
      distanceMode: 'global',
    });
    expect(result.distanceMode).toBe('global');
  });

  it('rejects a mode it does not recognise rather than defaulting it', () => {
    // Defaulting would turn a typo into a wider radius than the user chose.
    expect(normalisePreferences({ distanceMode: 'anywhere' }).distanceMode).toBe('nearby');
  });

  it('keeps the radius through a switch to global, so the round trip restores it', () => {
    const chosen = { ...generateDemoUser().preferences, maxDistance: 250, distanceMode: 'global' };
    expect(normalisePreferences(chosen).maxDistance).toBe(250);
  });

  it('clamps a radius the rules and schema would reject', () => {
    expect(normalisePreferences({ maxDistance: 9000 }).maxDistance).toBe(500);
    expect(normalisePreferences({ maxDistance: 0 }).maxDistance).toBe(1);
    expect(normalisePreferences({ maxDistance: 'far' }).maxDistance).toBe(50);
  });

  it('holds the age range coherent, so its own schema accepts the result', () => {
    const result = normalisePreferences({
      ageRange: { min: 40, max: 30 },
      genders: [Gender.FEMALE],
      relationshipGoals: [RelationshipGoal.LONG_TERM],
    });

    expect(result.ageRange.min).toBeLessThan(result.ageRange.max);
    expect(preferencesSchema.safeParse(result).success).toBe(true);
  });

  it('survives junk instead of throwing', () => {
    for (const junk of [undefined, null, 'nope', 42, []]) {
      const result = normalisePreferences(junk);
      expect(result.genders).toEqual([]);
      expect(result.relationshipGoals).toEqual([]);
      expect(result.distanceMode).toBe('nearby');
    }
  });

  it('leaves an already valid preference set untouched', () => {
    const demo = generateDemoUser();
    expect(normalisePreferences(demo.preferences)).toEqual(demo.preferences);
  });
});

describe('normaliseLocation', () => {
  it('leaves real coordinates alone', () => {
    const austin = {
      latitude: 30.2672,
      longitude: -97.7431,
      city: 'Austin',
      country: 'United States',
    };
    expect(normaliseLocation(austin)).toEqual(austin);
  });

  it('resolves the zero placeholder from the city label', () => {
    // The upgrade that matters. Left alone these profiles sit ~10,000 km from
    // everyone and are correctly excluded from every nearby deck, so shipping
    // the distance rules without this repair would have emptied everyone's feed.
    const result = normaliseLocation({
      latitude: 0,
      longitude: 0,
      city: 'Rotterdam',
      country: 'Netherlands',
    });

    expect(result.latitude).not.toBe(0);
    expect(result.longitude).not.toBe(0);
    // The city they typed is kept, not replaced by the catalog's spelling.
    expect(result.city).toBe('Rotterdam');
  });

  it('leaves an unresolvable city at zero rather than inventing coordinates', () => {
    const result = normaliseLocation({ latitude: 0, longitude: 0, city: 'Nowheresville' });
    expect(result).toEqual({
      latitude: 0,
      longitude: 0,
      city: 'Nowheresville',
      country: '',
    });
  });

  it('survives a location that is not an object at all', () => {
    for (const junk of [undefined, null, 'nope', 42]) {
      const result = normaliseLocation(junk);
      expect(result.latitude).toBe(0);
      expect(result.city).toBe('');
    }
  });
});

describe('normaliseStateUsers', () => {
  it('reports whether anything actually moved', () => {
    const demo = generateDemoUser();
    const alreadyFine = normaliseStateUsers([demo]);
    expect(alreadyFine.changed).toBe(false);

    const repaired = normaliseStateUsers([
      { ...demo, questionnaire: { ...LEGACY_QUESTIONNAIRE, prompts: undefined } },
    ]);
    expect(repaired.changed).toBe(true);
  });

  it('repairs a location and a distance mode in the same pass', () => {
    // Both changes arrive together for anyone who signed up before either, and
    // fixing only one leaves them with a mode that filters on nothing.
    const demo = generateDemoUser();
    const { distanceMode: _absent, ...preferences } = demo.preferences;

    const { users, changed } = normaliseStateUsers([
      {
        ...demo,
        preferences,
        location: { latitude: 0, longitude: 0, city: 'Lisbon', country: 'Portugal' },
      },
    ]);

    expect(changed).toBe(true);
    const stored = users[0] as User;
    expect(stored.preferences.distanceMode).toBe('nearby');
    expect(stored.location.latitude).toBeCloseTo(38.7223, 4);
  });

  it('leaves a record that passes the feed its old, loose radius', () => {
    // The regression that matters: after upgrading, the demo account should
    // still pass the same candidates it passed before.
    const demo = generateDemoUser();
    const { distanceMode: _absent, ...preferences } = demo.preferences;
    const { users } = normaliseStateUsers([{ ...demo, preferences }]);
    expect((users[0] as User).preferences).toEqual(demo.preferences);
  });

  it('flags a user list that is not a list at all', () => {
    expect(normaliseStateUsers('nope').changed).toBe(true);
    expect(normaliseStateUsers('nope').users).toEqual([]);
  });
});

describe('loading a stale database', () => {
  it('upgrades stored records on load instead of crashing', async () => {
    const demo = generateDemoUser();
    // Exactly what an older build would have left in storage: a questionnaire
    // with interest tags, kids in lifestyle, and no prompts field at all.
    await writeJson(persistentStore, DB_KEY, {
      users: [
        {
          ...demo,
          email: DEMO_EMAIL,
          password: demo.email,
          questionnaire: { ...LEGACY_QUESTIONNAIRE, prompts: undefined },
        },
      ],
      currentUserId: null,
      swipes: [],
      matches: [],
      messages: [],
    });

    // A fresh instance, because the shared singleton caches its state and
    // reset() reseeds rather than reloading what is on disk.
    const state = await new MockDatabase().getState();
    const stored = state.users[0]!;

    expect(stored.questionnaire?.prompts).toEqual([]);
    expect(stored.questionnaire?.lifestyle).not.toHaveProperty('kids');
    expect(() => scoreCompatibility(stored, demo)).not.toThrow();
  });

  it('persists the upgrade so the next launch does not repeat it', async () => {
    const demo = generateDemoUser();
    await writeJson(persistentStore, DB_KEY, {
      users: [{ ...demo, email: DEMO_EMAIL, questionnaire: { ...LEGACY_QUESTIONNAIRE } }],
      currentUserId: null,
      swipes: [],
      matches: [],
      messages: [],
    });

    await new MockDatabase().getState();

    // A second instance must see the migrated shape, not the stale one.
    const reloaded = await new MockDatabase().getState();
    expect(reloaded.users[0]?.questionnaire?.prompts).toEqual([]);
  });

  it('upgrades an account stored with no distance mode and no coordinates', async () => {
    const demo = generateDemoUser();
    const { distanceMode: _absent, ...preferences } = demo.preferences;

    // Exactly what a hand-typed city looked like before the catalog existed: a
    // name, no coordinates, and no way to say whether the radius applied.
    await writeJson(persistentStore, DB_KEY, {
      users: [
        {
          ...demo,
          email: DEMO_EMAIL,
          preferences,
          location: { latitude: 0, longitude: 0, city: 'Rotterdam', country: 'Netherlands' },
        },
      ],
      currentUserId: null,
      swipes: [],
      matches: [],
      messages: [],
    });

    const stored = (await new MockDatabase().getState()).users[0]!;

    expect(stored.preferences.distanceMode).toBe('nearby');
    expect(stored.location.latitude).not.toBe(0);

    // The point of the repair: the account is now reachable by the feed.
    const nearby = {
      ...generateDemoUser(),
      id: 'user_nearby',
      location: stored.location,
    } as User;
    expect(checkEligibility(nearby, stored).eligible).toBe(true);
  });
});
