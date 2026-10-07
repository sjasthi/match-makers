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

        <Section title="Developer">
          <View style={styles.developerBlock}>
            <Text variant="bodySmall" style={styles.developerHint}>
              Switch the auth strategy used by every screen without touching the backend.
            </Text>
            <AuthModeSwitcher value={authMode} onChange={changeAuthMode} />
          </View>

          <AdminRow enabled={isMock} onPress={() => navigation.navigate('AdminUsers')} />

          <Pressable
            onPress={() => void resetMockData()}
            style={styles.dangerRow}
            accessibilityRole="button"
            disabled={resetting}
          >
            <AppIcon name="restore" size={18} color={COLORS.error} />
            <Text style={styles.dangerText}>{resetting ? 'Resetting...' : 'Reset mock data'}</Text>
          </Pressable>
        </Section>

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

function AdminRow({ enabled, onPress }: { enabled: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={enabled ? onPress : undefined}
      disabled={!enabled}
      style={styles.adminRow}
      accessibilityRole="button"
      accessibilityState={{ disabled: !enabled }}
      testID="settings-admin-row"
    >
      <AppIcon
        name="shield-account"
        size={20}
        color={enabled ? COLORS.textSecondary : COLORS.textMuted}
      />
      <View style={styles.adminBody}>
        <Text variant="bodyLarge" style={!enabled && styles.adminDisabledText}>
          Admin: all users
        </Text>
        <Text variant="bodySmall" style={styles.adminHint}>
          {enabled
            ? 'Read-only. Every account in the mock database.'
            : 'Switch to mock mode to inspect seeded users.'}
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
