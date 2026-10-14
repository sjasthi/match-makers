import { describeTags, normaliseTag, tagDisplay, TAG_MAX_LENGTH } from './tags';
import { MAX_POST_TAGS } from './validation/schemas';
import { postImportSchema, postTagSchema } from './validation/schemas';

describe('normaliseTag', () => {
  it('lowercases and trims, so the same word typed twice is one tag', () => {
    expect(normaliseTag('Dogs')).toBe('dog');
    expect(normaliseTag('  DOGS  ')).toBe('dog');
    expect(normaliseTag('dog')).toBe('dog');
  });

  it('collapses internal whitespace, so a stray double space is not a second tag', () => {
    expect(normaliseTag('  live   music ')).toBe('live music');
  });

  it('folds a plural, which is the case this whole rule exists for', () => {
    // The failure this prevents is silent: two people type `dog` and `dogs`, no
    // exact match is found, and the percentage just quietly does not move.
    expect(normaliseTag('dogs')).toBe('dog');
    expect(normaliseTag('cats')).toBe('cat');
    expect(normaliseTag('HIKES')).toBe('hike');
  });

  it('leaves a word ending in ss alone', () => {
    // A naive trailing-s strip turns these into misspellings. They would still
    // match each other consistently, so nothing would break visibly, but the
    // chip would show a typo on the screen the admin is using to check their work.
    expect(normaliseTag('fitness')).toBe('fitness');
    expect(normaliseTag('glass')).toBe('glass');
    expect(normaliseTag('dress')).toBe('dress');
  });

  it('leaves a word ending in us alone', () => {
    expect(normaliseTag('bus')).toBe('bus');
    expect(normaliseTag('focus')).toBe('focus');
    expect(normaliseTag('cactus')).toBe('cactus');
  });

  it('leaves a word ending in is alone', () => {
    expect(normaliseTag('iris')).toBe('iris');
    expect(normaliseTag('analysis')).toBe('analysis');
  });

  it('leaves a short word alone even when it ends in s', () => {
    // Length guard, so `gas` does not become `ga`.
    expect(normaliseTag('gas')).toBe('gas');
  });

  it('leaves a singular alone', () => {
    expect(normaliseTag('music')).toBe('music');
    expect(normaliseTag('art')).toBe('art');
    expect(normaliseTag('hiking')).toBe('hiking');
    expect(normaliseTag('baking')).toBe('baking');
  });

  it('handles the seeded vocabulary without mangling any of it', () => {
    // The seed is written in canonical form, so this doubles as a guard that a
    // future change to the fold rule cannot quietly corrupt the shipped data.
    for (const tag of ['animal', 'pet', 'outdoor', 'food', 'travel', 'music', 'fitness', 'art', 'home', 'nightlife']) {
      expect(normaliseTag(tag)).toBe(tag);
    }
  });

  it('is idempotent, so re-folding a stored tag cannot change it', () => {
    // Normalising on write and again on load has to be a no-op the second time,
    // or a stored tag would drift every time the database is read.
    for (const input of ['Dogs', '  HOT DOG ', 'fitness', 'Classes', 'bus']) {
      const once = normaliseTag(input);
      expect(normaliseTag(once)).toBe(once);
    }
  });

  it('returns empty for input that was empty to begin with', () => {
    expect(normaliseTag('')).toBe('');
    expect(normaliseTag('   ')).toBe('');
  });

  it('accepts a tag at the length limit and rejects one past it', () => {
    const atLimit = 'a'.repeat(TAG_MAX_LENGTH);
    expect(postTagSchema.safeParse(atLimit).success).toBe(true);
    expect(postTagSchema.safeParse(`${atLimit}a`).success).toBe(false);
  });
});

