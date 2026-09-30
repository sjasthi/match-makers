import { StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Text } from 'react-native-paper';
import { COLORS, FONT_SIZES, SPACING } from '@/constants';

interface EmptyStateProps {
  icon: string;
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ icon, title, message, actionLabel, onAction }: EmptyStateProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.icon}>{icon}</Text>
      <Text variant="titleMedium" style={styles.title}>
        {title}
      </Text>
      <Text variant="bodyMedium" style={styles.message}>
        {message}
      </Text>
      {actionLabel && onAction ? (
        <Button mode="contained" onPress={onAction} style={styles.action}>
          {actionLabel}
        </Button>
      ) : null}
    </View>
  );
}

interface LoadingStateProps {
  label?: string;
  fullHeight?: boolean;
}

export function LoadingState({ label = 'Loading...', fullHeight = false }: LoadingStateProps) {
  return (
    <View style={[styles.container, fullHeight && styles.fullHeight]}>
      <ActivityIndicator size="large" color={COLORS.primary} />
      <Text variant="bodyMedium" style={styles.message}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.xl,
    gap: SPACING.md,
  },
  fullHeight: {
    flex: 1,
  },
  icon: {
    fontSize: 48,
  },
  title: {
    textAlign: 'center',
  },
  message: {
    color: COLORS.textSecondary,
    textAlign: 'center',
    fontSize: FONT_SIZES.sm,
  },
  action: {
    marginTop: SPACING.sm,
  },
});
