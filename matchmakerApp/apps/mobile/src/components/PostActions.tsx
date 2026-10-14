import { StyleSheet, View } from 'react-native';
import { IconButton } from 'react-native-paper';
import type { PostReactionAction } from '@match-makers/shared';

import { BORDER_RADIUS, COLORS, SPACING } from '@/constants';

interface Props {
  onLike: () => void;
  onDislike: () => void;
  /** The tag of the photo on screen, so the labels can name what is being judged. */
  subject?: string;
  /** Which way this photo is currently answered, if it is answered at all. */
  reaction?: PostReactionAction;
  disabled?: boolean;
}

/**
 * Like and dislike for the photo feed.
 *
 * Two buttons rather than a gesture. The swipe deck uses a drag because a
 * profile is a considered decision and the drag is a way of taking a moment over
 * it. A tap on a picture is not a considered decision, and requiring a drag for
 * the cheapest interaction in the app would also make it the only one that
 * cannot be pressed with a thumb or announced to a screen reader.
 *
 * `subject` is the primary tag, so the accessibility label says what is being
 * liked rather than announcing a bare "Like" against an unlabelled control.
 *
 * `reaction` is what makes unlike work. The button you are already holding down
 * is filled rather than outlined, and pressing it again takes the answer back —
 * the same control that made the answer is the one that removes it, so there is
 * no second control to learn and no state you cannot see your way out of.
 */
export function PostActions({ onLike, onDislike, subject, reaction, disabled }: Props) {
  const noun = subject ? ` this ${subject} photo` : ' this photo';
  const liked = reaction === 'like';
  const passed = reaction === 'dislike';

  return (
    <View style={styles.row} accessibilityRole="toolbar" accessibilityLabel="Photo reaction">
      <IconButton
        // Outlined until answered, then filled: the shape carries the state, so it
        // survives being greyscale and it is readable at a glance.
        icon={passed ? 'close-circle' : 'close-circle-outline'}
        iconColor={COLORS.error}
        size={34}
        mode="contained-tonal"
        containerColor={COLORS.background}
        onPress={onDislike}
        disabled={disabled}
        accessibilityLabel={
          passed ? `Clear your answer to${noun}` : `Show me fewer${noun}`
        }
        style={[styles.button, { borderColor: COLORS.error }]}
        testID="post-dislike"
      />

      <IconButton
        icon={liked ? 'heart' : 'heart-outline'}
        iconColor={COLORS.primary}
        size={34}
        mode="contained-tonal"
        containerColor={COLORS.background}
        onPress={onLike}
        disabled={disabled}
        accessibilityLabel={
          liked ? `Unlike${noun} again to clear your answer` : `I like${noun}`
        }
        style={[styles.button, { borderColor: COLORS.primary }]}
        testID="post-like"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.xl,
  },
  button: {
    borderWidth: 2,
    borderRadius: BORDER_RADIUS.full,
  },
});
