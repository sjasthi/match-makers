import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ComponentProps } from 'react';

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];
type IconSize = number;

interface Props {
  name: IconName;
  size?: IconSize;
  color?: string;
  testID?: string;
}

/**
 * Thin wrapper over the Material Community Icons set.
 *
 * `@expo/vector-icons` is guaranteed to resolve under Expo, whereas
 * react-native-paper resolves its icons through `react-native-vector-icons`,
 * which is not a direct dependency here.
 */
export function AppIcon({ name, size = 24, color = '#000000', testID }: Props) {
  return <MaterialCommunityIcons name={name} size={size} color={color} testID={testID} />;
}

export type { IconName };
