import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Text } from 'react-native-paper';
import { emailSchema } from '@match-makers/shared';
import { ScreenContainer, PrimaryButton, FormField, ErrorBanner } from '@/components';
import { COLORS, SPACING } from '@/constants';

interface ForgotInput {
  email: string;
}

const schema = emailSchema.transform((value) => ({ email: value }));

export function ForgotPasswordScreen() {
  const [sent, setSent] = useState(false);

  const { control, handleSubmit, getValues, formState } = useForm<ForgotInput>({
    resolver: zodResolver(schema),
    defaultValues: { email: '' },
  });

  const onSubmit = handleSubmit(async () => {
    // No mail transport exists in the prototype. The real flow calls
    // POST /auth/forgot-password and always responds the same way, so the UI
    // cannot be used to discover which emails have accounts.
    setSent(true);
  });

  if (sent) {
    const email = getValues('email');
    return (
      <ScreenContainer>
        <View style={styles.sent}>
          <Text variant="headlineSmall" style={styles.title}>
            Check your inbox
          </Text>
          <Text variant="bodyMedium" style={styles.body}>
            If an account exists for {email}, a reset link is on its way. The link expires in 30
            minutes.
          </Text>
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer scroll>
      <View style={styles.header}>
        <Text variant="headlineSmall" style={styles.title}>
          Reset your password
        </Text>
        <Text variant="bodyMedium" style={styles.body}>
          Enter the email you signed up with and we will send a reset link.
        </Text>
      </View>

      <View style={styles.form}>
        <ErrorBanner message={formState.errors.root?.message} />

        <FormField
          control={control}
          name="email"
          label="Email"
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          textContentType="emailAddress"
        />

        <PrimaryButton onPress={onSubmit} fullWidth>
          Send reset link
        </PrimaryButton>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: SPACING.sm,
    marginBottom: SPACING.xl,
  },
  sent: {
    flex: 1,
    justifyContent: 'center',
    gap: SPACING.md,
  },
  title: {
    fontWeight: '700',
  },
  body: {
    color: COLORS.textSecondary,
  },
  form: {
    gap: SPACING.md,
  },
});
