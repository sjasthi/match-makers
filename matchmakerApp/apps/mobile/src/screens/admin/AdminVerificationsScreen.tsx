import { useState } from 'react';
import { FlatList, StyleSheet, View, Image } from 'react-native';
import { Text } from 'react-native-paper';
import {
  ScreenContainer,
  LoadingState,
  EmptyState,
  ErrorBanner,
  PrimaryButton,
} from '@/components';
import { useAsync } from '@/hooks/useAsync';
import {
  listPendingVerifications,
  acceptVerification,
  declineVerification,
  type AdminVerificationSubmission,
} from '@/services/admin';
import { BORDER_RADIUS, COLORS, FONT_SIZES, SPACING } from '@/constants';

/**
 * Admin screen for reviewing pending verification submissions.
 * Shows submitted photos with Accept/Decline buttons.
 */
export function AdminVerificationsScreen() {
  const [actionError, setActionError] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);

  const { data, error, isLoading, refetch } = useAsync<AdminVerificationSubmission[]>(
    () => listPendingVerifications(),
    []
  );

  const handleAccept = async (submissionId: string) => {
    setActionError(null);
    setActingId(submissionId);
    try {
      await acceptVerification(submissionId);
      refetch();
    } catch (caught) {
      setActionError(
        caught instanceof Error ? caught.message : 'Could not accept this submission.'
      );
    } finally {
      setActingId(null);
    }
  };

  const handleDecline = async (submissionId: string) => {
    setActionError(null);
    setActingId(submissionId);
    try {
      await declineVerification(submissionId, 'Photo was not approved in this review.');
      refetch();
    } catch (caught) {
      setActionError(
        caught instanceof Error ? caught.message : 'Could not decline this submission.'
      );
    } finally {
      setActingId(null);
    }
  };

  return (
    <ScreenContainer padded={false}>
      <FlatList
        testID="admin-verifications-list"
        data={data ?? []}
        keyExtractor={(sub) => sub.id}
        contentContainerStyle={styles.content}
        refreshing={false}
        onRefresh={refetch}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text variant="bodySmall" style={styles.hint}>
              Pending verification submissions. Review each photo and accept or decline.
            </Text>
            {error ? <ErrorBanner message={error} onDismiss={refetch} /> : null}
            {actionError ? (
              <ErrorBanner message={actionError} onDismiss={() => setActionError(null)} />
            ) : null}
            {data ? (
              <Text variant="labelLarge" style={styles.count}>
                {data.length} {data.length === 1 ? 'SUBMISSION' : 'SUBMISSIONS'} PENDING
              </Text>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          isLoading ? (
            <LoadingState label="Loading submissions..." />
          ) : (
            <EmptyState
              icon="✅"
              title="No pending submissions"
              message="All verification requests have been reviewed."
            />
          )
        }
        renderItem={({ item }) => (
          <VerificationRow
            submission={item}
            onAccept={() => handleAccept(item.id)}
            onDecline={() => handleDecline(item.id)}
            busy={actingId === item.id}
          />
        )}
      />
    </ScreenContainer>
  );
}

function VerificationRow({
  submission,
  onAccept,
  onDecline,
  busy,
}: {
  submission: AdminVerificationSubmission;
  onAccept: () => void;
  onDecline: () => void;
  busy: boolean;
}) {
  const submittedDate = new Date(submission.submittedAt).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <View style={styles.row}>
      <View style={styles.rowLeft}>
        <View style={styles.photoWrapper}>
          <Image source={{ uri: submission.imageData }} style={styles.photo} resizeMode="cover" />
        </View>
        <View style={styles.info}>
          <View style={styles.nameLine}>
            <Text variant="bodyLarge" style={styles.name} numberOfLines={1}>
              {submission.userName}
            </Text>
            {submission.userIsVerified ? (
              <Text variant="labelSmall" style={styles.verified}>
                ✓ Verified
              </Text>
            ) : (
              <Text variant="labelSmall" style={styles.unverified}>
                Unverified
              </Text>
            )}
          </View>
          <Text variant="bodySmall" style={styles.email} numberOfLines={1}>
            {submission.userEmail}
          </Text>
          <Text variant="bodySmall" style={styles.meta}>
            Submitted {submittedDate}
          </Text>
        </View>
      </View>
      <View style={styles.actions}>
        <PrimaryButton
          variant="outlined"
          onPress={onDecline}
          style={styles.actionButton}
          icon="close"
          disabled={busy}
          loading={busy}
        >
          Decline
        </PrimaryButton>
        <PrimaryButton
          onPress={onAccept}
          style={styles.actionButton}
          icon="check"
          disabled={busy}
          loading={busy}
        >
          Accept
        </PrimaryButton>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: SPACING.xxl },
  header: { padding: SPACING.lg, gap: SPACING.sm },
  hint: { color: COLORS.textSecondary },
  count: { color: COLORS.textMuted, letterSpacing: 0.8 },
  row: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: SPACING.md,
    padding: SPACING.lg,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  rowLeft: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: SPACING.md,
  },
  photoWrapper: {
    width: 220,
    height: 260,
    borderRadius: BORDER_RADIUS.md,
    overflow: 'hidden',
    backgroundColor: COLORS.surface,
  },
  photo: {
    width: '100%',
    height: '100%',
  },
  info: { flex: 1, gap: 2 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs },
  name: { fontWeight: '700', flexShrink: 1 },
  verified: { color: COLORS.secondary, fontWeight: '700' },
  unverified: { color: COLORS.warning, fontWeight: '700' },
  email: { color: COLORS.textSecondary, fontSize: FONT_SIZES.sm },
  meta: { color: COLORS.textMuted, fontSize: FONT_SIZES.sm },
  actions: { flexDirection: 'row', gap: SPACING.sm },
  actionButton: { flex: 1 },
});
