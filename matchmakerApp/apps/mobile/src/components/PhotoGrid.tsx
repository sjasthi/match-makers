import { useEffect, useMemo, useRef } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
  type FlatList as FlatListType,
} from 'react-native';
import { Text } from 'react-native-paper';
import type { Post, PostReactionAction } from '@match-makers/shared';

import { PhotoTile } from './PhotoTile';
import { EmptyState } from './states';
import { ErrorBanner } from './ErrorBanner';
import { BORDER_RADIUS, COLORS, SPACING } from '@/constants';
import { columnCountFor, tileAspectRatio, toMasonryOrder } from '@/utils/masonry';
import { tagLabel } from '@/utils/interests';

interface Props {
  /** Just this page of the filtered set. */
  posts: Post[];
  reactions: Record<string, PostReactionAction>;
  activeTag: string | null;
  onTagPress: (tag: string) => void;
  onOpen: (postId: string) => void;
  onClearFilter: () => void;
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  /** True when the library itself is empty, rather than this person having answered all of it. */
  libraryIsEmpty: boolean;
  /** Photos still waiting on an answer, shown once the library is fully answered. */
  remaining: number;
  total: number;
  state: 'idle' | 'loading' | 'refreshing' | 'error' | 'success';
  error: string | null;
  onRetry: () => void;
  onRefresh: () => void;
  onSeeMatches: () => void;
  likedCount: number;
}

/** Side padding outside the outermost tiles. Matches the page gutter elsewhere. */
const GUTTER = SPACING.lg;
const GAP = SPACING.sm;

/**
 * The masonry grid.
 *
 * A single vertical `FlatList` whose items are rows, not tiles. `numColumns`
 * would force equal heights, and two lists side by side would scroll
 * independently; making a row the unit of virtualization gives one scroll
 * container and a real stagger. `alignItems: flex-start` is what keeps a short
 * tile from stretching to match a tall one beside it.
 *
 * Column widths come from a measured tile width rather than from `flex`, so the
 * aspect ratios stay exact at any screen width.
 */
export function PhotoGrid({
  posts,
  reactions,
  activeTag,
  onTagPress,
  onOpen,
  onClearFilter,
  page,
  pageCount,
  onPageChange,
  libraryIsEmpty,
  remaining,
  total,
  state,
  error,
  onRetry,
  onRefresh,
  onSeeMatches,
  likedCount,
}: Props) {
  const { width } = useWindowDimensions();
  const listRef = useRef<FlatListType<Post>>(null);

  /**
   * Back to the top on a page change.
   *
   * Without this you press "next page" at the bottom of page one and land on
   * page two scrolled to wherever you happened to be, which on a grid means
   * somewhere in the middle of photos you have not looked at yet.
   */
  useEffect(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [page, activeTag]);

  const columns = columnCountFor(width);
  const tileWidth = Math.floor((width - GUTTER * 2 - GAP * (columns - 1)) / columns);

  // The weighting is the bare aspect ratio, not a pixel height: every tile is the
  // same width, so the width cancels out of the comparison and `tileWidth` does
  // not belong in the dependency list.
  const ordered = useMemo(() => toMasonryOrder(posts, columns, tileAspectRatio), [posts, columns]);

  return (
    <FlatList<Post>
      ref={listRef}
      testID="photo-grid"
      data={ordered}
      keyExtractor={(post) => post.id}
      numColumns={columns}
      // This is the masonry. `numColumns` lays items out in visual rows and gives
      // each row `alignItems: stretch`, which would pull every tile to the height
      // of the tallest beside it and turn this back into a plain grid. `flex-start`
      // is what lets a short tile stay short.
      columnWrapperStyle={styles.row}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      refreshing={state === 'refreshing'}
      onRefresh={onRefresh}
      ListHeaderComponent={
        <View style={styles.header}>
          {error ? <ErrorBanner message={error} onRetry={onRetry} /> : null}
          {activeTag ? (
            <FilterLine tag={activeTag} onClear={onClearFilter} />
          ) : null}
        </View>
      }
      ListEmptyComponent={
        <EmptyStateFor
          libraryIsEmpty={libraryIsEmpty}
          likedCount={likedCount}
          onSeeMatches={onSeeMatches}
        />
      }
      ListFooterComponent={
        <PageFooter
          page={page}
          pageCount={pageCount}
          onPageChange={onPageChange}
          remaining={remaining}
          total={total}
        />
      }
      renderItem={({ item: post }) => (
        <PhotoTile
          post={post}
          width={tileWidth}
          reaction={reactions[post.id]}
          activeTag={activeTag}
          onPress={() => onOpen(post.id)}
          onTagPress={onTagPress}
          testID={`photo-tile-${post.id}`}
        />
      )}
    />
  );
}

/**
 * The only way a grid is empty now.
 *
 * There used to be a third: a category you had answered to death. Answered photos
 * stay in the grid and filters are built from the tags on visible tiles, so a
 * filter can never match nothing — that branch is unreachable rather than merely
 * rare, and is gone rather than left as dead code.
 */
