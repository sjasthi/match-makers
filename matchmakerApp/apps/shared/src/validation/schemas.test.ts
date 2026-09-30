import { loginSchema, passwordSchema, registerSchema, preferencesSchema } from './schemas';
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
    maxDistance: 50,
    genders: [Gender.FEMALE],
    relationshipGoals: [RelationshipGoal.LONG_TERM],
  };

  it('accepts a valid range', () => {
    expect(preferencesSchema.safeParse(base).success).toBe(true);
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
