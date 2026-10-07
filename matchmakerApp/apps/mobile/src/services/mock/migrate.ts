import {
  Gender,
  RelationshipGoal,
  PartnerValue,
  PromptTag,
  PromptChoice,
  ImportanceScale,
  ScheduleType,
  ExerciseLevel,
  SmokingStatus,
  DrinkingStatus,
  PetsPreference,
  emptyLifestyle,
  type DistanceMode,
  type Location,
  type PromptAnswer,
  type UserQuestionnaire,
  type UserPreferences,
  type ValueImportance,
} from '@match-makers/shared';
import { findCityCentroid } from '@/utils/cityCatalog';
import { hasCoordinates } from '@/utils/distance';
import { APP_CONFIG } from '@/constants';

/**
 * Brings a stored questionnaire up to the current shape.
 *
 * The mock database is a JSON blob keyed by a version string, and this schema
 * has changed more than once: interest tags became tagged prompts, and kids
 * moved out of lifestyle. Bumping the key on every change silently discards
 * everyone's accounts, swipes and messages, so instead the stored records are
 * upgraded in place on load. A stale record that reaches the scoring code
 * crashes it, because `questionnaire.prompts.map` and `questionnaire.values
 * .length` assume the fields are there.
 *
 * The same is now true of preferences and location. `distanceMode` did not
 * exist, and every record written before it has no way to say whether its
 * `maxDistance` was a real limit, which means a record missing the field has to
 * be read as `nearby`. Guessing `global` would silently widen everyone's radius
 * on upgrade.
 *
 * Anything that cannot be carried forward is dropped rather than guessed at.
 * Old interest tags in particular are discarded: they were free-floating tags
 * with no prompt behind them, and inventing a prompt for them would put an
 * answer nobody gave on someone's profile.
 */

function toSet<T extends string | number>(values: readonly T[]): Set<T> {
  return new Set<T>(values);
}

const PARTNER_VALUES = toSet<string>(Object.values(PartnerValue));
const PROMPT_TAGS = toSet<string>(Object.values(PromptTag));
const PROMPT_CHOICES = toSet<string>(Object.values(PromptChoice));
// Object.values on a numeric enum yields the member names too.
const IMPORTANCES = toSet<number>(
  Object.values(ImportanceScale).filter((value): value is number => typeof value === 'number')
);

const LIFESTYLE_DEFAULTS = emptyLifestyle();

const GENDERS = toSet<string>(Object.values(Gender));
const RELATIONSHIP_GOALS = toSet<string>(Object.values(RelationshipGoal));
const DISTANCE_MODES = toSet<string>(['nearby', 'global']);

/** Bounds the distance rules enforce, mirrored from APP_CONFIG and the schema. */
const MIN_DISTANCE = 1;
const MAX_DISTANCE = 500;

