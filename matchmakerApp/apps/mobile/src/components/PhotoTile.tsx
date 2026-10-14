import { memo, useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import type { Post, PostReactionAction } from '@match-makers/shared';

import { BORDER_RADIUS, COLORS, FONT_SIZES, SPACING } from '@/constants';
import { tagColor, tagGlyph, tagLabel } from '@/utils/interests';
import { tileAspectRatio } from '@/utils/masonry';

interface Props {
  post: Post;
  /** Width of one tile, so the aspect ratio can set its height. */
  width: number;
  /**
   * This person's answer to this photo, if any.
   *
   * Display only. Like and unlike happen in the viewer, where the photo is big
   * enough to judge and its tags are legible — liking straight off a thumbnail
   * would mean answering pictures you never looked at.
   */
  reaction?: PostReactionAction;
  /** The tag currently filtering the grid, so the matching pills look active. */
  activeTag?: string | null;
  onPress: () => void;
  onTagPress: (tag: string) => void;
  testID?: string;
}

/**
 * One photo in the grid.
 *
 * Two press targets, and they mean different things. The tile body opens the
 * photo; the tag pill filters the grid to that category. Merging them would mean
 * a tap on a tag opened a photo, which is how you end up never filtering.
 *
 * The pill is the only way categories are browsable. There is no chip row, so a
 * tile showing `dog` is the affordance that says "there are more of these" —
 * without it the grid is just pictures with a caption.
 *
 * Answered photos stay in the grid so you can come back and change your mind, so
 * the state has to be readable at a glance rather than inferred from an absence.
 * Liked gets a filled heart, disliked is dimmed with a muted cross.
 *
 * No exit animation. Answering a tile removes it from the data, which makes the
 * columns re-deal immediately, and a fade would be animating a tile out of a slot
 * that is no longer where it was going. The reflow is the thing worth watching.
 */
export const PhotoTile = memo(function PhotoTile({
  post,
  width,
  reaction,
  activeTag = null,
  onPress,
  onTagPress,
  testID,
}: Props) {
  const [failed, setFailed] = useState(false);
  const height = Math.round(width * tileAspectRatio(post));

  // The grid copy, falling back to the full image. Ten tiles at grid size decode
  // roughly a quarter of the memory that ten full-size ones do, and every post
  // written before the importer produced two copies has no thumb at all, so the
  // fallback is the normal path for old data rather than an edge case.
  const uri = post.thumbUri || post.imageUri;

  // A post that arrives after a previous one failed should get a fresh attempt
  // rather than inherit its failure, or the rest of the grid renders as tiles.
  // Keyed on both, because a thumb can appear after a fallback already gave up.
  useEffect(() => {
    setFailed(false);
  }, [uri]);

  const primary = post.tags[0];

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open the photo tagged ${post.tags.map(tagLabel).join(', ')}${
        reaction ? `, ${reaction === 'like' ? 'liked' : 'passed'}` : ''
      }`}
      style={[styles.tile, { width, height }, reaction === 'dislike' && styles.passed]}
      testID={testID}
    >
      {uri && !failed ? (
        <Image
          source={{ uri }}
          style={styles.media}
          resizeMode="cover"
          onError={() => setFailed(true)}
          testID={testID ? `${testID}-image` : undefined}
        />
      ) : (
        <View
          style={[styles.tileFill, { backgroundColor: primary ? tagColor(primary) : COLORS.surfaceVariant }]}
          testID={testID ? `${testID}-tile` : undefined}
        >
          {/* Stands in for a photo the library does not have. Still the tag,
              drawn, so the placeholder says what it is rather than only that
              something is missing. */}
          <Text style={styles.glyph} allowFontScaling={false}>
            {primary ? tagGlyph(primary) : '📷'}
          </Text>
        </View>
      )}

      {/* Reads as "you said no to this" without shouting, and leaves the heart
          free to mean the opposite. Dimming rather than hiding is the point of
          keeping answered photos on screen at all. */}
      {reaction === 'dislike' ? (
        <View style={styles.passedBadge} pointerEvents="none">
          <Text style={styles.passedGlyph} allowFontScaling={false}>
            ✕
          </Text>
        </View>
      ) : null}

      {reaction === 'like' ? (
        <View style={styles.likedBadge} pointerEvents="none" testID={testID ? `${testID}-liked` : undefined}>
          <Text style={styles.likedGlyph} allowFontScaling={false}>
            ♥
          </Text>
        </View>
      ) : null}

      {/*
        A scrim under the pill rather than a gradient. A gradient on every tile
        is a lot of ink for a caption one word long, and at this size a flat
        bottom fade is enough to keep white text legible over an arbitrary photo.
      */}
      <View style={styles.caption} pointerEvents="box-none">
        <Pressable
          onPress={() => onTagPress(primary ?? post.tags[0] ?? '')}
          disabled={!primary}
          accessibilityRole="button"
          accessibilityLabel={
            primary
              ? `Show only ${tagLabel(primary)} photos`
              : 'This photo has no tag to filter by'
          }
          accessibilityState={{ selected: primary === activeTag }}
          hitSlop={6}
          style={[
            styles.pill,
            { backgroundColor: tagColor(primary ?? '') },
            primary === activeTag && styles.pillActive,
          ]}
          testID={testID ? `${testID}-tag` : undefined}
        >
          <Text style={styles.pillText} numberOfLines={1}>
            {primary ? tagLabel(primary) : 'Untitled'}
          </Text>
        </Pressable>
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  tile: {
    borderRadius: BORDER_RADIUS.md,
    overflow: 'hidden',
    backgroundColor: COLORS.surfaceVariant,
  },
  media: {
    width: '100%',
    height: '100%',
  },
  passed: {
    opacity: 0.45,
  },
  passedBadge: {
    position: 'absolute',
    top: SPACING.xs,
    left: SPACING.xs,
    backgroundColor: COLORS.overlay,
    borderRadius: BORDER_RADIUS.full,
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  passedGlyph: {
    color: COLORS.background,
    fontSize: FONT_SIZES.sm,
    fontWeight: '700',
  },
  likedBadge: {
    position: 'absolute',
    top: SPACING.xs,
    left: SPACING.xs,
    backgroundColor: COLORS.primary,
    borderRadius: BORDER_RADIUS.full,
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  likedGlyph: {
    color: COLORS.background,
    fontSize: FONT_SIZES.sm,
    fontWeight: '700',
  },
  tileFill: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyph: {
    fontSize: 34,
  },
  caption: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: SPACING.xs,
    justifyContent: 'flex-end',
  },
  pill: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    borderRadius: BORDER_RADIUS.full,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    // Opaque enough to carry white text over an arbitrary photo without a scrim
    // behind every caption in the grid.
    opacity: 0.92,
  },
  pillActive: {
    borderWidth: 2,
    borderColor: COLORS.background,
    opacity: 1,
  },
  pillText: {
    color: COLORS.background,
    fontSize: FONT_SIZES.xs,
    fontWeight: '700',
  },
});
