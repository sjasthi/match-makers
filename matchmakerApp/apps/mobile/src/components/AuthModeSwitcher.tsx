import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { SegmentedButtons, Surface, Text } from 'react-native-paper';
import { AUTH_MODES, type AuthMode } from '@/services/auth/AuthAdapter';
import { AppIcon } from './AppIcon';
import { BORDER_RADIUS, COLORS, FONT_SIZES, SPACING } from '@/constants';

const MODE_LABELS: Record<AuthMode, string> = {
  mock: 'Mock',
  jwt: 'JWT',
  session: 'Session',
};

const MODE_DESCRIPTIONS: Record<AuthMode, string> = {
  mock: 'Local data only, no server required.',
  jwt: 'Bearer access token plus refresh rotation.',
  session: 'HttpOnly cookie session.',
};

interface Props {
  value: AuthMode;
  onChange: (mode: AuthMode) => void;
  disabled?: boolean;
  showDescription?: boolean;
}

/**
 * Lets a developer flip between the mock, JWT and session auth strategies
 * without editing code. This is the "configurable auth" the prototype needs
 * while the real backend is still being built.
 */
export function AuthModeSwitcher({ value, onChange, disabled, showDescription = true }: Props) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Surface style={styles.container} elevation={0}>
      <Pressable onPress={() => setExpanded((current) => !current)} accessibilityRole="button">
        <View style={styles.headerRow}>
          <Text variant="labelMedium" style={styles.label}>
            Auth mode
          </Text>
          <AppIcon
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={18}
            color={COLORS.textSecondary}
          />
        </View>
      </Pressable>

      {expanded ? (
        <View style={styles.body}>
          <SegmentedButtons
            value={value}
            onValueChange={(next) => onChange(next as AuthMode)}
            buttons={AUTH_MODES.map((mode) => ({
              value: mode,
              label: MODE_LABELS[mode],
            }))}
            density="small"
            style={styles.segmented}
          />
          {showDescription ? (
            <Text variant="bodySmall" style={styles.description}>
              {MODE_DESCRIPTIONS[value]}
            </Text>
          ) : null}
          {disabled ? (
            <Text variant="bodySmall" style={styles.description}>
              Switching signs you out of the current session.
            </Text>
          ) : null}
        </View>
      ) : null}
    </Surface>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  label: {
    color: COLORS.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  body: {
    paddingHorizontal: SPACING.md,
    paddingBottom: SPACING.md,
    gap: SPACING.sm,
  },
  segmented: {
    marginBottom: SPACING.xs,
  },
  description: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZES.xs,
  },
});
