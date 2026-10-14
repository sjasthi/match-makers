import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Chip, HelperText, Text, TextInput } from 'react-native-paper';
import { MAX_POST_TAGS, TAG_MAX_LENGTH, normaliseTag } from '@match-makers/shared';

import { rankSuggestions, tagColor, tagLabel } from '@/utils/interests';
import { BORDER_RADIUS, COLORS, FONT_SIZES, SPACING } from '@/constants';

interface Props {
  tags: string[];
  onChange: (next: string[]) => void;
  /** Tags already in use elsewhere, with counts. Used only to suggest. */
  suggestions?: ReadonlyArray<{ tag: string; count: number }>;
  label?: string;
  /** Shown under the field until something has been committed. */
  hint?: string;
  disabled?: boolean;
  testID?: string;
}

/** How many suggestions to offer. Enough to scan, few enough to stay a strip. */
const SUGGESTION_LIMIT = 6;

/**
 * Type a word, press enter, it becomes a tag.
 *
 * Enter is the whole interaction, so the field has to behave like one: it keeps
 * focus and the keyboard stays up after a commit, because the common case is
 * three tags in a row and dismissing the keyboard between each of them is what
 * would make that tedious. Backspace on an empty field steps back through the
 * chips, which is the other half of that muscle memory.
 *
 * The chip shows the canonical form, not what was typed. `Dogs` is stored and
 * displayed as `dog`, so the admin can see the exact spelling that will be
 * compared against everybody else's — otherwise a folded word would look like a
 * bug and get "fixed" into two different tags.
 *
 * Suggestions are advisory only. Anything typed is accepted, because a library
 * that can only describe cats is not a library. They exist because free text
 * means everybody invents their own vocabulary, and the tag-level signal quietly
 * stops working when two people say `dog` and `dogs` and nobody said otherwise.
 * Offering the words already in use is the cheapest way to pull the vocabulary
 * back together without forbidding anything.
 */
