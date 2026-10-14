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
import { distanceBetween } from '@/utils/eligibility';
import { formatDistance } from '@/utils/distance';
import {
  compatibilityLabel,
  scoreCompatibility,
  MATCH_WEIGHTS,
  type TasteSignal,
} from '@/utils/matching';
import { useAuthStore } from '@/stores/authStore';
import { COLORS, FONT_SIZES, SPACING } from '@/constants';
import type { ProfileStackParamList } from '@/navigation/types';

type DetailRoute = RouteProp<ProfileStackParamList, 'ProfileDetail'>;

/**
 * How far away they are, and whether that is inside the limit you set.
 *
 * Also mentions their own limit when it is the tighter of the two. On a mutual
 * filter both sides' numbers decide what you get to see, and a screen that
 * only reports your own invites you to widen a setting that was never the thing
 * binding.
 */
function describeDistanceTo(viewer: User, candidate: User): string {
  const apart = distanceBetween(viewer, candidate);
  if (apart === null) {
    return 'Distance is unknown. One of you has not set a location.';
  }

  const measured = `${formatDistance(apart)} away`;
  const yourLimit =
    viewer.preferences.distanceMode === 'global' ? null : viewer.preferences.maxDistance;
  const theirLimit =
    candidate.preferences.distanceMode === 'global' ? null : candidate.preferences.maxDistance;

  if (yourLimit === null || theirLimit === null) return measured;
  const binding = Math.min(yourLimit, theirLimit);
  const whose = yourLimit <= theirLimit ? 'your' : 'their';
  return `${measured} — inside ${whose} ${binding} km limit`;
}

export function ProfileDetailScreen() {
  const route = useRoute<DetailRoute>();
  const { userId, user: passedUser, taste } = route.params;
  const [user, setUser] = useState<User | null>(passedUser ?? null);
  const viewer = useAuthStore((store) => store.user);

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

          {/* No questionnaire any more, so nothing gates this — any other profile
              can be scored, and the breakdown says plainly when the taste signal
              is still empty rather than hiding the screen. */}
          {viewer && viewer.id !== user.id ? (
            <MatchBreakdown viewer={viewer} candidate={user} taste={taste} />
          ) : null}
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

/**
 * The percentage, broken into the parts that made it.
 *
 * A single number with no explanation is the thing users distrust most on a
 * dating app, so every signal is named and weighted out loud, including the
 * ones that scored nothing.
 *
 * `taste` arrives on the route from the deck, which is the only place that had
 * the reactions table loaded. Without it the photo feed contributes nothing here
 * and the row is simply absent, rather than claiming a score it did not read.
 */
function MatchBreakdown({
  viewer,
  candidate,
  taste,
}: {
  viewer: User;
  candidate: User;
  taste?: TasteSignal;
}) {
  const result = scoreCompatibility(viewer, candidate, taste);

  const rows: Array<{ label: string; value: string; earned: number; of: number }> = [
    {
      label: 'Photos you both like',
      value: result.reason ?? 'Nothing in common yet',
      earned: result.tasteAffinity * MATCH_WEIGHTS.sharedTaste,
      of: MATCH_WEIGHTS.sharedTaste,
    },
    {
      label: 'Relationship goal',
      value: result.sharedGoals ? 'Same' : 'Different',
      earned: result.sharedGoals ? MATCH_WEIGHTS.relationshipGoal : 0,
      of: MATCH_WEIGHTS.relationshipGoal,
    },
    {
      label: 'Orientation',
      value: result.mutualOrientation ? 'Compatible' : 'Not compatible',
      earned: result.mutualOrientation ? MATCH_WEIGHTS.mutualOrientation : 0,
      of: MATCH_WEIGHTS.mutualOrientation,
    },
  ];

  return (
    <View style={styles.section}>
      <Text variant="titleSmall" style={styles.sectionTitle}>
        Your match
      </Text>
      <Text variant="headlineMedium" style={styles.score}>
        {`${result.score}%`}
      </Text>
      <Text variant="bodySmall" style={styles.scoreCaption}>
        {compatibilityLabel(result.score)}
      </Text>

      {rows.map((row) => (
        <View key={row.label} style={styles.breakdownRow}>
          <View style={styles.breakdownText}>
            <Text variant="bodyMedium">{row.label}</Text>
            <Text variant="bodySmall" style={styles.breakdownValue} numberOfLines={2}>
              {row.value}
            </Text>
          </View>
          <Text variant="bodyMedium" style={styles.breakdownPoints}>
            {Math.round(row.earned)}/{row.of}
          </Text>
        </View>
      ))}

      {/* Distance is deliberately not one of the rows above. Those are weighted
          scoring signals and this is not one: it either passed your limit or
          you would never have been able to see this profile. A "0/0" row next
          to a number is either invisible or misleading, so the distance gets
          its own line and says what it actually means. */}
      <View style={styles.breakdownRow}>
        <View style={styles.breakdownText}>
          <Text variant="bodyMedium">Distance</Text>
          <Text variant="bodySmall" style={styles.breakdownValue} numberOfLines={2}>
            {describeDistanceTo(viewer, candidate)}
          </Text>
        </View>
      </View>

    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: SPACING.xxl },
  score: { fontWeight: '800', color: COLORS.primary },
  scoreCaption: { color: COLORS.textSecondary, marginBottom: SPACING.sm },
  breakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: SPACING.md,
    paddingVertical: SPACING.xs,
  },
  breakdownText: { flex: 1, gap: 2 },
  breakdownValue: { color: COLORS.textSecondary },
  breakdownPoints: { fontWeight: '700', color: COLORS.textSecondary },
  promptList: { marginTop: SPACING.md, gap: SPACING.sm },
  promptRow: { gap: 2 },
  promptQuestion: { fontWeight: '600' },
  promptChoice: { color: COLORS.textSecondary },
  promptNote: { color: COLORS.textSecondary, fontStyle: 'italic' },
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
