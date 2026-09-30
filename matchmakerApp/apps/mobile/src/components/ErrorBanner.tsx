import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { AppIcon } from './AppIcon';
import { BORDER_RADIUS, COLORS, FONT_SIZES, SPACING } from '@/constants';

interface Props {
  message?: string | null;
  onDismiss?: () => void;
  onRetry?: () => void;
  retryLabel?: string;
  tone?: 'error' | 'info';
}

export function ErrorBanner({
  message,
  onDismiss,
  onRetry,
  retryLabel = 'Try again',
  tone = 'error',
}: Props) {
  if (!message) return null;

  const isError = tone === 'error';

  return (
    <View
      style={[styles.container, isError ? styles.errorContainer : styles.infoContainer]}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      <AppIcon
        name={isError ? 'alert-circle-outline' : 'information-outline'}
        size={18}
        color={isError ? COLORS.error : COLORS.secondary}
      />
      <Text style={[styles.message, isError ? styles.errorText : styles.infoText]}>{message}</Text>

      {onRetry ? (
        <Pressable onPress={onRetry} accessibilityRole="button" style={styles.action}>
          <Text style={[styles.actionText, isError ? styles.errorText : styles.infoText]}>
            {retryLabel}
          </Text>
        </Pressable>
      ) : null}

      {onDismiss ? (
        <Pressable
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
          style={styles.dismiss}
        >
          <AppIcon name="close" size={16} color={COLORS.textSecondary} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
  },
  errorContainer: {
    backgroundColor: 'rgba(239,68,68,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.25)',
  },
  infoContainer: {
    backgroundColor: 'rgba(78,205,196,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(78,205,196,0.3)',
  },
  message: {
    flex: 1,
    fontSize: FONT_SIZES.sm,
  },
  errorText: {
    color: COLORS.error,
  },
  infoText: {
    color: COLORS.secondaryDark,
  },
  action: {
    paddingHorizontal: SPACING.sm,
  },
  actionText: {
    fontWeight: '700',
    fontSize: FONT_SIZES.sm,
  },
  dismiss: {
    padding: SPACING.xs,
  },
});
