import { useCallback } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import type { Post, PostReactionAction } from '@match-makers/shared';

import { PhotoPostCard } from './PhotoPostCard';
import { PostActions } from './PostActions';
import { COLORS, FONT_SIZES, SPACING } from '@/constants';
import { tagLabel } from '@/utils/interests';

interface Props {
  /** The post being looked at, or null when the viewer is closed. */
  post: Post | null;
  /** This person's current answer to it, if any. Drives the filled/outline buttons. */
  reaction?: PostReactionAction;
  onAnswer: (postId: string, action: PostReactionAction) => void;
  onClose: () => void;
  /** Jump to the deck the answers have been feeding. */
  onSeeMatches: () => void;
  testID?: string;
}

/**
 * Full-screen photo viewer: look properly, then answer.
 *
 * The grid is for browsing and this is for deciding. That split is the whole
 * reason the feature works — a like is only meaningful as taste if you can see
 * the photo is tagged `dog`, and at tile size in a grid you cannot.
 *
 * Answering does **not** advance. It used to, which was right when answering
 * removed the photo and the only way back was to reopen it from the grid. Now
 * that answers can be undone, stepping away from the photo the moment you answer
 * it turns changing your mind into a three-step round trip. The buttons fill in
 * place, and pressing the lit one again clears the answer.
 *
 * A `Modal` rather than a route: it is a mode of this screen, not a place, and
 * putting it on the tab navigator would mean a back button competing with the
 * close button for the same corner.
 */
export function PostViewer({
  post,
  reaction,
  onAnswer,
  onClose,
  onSeeMatches,
  testID = 'post-viewer',
}: Props) {
  const answer = useCallback(
    (action: PostReactionAction) => {
      if (!post) return;
      onAnswer(post.id, action);
    },
    [post, onAnswer]
  );

  const goToMatches = useCallback(() => {
    onClose();
    onSeeMatches();
  }, [onClose, onSeeMatches]);

  return (
    <Modal
      visible={post !== null}
      animationType="slide"
      // Android hardware back, which would otherwise drop the user past the
      // viewer and into the tab behind it.
      onRequestClose={onClose}
      presentationStyle="fullScreen"
      testID={testID}
    >
      <View style={styles.root}>
        <View style={styles.chrome}>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close and go back to the grid"
            hitSlop={12}
            style={styles.close}
            testID={`${testID}-close`}
          >
            <Text style={styles.closeText}>✕</Text>
          </Pressable>


        </View>

        {post ? (
          <View style={styles.card}>
            {/* The card owns only the photo. The close button and the remaining
                count are this viewer's chrome, so they live here rather than
                being pushed into a component that is also used by nothing else. */}
            <PhotoPostCard post={post} testID={`${testID}-card`} />

            <View style={styles.actions}>
              <PostActions
                onLike={() => answer('like')}
                onDislike={() => answer('dislike')}
                subject={post.tags[0] ? tagLabel(post.tags[0]).toLowerCase() : undefined}
                reaction={reaction}
              />
            </View>

            <Pressable
              onPress={goToMatches}
              accessibilityRole="button"
              accessibilityLabel="See who we picked for you"
              style={styles.cta}
              testID={`${testID}-go-to-likes`}
            >
              <Text variant="labelSmall" style={styles.ctaText}>
                SEE WHO WE PICKED FOR YOU ›
              </Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  chrome: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.xl,
    paddingBottom: SPACING.sm,
  },
  close: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surface,
  },
  closeText: {
    color: COLORS.text,
    fontSize: FONT_SIZES.lg,
    fontWeight: '700',
  },
  card: {
    flex: 1,
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.lg,
    // The photo decides its own height now, so a landscape image in a tall
    // viewer sits centred rather than stretched to the top of the space.
    justifyContent: 'center',
  },
  actions: {
    paddingVertical: SPACING.lg,
  },
  cta: {
    alignItems: 'center',
    paddingVertical: SPACING.sm,
  },
  ctaText: {
    color: COLORS.primary,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
});