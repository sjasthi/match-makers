import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ScreenContainer, PrimaryButton, AppIcon } from '@/components';
import { COLORS, FONT_SIZES, SPACING } from '@/constants';
import type { OnboardingStackParamList } from '@/navigation/types';
import type { IconName } from '@/components';

const HIGHLIGHTS: ReadonlyArray<{ icon: IconName; title: string; body: string }> = [
  {
    icon: 'tune-variant',
    title: 'You set the rules',
    body: 'Choose who you see with age, distance and goal filters.',
  },
  {
    icon: 'shield-check-outline',
    title: 'Verified people only',
    body: 'Verification badges make it obvious who is a real account.',
  },
  {
    icon: 'hand-wave-outline',
    title: 'Chat only after a match',
    body: 'No cold DMs. You both have to opt in.',
  },
];

export function WelcomeScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<OnboardingStackParamList>>();

  return (
    <ScreenContainer>
      <View style={styles.content}>
        <Text variant="displaySmall" style={styles.brand}>
          Match Makers
        </Text>
        <Text variant="headlineSmall" style={styles.headline}>
          A few questions and you are ready to swipe.
        </Text>

        <View style={styles.list}>
          {HIGHLIGHTS.map((item) => (
            <View key={item.title} style={styles.item}>
              <View style={styles.iconWrapper}>
                <AppIcon name={item.icon} size={22} color={COLORS.secondary} />
              </View>
              <View style={styles.itemBody}>
                <Text variant="titleSmall" style={styles.itemTitle}>
                  {item.title}
                </Text>
                <Text variant="bodySmall" style={styles.itemText}>
                  {item.body}
                </Text>
              </View>
            </View>
          ))}
        </View>
      </View>

      <PrimaryButton onPress={() => navigation.navigate('Basics')} fullWidth>
        Get started
      </PrimaryButton>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
    justifyContent: 'center',
    gap: SPACING.lg,
  },
  brand: {
    color: COLORS.primary,
    fontWeight: '800',
  },
  headline: {
    fontWeight: '700',
  },
  list: {
    gap: SPACING.lg,
    marginTop: SPACING.sm,
  },
  item: {
    flexDirection: 'row',
    gap: SPACING.md,
    alignItems: 'flex-start',
  },
  iconWrapper: {
    width: 28,
    alignItems: 'flex-start',
  },
  itemBody: {
    flex: 1,
    gap: 2,
  },
  itemTitle: {
    fontWeight: '700',
  },
  itemText: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZES.sm,
  },
});
