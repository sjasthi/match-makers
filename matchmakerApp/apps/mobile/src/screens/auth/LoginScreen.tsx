import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { loginSchema, type LoginInput } from '@match-makers/shared';
import {
  ScreenContainer,
  PrimaryButton,
  FormField,
  ErrorBanner,
} from '@/components';
import { useAuthActions, useAuthFormState } from '@/hooks';
import { COLORS, FONT_SIZES, SPACING } from '@/constants';
import type { AuthStackParamList } from '@/navigation/types';

export function LoginScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<AuthStackParamList>>();
  const { login } = useAuthActions();
  const { isSubmitting, error, fieldErrors, clearError } = useAuthFormState();
  const [showPassword, setShowPassword] = useState(false);

  const { control, handleSubmit } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
    mode: 'onBlur',
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await login(values);
    } catch {
      // The store already surfaced the message; the form keeps its values.
    }
  });

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScreenContainer scroll>
          <View style={styles.header}>
            <Text variant="displaySmall" style={styles.brand}>
              Match Makers
            </Text>
            <Text variant="bodyMedium" style={styles.tagline}>
              Sign in to see who is waiting for you.
            </Text>
          </View>

          <View style={styles.form}>
            <ErrorBanner message={error} onDismiss={clearError} />

            <FormField
              control={control}
              name="email"
              label="Email"
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              textContentType="emailAddress"
              serverError={fieldErrors?.email}
              returnKeyType="next"
            />

            <FormField
              control={control}
              name="password"
              label="Password"
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              autoComplete="current-password"
              textContentType="password"
              serverError={fieldErrors?.password}
              right={
                <Text
                  onPress={() => setShowPassword((value) => !value)}
                  style={styles.showPassword}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </Text>
              }
              returnKeyType="go"
              onSubmitEditing={onSubmit}
            />

            <Text
              style={styles.forgotPassword}
              onPress={() => navigation.navigate('ForgotPassword')}
              suppressHighlighting
            >
              Forgot your password?
            </Text>

            <PrimaryButton
              onPress={onSubmit}
              loading={isSubmitting}
              disabled={isSubmitting}
              fullWidth
              testID="login-submit"
            >
              Sign in
            </PrimaryButton>

            <Text style={styles.switchPrompt}>
              No account yet?{' '}
              <Text
                style={styles.link}
                onPress={() => navigation.navigate('Register')}
                suppressHighlighting
              >
                Create one
              </Text>
            </Text>

          </View>
        </ScreenContainer>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  flex: {
    flex: 1,
  },
  header: {
    gap: SPACING.sm,
    marginBottom: SPACING.xl,
  },
  brand: {
    color: COLORS.primary,
    fontWeight: '800',
  },
  tagline: {
    color: COLORS.textSecondary,
  },
  form: {
    gap: SPACING.md,
  },
  showPassword: {
    color: COLORS.primary,
    fontSize: FONT_SIZES.sm,
    paddingHorizontal: SPACING.md,
  },
  forgotPassword: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZES.sm,
    textAlign: 'right',
  },
  switchPrompt: {
    textAlign: 'center',
    color: COLORS.textSecondary,
    fontSize: FONT_SIZES.sm,
  },
  link: {
    color: COLORS.primary,
    fontWeight: '700',
  },
});
