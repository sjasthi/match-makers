import { Pressable, StyleSheet, Text as RNText } from 'react-native';
import { Text } from 'react-native-paper';
import { ProfileImage } from './ProfileImage';
import { BORDER_RADIUS, COLORS, FONT_SIZES, SPACING } from '@/constants';

export interface PersonTileProps {
  userId: string;
  name: string;
  /** The deck's own number, 0-100. One meaning for the word "match" app-wide. */
  score: number;
  /** The checkable sentence under the percentage, or null with nothing shared. */
  reason?: string | null;
  onPress: () => void;
  /** Prefixes the testID so two grids on one screen cannot collide. */
  testPrefix: string;
}

/**
 * One person, as a card in a grid of people.
 *
 * Extracted because two surfaces now render exactly this — the Taste Profile's
 * "who your answers pulled you towards" and the deck — and the two were built a
 * round apart with the same markup written twice. A third copy was not going to
 * be the thing that finally made it a component.
 *
 * The percentage is the deck's score, not the taste affinity, and that is
 * deliberate: two different percentages under the same word "match", on two
 * screens a swipe apart, is how "who is closest" became unanswerable from the
 * UI. The reason goes under it because a percentage a person cannot check is a
 * number they have to take on faith.
 */
export function PersonTile({ userId, name, score, reason, onPress, testPrefix }: PersonTileProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${score}% match${reason ? `. ${reason}` : ''}`}
      style={styles.tile}
      testID={`${testPrefix}-${userId}`}
    >
      <ProfileImage
        user={{ id: userId, name }}
        initialsScale={0.34}
        style={styles.avatar}
      />

      <Text variant="titleSmall" style={styles.name} numberOfLines={1}>
        {name}
      </Text>

      <Text variant="titleMedium" style={styles.score}>
        {score}%
      </Text>

      {/* Omitted rather than shown blank. A card with no reason is a real state
          — nothing shared yet — and an empty line would read as a broken one. */}
      {reason ? (
        <RNText style={styles.reason} numberOfLines={3}>
          {reason}
        </RNText>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    // Three across with the section gutter accounted for, which is also why the
    // closest list is capped at three: a grid of three is one clean row.
    flexGrow: 1,
    flexBasis: '30%',
    gap: SPACING.xs,
    padding: SPACING.sm,
    borderRadius: BORDER_RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  avatar: { width: 56, height: 56, borderRadius: 28 },
  name: { color: COLORS.text },
  score: { color: COLORS.primary, fontWeight: '700' },
  reason: { color: COLORS.textSecondary, fontSize: FONT_SIZES.xs },
});

/** How tiles compose into a grid. Exported so every grid of people wraps identically. */
export const personTileGridStyle = {
  flexDirection: 'row',
  flexWrap: 'wrap',
  gap: SPACING.sm,
} as const;