describe('postTagSchema', () => {
  it('normalises as it validates, so nothing un-canonical reaches storage', () => {
    // The schema is the single gate every write goes through, which is why the
    // fold lives here rather than only in the input component.
    expect(postTagSchema.parse('  Dogs ')).toBe('dog');
    expect(postTagSchema.parse('HOT DOG')).toBe('hot dog');
  });

  it('rejects an empty or whitespace-only tag', () => {
    expect(postTagSchema.safeParse('').success).toBe(false);
    expect(postTagSchema.safeParse('   ').success).toBe(false);
  });

  it('rejects a non-string rather than coercing it', () => {
    expect(postTagSchema.safeParse(42).success).toBe(false);
    expect(postTagSchema.safeParse(null).success).toBe(false);
  });
});

describe('tagDisplay', () => {
  it('capitalises only the first character', () => {
    expect(tagDisplay('hiking')).toBe('Hiking');
    expect(tagDisplay('live music')).toBe('Live music');
  });

  it('leaves the rest of the word alone', () => {
    // A tag is somebody's own word. Title-casing the whole thing would mangle
    // `iPhone` and `eBay` into things nobody typed.
    expect(tagDisplay('iphone')).toBe('Iphone');
    expect(tagDisplay('e 2 e')).toBe('E 2 e');
  });

  it('is safe on an empty tag', () => {
    expect(tagDisplay('')).toBe('');
  });
});

describe('describeTags', () => {
  it('reads as a sentence', () => {
    expect(describeTags(['dog'])).toBe('dog');
    expect(describeTags(['dog', 'cat'])).toBe('dog and cat');
    expect(describeTags(['dog', 'cat', 'bird'])).toBe('dog, cat and bird');
  });

  it('caps the sentence and says how many it left out', () => {
    // This goes under a match percentage. A sentence with eight tags in it is
    // not a sentence, and that line is the product's whole pitch.
    const sentence = describeTags(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
    expect(sentence).toBe('a, b, c, 5 more');
    // Never a double "and": "and 5 more" is already the conjunction.
    expect(describeTags(['a', 'b', 'c', 'd'])).toBe('a, b, c, 1 more');
  });

  it('says nothing for no tags', () => {
    expect(describeTags([])).toBe('');
  });
});
describe('postImportSchema', () => {
  const image = 'file:///tmp/cat.jpg';

  it('folds every tag and de-duplicates what folding collided', () => {
    // The whole point of folding at the gate: `Dogs` and `  dog ` are one tag,
    // and storing both would make the taste index count the reaction twice for a
    // tag the person expressed once, inflating their affinity with everybody else
    // who liked that photo.
    expect(
      postImportSchema.parse({ imageUri: image, tags: ['Dogs', '  dog ', 'DOG', 'cat'] }).tags
    ).toEqual(['dog', 'cat']);
  });

  it('keeps the earliest of two tags that fold together', () => {
    // Order is meaningful: the first tag is the primary one a co-like is credited
    // to. Silently promoting the later one would change what the photo is about.
    expect(postImportSchema.parse({ imageUri: image, tags: ['dog', 'cat', 'dogs'] }).tags).toEqual([
      'dog',
      'cat',
    ]);
  });

  it('rejects a photo with no tags', () => {
    expect(postImportSchema.safeParse({ imageUri: image, tags: [] }).success).toBe(false);
  });

  it('accepts a photo at the cap', () => {
    const tags = Array.from({ length: MAX_POST_TAGS }, (_, index) => `tag${index}`);
    expect(postImportSchema.safeParse({ imageUri: image, tags }).success).toBe(true);
  });

  it('rejects a photo past the cap', () => {
    const tags = Array.from({ length: MAX_POST_TAGS + 1 }, (_, index) => `tag${index}`);
    const result = postImportSchema.safeParse({ imageUri: image, tags });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/at most 8 tags/i);
  });

  it('counts the raw list against the cap, before de-duplication', () => {
    // Nine words is nine words even if two of them collide, and silently
    // accepting nine where eight was the stated limit would make the limit a
    // suggestion.
    const tags = ['dog', 'dogs', 'cat', 'art', 'music', 'food', 'travel', 'home', 'dogs'];
    expect(postImportSchema.safeParse({ imageUri: image, tags }).success).toBe(false);
  });
});
