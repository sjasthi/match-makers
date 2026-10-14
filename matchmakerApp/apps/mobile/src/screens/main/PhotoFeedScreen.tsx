import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { Text } from 'react-native-paper';
import type { PostReactionAction } from '@match-makers/shared';

import { ScreenContainer, TasteSummary, PhotoGrid, PostViewer, LoadingState } from '@/components';
import { usePhotoFeed } from '@/hooks';
import { COLORS, FONT_SIZES, SPACING } from '@/constants';
import { tagLabel } from '@/utils/interests';
import type { MainTabParamList } from '@/navigation/types';

type Nav = BottomTabNavigationProp<MainTabParamList>;

/**
 * The landing page: a wall of site-owned photos, answered at your pace.
 *
 * This replaced the swipe deck as the first tab, then replaced one-photo-at-a-time
 * with this grid. The reasoning survived both changes: the deck asks for a
 * decision about a person and can only ask it honestly once the questionnaire is
 * answered, so a signed-in account used to land on a form. Browsing photos has no
 * such precondition, and what it produces is exactly the input the deck was
 * missing.
 *
 * Two surfaces on purpose. The grid is for browsing — many small pictures, no
 * decisions — and the viewer is for deciding, where one photo is big enough that
 * its tags are readable. A like is only meaningful as taste if you can see what
 * you are liking, and at tile size you cannot.
 *
 * There is no gate on this screen and there should not be. Everything it shows is
 * site-owned content, and the only thing it writes is a reaction.
 */
export function PhotoFeedScreen() {
  const navigation = useNavigation<Nav>();
  const {
    posts,
    visible,
    pagePosts,
    page,
    pageCount,
    reactions,
    state,
    error,
    total,
    summary,
    activeTag,
    summaryExpanded,
    remaining,
    load,
    refresh,
    react,
    setActiveTag,
    setPage,
    toggleSummaryExpanded,
    libraryIsEmpty,
  } = usePhotoFeed();

  // Which photo the viewer is showing. Local rather than in the store because it
  // is a mode of this screen, not a place, and nothing else needs to know.
  const [viewingId, setViewingId] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Refreshes on return from another tab, but only when there is nothing to
   * show.
   *
   * The guard reads through a ref rather than closing over `state` and `posts`.
   * `useFocusEffect` re-runs its effect whenever the callback identity changes,
   * so a callback that depended on the values it was reading would re-arm itself
   * after every load: load succeeds, the grid is empty, the effect refetches,
   * state changes, the effect refetches. On an empty grid that never settles, and
   * an empty grid is exactly the case this screen has to handle.
   */
  const guard = useRef({ state, posts });
  guard.current = { state, posts };

  useFocusEffect(
    useCallback(() => {
      const current = guard.current;
      if (current.state === 'success' && current.posts.length === 0) void load();
    }, [load])
  );

  /**
   * The photo the viewer is showing, or nothing at all when it is closed.
   *
   * These used to be two cases in one expression, and that is what made the close
   * button do nothing:
   *
   *     viewingIndex >= 0 ? visible[viewingIndex] : visible[0]
   *
   * Closing sets `viewingId` to null, which produced a negative index, which fell
   * through to the fallback and handed the viewer the *first* photo instead of
   * none — so `PostViewer`'s `visible={post !== null}` never went false.
   *
   * There is only one case now. Answering no longer removes the photo from the
   * grid, so the thing you are looking at cannot vanish underneath you and there
   * is nothing to fall forward to. The `?? null` is left to cover a photo deleted
   * from the library while the viewer is open, where closing is the right answer.
   */
  const viewing =
    viewingId === null ? null : (visible.find((post) => post.id === viewingId) ?? null);

  const onTagPress = useCallback(
    (tag: string) => {
      if (!tag) return;
      // Tapping the tag that is already filtering clears it, so one place to tap
      // does both things.
      setActiveTag(activeTag === tag ? null : tag);
    },
    [activeTag, setActiveTag]
  );

  const goToLikes = useCallback(() => {
    navigation.navigate('Likes');
  }, [navigation]);

  const subtitle =
    total === 0
      ? 'Like a photo and we will use it to find you people'
      : activeTag
        ? `${visible.length} tagged ${tagLabel(activeTag).toLowerCase()} · ${remaining} left`
        : remaining === 0
          ? `All ${total} answered · tap any to change your mind`
          : `${remaining} of ${total} to answer · tap one to answer`;

  if (state === 'loading' && posts.length === 0) {
    return <LoadingState label="Finding photos for you..." fullHeight />;
  }

  return (
    <ScreenContainer padded={false}>
      <View style={styles.header}>
        <Text variant="titleLarge" style={styles.title}>
          Discover
        </Text>
        <Text variant="bodySmall" style={styles.subtitle}>
          {subtitle}
        </Text>
      </View>

      <View style={styles.summary}>
        <TasteSummary
          summary={summary}
          expanded={summaryExpanded}
          onToggle={toggleSummaryExpanded}
        />
      </View>

      <PhotoGrid
        posts={pagePosts}
        reactions={reactions}
        activeTag={activeTag}
        onTagPress={onTagPress}
        onOpen={setViewingId}
        onClearFilter={() => setActiveTag(null)}
        page={page}
        pageCount={pageCount}
        onPageChange={setPage}
        libraryIsEmpty={libraryIsEmpty}
        remaining={remaining}
        total={total}
        state={state}
        error={error}
        onRetry={() => void load()}
        onRefresh={() => void refresh()}
        onSeeMatches={goToLikes}
        likedCount={summary.likes}
      />

      <PostViewer
        post={viewing}
        reaction={viewing ? reactions[viewing.id] : undefined}
        onAnswer={(postId: string, action: PostReactionAction) => void react(postId, action)}
        onClose={() => setViewingId(null)}
        onSeeMatches={goToLikes}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.sm,
    gap: 2,
  },
  title: { fontWeight: '800' },
  subtitle: { color: COLORS.textSecondary, fontSize: FONT_SIZES.xs },
  summary: {
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.sm,
  },
});