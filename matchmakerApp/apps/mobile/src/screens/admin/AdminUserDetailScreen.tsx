import { StyleSheet, View } from 'react-native';
import { Divider, Text } from 'react-native-paper';
import { useRoute, type RouteProp } from '@react-navigation/native';
import type { User } from '@match-makers/shared';
import { ScreenContainer, EmptyState, LoadingState, ErrorBanner, ProfileImage } from '@/components';
import { useAsync } from '@/hooks/useAsync';
import { useAuthMode, useCurrentUser } from '@/hooks';
import { getAdminUser } from '@/services/admin';
import { ageFromDateOfBirth } from '@/utils/mockData';
import { hasCoordinates } from '@/utils/distance';
import { choiceLabel, promptQuestion, tagLabel } from '@/prompts';
import { COLORS, SPACING } from '@/constants';
import type { ProfileStackParamList } from '@/navigation/types';

type DetailRoute = RouteProp<ProfileStackParamList, 'AdminUserDetail'>;

/**
 * The whole stored record for one account.
 *
 * `ProfileDetailScreen` shows a person as another user would meet them. This
 * shows the same record as data: the ids, the raw coordinates, the fields a
 * fresh registration leaves blank. Those are exactly the fields you cannot see
 * from a normal session, and they are where seed and migration bugs show up.
 */
