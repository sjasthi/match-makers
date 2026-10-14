import { useEffect, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Text } from 'react-native-paper';
import type { Post } from '@match-makers/shared';

import { BORDER_RADIUS, COLORS, FONT_SIZES, SPACING } from '@/constants';
import { postColor, tagColor, tagGlyph, tagLabel } from '@/utils/interests';

interface Props {
  post: Post;
  testID?: string;
}

/**
 * One site-owned photo, full screen.
 *
 * Chrome-free by design: the viewer it lives in supplies the close button and
 * the remaining count. This is the picture and its tags, nothing else.
 *
 * Shows the tags rather than hiding them. The whole feature depends on the
 * person knowing what they are reacting to: a like is only meaningful as taste
 * if they can see that the picture is tagged `pets`, and an untagged photo
 * behind a heart button is a preference nobody gave.
 *
 * There is no author and nothing to tap through to. The feed is an input device,
 * not a social surface, and offering a profile here would invite it to be read
 * as one.
 */
export function PhotoPostCard({ post, testID }: Props) {
  const [failed, setFailed] = useState(false);

  // A post that arrives after a previous one failed should get a fresh attempt
  // rather than inherit its failure, or the rest of the feed renders as tiles.
  useEffect(() => {
    setFailed(false);
  }, [post.imageUri]);

  const primary = post.tags[0];
  const secondary = post.tags.slice(1);

  // The photo's real proportions, when the importer recorded them.
  //
  // This component used to fill whatever box it was given with `resizeMode:
  // "cover"`, which meant the full-screen viewer was not showing the full
  // photo at all: a landscape photograph in a tall card was cropped top and
  // bottom, so "full view" was full *screen* and not full *image*. Sizing the
  // card to the stored ratio fixes that without letterboxing, because the box
  // and the picture agree.
  //
  // The ratio is read from storage rather than measured with `Image.getSize`,
  // which resolves after first paint and would re-flow the card as photos
  // loaded. Posts with no dimensions fall through to filling the box exactly as
  // before, so seeded posts look unchanged.
  const ratio = post.width && post.height ? post.width / post.height : null;

  return (
    <View
      style={[
        styles.card,
        ratio ? [styles.cardSized, { aspectRatio: ratio }] : styles.cardFill,
      ]}
      testID={testID}
    >
      {post.imageUri && !failed ? (
        <Image
          source={{ uri: post.imageUri }}
          style={styles.image}
          // `contain` only when the box is known to match. With the ratio
          // applied the two modes agree, but sub-pixel rounding can still shave
          // a row off the edge, and a cropped full-screen photo is the exact
          // thing this component exists to avoid.
          resizeMode={ratio ? 'contain' : 'cover'}
          onError={() => setFailed(true)}
          accessibilityLabel={`A photo tagged ${post.tags.map(tagLabel).join(', ')}`}
          testID={testID ? `${testID}-image` : undefined}
        />
      ) : (
        <View
          style={[styles.tile, { backgroundColor: primary ? postColor(post.tags) : COLORS.surfaceVariant }]}
          testID={testID ? `${testID}-tile` : undefined}
        >
          {/* The glyph stands in for the picture the prototype does not ship.
              It is the tag, drawn, so the fallback still tells you what the
              photo was about rather than only that it is missing. */}
          <Text style={styles.glyph} allowFontScaling={false}>
            {primary ? tagGlyph(primary) : '📷'}
          </Text>
        </View>
      )}

      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.15)', 'rgba(0,0,0,0.78)']}
        locations={[0, 0.45, 1]}
        style={styles.overlay}
        pointerEvents="none"
      />

      <View style={styles.caption} pointerEvents="none">
        <View style={styles.tagRow}>
          {primary ? (
            <View style={[styles.primaryTag, { backgroundColor: tagColor(primary) }]}>
              <Text style={styles.primaryTagText}>{tagLabel(primary)}</Text>
            </View>
          ) : null}
          {secondary.map((tag) => (
            <View key={tag} style={styles.secondaryTag}>
              <Text style={styles.secondaryTagText}>{tagLabel(tag)}</Text>
            </View>
          ))}
        </View>
        <Text variant="bodySmall" style={styles.hint}>
          Like this if you would see more like it
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: BORDER_RADIUS.xl,
    overflow: 'hidden',
    backgroundColor: COLORS.surfaceVariant,
  },
  // Only when the photo's dimensions are unknown. A card with a known ratio is
  // sized by `aspectRatio` and must not also claim `flex: 1`, or the two fight
  // and the result depends on which one the layout pass happens to honour.
  cardFill: {
    flex: 1,
  },
  // Bounded on both axes so a portrait photo in a wide viewer shrinks instead of
  // overflowing. `aspectRatio` fills whichever axis has room and derives the
  // other, so the picture is never cropped to fit a box it did not choose.
  cardSized: {
    width: '100%',
    maxWidth: '100%',
    maxHeight: '100%',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  tile: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyph: {
    fontSize: 96,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
  },
  caption: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: SPACING.lg,
    gap: SPACING.xs,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
  },
  primaryTag: {
    borderRadius: BORDER_RADIUS.full,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
  },
  primaryTagText: {
    color: COLORS.background,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  secondaryTag: {
    borderRadius: BORDER_RADIUS.full,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    backgroundColor: COLORS.overlay,
  },
  secondaryTagText: {
    color: COLORS.background,
    fontSize: FONT_SIZES.xs,
  },
  hint: {
    color: 'rgba(255,255,255,0.82)',
    fontSize: FONT_SIZES.xs,
  },
});