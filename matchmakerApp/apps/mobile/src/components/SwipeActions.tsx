import { StyleSheet, View } from 'react-native';
import { IconButton } from 'react-native-paper';
import { COLORS, SPACING } from '@/constants';
import type { IconName } from './AppIcon';

interface ActionConfig {
  icon: IconName;
  label: string;
  onPress: () => void;
  color: string;
  size: number;
  disabled?: boolean;
}

interface Props {
  onPass: () => void;
  onSuperLike: () => void;
  onLike: () => void;
  disabled?: boolean;
  busy?: boolean;
}

export function SwipeActions({ onPass, onSuperLike, onLike, disabled, busy }: Props) {
  const actions: ActionConfig[] = [
    {
      icon: 'close',
      label: 'Pass',
      onPress: onPass,
      color: COLORS.error,
      size: 30,
    },
    {
      icon: 'star-four-points',
      label: 'Super like',
      onPress: onSuperLike,
      color: COLORS.secondary,
      size: 24,
    },
    {
      icon: 'heart',
      label: 'Like',
      onPress: onLike,
      color: COLORS.primary,
      size: 30,
    },
  ];

  return (
    <View style={styles.row} accessibilityRole="toolbar" accessibilityLabel="Swipe actions">
      {actions.map((action) => (
        <IconButton
          key={action.label}
          icon={action.icon}
          iconColor={action.color}
          size={action.size}
          mode="contained-tonal"
          containerColor={COLORS.background}
          onPress={action.onPress}
          disabled={disabled || busy}
          accessibilityLabel={action.label}
          style={[styles.button, { borderColor: action.color }]}
          testID={`swipe-${action.label.replace(/\s+/g, '-').toLowerCase()}`}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.xl,
  },
  button: {
    borderWidth: 2,
  },
});