export function AdminUserDetailScreen() {
  const route = useRoute<DetailRoute>();
  const { userId } = route.params;
  const [authMode] = useAuthMode();
  const currentUser = useCurrentUser();
  const isMock = authMode === 'mock';

  const {
    data: user,
    error,
    isLoading,
    refetch,
  } = useAsync<User | null>(async () => (isMock ? getAdminUser(userId) : null), [isMock, userId]);

  if (!isMock) {
    return (
      <ScreenContainer>
        <EmptyState
          icon="🔒"
          title="Mock mode only"
          message="There is no backend to read a user record from yet. Switch the auth mode back to mock in Settings."
        />
      </ScreenContainer>
    );
  }

  if (isLoading) {
    return (
      <ScreenContainer>
        <LoadingState label="Reading the record..." />
      </ScreenContainer>
    );
  }

  if (!user) {
    return (
      <ScreenContainer>
        <EmptyState
          icon="🔍"
          title="No such account"
          message={`Nothing in the mock database is stored under ${userId}.`}
          actionLabel="Reload"
          onAction={refetch}
        />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer scroll>
      <View style={styles.body}>
        {error ? <ErrorBanner message={error} onDismiss={refetch} /> : null}

        <View style={styles.header}>
          <ProfileImage user={user} style={styles.avatar} />
          <View style={styles.headerText}>
            <Text variant="titleMedium" style={styles.name}>
              {user.name}
            </Text>
            <Text variant="bodySmall" style={styles.muted}>
              {user.email}
            </Text>
            {user.id === currentUser?.id ? (
              <Text variant="labelSmall" style={styles.youBadge}>
                SIGNED-IN ACCOUNT
              </Text>
            ) : null}
          </View>
        </View>

        <Section title="Record">
          <Row label="id" value={user.id} />
          <Row label="createdAt" value={user.createdAt} />
          <Row label="updatedAt" value={user.updatedAt} />
          <Row label="isVerified" value={user.isVerified ? 'true' : 'false'} />
          <Row
            label="questionnaire"
            value={user.questionnaire ? 'present' : 'absent (still onboarding)'}
          />
        </Section>

        <Section title="Basics">
          <Row label="dateOfBirth" value={user.dateOfBirth} />
          <Row label="age" value={String(ageFromDateOfBirth(user.dateOfBirth))} />
          <Row label="gender" value={user.gender.replace(/_/g, ' ')} />
          <Row label="sexualOrientation" value={user.sexualOrientation.replace(/_/g, ' ')} />
          <Row label="relationshipGoal" value={user.relationshipGoal.replace(/_/g, ' ')} />
        </Section>

        <Section title="Location">
          <Row label="city" value={user.location.city || '(empty)'} />
          <Row label="country" value={user.location.country || '(empty)'} />
          <Row
            label="coordinates"
            // Spelled out rather than just printing 0,0, because a profile
            // sitting on null island is invisible to every nearby deck while
            // looking complete. An inspector that says "0,0" is not much help
            // for spotting it.
            value={
              hasCoordinates(user.location)
                ? `${user.location.latitude}, ${user.location.longitude}`
                : '(none - hidden from nearby viewers)'
            }
          />
        </Section>

        <Section title="Preferences">
          <Row
            label="ageRange"
            value={`${user.preferences.ageRange.min} - ${user.preferences.ageRange.max}`}
          />
          <Row label="distanceMode" value={user.preferences.distanceMode} />
          <Row
            label="maxDistance"
            value={
              user.preferences.distanceMode === 'global'
                ? `${user.preferences.maxDistance} km (not applied)`
                : `${user.preferences.maxDistance} km`
            }
          />
          <Row
            label="genders"
            value={
              user.preferences.genders.length
                ? user.preferences.genders.map((gender) => gender.replace(/_/g, ' ')).join(', ')
                : '(none)'
            }
          />
          <Row
            label="relationshipGoals"
            value={
              user.preferences.relationshipGoals.length
                ? user.preferences.relationshipGoals
                    .map((goal) => goal.replace(/_/g, ' '))
                    .join(', ')
                : '(none)'
            }
          />
        </Section>

        <Section title={`Photos (${user.photos.length})`}>
          {user.photos.length === 0 ? (
            <Row label="" value="(none)" />
          ) : (
            user.photos.map((photo) => (
              <Row
                key={photo.id}
                label={`${photo.isPrimary ? 'primary' : 'photo'} ${photo.order}`}
                value={photo.url || '(empty uri)'}
              />
            ))
          )}
        </Section>

        <Section title="Bio">
          <Text variant="bodyMedium" style={user.bio ? undefined : styles.muted}>
            {user.bio || '(empty)'}
          </Text>
        </Section>

        {user.questionnaire ? (
          <>
            <Section title={`Values (${user.questionnaire.values.length})`}>
              {user.questionnaire.values.length === 0 ? (
                <Row label="" value="(none)" />
              ) : (
                user.questionnaire.values.map((value) => (
                  <Row
                    key={value}
                    label={value.replace(/_/g, ' ')}
                    value={`importance ${user.questionnaire?.importance[value] ?? '-'}`}
                  />
                ))
              )}
            </Section>

            <Section title={`Deal breakers (${user.questionnaire.dealBreakers.length})`}>
              {user.questionnaire.dealBreakers.length === 0 ? (
                <Row label="" value="(none)" />
              ) : (
                user.questionnaire.dealBreakers.map((value) => (
                  <Row key={value} label={value.replace(/_/g, ' ')} value="veto" />
                ))
              )}
            </Section>

            <Section title={`Prompts (${user.questionnaire.prompts.length})`}>
              {user.questionnaire.prompts.length === 0 ? (
                <Row label="" value="(none)" />
              ) : (
                user.questionnaire.prompts.map((answer) => (
                  <View key={answer.promptId} style={styles.prompt}>
                    <Text variant="bodySmall" style={styles.promptTag}>
                      {tagLabel(answer.tag)}
                    </Text>
                    <Text variant="bodyMedium" style={styles.promptQuestion}>
                      {promptQuestion(answer.promptId, answer.tag)}
                    </Text>
                    <Text variant="bodyMedium">{choiceLabel(answer.choice)}</Text>
                    {answer.note ? (
                      <Text variant="bodySmall" style={styles.muted}>
                        {answer.note}
                      </Text>
                    ) : null}
                  </View>
                ))
              )}
            </Section>

            <Section title="Lifestyle">
              <Row
                label="schedule"
                value={user.questionnaire.lifestyle.schedule.replace(/_/g, ' ')}
              />
              <Row
                label="exercise"
                value={user.questionnaire.lifestyle.exercise.replace(/_/g, ' ')}
              />
              <Row
                label="smoking"
                value={user.questionnaire.lifestyle.smoking.replace(/_/g, ' ')}
              />
              <Row
                label="drinking"
                value={user.questionnaire.lifestyle.drinking.replace(/_/g, ' ')}
              />
              <Row label="pets" value={user.questionnaire.lifestyle.pets.replace(/_/g, ' ')} />
            </Section>
          </>
        ) : null}
      </View>
    </ScreenContainer>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text variant="labelLarge" style={styles.sectionTitle}>
        {title.toUpperCase()}
      </Text>
      <Divider />
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

/** Label and value on one line, wrapping rather than truncating. */
function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      {label ? (
        <Text variant="bodySmall" style={styles.rowLabel}>
          {label}
        </Text>
      ) : null}
      <Text variant="bodySmall" style={styles.rowValue}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { gap: SPACING.lg, paddingVertical: SPACING.lg, paddingBottom: SPACING.xxl },
  header: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md },
  avatar: { width: 64, height: 64, borderRadius: 32 },
  headerText: { flex: 1, gap: 2 },
  name: { fontWeight: '800' },
  muted: { color: COLORS.textSecondary },
  youBadge: { color: COLORS.secondary, fontWeight: '700' },
  section: { gap: SPACING.sm },
  sectionTitle: { color: COLORS.textSecondary, letterSpacing: 0.8 },
  sectionBody: { gap: SPACING.xs },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: SPACING.md,
  },
  rowLabel: { color: COLORS.textMuted, flexShrink: 0 },
  rowValue: { flex: 1, textAlign: 'right' },
  prompt: { gap: 2, paddingVertical: SPACING.xs },
  promptTag: { color: COLORS.textMuted, letterSpacing: 0.4 },
  promptQuestion: { fontWeight: '600' },
});
