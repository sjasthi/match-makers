import {
  loginSchema,
  passwordSchema,
  postImportSchema,
  postSchema,
  preferencesSchema,
  registerSchema,
} from './schemas';
import { Gender, RelationshipGoal } from '../types';

describe('loginSchema', () => {
  it('accepts a well formed payload', () => {
    const result = loginSchema.safeParse({ email: 'ada@example.com', password: 'hunter2' });
    expect(result.success).toBe(true);
  });

  it('rejects a malformed email', () => {
    const result = loginSchema.safeParse({ email: 'not-an-email', password: 'hunter2' });
    expect(result.success).toBe(false);
  });

  it('rejects an empty password', () => {
    const result = loginSchema.safeParse({ email: 'ada@example.com', password: '' });
    expect(result.success).toBe(false);
  });
});

describe('passwordSchema', () => {
  it.each([
    ['short1A', 'Password must be at least 8 characters'],
    ['alllowercase1', 'Password must contain at least one uppercase letter'],
    ['ALLUPPERCASE1', 'Password must contain at least one lowercase letter'],
    ['NoDigitsHere', 'Password must contain at least one number'],
  ])('rejects %s', (password, expectedMessage) => {
    const result = passwordSchema.safeParse(password);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(expectedMessage);
    }
  });

  it('accepts a compliant password', () => {
    expect(passwordSchema.safeParse('Str0ngPass').success).toBe(true);
  });
});

describe('registerSchema', () => {
  const base = {
    email: 'ada@example.com',
    password: 'Str0ngPass',
    confirmPassword: 'Str0ngPass',
    name: 'Ada Lovelace',
    dateOfBirth: '1990-04-12',
    gender: Gender.FEMALE,
  };

  it('accepts a matching password pair', () => {
    expect(registerSchema.safeParse(base).success).toBe(true);
  });

  it('rejects mismatched passwords and points at confirmPassword', () => {
    const result = registerSchema.safeParse({ ...base, confirmPassword: 'Different1' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path[0] === 'confirmPassword');
      expect(issue?.message).toBe('Passwords do not match');
    }
  });

  it('rejects users under 18', () => {
    const underage = new Date();
    underage.setFullYear(underage.getFullYear() - 17);
    const result = registerSchema.safeParse({ ...base, dateOfBirth: underage.toISOString() });
    expect(result.success).toBe(false);
  });
});

describe('preferencesSchema', () => {
  const base = {
    ageRange: { min: 24, max: 38 },
    distanceMode: 'nearby' as const,
    maxDistance: 50,
    genders: [Gender.FEMALE],
    relationshipGoals: [RelationshipGoal.LONG_TERM],
  };

  it('accepts a valid range', () => {
    expect(preferencesSchema.safeParse(base).success).toBe(true);
  });

  it('accepts global mode', () => {
    expect(preferencesSchema.safeParse({ ...base, distanceMode: 'global' }).success).toBe(true);
  });

  it('rejects a distance mode it does not know', () => {
    // A typo has to fail here rather than being dropped, because a preference
    // silently reverted to a default is worse than one rejected outright.
    const result = preferencesSchema.safeParse({ ...base, distanceMode: 'anywhere' });
    expect(result.success).toBe(false);
  });

  it('still validates the radius while global, so a round trip survives', () => {
    // The radius is carried through global mode precisely so switching back to
    // nearby restores it. Rejecting it while hidden would make a profile fail
    // on a field the person cannot see.
    expect(
      preferencesSchema.safeParse({ ...base, distanceMode: 'global', maxDistance: 0 }).success
    ).toBe(false);
    expect(preferencesSchema.safeParse({ ...base, distanceMode: 'global' }).success).toBe(true);
  });

  it('rejects an inverted age range', () => {
    const result = preferencesSchema.safeParse({ ...base, ageRange: { min: 40, max: 30 } });
    expect(result.success).toBe(false);
  });

  it('requires at least one gender', () => {
    const result = preferencesSchema.safeParse({ ...base, genders: [] });
    expect(result.success).toBe(false);
  });
});

describe('postSchema', () => {
  const base = {
    id: 'post_1',
    imageUri: 'file:///cache/1200.jpg',
    tags: ['dog'],
    createdAt: '2026-01-01T00:00:00.000Z',
  };

  it('accepts a post written before the second copy existed', () => {
    // Every post in storage predates thumbUri, so this shape has to keep
    // validating or the migration would reject the whole library at once.
    expect(postSchema.safeParse(base).success).toBe(true);
  });

  it('accepts both copies and the dimensions of the full one', () => {
    const result = postSchema.safeParse({
      ...base,
      thumbUri: 'file:///cache/640.jpg',
      width: 1200,
      height: 900,
    });
    expect(result.success).toBe(true);
  });

  it.each([
    ['zero width', { width: 0 }],
    ['a negative height', { height: -10 }],
    ['a fractional width', { width: 120.5 }],
  ])('rejects %s', (_label, fields) => {
    // A nonsensical dimension is worse than an absent one: the viewer uses these
    // to size its card, so a zero would collapse the layout rather than fall back.
    expect(postSchema.safeParse({ ...base, ...fields }).success).toBe(false);
  });
});

describe('postImportSchema', () => {
  it('still requires the full image', () => {
    // A thumbnail on its own cannot be shown full screen, so it is never enough.
    const result = postImportSchema.safeParse({ thumbUri: 'file:///cache/640.jpg', tags: ['dog'] });
    expect(result.success).toBe(false);
  });

  it('accepts an import carrying both copies', () => {
    const result = postImportSchema.safeParse({
      imageUri: 'file:///cache/1200.jpg',
      thumbUri: 'file:///cache/640.jpg',
      width: 1200,
      height: 900,
      tags: ['dog'],
    });
    expect(result.success).toBe(true);
  });
});
