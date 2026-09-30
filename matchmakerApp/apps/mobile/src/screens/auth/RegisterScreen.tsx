import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Gender, registerSchema, type RegisterInput } from '@match-makers/shared';
import {
  ScreenContainer,
  PrimaryButton,
  FormField,
  ErrorBanner,
  SelectChips,
  type ChipOption,
} from '@/components';
import { useAuthActions, useAuthFormState } from '@/hooks';
import { COLORS, FONT_SIZES, SPACING } from '@/constants';
import type { AuthStackParamList } from '@/navigation/types';

const GENDER_OPTIONS: ReadonlyArray<ChipOption<Gender>> = [
  { value: Gender.FEMALE, label: 'Woman' },
  { value: Gender.MALE, label: 'Man' },
  { value: Gender.NON_BINARY, label: 'Non-binary' },
  { value: Gender.PREFER_NOT_TO_SAY, label: 'Prefer not to say' },
];

export function RegisterScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<AuthStackParamList>>();
  const { register } = useAuthActions();
  const { isSubmitting, error, fieldErrors, clearError } = useAuthFormState();

  const { control, handleSubmit, setValue, formState } = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      email: '',
      password: '',
      confirmPassword: '',
      name: '',
      dateOfBirth: '',
      gender: Gender.PREFER_NOT_TO_SAY,
    },
    mode: 'onBlur',
  });

  const [gender, setGender] = useState<Gender>(Gender.PREFER_NOT_TO_SAY);

  const selectGender = (value: Gender) => {
    setGender(value);
    void setValue('gender', value, { shouldValidate: true });
  };

  const onSubmit = handleSubmit(async (values) => {
    try {
      await register({
        email: values.email,
        password: values.password,
        name: values.name,
        dateOfBirth: values.dateOfBirth,
        gender: values.gender,
      });
    } catch {
      // Errors are surfaced through the store.
    }
  });

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScreenContainer scroll>
          <View style={styles.header}>
            <Text variant="headlineMedium" style={styles.title}>
              Create your account
            </Text>
            <Text variant="bodyMedium" style={styles.subtitle}>
              You will pick your preferences and photos next.
            </Text>
          </View>

          <View style={styles.form}>
            <ErrorBanner message={error} onDismiss={clearError} />

            <FormField
              control={control}
              name="name"
              label="First and last name"
              autoCapitalize="words"
              autoComplete="name"
              serverError={fieldErrors?.name}
            />

            <FormField
              control={control}
              name="email"
              label="Email"
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              textContentType="emailAddress"
              serverError={fieldErrors?.email}
            />

            <FormField
              control={control}
              name="dateOfBirth"
              label="Date of birth"
              placeholder="YYYY-MM-DD"
              keyboardType="numbers-and-punctuation"
              autoCapitalize="none"
              serverError={fieldErrors?.dateOfBirth}
            />

            <SelectChips
              label="I am a"
              options={GENDER_OPTIONS}
              selected={[gender]}
              onToggle={selectGender}
              multiple={false}
              helperText="Used to show you relevant profiles."
            />

            <FormField
              control={control}
              name="password"
              label="Password"
              secureTextEntry
              autoCapitalize="none"
              autoComplete="new-password"
              textContentType="newPassword"
              serverError={fieldErrors?.password}
            />

            <FormField
              control={control}
              name="confirmPassword"
              label="Confirm password"
              secureTextEntry
              autoCapitalize="none"
              autoComplete="new-password"
              textContentType="newPassword"
              serverError={fieldErrors?.confirmPassword}
            />

            <Text variant="bodySmall" style={styles.requirement}>
              At least 8 characters with an uppercase letter, a lowercase letter and a number.
            </Text>

            <PrimaryButton
              onPress={onSubmit}
              loading={isSubmitting}
              disabled={isSubmitting}
              fullWidth
            >
              Create account
            </PrimaryButton>

            <Text
              style={styles.switchPrompt}
              onPress={() => navigation.goBack()}
              suppressHighlighting
            >
              Already have an account? <Text style={styles.link}>Sign in</Text>
            </Text>

            {formState.errors.root ? (
              <Text style={styles.rootError}>{formState.errors.root.message}</Text>
            ) : null}
          </View>
        </ScreenContainer>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.background },
  flex: { flex: 1 },
  header: { gap: SPACING.xs, marginBottom: SPACING.lg },
  title: { fontWeight: '700' },
  subtitle: { color: COLORS.textSecondary },
  form: { gap: SPACING.md, paddingBottom: SPACING.xl },
  requirement: { color: COLORS.textSecondary, marginTop: -SPACING.sm },
  switchPrompt: {
    textAlign: 'center',
    color: COLORS.textSecondary,
    fontSize: FONT_SIZES.sm,
  },
  link: { color: COLORS.primary, fontWeight: '700' },
  rootError: { color: COLORS.error, fontSize: FONT_SIZES.sm, textAlign: 'center' },
});
