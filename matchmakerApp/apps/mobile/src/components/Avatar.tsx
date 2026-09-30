import { StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { ProfileImage, type ProfileImageUser } from './ProfileImage';
import { BORDER_RADIUS, COLORS } from '@/constants';

interface Props {
  user: ProfileImageUser;
  url?: string | null;
  size?: number;
  verified?: boolean;
  style?: ViewStyle;
}

/** Circular profile image, or a generated initials avatar when there is none. */
export function Avatar({ user, url, size = 48, verified, style }: Props) {
  return (
    <View
      style={[
        styles.container,
        { width: size, height: size, borderRadius: size / 2, overflow: 'hidden' },
        style,
      ]}
    >
      <ProfileImage user={user} url={url} initialsScale={0.42} />

      {verified ? (
        <View style={styles.badge}>
          <Text style={styles.badgeGlyph}>✓</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: COLORS.surfaceVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: COLORS.secondary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: COLORS.background,
  },
  badgeGlyph: {
    color: COLORS.background,
    fontSize: 10,
    fontWeight: '900',
  },
});

export const avatarBorderRadius = BORDER_RADIUS.full;
