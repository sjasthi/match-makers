import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Text, Divider } from 'react-native-paper';
import type { RouteProp } from '@react-navigation/native';
import { useRoute } from '@react-navigation/native';
import type { User } from '@match-makers/shared';
import { ScreenContainer, EmptyState, AppIcon, ProfileImage } from '@/components';
import { mockDb } from '@/services/mock/database';
import { getAuthAdapter } from '@/services/auth';
import { ageFromDateOfBirth } from '@/utils/mockData';
import { COLORS, FONT_SIZES, SPACING } from '@/constants';
import type { ProfileStackParamList } from '@/navigation/types';

type DetailRoute = RouteProp<ProfileStackParamList, 'ProfileDetail'>;

export function ProfileDetailScreen() {
  const route = useRoute<DetailRoute>();
  const { userId, user: passedUser } = route.params;
  const [user, setUser] = useState<User | null>(passedUser ?? null);

  useEffect(() => {
    // The feed passes the full record through navigation params. Only the mock
    // mode needs a lookup, because there is no /profiles/:id endpoint to hit.
    if (passedUser || getAuthAdapter().mode !== 'mock') return;

    let active = true;
    void mockDb.findUserById(userId).then((found) => {
      if (!active || !found) return;
      const { password: _password, ...rest } = found;
      setUser(rest);
    });

    return () => {
      active = false;
    };
  }, [userId, passedUser]);

  if (!user) {
    return (
      <ScreenContainer>
        <EmptyState
          icon="🔍"
          title="Profile unavailable"
          message="This profile is no longer active."
        />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer padded={false}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {user.photos.length > 0 ? (
          <View style={styles.photos}>
            {user.photos.map((photo) => (
              <View key={photo.id} style={styles.photo}>
                <ProfileImage user={user} url={photo.url} initialsScale={0.3} />
              </View>
            ))}
          </View>
        ) : (
          <View style={[styles.photo, styles.photoPlaceholder]}>
            <AppIcon name="account" size={48} color={COLORS.textMuted} />
          </View>
        )}

        <View style={styles.body}>
          <View style={styles.nameRow}>
            <Text variant="headlineSmall" style={styles.name}>
              {user.name}
            </Text>
            {user.isVerified ? (
              <AppIcon name="check-decagram" size={20} color={COLORS.secondary} />
            ) : null}
          </View>

          <Text variant="bodyMedium" style={styles.meta}>
            {ageFromDateOfBirth(user.dateOfBirth)}
            {user.location.city ? ` · ${user.location.city}` : ''}
            {user.location.country ? `, ${user.location.country}` : ''}
          </Text>

          <Divider style={styles.divider} />

          {user.bio ? (
            <View style={styles.section}>
              <Text variant="titleSmall" style={styles.sectionTitle}>
                About
              </Text>
              <Text variant="bodyMedium">{user.bio}</Text>
            </View>
          ) : null}

          <View style={styles.section}>
            <Text variant="titleSmall" style={styles.sectionTitle}>
              Looking for
            </Text>
            <Text variant="bodyMedium" style={styles.capitalize}>
              {user.relationshipGoal.replace(/_/g, ' ')}
            </Text>
          </View>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: SPACING.xxl },
  photos: { backgroundColor: COLORS.surfaceVariant },
  photo: { width: '100%', height: 320, backgroundColor: COLORS.surfaceVariant },
  photoPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  body: { padding: SPACING.lg, gap: SPACING.lg },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  name: { fontWeight: '800' },
  meta: { color: COLORS.textSecondary },
  divider: {},
  section: { gap: SPACING.xs },
  sectionTitle: { fontWeight: '700' },
  capitalize: { textTransform: 'capitalize', color: COLORS.textSecondary, fontSize: FONT_SIZES.sm },
});
