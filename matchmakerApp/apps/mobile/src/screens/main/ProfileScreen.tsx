import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { Text, Divider } from 'react-native-paper';
import {
  ScreenContainer,
  AppIcon,
  ProfileImage,
  describeDistance,
  type IconName,
} from '@/components';
import { useAuthActions, useCurrentUser } from '@/hooks';
import { fetchVerificationStatus, getMissingProfileSections } from '@/services/profile';
import { ageFromDateOfBirth } from '@/utils/mockData';
import { BORDER_RADIUS, COLORS, FONT_SIZES, SPACING } from '@/constants';
import type { RootStackParamList, MainTabParamList } from '@/navigation/types';

const HERO_HEIGHT = 320;

export function ProfileScreen() {
  // This screen is registered twice: as the Profile tab and as the Profile
  // stack's home. `useNavigation()` therefore hands back whichever navigator
  // mounted it, so it is the tab navigator when reached from the tab bar. That
  // object cannot service `navigate('Profile', ...)`: the tab's own Profile
  // route is `undefined`, so the action would just re-select the tab and drop
  // the nested screen. Resolve the root stack explicitly instead.
  const tabNavigation = useNavigation<BottomTabNavigationProp<MainTabParamList>>();
  const navigation = tabNavigation.getParent<NativeStackNavigationProp<RootStackParamList>>();
  const user = useCurrentUser();
  const { logout } = useAuthActions();
  const { width } = useWindowDimensions();
  const [verification, setVerification] = useState<string | null>(null);

  const loadVerification = useCallback(() => {
    let active = true;
    fetchVerificationStatus()
      .then((status) => {
        if (active) setVerification(status.status);
      })
      .catch(() => {
        if (active) setVerification(null);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => loadVerification(), [loadVerification, user?.id]);

  // Reflect profile edits made on other screens as soon as they return.
  useFocusEffect(
    useCallback(() => {
      void loadVerification();
    }, [loadVerification])
  );

  if (!user) {
    return <ScreenContainer />;
  }

  const missing = getMissingProfileSections(user);
  const photos = user.photos;

  return (
    <ScreenContainer padded={false}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          {photos.length > 0 ? (
            <ScrollView
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              style={styles.photoStrip}
            >
              {photos.map((photo) => (
                <View key={photo.id} style={[styles.heroPhoto, { width }]}>
                  <ProfileImage user={user} url={photo.url} initialsScale={0.3} />
                </View>
              ))}
            </ScrollView>
          ) : (
            <View style={[styles.heroPhoto, styles.heroPlaceholder]}>
              <AppIcon name="account-plus-outline" size={40} color={COLORS.textMuted} />
            </View>
          )}
        </View>

        <View style={styles.body}>
          {missing.length > 0 ? (
            <Pressable
              onPress={() => navigation?.navigate('Onboarding', { screen: 'Basics' })}
              accessibilityRole="button"
            >
              <View style={styles.incomplete}>
                <AppIcon name="alert-circle-outline" size={18} color={COLORS.warning} />
                <Text style={styles.incompleteText}>
                  Your profile is missing {missing.join(', ')}. Finish it to appear in the feed.
                </Text>
              </View>
            </Pressable>
          ) : null}

          <View style={styles.identity}>
            <View style={styles.nameRow}>
              <Text variant="headlineSmall" style={styles.name}>
                {user.name}
              </Text>
              {user.isVerified ? (
                <AppIcon name="check-decagram" size={20} color={COLORS.secondary} />
              ) : null}
            </View>
            <Text variant="bodyMedium" style={styles.meta}>
              {ageFromDateOfBirth(user.dateOfBirth)} · {user.location.city || 'Location not set'}
            </Text>
            <Text variant="bodySmall" style={styles.goal}>
              Looking for {user.relationshipGoal.replace(/_/g, ' ')}
            </Text>
          </View>

          {user.bio ? (
            <View style={styles.section}>
              <Text variant="titleSmall" style={styles.sectionTitle}>
                About
              </Text>
              <Text variant="bodyMedium">{user.bio}</Text>
            </View>
          ) : null}

          <View style={styles.preferenceRow}>
            <View style={styles.preferenceCard}>
              <Text variant="labelSmall" style={styles.preferenceLabel}>
                Age range
              </Text>
              <Text variant="titleMedium">
                {user.preferences.ageRange.min}–{user.preferences.ageRange.max}
              </Text>
            </View>
            <View style={styles.preferenceCard}>
              <Text variant="labelSmall" style={styles.preferenceLabel}>
                Distance
              </Text>
              <Text variant="titleMedium">{describeDistance(user.preferences)}</Text>
            </View>
            <View style={styles.preferenceCard}>
              <Text variant="labelSmall" style={styles.preferenceLabel}>
                Verification
              </Text>
              <Text variant="titleMedium" style={styles.capitalize}>
                {verification ?? (user.isVerified ? 'verified' : 'unverified')}
              </Text>
            </View>
          </View>

          <Divider style={styles.divider} />

          <MenuRow
            icon="pencil-outline"
            label="Edit profile"
            onPress={() => navigation?.navigate('Profile', { screen: 'EditProfile' })}
          />
          <MenuRow
            icon="tune-variant"
            label="Discovery preferences"
            onPress={() => navigation?.navigate('Profile', { screen: 'Preferences' })}
          />
          <MenuRow
            icon="clipboard-text-outline"
            label="Match profile"
            onPress={() => navigation?.navigate('Profile', { screen: 'MatchProfile' })}
          />
          <MenuRow
            icon="shield-check-outline"
            label="Verification"
            value={verification ?? undefined}
            onPress={() => navigation?.navigate('Profile', { screen: 'Verification' })}
          />
          <MenuRow
            icon="cog-outline"
            label="Settings"
            onPress={() => navigation?.navigate('Profile', { screen: 'Settings' })}
          />

          <PrimarySignOut onSignOut={logout} />
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

function PrimarySignOut({ onSignOut }: { onSignOut: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <Pressable
      onPress={async () => {
        setBusy(true);
        try {
          await onSignOut();
        } finally {
          setBusy(false);
        }
      }}
      style={styles.signOut}
      accessibilityRole="button"
      disabled={busy}
    >
      <AppIcon name="logout" size={18} color={COLORS.error} />
      <Text style={styles.signOutText}>{busy ? 'Signing out...' : 'Sign out'}</Text>
    </Pressable>
  );
}

function MenuRow({
  icon,
  label,
  value,
  onPress,
}: {
  icon: IconName;
  label: string;
  value?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={styles.menuRow}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <AppIcon name={icon} size={20} color={COLORS.textSecondary} />
      <Text variant="bodyLarge" style={styles.menuLabel}>
        {label}
      </Text>
      {value ? (
        <Text variant="bodySmall" style={styles.menuValue}>
          {value}
        </Text>
      ) : null}
      <AppIcon name="chevron-right" size={20} color={COLORS.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: SPACING.xxl },
  hero: { height: HERO_HEIGHT },
  photoStrip: { flex: 1 },
  heroPhoto: { height: HERO_HEIGHT, backgroundColor: COLORS.surfaceVariant },
  heroPlaceholder: { alignItems: 'center', justifyContent: 'center', width: '100%' },
  body: { padding: SPACING.lg, gap: SPACING.lg },
  incomplete: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    backgroundColor: 'rgba(245,158,11,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.3)',
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
  },
  incompleteText: { flex: 1, color: COLORS.warning, fontSize: FONT_SIZES.sm },
  identity: { gap: SPACING.xs },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  name: { fontWeight: '800' },
  meta: { color: COLORS.textSecondary },
  goal: { color: COLORS.textSecondary, textTransform: 'capitalize' },
  section: { gap: SPACING.xs },
  sectionTitle: { fontWeight: '700' },
  preferenceRow: { flexDirection: 'row', gap: SPACING.md },
  preferenceCard: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    gap: 2,
  },
  preferenceLabel: { color: COLORS.textSecondary },
  capitalize: { textTransform: 'capitalize' },
  divider: { marginVertical: SPACING.xs },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingVertical: SPACING.md,
  },
  menuLabel: { flex: 1 },
  menuValue: { color: COLORS.textSecondary },
  signOut: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    paddingVertical: SPACING.md,
    marginTop: SPACING.md,
  },
  signOutText: { color: COLORS.error, fontWeight: '700' },
});
