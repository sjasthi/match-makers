import { useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Text } from 'react-native-paper';
import { ProfileImage } from './ProfileImage';
import type { User } from '@match-makers/shared';
import { BORDER_RADIUS, COLORS, SPACING } from '@/constants';

interface Props {
  user: User;
  viewer: User;
  onPress: () => void;
}

/** Card shown when a swipe produces a match, with the two profiles side by side. */
export function MatchCelebration({ user, viewer, onPress }: Props) {
  const { width } = useWindowDimensions();
  const [visible, setVisible] = useState(true);
  const avatarSize = Math.min(140, width * 0.32);

  if (!visible) return null;

  const viewerPhoto = viewer.photos.find((photo) => photo.isPrimary) ?? viewer.photos[0] ?? null;
  const theirPhoto = user.photos.find((photo) => photo.isPrimary) ?? user.photos[0] ?? null;

  return (
    <View style={styles.backdrop}>
      <View style={styles.panel}>
        <Text variant="headlineMedium" style={styles.title}>
          It is a match!
        </Text>
        <Text variant="bodyMedium" style={styles.subtitle}>
          You and {user.name} liked each other. Say something before the moment passes.
        </Text>

        <View style={styles.avatars}>
          <View style={[styles.avatar, { width: avatarSize, height: avatarSize }]}>
            <ProfileImage user={viewer} url={viewerPhoto?.url} initialsScale={0.4} />
          </View>

          <View style={styles.heart}>
            <Text style={styles.heartGlyph}>♥</Text>
          </View>

          <View style={[styles.avatar, { width: avatarSize, height: avatarSize }]}>
            <ProfileImage user={user} url={theirPhoto?.url} initialsScale={0.4} />
          </View>
        </View>

        <Pressable
          onPress={onPress}
          style={styles.primaryCta}
          accessibilityRole="button"
          accessibilityLabel={`Send a message to ${user.name}`}
        >
          <Text style={styles.primaryCtaText}>Send a message</Text>
        </Pressable>

        <Pressable
          onPress={() => setVisible(false)}
          style={styles.secondaryCta}
          accessibilityRole="button"
        >
          <Text style={styles.secondaryCtaText}>Keep swiping</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: COLORS.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.lg,
  },
  panel: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: COLORS.background,
    borderRadius: BORDER_RADIUS.xl,
    padding: SPACING.xl,
    alignItems: 'center',
    gap: SPACING.md,
  },
  title: {
    color: COLORS.primary,
    fontWeight: '700',
  },
  subtitle: {
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  avatars: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: SPACING.md,
  },
  avatar: {
    width: 120,
    height: 120,
    borderRadius: BORDER_RADIUS.full,
    overflow: 'hidden',
    backgroundColor: COLORS.surfaceVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heart: {
    marginHorizontal: -SPACING.md,
    zIndex: 1,
  },
  heartGlyph: {
    fontSize: 32,
    color: COLORS.primary,
  },
  primaryCta: {
    width: '100%',
    backgroundColor: COLORS.primary,
    borderRadius: BORDER_RADIUS.full,
    paddingVertical: SPACING.md,
    alignItems: 'center',
  },
  primaryCtaText: {
    color: COLORS.background,
    fontWeight: '700',
  },
  secondaryCta: {
    paddingVertical: SPACING.sm,
  },
  secondaryCtaText: {
    color: COLORS.textSecondary,
  },
});
