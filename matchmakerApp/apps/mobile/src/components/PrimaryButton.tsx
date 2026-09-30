import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet } from 'react-native';
import { Button, type ButtonProps } from 'react-native-paper';
import { SPACING } from '@/constants';

type Variant = 'contained' | 'outlined' | 'text' | 'elevated';

interface Props extends Omit<ButtonProps, 'loading' | 'mode'> {
  variant?: Variant;
  loading?: boolean;
  fullWidth?: boolean;
  children: ReactNode;
}

export function PrimaryButton({
  variant = 'contained',
  loading = false,
  fullWidth = false,
  disabled,
  children,
  style,
  ...rest
}: Props) {
  return (
    <Button
      mode={variant}
      onPress={rest.onPress}
      disabled={disabled || loading}
      loading={loading}
      style={[fullWidth && styles.fullWidth, style]}
      contentStyle={styles.content}
      accessibilityRole="button"
      {...rest}
    >
      {loading ? <ActivityIndicator size={16} style={styles.hidden} /> : null}
      {children}
    </Button>
  );
}

const styles = StyleSheet.create({
  fullWidth: {
    alignSelf: 'stretch',
  },
  content: {
    minHeight: 48,
  },
  hidden: {
    position: 'absolute',
  },
});

export const buttonSpacing = SPACING.md;
