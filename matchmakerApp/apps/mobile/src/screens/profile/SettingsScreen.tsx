import { useState } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ScreenContainer, AppIcon } from '@/components';
import { BORDER_RADIUS, COLORS, FONT_SIZES, SPACING } from '@/constants';
import type { ProfileStackParamList } from '@/navigation/types';

type Nav = NativeStackNavigationProp<ProfileStackParamList, 'Settings'>;

export function SettingsScreen() {
  const navigation = useNavigation<Nav>();
  const [notifications, setNotifications] = useState(true);
  const [showMe, setShowMe] = useState(true);

  return (
    <ScreenContainer scroll>
      <View style={styles.form}>
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

        {__DEV__ && (
          <Section title="Admin">
            <AdminRow
              enabled
              onPress={() => navigation.navigate('AdminUsers')}
              label="Admin: all users"
              hint="Read-only. Every account on the server."
              icon="shield-account"
            />

            {/* The only write path in the app. Separate from the read-only row
                above so it is obvious which one of the two can change something. */}
            <AdminRow
              enabled
              onPress={() => navigation.navigate('AdminPosts')}
              label="Admin: photo library"
              hint="Import and tag the photos the feed shows. Needs an admin account."
              icon="image-multiple-outline"
              testID="settings-admin-posts-row"
            />

            <AdminRow
              enabled
              onPress={() => navigation.navigate('AdminVerifications')}
              label="Admin: verification review"
              hint="Review pending verification submissions. Needs an admin account."
              icon="shield-check"
              testID="settings-admin-verifications-row"
            />
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
  footer: { color: COLORS.textMuted, textAlign: 'center', fontSize: FONT_SIZES.xs },
});