export function TagInput({
  tags,
  onChange,
  suggestions = [],
  label = 'Tags',
  hint,
  disabled,
  testID = 'tag-input',
}: Props) {
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);

  const atCapacity = tags.length >= MAX_POST_TAGS;

  const commit = useCallback(
    (raw: string) => {
      const tag = normaliseTag(raw);
      setTyped('');

      if (!tag) {
        // Enter on an empty field is not a mistake, it is somebody reaching for
        // the next one. Clearing whatever was there is the whole response.
        setError(null);
        return;
      }

      if (raw.trim().length > TAG_MAX_LENGTH) {
        setError(`Keep tags under ${TAG_MAX_LENGTH} characters`);
        return;
      }

      if (tags.includes(tag)) {
        setError(`"${tagLabel(tag)}" is already on this photo`);
        return;
      }

      if (tags.length >= MAX_POST_TAGS) {
        // Unreachable through the UI, because the field is disabled at the cap.
        // Kept because the input is controlled: a caller could hand it a full
        // list while leaving the field enabled, and overwriting it silently
        // would be worse than refusing.
        setError(`A photo can carry at most ${MAX_POST_TAGS} tags`);
        return;
      }

      setError(null);
      onChange([...tags, tag]);
    },
    [tags, onChange]
  );

  const remove = useCallback(
    (tag: string) => {
      setError(null);
      onChange(tags.filter((value) => value !== tag));
    },
    [tags, onChange]
  );

  /**
   * Backspace on an empty field steps back through the chips.
   *
   * React Native gives no reliable cross-platform "backspace was pressed" signal
   * on a soft keyboard, so this watches the text collapsing to nothing instead.
   * Two guards make that safe: it only fires when the field was *already* empty,
   * so deleting a character somebody is halfway through typing never drops a
   * committed tag; and `consumedEmpty` makes it idempotent, so one backspace
   * removes one chip even if the platform reports the same keystroke twice. The
   * flag clears as soon as anything is typed again.
   */
  const consumedEmpty = useRef(false);

  const onChangeText = useCallback(
    (value: string) => {
      if (value.length > 0) {
        consumedEmpty.current = false;
        setTyped(value);
        return;
      }

      if (typed.length === 0 && tags.length > 0 && !consumedEmpty.current) {
        consumedEmpty.current = true;
        remove(tags[tags.length - 1]!);
        return;
      }

      setTyped('');
    },
    [typed, tags, remove]
  );

  const offered = useMemo(
    () => rankSuggestions(typed, suggestions, tags, SUGGESTION_LIMIT),
    [typed, suggestions, tags]
  );

  return (
    <View style={styles.container} testID={testID}>
      {tags.length > 0 ? (
        <View style={styles.chipRow} testID={`${testID}-chips`}>
          {tags.map((tag, index) => (
            <Chip
              key={tag}
              onClose={() => remove(tag)}
              onPress={() => remove(tag)}
              // Numbered because the first tag is the primary one, which is what
              // a co-like is credited to in the match reason. Tapping the chip to
              // drop it is there because the × is a small target on a phone.
              style={[styles.chip, { backgroundColor: tagColor(tag) }]}
              textStyle={styles.chipText}
              // Chip takes no closeIconColor in this version, and the default is
              // mid-tone against the tag's own fill, so the × lands somewhere
              // between legible and not on half the swatches. A per-chip theme
              // override is the supported way to pin it to white.
              theme={{ colors: { onSurfaceVariant: COLORS.background } }}
              accessibilityLabel={`${tagLabel(tag)}${
                index === 0 ? ', primary tag' : ''
              }. Tap to remove.`}
              testID={`${testID}-tag-${tag}`}
            >
              {`${index + 1}. ${tagLabel(tag)}`}
            </Chip>
          ))}
        </View>
      ) : null}

      <TextInput
        mode="outlined"
        label={label}
        value={typed}
        onChangeText={onChangeText}
        onSubmitEditing={() => commit(typed)}
        // Enter commits rather than closing: the common case is several tags in a
        // row, and a keyboard that disappears between each one makes that three
        // times slower for no reason.
        returnKeyType="done"
        blurOnSubmit={false}
        autoCapitalize="none"
        autoCorrect={false}
        // The whole point is that anything is allowed, so the platform's spell
        // checker red underlining every word would be actively misleading.
        spellCheck={false}
        disabled={disabled || atCapacity}
        outlineColor={COLORS.border}
        style={styles.input}
        maxLength={TAG_MAX_LENGTH}
        accessibilityLabel={
          atCapacity
            ? `Tag limit reached: ${MAX_POST_TAGS} of ${MAX_POST_TAGS}`
            : `${label}. Type a word and press enter to add it`
        }
        testID={`${testID}-field`}
      />

      {error ? (
        <HelperText type="error" visible padding="none" testID={`${testID}-error`}>
          {error}
        </HelperText>
      ) : null}

      {offered.length > 0 && !atCapacity ? (
        <View style={styles.suggestions} testID={`${testID}-suggestions`}>
          <Text variant="labelSmall" style={styles.suggestionHeading}>
            ALREADY IN THE LIBRARY
          </Text>
          <View style={styles.suggestionRow}>
            {offered.map((tag) => (
              <Pressable
                key={tag}
                onPress={() => commit(tag)}
                accessibilityRole="button"
                accessibilityLabel={`Use the tag ${tagLabel(tag)}`}
                style={styles.suggestion}
                testID={`${testID}-suggestion-${tag}`}
              >
                <Text style={styles.suggestionText}>{tagLabel(tag)}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      <HelperText type="info" visible padding="none">
        {atCapacity
          ? `${MAX_POST_TAGS} of ${MAX_POST_TAGS} tags. Remove one to add another.`
          : (hint ?? 'Type a word and press enter. Tap a tag to remove it.')}
      </HelperText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: SPACING.xs },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs },
  chip: { borderRadius: BORDER_RADIUS.full },
  chipText: { color: COLORS.background, fontWeight: '700' },
  input: { backgroundColor: COLORS.background },
  suggestions: { gap: SPACING.xs },
  suggestionHeading: { color: COLORS.textMuted, letterSpacing: 0.8, fontWeight: '700' },
  suggestionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs },
  suggestion: {
    borderRadius: BORDER_RADIUS.full,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    backgroundColor: COLORS.surface,
  },
  suggestionText: { fontSize: FONT_SIZES.sm, color: COLORS.textSecondary },
});