function EmptyStateFor({
  libraryIsEmpty,
  likedCount,
  onSeeMatches,
}: {
  libraryIsEmpty: boolean;
  likedCount: number;
  onSeeMatches: () => void;
}) {
  if (libraryIsEmpty) {
    return (
      <EmptyState
        icon="🖼️"
        title="No photos yet"
        message="The photo library is empty. Import some in Settings, under Admin: photo library."
      />
    );
  }

  return (
    <EmptyState
      icon="✅"
      title="You have seen them all"
      message={
        likedCount > 0
          ? `Your ${likedCount} ${likedCount === 1 ? 'answer has' : 'answers have'} already moved some people's place in your deck.`
          : 'Nothing left to react to. More photos get added over time.'
      }
      actionLabel="See who we picked for you"
      onAction={onSeeMatches}
    />
  );
}

/**
 * Previous / page count / next, plus a line for what is left.
 *
 * "Page 2 of 3" rather than a scrollbar is the only clue how much library is
 * behind you, and the answer keeps its place across pages rather than moving up
 * to where the work is.
 */
function PageFooter({
  page,
  pageCount,
  onPageChange,
  remaining,
  total,
}: {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  remaining: number;
  total: number;
}) {
  const onlyPage = pageCount <= 1;

  return (
    <View style={styles.footer} testID="photo-grid-footer">
      {remaining === 0 && total > 0 ? (
        <Text variant="bodySmall" style={styles.caughtUp} testID="photo-grid-caught-up">
          All {total} answered — tap any photo to review or change your answer.
        </Text>
      ) : null}

      {onlyPage ? (
        <Text variant="bodySmall" style={styles.pageNote} testID="photo-grid-page-note">
          {remaining} of {total} still to answer
        </Text>
      ) : (
        <View style={styles.pageRow}>
          <Pressable
            onPress={() => onPageChange(page - 1)}
            disabled={page === 0}
            accessibilityRole="button"
            accessibilityLabel="Previous page of photos"
            accessibilityState={{ disabled: page === 0 }}
            style={[styles.pageButton, page === 0 && styles.pageButtonOff]}
            testID="photo-page-previous"
          >
            <Text variant="labelLarge" style={styles.pageButtonText}>
              ‹ Prev
            </Text>
          </Pressable>

          <Text variant="labelSmall" style={styles.pageLabel} testID="photo-page-label">
            PAGE {page + 1} OF {pageCount}
          </Text>

          <Pressable
            onPress={() => onPageChange(page + 1)}
            disabled={page >= pageCount - 1}
            accessibilityRole="button"
            accessibilityLabel="Next page of photos"
            accessibilityState={{ disabled: page >= pageCount - 1 }}
            style={[styles.pageButton, page >= pageCount - 1 && styles.pageButtonOff]}
            testID="photo-page-next"
          >
            <Text variant="labelLarge" style={styles.pageButtonText}>
              Next ›
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

/**
 * "Showing dog · 14 left ✕", shown only while a filter is on.
 *
 * Not a chip row. There is no row of categories by design — the tag pill on each
 * tile is the affordance — so without this line a filtered grid is
 * indistinguishable from a small library, which is the same "filter that emptied
 * your deck with no explanation" problem the deck's empty state already had to
 * solve.
 */
function FilterLine({ tag, onClear }: { tag: string; onClear: () => void }) {
  return (
    <View style={styles.filter}>
      <Text variant="bodySmall" style={styles.filterText} numberOfLines={1}>
        Showing {tagLabel(tag)} only
      </Text>
      <Pressable
        onPress={onClear}
        accessibilityRole="button"
        accessibilityLabel={`Stop filtering by ${tagLabel(tag)}`}
        hitSlop={8}
        style={styles.filterClear}
        testID="feed-clear-filter"
      >
        <Text variant="labelSmall" style={styles.filterClearText}>
          SHOW ALL ✕
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: GUTTER,
    paddingBottom: SPACING.xxl,
  },
  header: {
    gap: SPACING.sm,
    paddingBottom: SPACING.sm,
  },
  row: {
    gap: GAP,
    marginBottom: GAP,
    // See the `columnWrapperStyle` comment above: this is what makes it masonry
    // rather than a grid of equal-height cells.
    alignItems: 'flex-start',
  },
  footer: {
    alignItems: 'center',
    gap: SPACING.md,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.md,
  },
  caughtUp: {
    color: COLORS.success,
    fontWeight: '700',
    textAlign: 'center',
  },
  pageNote: {
    color: COLORS.textMuted,
  },
  pageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    alignSelf: 'stretch',
    gap: SPACING.md,
  },
  pageButton: {
    borderRadius: BORDER_RADIUS.full,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    backgroundColor: COLORS.background,
  },
  pageButtonOff: {
    // Present but inert, so the footer does not change width as you page through
    // and the page label stays put instead of sliding sideways.
    opacity: 0.35,
  },
  pageButtonText: {
    color: COLORS.text,
    fontWeight: '700',
  },
  pageLabel: {
    color: COLORS.textSecondary,
    letterSpacing: 0.8,
    fontWeight: '700',
  },
  filter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.sm,
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.full,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingLeft: SPACING.md,
    paddingRight: SPACING.sm,
    paddingVertical: SPACING.xs,
  },
  filterText: {
    color: COLORS.text,
    flexShrink: 1,
  },
  filterClear: {
    paddingVertical: 2,
    paddingHorizontal: SPACING.xs,
  },
  filterClearText: {
    color: COLORS.primary,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
});