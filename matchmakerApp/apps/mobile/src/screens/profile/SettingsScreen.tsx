import { useState } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ScreenContainer, ErrorBanner, AuthModeSwitcher, AppIcon } from '@/components';
import { useAuthMode } from '@/hooks';
import { mockDb } from '@/services/mock/database';
import { BORDER_RADIUS, COLORS, FONT_SIZES, SPACING } from '@/constants';
import type { ProfileStackParamList } from '@/navigation/types';

type Nav = NativeStackNavigationProp<ProfileStackParamList, 'Settings'>;

export function SettingsScreen() {
  const navigation = useNavigation<Nav>();
  const [authMode, changeAuthMode] = useAuthMode();
  // Both admin rows are available in both modes now. In mock mode they read the
  // mock database; in JWT mode they call `apps/api`, which decides for itself
  // whether this account has admin and answers 403 if not. The client has no way
  // to know -- `User` carries no admin flag -- so it must not pretend either way.
  const isMock = authMode === 'mock';
  const [notifications, setNotifications] = useState(true);
  const [showMe, setShowMe] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);

  const resetMockData = async () => {
    setError(null);
    setResetting(true);
    try {
      await mockDb.reset();
      setError('Mock database reseeded. Sign in again to pick up the fresh demo account.');
    } catch {
      setError('Could not reset the mock database.');
    } finally {
      setResetting(false);
    }
  };

  return (
    <ScreenContainer scroll>
      <View style={styles.form}>
        <ErrorBanner
          message={error}
          onDismiss={() => setError(null)}
          tone={error?.includes('reseeded') ? 'info' : 'error'}
        />

        <Section title="Privacy">
          <ToggleRow
            icon="eye-outline"
            label="Show me in the feed"
            description="Turn off to take a break without deleting your profile."
            value={showMe}
            onValueChange={setShowMe}
          />
        </Section>

        <Section title="Notifications">
          <ToggleRow
            icon="bell-outline"
            label="Matches and messages"
            description="Get notified when someone likes you or replies."
            value={notifications}
            onValueChange={setNotifications}
          />
        </Section>

        {/*
         * Developer tools only exist in a development build.
         *
         * Everything in here is a development affordance rather than a product
         * feature: a switch for which auth strategy every screen uses, an
         * inspector over a database that only exists in mock mode, and a button
         * that wipes and reseeds it. None of that belongs in a shipping
         * Settings screen, where "Reset mock data" reads as a way to lose your
         * account and the switcher reads as a way to break the app.
         *
         * `__DEV__` is defined by Metro and is statically false in a release
         * bundle, so this is compiled away rather than hidden behind a flag
         * somebody can flip. It stays visible under `expo start` and under
         * `expo export --dev`, which is what a demo runs on.
         */}
        {__DEV__ && (
          <Section title="Developer">
            <View style={styles.developerBlock}>
              <Text variant="bodySmall" style={styles.developerHint}>
                Switch the auth strategy used by every screen without touching the backend.
              </Text>
              <AuthModeSwitcher value={authMode} onChange={changeAuthMode} />
            </View>

            <AdminRow
              enabled
              onPress={() => navigation.navigate('AdminUsers')}
              label="Admin: all users"
              hint={
                isMock
                  ? 'Read-only. Every seeded account.'
                  : 'Read-only. Every account on the server.'
              }
              icon="shield-account"
            />

            {/* The only write path in the app. Separate from the read-only row
                above so it is obvious which one of the two can change something. */}
            <AdminRow
              enabled
              onPress={() => navigation.navigate('AdminPosts')}
              label="Admin: photo library"
              hint={
                isMock
                  ? 'Import and tag the seeded photos the feed shows.'
                  : 'Import and tag the photos the feed shows. Needs an admin account.'
              }
              icon="image-multiple-outline"
              testID="settings-admin-posts-row"
            />

            <AdminRow
              enabled
              onPress={() => navigation.navigate('AdminVerifications')}
              label="Admin: verification review"
              hint={
                isMock
                  ? 'Local demo queue; mock mode has no admin-role enforcement.'
                  : 'Review pending verification submissions. Needs an admin account.'
              }
              icon="shield-check"
              testID="settings-admin-verifications-row"
            />

            <Pressable
              onPress={() => void resetMockData()}
              style={styles.dangerRow}
              accessibilityRole="button"
              disabled={resetting}
            >
              <AppIcon name="restore" size={18} color={COLORS.error} />
              <Text style={styles.dangerText}>
                {resetting ? 'Resetting...' : 'Reset mock data'}
              </Text>
            </Pressable>
          </Section>
        )}

        <Text variant="bodySmall" style={styles.footer}>
          Match Makers prototype. Build 0.1.0
        </Text>
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
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function AdminRow({
  enabled,
  onPress,
  label,
  hint,
  disabledHint,
  icon,
  testID,
}: {
  enabled: boolean;
  onPress: () => void;
  label: string;
  hint: string;
  /** Only shown when `enabled` is false. */
  disabledHint?: string;
  icon: 'shield-account' | 'image-multiple-outline' | 'shield-check';
  testID?: string;
}) {
  return (
    <Pressable
      onPress={enabled ? onPress : undefined}
      disabled={!enabled}
      style={styles.adminRow}
      accessibilityRole="button"
      accessibilityState={{ disabled: !enabled }}
      testID={testID ?? 'settings-admin-row'}
    >
      <AppIcon name={icon} size={20} color={enabled ? COLORS.textSecondary : COLORS.textMuted} />
      <View style={styles.adminBody}>
        <Text variant="bodyLarge" style={!enabled && styles.adminDisabledText}>
          {label}
        </Text>
        <Text variant="bodySmall" style={styles.adminHint}>
          {enabled ? hint : disabledHint}
        </Text>
      </View>
    </Pressable>
  );
}

function ToggleRow({
  icon,
  label,
  description,
  value,
  onValueChange,
}: {
  icon: 'eye-outline' | 'bell-outline';
  label: string;
  description: string;
  value: boolean;
  onValueChange: (next: boolean) => void;
}) {
  return (
    <View style={styles.toggleRow}>
      <AppIcon name={icon} size={20} color={COLORS.textSecondary} />
      <View style={styles.toggleBody}>
        <Text variant="bodyLarge">{label}</Text>
        <Text variant="bodySmall" style={styles.toggleDescription}>
          {description}
        </Text>
      </View>
      <Switch value={value} onValueChange={onValueChange} />
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: SPACING.lg, paddingVertical: SPACING.lg, paddingBottom: SPACING.xxl },
  section: { gap: SPACING.sm },
  sectionTitle: { color: COLORS.textSecondary, letterSpacing: 0.8 },
  sectionBody: {
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    padding: SPACING.md,
  },
  toggleBody: { flex: 1, gap: 2 },
  toggleDescription: { color: COLORS.textSecondary },
  developerBlock: { padding: SPACING.md, gap: SPACING.md },
  developerHint: { color: COLORS.textSecondary },
  adminRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    padding: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  adminBody: { flex: 1, gap: 2 },
  adminHint: { color: COLORS.textSecondary },
  adminDisabledText: { color: COLORS.textMuted },
  dangerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    padding: SPACING.md,
  },
  dangerText: { color: COLORS.error, fontWeight: '700' },
  footer: { color: COLORS.textMuted, textAlign: 'center', fontSize: FONT_SIZES.xs },
});
