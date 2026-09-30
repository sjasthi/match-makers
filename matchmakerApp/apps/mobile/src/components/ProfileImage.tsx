import { useEffect, useMemo, useState } from 'react';
import {
  Image,
  StyleSheet,
  Text,
  View,
  type ImageStyle,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import type { User } from '@match-makers/shared';
import { COLORS } from '@/constants';

/** Deterministic hash so a given user always gets the same colour. */
export function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    // Force a 32-bit int so the value is stable across platforms.
    hash |= 0;
  }
  return Math.abs(hash);
}

/** Background colour for a user's generated avatar, stable across renders. */
export function avatarColor(seed: string): string {
  const hue = hashString(seed) % 360;
  return `hsl(${hue}, 58%, 42%)`;
}

export function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.charAt(0).toUpperCase();
  return `${parts[0]!.charAt(0)}${parts[parts.length - 1]!.charAt(0)}`.toUpperCase();
}

/** Only the fields needed to pick a colour and draw initials. */
export type ProfileImageUser = Pick<User, 'id' | 'name'>;

interface Props {
  user: ProfileImageUser;
  /** Empty or missing means 'draw a generated avatar'. */
  url?: string | null;
  style?: StyleProp<ViewStyle>;
  imageStyle?: StyleProp<ImageStyle>;
  /** Initial size as a fraction of the container. */
  initialsScale?: number;
  resizeMode?: 'cover' | 'contain';
  testID?: string;
}

/**
 * Renders a user's photo, or a generated initials avatar when there is no
 * upload or the image fails to load.
 *
 * This is the only component that decides between the two, so every surface
 * (swipe card, avatar, profile hero, match celebration) degrades identically.
 * Placeholder users are seeded with an empty `url` rather than a remote link,
 * which keeps the app fully offline.
 */
export function ProfileImage({
  user,
  url: photoUrl,
  style,
  imageStyle,
  initialsScale = 0.4,
  resizeMode = 'cover',
  testID,
}: Props) {
  const url = photoUrl ?? '';
  const [failed, setFailed] = useState(false);
  const [boxSize, setBoxSize] = useState(0);

  // A new photo deserves a fresh attempt, rather than inheriting a stale failure.
  useEffect(() => {
    setFailed(false);
  }, [url]);

  const initials = useMemo(() => initialsFor(user.name), [user.name]);

  if (url && !failed) {
    return (
      <Image
        source={{ uri: url }}
        style={[styles.image, imageStyle]}
        resizeMode={resizeMode}
        onError={() => setFailed(true)}
        accessibilityLabel={`${user.name}'s photo`}
        testID={testID}
      />
    );
  }

  return (
    <View
      style={[styles.avatar, { backgroundColor: avatarColor(user.id) }, style]}
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        setBoxSize(Math.min(width, height));
      }}
      testID={testID}
    >
      <Text
        style={[styles.initials, { fontSize: boxSize * initialsScale }]}
        // The colour is fixed and mid-tone, so white text always has contrast.
        allowFontScaling={false}
      >
        {initials}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  image: {
    width: '100%',
    height: '100%',
    backgroundColor: COLORS.surfaceVariant,
  },
  avatar: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: {
    color: COLORS.background,
    fontWeight: '700',
    letterSpacing: 1,
  },
});
