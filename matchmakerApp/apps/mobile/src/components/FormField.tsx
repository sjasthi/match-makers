import { forwardRef } from 'react';
import type { ReactNode } from 'react';
import { Controller, type ControllerProps, type FieldValues } from 'react-hook-form';
import { HelperText, TextInput, type TextInputProps } from 'react-native-paper';
import { COLORS } from '@/constants';

type FormFieldProps<T extends FieldValues> = Omit<
  TextInputProps,
  'name' | 'value' | 'onChange' | 'onBlur' | 'error'
> & {
  control: ControllerProps<T, T['name']>['control'];
  name: T['name'];
  label: string;
  hint?: string;
  serverError?: string;
};

function FormFieldInner<T extends FieldValues>(
  { control, name, label, serverError, ...inputProps }: FormFieldProps<T>,
  ref: React.ForwardedRef<unknown>
) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field: { onChange, onBlur, value }, fieldState: { error } }) => (
        <TextInput
          ref={ref as never}
          mode="outlined"
          label={label}
          value={(value as string) ?? ''}
          onChangeText={onChange}
          onBlur={onBlur}
          error={Boolean(error) || Boolean(serverError)}
          outlineColor={COLORS.border}
          style={{ backgroundColor: COLORS.background }}
          {...inputProps}
        />
      )}
    />
  );
}

/** react-hook-form bound text input that renders both client and server errors. */
export const FormField = forwardRef(FormFieldInner) as <T extends FieldValues>(
  props: FormFieldProps<T> & { ref?: React.ForwardedRef<unknown> }
) => ReactNode;

export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <HelperText type="error" visible padding="none">
      {message}
    </HelperText>
  );
}

export function FormHint({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <HelperText type="info" visible padding="none">
      {message}
    </HelperText>
  );
}
