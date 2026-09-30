import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import type { VerificationStatus } from '@match-makers/shared';
import { ScreenContainer, PrimaryButton, ErrorBanner, LoadingState, AppIcon } from '@/components';
import { useCurrentUser } from '@/hooks';
import { useAuthStore } from '@/stores/authStore';
import { fetchVerificationStatus, submitVerification } from '@/services/profile';
import { AuthError } from '@/services/auth/AuthError';
import { BORDER_RADIUS, COLORS, FONT_SIZES, SPACING } from '@/constants';
import type { IconName } from '@/components';

type Method = NonNullable<VerificationStatus['method']>;

const METHODS: ReadonlyArray<{
  value: Method;
  icon: IconName;
  title: string;
  description: string;
}> = [
  {
    value: 'selfie',
    icon: 'face-recognition',
    title: 'Quick selfie check',
    description: 'Match a short video against your profile photo. Takes about a minute.',
  },
  {
    value: 'document',
    icon: 'card-account-details-outline',
    title: 'Government ID',
    description: 'Upload an ID and a photo of you holding it. Reviewed within a day.',
  },
  {
    value: 'phone',
    icon: 'phone-lock',
    title: 'Confirm your phone',
    description: 'We already have your email. Adding a phone number reduces fake accounts.',
  },
];

export function VerificationScreen() {
  const user = useCurrentUser();
  const setUser = useAuthStore((store) => store.setUser);

  const [status, setStatus] = useState<VerificationStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState<Method | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setStatus(await fetchVerificationStatus());
    } catch (caught) {
      setError(AuthError.unknown(caught).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const choose = async (method: Method) => {
    setError(null);
    setSubmitting(method);
    try {
      const result = await submitVerification(method);
      setStatus({ status: result.status, method });
      if (result.user) setUser(result.user);
    } catch (caught) {
      setError(AuthError.unknown(caught).message);
    } finally {
      setSubmitting(null);
    }
  };

  if (loading) return <LoadingState label="Checking verification..." fullHeight />;

  const isVerified = status?.status === 'verified' || user?.isVerified;

  return (
    <ScreenContainer scroll>
      <View style={styles.form}>
        {isVerified ? (
          <View style={styles.verifiedCard}>
            <AppIcon name="check-decagram" size={40} color={COLORS.secondary} />
            <Text variant="titleMedium" style={styles.verifiedTitle}>
              You are verified
            </Text>
            <Text variant="bodySmall" style={styles.verifiedBody}>
              Your badge is visible to everyone you match with.
            </Text>
          </View>
        ) : null}

        {status?.status === 'pending' ? (
          <ErrorBanner
            message="Your submission is being reviewed. This usually takes under a day."
            tone="info"
          />
        ) : null}

        {error ? <ErrorBanner message={error} onDismiss={() => setError(null)} /> : null}

        <View style={styles.intro}>
          <Text variant="titleMedium" style={styles.title}>
            Prove you are real
          </Text>
          <Text variant="bodyMedium" style={styles.body}>
            Verified profiles get more matches and are reported far less often. Pick whichever
            option suits you, and you can change your mind later.
          </Text>
        </View>

        <View style={styles.methods}>
          {METHODS.map((method) => (
            <View key={method.value} style={styles.methodCard}>
              <AppIcon name={method.icon} size={24} color={COLORS.primary} />
              <View style={styles.methodBody}>
                <Text variant="titleSmall" style={styles.methodTitle}>
                  {method.title}
                </Text>
                <Text variant="bodySmall" style={styles.methodDescription}>
                  {method.description}
                </Text>
              </View>
              <PrimaryButton
                variant="outlined"
                onPress={() => void choose(method.value)}
                loading={submitting === method.value}
                disabled={Boolean(submitting) || isVerified}
                compact
              >
                {isVerified ? 'Done' : 'Start'}
              </PrimaryButton>
            </View>
          ))}
        </View>

        <Pressable onPress={() => void load()} style={styles.refresh} accessibilityRole="button">
          <Text style={styles.refreshText}>Refresh status</Text>
        </Pressable>

        <Text variant="bodySmall" style={styles.footnote}>
          The prototype skips the actual capture flow and marks you verified immediately, so the
          rest of the app can be exercised. FP1 called for a proof step that stays non-intrusive.
        </Text>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  form: { gap: SPACING.lg, paddingVertical: SPACING.lg, paddingBottom: SPACING.xxl },
  verifiedCard: {
    alignItems: 'center',
    gap: SPACING.sm,
    backgroundColor: 'rgba(78,205,196,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(78,205,196,0.3)',
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
  },
  verifiedTitle: { fontWeight: '700' },
  verifiedBody: { color: COLORS.textSecondary, textAlign: 'center' },
  intro: { gap: SPACING.xs },
  title: { fontWeight: '700' },
  body: { color: COLORS.textSecondary },
  methods: { gap: SPACING.md },
  methodCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
  },
  methodBody: { flex: 1, gap: 2 },
  methodTitle: { fontWeight: '700' },
  methodDescription: { color: COLORS.textSecondary, fontSize: FONT_SIZES.xs },
  refresh: { alignSelf: 'center', padding: SPACING.sm },
  refreshText: { color: COLORS.primary, fontWeight: '700' },
  footnote: { color: COLORS.textMuted },
});
