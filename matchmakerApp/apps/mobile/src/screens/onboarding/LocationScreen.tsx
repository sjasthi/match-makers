import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text, TextInput } from 'react-native-paper';
import * as Location from 'expo-location';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ScreenContainer, PrimaryButton, ErrorBanner, AppIcon } from '@/components';
import { useAuthStore } from '@/stores/authStore';
import { updateProfile } from '@/services/profile';
import { AuthError } from '@/services/auth/AuthError';
import { COLORS, SPACING } from '@/constants';
import type { OnboardingStackParamList } from '@/navigation/types';

export function LocationScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<OnboardingStackParamList>>();
  const user = useAuthStore((store) => store.user);
  const setUser = useAuthStore((store) => store.setUser);

  const [city, setCity] = useState(user?.location.city ?? '');
  const [country, setCountry] = useState(user?.location.country ?? '');
  const [coordinates, setCoordinates] = useState({
    latitude: user?.location.latitude ?? 0,
    longitude: user?.location.longitude ?? 0,
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);

  const detectLocation = async () => {
    setError(null);
    setLocating(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        setError('Location permission was declined. Enter your city instead.');
        return;
      }

      const position = await Location.getCurrentPositionAsync({});
      setCoordinates({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      });

      const [place] = await Location.reverseGeocodeAsync({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      });
      if (place?.city) setCity(place.city);
      if (place?.country) setCountry(place.country);
    } catch {
      setError('Could not read your location. Enter your city instead.');
    } finally {
      setLocating(false);
    }
  };

  const onSave = async () => {
    setError(null);
    if (!city.trim() || !country.trim()) {
      setError('Enter both a city and a country.');
      return;
    }

    setSaving(true);
    try {
      const updated = await updateProfile({
        location: { ...coordinates, city: city.trim(), country: country.trim() },
      });
      setUser(updated);
      navigation.navigate('OnboardingDone');
    } catch (caught) {
      setError(AuthError.unknown(caught).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScreenContainer scroll>
      <View style={styles.header}>
        <Text variant="headlineSmall" style={styles.title}>
          Where are you?
        </Text>
        <Text variant="bodyMedium" style={styles.subtitle}>
          We use your city to show you people nearby.
        </Text>
      </View>

      <View style={styles.form}>
        <ErrorBanner message={error} onDismiss={() => setError(null)} />

        <TextInput
          mode="outlined"
          label="City"
          value={city}
          onChangeText={setCity}
          autoCapitalize="words"
          style={{ backgroundColor: COLORS.background }}
        />

        <TextInput
          mode="outlined"
          label="Country"
          value={country}
          onChangeText={setCountry}
          autoCapitalize="words"
          style={{ backgroundColor: COLORS.background }}
        />

        <Pressable onPress={detectLocation} style={styles.link} accessibilityRole="button">
          <AppIcon name="crosshairs-gps" size={16} color={COLORS.primary} />
          <Text style={styles.linkText}>Use my current location</Text>
        </Pressable>

        {locating ? <Text style={styles.locating}>Locating...</Text> : null}

        <PrimaryButton onPress={onSave} loading={saving} disabled={saving || locating} fullWidth>
          Finish setup
        </PrimaryButton>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: { gap: SPACING.xs, marginBottom: SPACING.lg },
  title: { fontWeight: '700' },
  subtitle: { color: COLORS.textSecondary },
  form: { gap: SPACING.md, paddingBottom: SPACING.xl },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingVertical: SPACING.sm,
  },
  linkText: { color: COLORS.primary, fontWeight: '700' },
  locating: { color: COLORS.textSecondary },
});