const LIFESTYLE_ENUMS: {
  [K in keyof typeof LIFESTYLE_DEFAULTS]: Set<string>;
} = {
  schedule: toSet<string>(Object.values(ScheduleType)),
  exercise: toSet<string>(Object.values(ExerciseLevel)),
  smoking: toSet<string>(Object.values(SmokingStatus)),
  drinking: toSet<string>(Object.values(DrinkingStatus)),
  pets: toSet<string>(Object.values(PetsPreference)),
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function normalisePrompts(raw: unknown): PromptAnswer[] {
  const seen = new Set<string>();
  const answers: PromptAnswer[] = [];

  for (const entry of asArray(raw)) {
    if (!isRecord(entry)) continue;
    const { promptId, tag, choice, note } = entry;

    if (typeof promptId !== 'string' || !promptId) continue;
    if (typeof tag !== 'string' || !PROMPT_TAGS.has(tag)) continue;
    if (typeof choice !== 'string' || !PROMPT_CHOICES.has(choice)) continue;
    // Two answers to the same tag score as one prompt but read as two opinions.
    if (seen.has(tag)) continue;

    seen.add(tag);
    answers.push({
      promptId,
      tag: tag as PromptTag,
      choice: choice as PromptChoice,
      ...(typeof note === 'string' && note ? { note } : {}),
    });
  }

  return answers;
}

function normaliseLifestyle(raw: unknown) {
  const source = isRecord(raw) ? raw : {};
  const result = { ...LIFESTYLE_DEFAULTS };

  for (const key of Object.keys(LIFESTYLE_ENUMS) as Array<keyof typeof LIFESTYLE_ENUMS>) {
    const value = source[key];
    if (typeof value === 'string' && LIFESTYLE_ENUMS[key].has(value)) {
      Object.assign(result, { [key]: value });
    }
  }

  return result;
}

export function normaliseQuestionnaire(raw: unknown): UserQuestionnaire {
  const source = isRecord(raw) ? raw : {};

  const values = asArray(source.values).filter(
    (value): value is PartnerValue => typeof value === 'string' && PARTNER_VALUES.has(value)
  );
  const valueSet = new Set<string>(values);

  const importance: ValueImportance = {};
  if (isRecord(source.importance)) {
    for (const [key, value] of Object.entries(source.importance)) {
      // A grade is only meaningful for a value that was actually picked.
      if (!valueSet.has(key)) continue;
      if (typeof value !== 'number' || !IMPORTANCES.has(value)) continue;
      importance[key as PartnerValue] = value as ImportanceScale;
    }
  }

  const dealBreakers = asArray(source.dealBreakers).filter(
    (value): value is PartnerValue => typeof value === 'string' && valueSet.has(value)
  );

  return {
    values,
    importance,
    dealBreakers,
    prompts: normalisePrompts(source.prompts),
    lifestyle: normaliseLifestyle(source.lifestyle),
  };
}

/**
 * Brings stored discovery preferences up to the current shape.
 *
 * `distanceMode` is the reason this exists. A record written before it has a
 * `maxDistance` but no way of saying whether that number was ever a live limit,
 * so the only honest reading is `nearby`: the user picked a radius, so treat it
 * as one. Defaulting to `global` would quietly double everyone's radius on the
 * upgrade, which is the kind of change nobody notices until they wonder why
 * someone in another country is in their deck.
 *
 * Numbers outside the range the rules and schema accept are clamped rather than
 * dropped, since a radius of 900 is a preference that 500 happens to cap and a
 * radius of 0 is a record that never finished onboarding.
 */
export function normalisePreferences(raw: unknown): UserPreferences {
  const source = isRecord(raw) ? raw : {};

  const distanceMode =
    typeof source.distanceMode === 'string' && DISTANCE_MODES.has(source.distanceMode)
      ? (source.distanceMode as DistanceMode)
      : 'nearby';

  const ageRange = isRecord(source.ageRange) ? source.ageRange : {};
  const min = clampNumber(ageRange.min, APP_CONFIG.MIN_AGE, APP_CONFIG.MIN_AGE, APP_CONFIG.MAX_AGE);
  const max = clampNumber(ageRange.max, 38, APP_CONFIG.MIN_AGE + 1, APP_CONFIG.MAX_AGE);

  return {
    // Held coherent rather than left inverted, since the schema rejects
    // `min >= max` and a normalised record that its own schema rejects is not
    // an upgrade.
    ageRange: { min: Math.min(min, max - 1), max: Math.max(max, min + 1) },
    distanceMode,
    maxDistance: clampNumber(source.maxDistance, 50, MIN_DISTANCE, MAX_DISTANCE),
    genders: asArray(source.genders).filter(
      (value): value is Gender => typeof value === 'string' && GENDERS.has(value)
    ),
    relationshipGoals: asArray(source.relationshipGoals).filter(
      (value): value is RelationshipGoal =>
        typeof value === 'string' && RELATIONSHIP_GOALS.has(value)
    ),
  };
}

function clampNumber(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(maximum, Math.max(minimum, numeric));
}

/**
 * Gives a stored location measurable coordinates where we can.
 *
 * Records are read from a JSON blob that predates the distance rules, so a large
 * share of them carry the `0, 0` placeholder: a hand-typed city, or an account
 * registered before onboarding collected coordinates. Left alone they would be
 * invisible in every nearby deck, because a profile at 0,0 is roughly 10,000 km
 * from everyone and the filter would be behaving correctly.
 *
 * The city label is resolved against the catalog rather than discarded. That is
 * a guess -- a centroid, not a home address -- but it is a guess in the
 * direction of showing someone their deck rather than an empty screen, and the
 * alternative is that upgrading the database quietly empties everyone's feed.
 *
 * A city we cannot resolve is left as `0, 0` rather than invented, and stays
 * hidden from nearby viewers while remaining reachable on global.
 */
export function normaliseLocation(raw: unknown): Location {
  const source = isRecord(raw) ? raw : {};

  const city = typeof source.city === 'string' ? source.city : '';
  const country = typeof source.country === 'string' ? source.country : '';

  const latitude = typeof source.latitude === 'number' ? source.latitude : Number.NaN;
  const longitude = typeof source.longitude === 'number' ? source.longitude : Number.NaN;

  const candidate: Location = { latitude, longitude, city, country };
  if (hasCoordinates(candidate)) return candidate;

  const centroid = findCityCentroid(city, country);
  if (!centroid) return { latitude: 0, longitude: 0, city, country };

  return { latitude: centroid.latitude, longitude: centroid.longitude, city, country };
}

/** Normalises every user in a stored mock state, reporting whether anything moved. */
export function normaliseStateUsers(users: unknown): { users: unknown[]; changed: boolean } {
  if (!Array.isArray(users)) return { users: [], changed: true };

  let changed = false;
  const next = users.map((user) => {
    if (!isRecord(user)) {
      changed = true;
      return user;
    }

    const questionnaire = normaliseQuestionnaire(user.questionnaire);
    const preferences = normalisePreferences(user.preferences);
    const location = normaliseLocation(user.location);

    const untouched =
      JSON.stringify(questionnaire) === JSON.stringify(user.questionnaire) &&
      JSON.stringify(preferences) === JSON.stringify(user.preferences) &&
      JSON.stringify(location) === JSON.stringify(user.location);

    if (untouched) return user;

    changed = true;
    return { ...user, questionnaire, preferences, location };
  });

  return { users: next, changed };
}
