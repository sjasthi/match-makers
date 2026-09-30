import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, SPACING } from '@/constants';

interface Props {
  children?: ReactNode;
  scroll?: boolean;
  padded?: boolean;
  contentStyle?: ViewStyle;
  testID?: string;
}

/** Consistent page chrome: safe-area padding, background colour and scrolling. */
export function ScreenContainer({
  children,
  scroll = false,
  padded = true,
  contentStyle,
  testID,
}: Props) {
  const insets = useSafeAreaInsets();
  const padding = {
    paddingTop: insets.top,
    paddingBottom: insets.bottom,
    paddingLeft: padded ? SPACING.lg : 0,
    paddingRight: padded ? SPACING.lg : 0,
  };

  if (scroll) {
    return (
      <ScrollView
        testID={testID}
        style={styles.root}
        contentContainerStyle={[styles.scrollContent, padding, contentStyle]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>
    );
  }

  return (
    <View testID={testID} style={[styles.root, padding, contentStyle]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollContent: {
    flexGrow: 1,
  },
});
