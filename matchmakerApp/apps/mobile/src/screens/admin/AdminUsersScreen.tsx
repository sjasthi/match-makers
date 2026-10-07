import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ScreenContainer, LoadingState, EmptyState, ErrorBanner, ProfileImage } from '@/components';
import { useAsync } from '@/hooks/useAsync';
import { useAuthMode, useCurrentUser } from '@/hooks';
import { listAllUsers, type AdminUserSummary } from '@/services/admin';
import { BORDER_RADIUS, COLORS, FONT_SIZES, SPACING } from '@/constants';
import type { ProfileStackParamList } from '@/navigation/types';

type Nav = NativeStackNavigationProp<ProfileStackParamList, 'AdminUsers'>;

/**
 * Every account in the mock database, one row each.
 *
 * The feed and Matches screens are all scoped to whoever is signed in, so this
 * is the only place in the app that can show the whole population at once. That
 * makes it the fastest way to check what a run of registrations actually wrote.
 */
export function AdminUsersScreen() {
  const navigation = useNavigation<Nav>();
  const [authMode] = useAuthMode();
  const currentUser = useCurrentUser();
  const isMock = authMode === 'mock';

  const { data, error, isLoading, refetch } = useAsync<AdminUserSummary[]>(async () => {
    if (!isMock) return [];
    return listAllUsers();
  }, [isMock]);

  if (!isMock) {
    return (
      <ScreenContainer>
        <EmptyState
          icon="🔒"
          title="Mock mode only"
          message="There is no backend to list accounts from yet. Switch the auth mode back to mock in Settings to inspect the seeded users."
        />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer padded={false}>
      <FlatList
        testID="admin-users-list"
        data={data ?? []}
        keyExtractor={(summary) => summary.user.id}
        contentContainerStyle={styles.content}
        refreshing={false}
        onRefresh={refetch}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text variant="bodySmall" style={styles.hint}>
              Read-only. Every account in the mock database, newest first.
            </Text>
            {error ? <ErrorBanner message={error} onDismiss={refetch} /> : null}
            {data ? (
              <Text variant="labelLarge" style={styles.count}>
                {data.length} {data.length === 1 ? 'ACCOUNT' : 'ACCOUNTS'}
              </Text>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          isLoading ? (
            <LoadingState label="Reading the mock database..." />
          ) : (
            <EmptyState
              icon="👥"
              title="No accounts yet"
              message="The mock database reseeds itself on first launch. If this is empty, reset it from Settings."
            />
          )
        }
        renderItem={({ item }) => (
          <UserRow
            summary={item}
            isCurrentUser={item.user.id === currentUser?.id}
            onPress={() => navigation.navigate('AdminUserDetail', { userId: item.user.id })}
          />
        )}
      />
    </ScreenContainer>
  );
}

function UserRow({
  summary,
  isCurrentUser,
  onPress,
}: {
  summary: AdminUserSummary;
  isCurrentUser: boolean;
  onPress: () => void;
}) {
  const { user } = summary;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      accessibilityRole="button"
      testID={`admin-user-row-${user.id}`}
    >
      <ProfileImage user={user} style={styles.avatar} />
      <View style={styles.rowBody}>
        <View style={styles.nameLine}>
          <Text variant="bodyLarge" style={styles.name} numberOfLines={1}>
            {user.name}
          </Text>
          {user.isVerified ? (
            <Text variant="labelSmall" style={styles.verified}>
              ✓
            </Text>
          ) : null}
        </View>
        <Text variant="bodySmall" style={styles.email} numberOfLines={1}>
          {user.email}
        </Text>
        <Text variant="bodySmall" style={styles.meta} numberOfLines={1}>
          {summary.age}
          {user.location.city ? ` · ${user.location.city}` : ''}
          {` · ${user.relationshipGoal.replace(/_/g, ' ')}`}
        </Text>
        <View style={styles.chips}>
          {summary.isDemo ? <Chip label="DEMO" tone="primary" /> : null}
          {isCurrentUser ? <Chip label="YOU" tone="secondary" /> : null}
          {summary.isProfileComplete ? (
            <Chip label="PROFILE OK" tone="success" />
          ) : (
            <Chip label="PROFILE INCOMPLETE" tone="warning" />
          )}
          {summary.hasCompleteQuestionnaire ? (
            <Chip label="FP3 OK" tone="success" />
          ) : (
            <Chip label="FP3 PARTIAL" tone="warning" />
          )}
        </View>
      </View>
    </Pressable>
  );
}

function Chip({
  label,
  tone,
}: {
  label: string;
  tone: 'primary' | 'secondary' | 'success' | 'warning';
}) {
  return (
    <Text variant="labelSmall" style={[styles.chip, chipTone[tone]]}>
      {label}
    </Text>
  );
}

const chipTone = StyleSheet.create({
  primary: { backgroundColor: COLORS.primaryLight, color: COLORS.text },
  secondary: { backgroundColor: COLORS.secondary, color: COLORS.text },
  success: { backgroundColor: COLORS.success, color: COLORS.background },
  warning: { backgroundColor: COLORS.warning, color: COLORS.text },
});

const styles = StyleSheet.create({
  content: { paddingBottom: SPACING.xxl },
  header: { padding: SPACING.lg, gap: SPACING.sm },
  hint: { color: COLORS.textSecondary },
  count: { color: COLORS.textMuted, letterSpacing: 0.8 },
  row: {
    flexDirection: 'row',
    gap: SPACING.md,
    padding: SPACING.lg,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  rowPressed: { backgroundColor: COLORS.surface },
  avatar: { width: 56, height: 56, borderRadius: BORDER_RADIUS.full },
  rowBody: { flex: 1, gap: 2 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs },
  name: { fontWeight: '700', flexShrink: 1 },
  verified: { color: COLORS.secondary, fontWeight: '700' },
  email: { color: COLORS.textSecondary, fontSize: FONT_SIZES.sm },
  meta: { color: COLORS.textMuted, fontSize: FONT_SIZES.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs, marginTop: SPACING.xs },
  chip: {
    overflow: 'hidden',
    borderRadius: BORDER_RADIUS.sm,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
});
