import { MD3LightTheme, type MD3Theme } from 'react-native-paper';
import { COLORS } from '@/constants';

export const appTheme: MD3Theme = {
  ...MD3LightTheme,
  roundness: 3,
  colors: {
    ...MD3LightTheme.colors,
    primary: COLORS.primary,
    onPrimary: COLORS.background,
    primaryContainer: '#FFE3E3',
    onPrimaryContainer: COLORS.primaryDark,
    secondary: COLORS.secondary,
    onSecondary: COLORS.background,
    secondaryContainer: '#D7F5F2',
    onSecondaryContainer: COLORS.secondaryDark,
    background: COLORS.background,
    onBackground: COLORS.text,
    surface: COLORS.surface,
    onSurface: COLORS.text,
    surfaceVariant: COLORS.surfaceVariant,
    onSurfaceVariant: COLORS.textSecondary,
    outline: COLORS.border,
    outlineVariant: COLORS.border,
    error: COLORS.error,
    onError: COLORS.background,
  },
};
