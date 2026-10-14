import { memo, useCallback, useRef } from 'react';
import {
  Animated,
  PanResponder,
  StyleSheet,
  Text,
  View,
  type PanResponderGestureState,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { IconButton, Surface, Chip } from 'react-native-paper';
import { ProfileImage } from './ProfileImage';
import type { User } from '@match-makers/shared';
import { BORDER_RADIUS, COLORS, FONT_SIZES, SPACING } from '@/constants';
import { ageFromDateOfBirth } from '@/utils/mockData';
import { compatibilityLabel, scoreCompatibility, type CompatibilityBreakdown } from '@/utils/matching';
import { distanceBetween } from '@/utils/eligibility';
import { formatDistance } from '@/utils/distance';

const SWIPE_THRESHOLD = 110;
const ROTATION_RANGE = 12;

interface Props {
  user: User;
  viewer: User;
  onLike: () => void;
  onPass: () => void;
  onSuperLike: () => void;
  onOpenDetail?: () => void;
  enabled?: boolean;
  /**
   * The score the deck was ordered by. Supplied by the feed, because only the
   * feed can see the photo reactions that make up the taste half of the score.
   *
   * Falls back to scoring the pair directly when omitted, which is correct but
   * less complete: it drops the taste bonus. That fallback exists for rendering
   * a card in isolation, and it is why the product path passes this explicitly.
   */
  compatibility?: CompatibilityBreakdown;
}

/**
 * The one line of context under the name: age, where they are, what they want.
 *
 * The distance is shown because it is now computed rather than guessed, and
 * "12 km away" tells you something a city name does not: whether the date you
 * are being offered is a drive or a flight. Omitted rather than approximated
 * when either side has no coordinates, so the card never implies a precision
 * the app does not have.
 */
function describe(user: User, viewer: User): string {
  const age = ageFromDateOfBirth(user.dateOfBirth);
  const goal = user.relationshipGoal.replace(/_/g, ' ');
  const place = user.location.city || user.location.country || 'Nearby';
  const away = distanceBetween(viewer, user);

  return [age, away === null ? place : `${place} · ${formatDistance(away)} away`, goal].join(' · ');
}

export const SwipeCard = memo(function SwipeCard({
  user,
  viewer,
  onLike,
  onPass,
  onSuperLike,
  onOpenDetail,
  enabled = true,
  compatibility: scored,
}: Props) {
  const position = useRef(new Animated.ValueXY()).current;
  const compatibility = scored ?? scoreCompatibility(viewer, user);

  const resetPosition = useCallback(() => {
    Animated.spring(position, {
      toValue: { x: 0, y: 0 },
      useNativeDriver: false,
    }).start();
  }, [position]);

  const flyOut = useCallback(
    (direction: 'left' | 'right') => {
      Animated.timing(position, {
        toValue: { x: direction === 'right' ? 700 : -700, y: 40 },
        duration: 220,
        useNativeDriver: false,
      }).start(() => resetPosition());
    },
    [position, resetPosition]
  );

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_event, gesture) =>
        Math.abs(gesture.dx) > 6 || Math.abs(gesture.dy) > 6,
      onPanResponderMove: (_event, gesture: PanResponderGestureState) => {
        if (!enabled) return;
        position.setValue({ x: gesture.dx, y: gesture.dy * 0.4 });
      },
      onPanResponderRelease: (_event, gesture) => {
        if (!enabled) return;
        if (gesture.dx > SWIPE_THRESHOLD) {
          flyOut('right');
          onLike();
        } else if (gesture.dx < -SWIPE_THRESHOLD) {
          flyOut('left');
          onPass();
        } else if (gesture.dy < -140 && Math.abs(gesture.dx) < SWIPE_THRESHOLD) {
          flyOut('right');
          onSuperLike();
        } else {
          resetPosition();
        }
      },
      onPanResponderTerminate: resetPosition,
    })
  ).current;

  const rotate = position.x.interpolate({
    inputRange: [-300, 0, 300],
    outputRange: [`-${ROTATION_RANGE}deg`, '0deg', `${ROTATION_RANGE}deg`],
    extrapolate: 'clamp',
  });

  const likeOpacity = position.x.interpolate({
    inputRange: [0, SWIPE_THRESHOLD],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });

  const passOpacity = position.x.interpolate({
    inputRange: [-SWIPE_THRESHOLD, 0],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

  const superLikeOpacity = position.y.interpolate({
    inputRange: [-140, -40],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

  return (
    <Animated.View
      {...panResponder.panHandlers}
      style={[styles.card, { transform: [...position.getTranslateTransform(), { rotate }] }]}
    >
      <Surface style={styles.surface} elevation={3}>
        <ProfileImage
          user={user}
          url={user.photos.find((photo) => photo.isPrimary)?.url ?? user.photos[0]?.url}
          initialsScale={0.32}
        />

        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.15)', 'rgba(0,0,0,0.82)']}
          locations={[0.35, 0.6, 1]}
          style={styles.gradient}
        >
          <View style={styles.footer}>
            <View style={styles.nameRow}>
              <Text style={styles.name} numberOfLines={1}>
                {user.name}
              </Text>
              {user.isVerified ? (
                <IconButton
                  icon="check-decagram"
                  size={18}
                  iconColor={COLORS.secondary}
                  accessibilityLabel="Verified profile"
                  style={styles.verifiedIcon}
                />
              ) : null}
            </View>

            <Text style={styles.meta} numberOfLines={1}>
              {describe(user, viewer)}
            </Text>

            {user.bio ? (
              <Text style={styles.bio} numberOfLines={2}>
                {user.bio}
              </Text>
            ) : null}

            {/* What the two of you actually share, in words. The whole reason to
                show a number is so this sentence can sit under it. */}
            {compatibility.reason ? (
              <Text style={styles.promptQuestion} numberOfLines={2} testID="swipe-card-reason">
                {compatibility.reason}
              </Text>
            ) : null}

            <View style={styles.chipRow}>
              <Chip compact style={styles.compatibilityChip} textStyle={styles.compatibilityText}>
                {`${compatibilityLabel(compatibility.score)} · ${compatibility.score}%`}
              </Chip>
              {compatibility.sharedGoals ? (
                <Chip compact style={styles.goalChip} textStyle={styles.compatibilityText}>
                  Same goal
                </Chip>
              ) : null}
              {compatibility.tasteAffinity > 0 ? (
                <Chip
                  compact
                  style={styles.tasteChip}
                  textStyle={styles.tasteText}
                  testID="swipe-card-taste-chip"
                >
                  {compatibility.tasteAffinity >= 0.5
                    ? `${compatibility.coLikedPosts} photos in common`
                    : `${compatibility.sharedTags.length} shared ${
                        compatibility.sharedTags.length === 1 ? 'interest' : 'interests'
                      }`}
                </Chip>
              ) : null}
            </View>

          </View>
        </LinearGradient>

        {onOpenDetail ? (
          <IconButton
            icon="information-outline"
            size={20}
            iconColor={COLORS.background}
            style={styles.infoButton}
            onPress={onOpenDetail}
            accessibilityLabel={`More about ${user.name}`}
          />
        ) : null}

        <Animated.View
          pointerEvents="none"
          style={[styles.stamp, styles.likeStamp, { opacity: likeOpacity }]}
        >
          <Text style={[styles.stampText, { color: COLORS.success }]}>LIKE</Text>
        </Animated.View>

        <Animated.View
          pointerEvents="none"
          style={[styles.stamp, styles.passStamp, { opacity: passOpacity }]}
        >
          <Text style={[styles.stampText, { color: COLORS.error }]}>PASS</Text>
        </Animated.View>

        <Animated.View
          pointerEvents="none"
          style={[styles.stamp, styles.superLikeStamp, { opacity: superLikeOpacity }]}
        >
          <Text style={[styles.stampText, { color: COLORS.secondary }]}>SUPER</Text>
        </Animated.View>
      </Surface>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  card: {
    ...StyleSheet.absoluteFillObject,
  },
  surface: {
    flex: 1,
    borderRadius: BORDER_RADIUS.xl,
    overflow: 'hidden',
    backgroundColor: COLORS.surfaceVariant,
  },
  gradient: {
    flex: 1,
    justifyContent: 'flex-end',
    padding: SPACING.lg,
  },
  footer: {
    gap: SPACING.xs,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  name: {
    flexShrink: 1,
    fontSize: FONT_SIZES.xxxl,
    fontWeight: '700',
    color: COLORS.background,
  },
  verifiedIcon: {
    margin: 0,
    marginLeft: -SPACING.sm,
  },
  meta: {
    fontSize: FONT_SIZES.sm,
    color: 'rgba(255,255,255,0.85)',
  },
  promptQuestion: { color: COLORS.background, fontWeight: '600' },
  bio: {
    fontSize: FONT_SIZES.sm,
    color: 'rgba(255,255,255,0.92)',
    lineHeight: 20,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.xs,
    marginTop: SPACING.xs,
  },
  compatibilityChip: {
    backgroundColor: 'rgba(78,205,196,0.25)',
  },
  goalChip: {
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  /**
   * Distinct from the other chips because it is the only one backed by
   * something the viewer did rather than something they filled in, and it is
   * the signal the photo feed exists to produce.
   */
  tasteChip: {
    backgroundColor: 'rgba(255,107,107,0.45)',
  },
  tasteText: {
    color: COLORS.background,
    fontSize: FONT_SIZES.xs,
    fontWeight: '700',
  },
  reason: {
    color: 'rgba(255,255,255,0.86)',
    fontSize: FONT_SIZES.xs,
    marginTop: SPACING.xs,
  },
  compatibilityText: {
    color: COLORS.background,
    fontSize: FONT_SIZES.xs,
  },
  infoButton: {
    position: 'absolute',
    top: SPACING.sm,
    right: SPACING.sm,
    margin: 0,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  stamp: {
    position: 'absolute',
    top: SPACING.xxl,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderWidth: 3,
    borderRadius: BORDER_RADIUS.sm,
  },
  likeStamp: {
    left: SPACING.lg,
    borderColor: COLORS.success,
    transform: [{ rotate: '-14deg' }],
  },
  passStamp: {
    right: SPACING.lg,
    borderColor: COLORS.error,
    transform: [{ rotate: '14deg' }],
  },
  superLikeStamp: {
    alignSelf: 'center',
    left: 0,
    right: 0,
    borderColor: COLORS.secondary,
    transform: [{ rotate: '0deg' }],
  },
  stampText: {
    fontSize: FONT_SIZES.xl,
    fontWeight: '800',
    letterSpacing: 2,
  },
});
