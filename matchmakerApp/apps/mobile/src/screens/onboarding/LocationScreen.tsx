import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text, TextInput } from 'react-native-paper';
import * as Location from 'expo-location';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { Location as ProfileLocation, UserPreferences } from '@match-makers/shared';
import {
  ScreenContainer,
  PrimaryButton,
  ErrorBanner,
  AppIcon,
  DiscoveryPreferences,
  defaultPreferences,
} from '@/components';
import { useAuthStore } from '@/stores/authStore';
import { updateProfile } from '@/services/profile';
import { AuthError } from '@/services/auth/AuthError';
import { findCityCentroid } from '@/utils/cityCatalog';
import { hasCoordinates } from '@/utils/distance';
import { COLORS, SPACING } from '@/constants';
import type { OnboardingStackParamList } from '@/navigation/types';

/**
 * Whether we can place the two free-text fields on the map.
 *
 * Only true for cities in `cityCatalog`. Modest in what it reports, which is why
 * the screen says so out loud rather than pretending the lookup succeeded.
 */
function canLocate(typedCity: string, typedCountry: string): boolean {
  return findCityCentroid(typedCity.trim(), typedCountry.trim()) !== null;
}

/**
 * FP3 "Location": where you are, plus the age range and distance you want to
 * see.
 *
 * The range and distance controls used to live on a separate preferences step.
 * FP3 groups them with location, which also means the last question before
 * photos is about who you are open to meeting.
 *
 * A typed city is resolved to coordinates on save. That resolution is what makes
 * the distance filter work for anyone who declines to share their GPS position:
 * without it the profile sits at 0,0, which is roughly 10,000 km from everyone,
 * and is then correctly hidden from every nearby deck while looking complete.
 */
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
  const [preferences, setPreferences] = useState<UserPreferences>(
    user?.preferences ?? defaultPreferences()
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);
  // Recomputed on every keystroke so the note tracks what is currently typed.
  const approximate = city.trim().length > 0 && !canLocate(city, country);

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

  /**
   * Where this profile actually is.
   *
   * GPS wins when it was captured. Otherwise the typed city is looked up, which
   * gives a centroid rather than an address -- coarse on purpose, since nobody
   * consented to a precise one, and a few kilometres either way does not change
   * who is shown to them.
   *
   * An unrecognised city falls back to the `0, 0` placeholder rather than
   * blocking the save. `cityCatalog` is a hand-maintained table, so blocking on
   * a miss means anyone whose town is not on it cannot finish signing up at all,
   * which is worse than the alternative. At `0, 0` the eligibility rules treat
   * the viewer as global, so their own deck still loads and stays full; the cost
   * is that nearby viewers cannot see them, which is the honest state for a
   * location we do not know rather than a fabricated one.
   *
   * `precise` reports which of the two happened so the screen can say so.
   */
  const resolveLocation = (): { location: ProfileLocation; precise: boolean } => {
    const trimmedCity = city.trim();
    const trimmedCountry = country.trim();

    if (
      hasCoordinates({
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
        city: trimmedCity,
        country: trimmedCountry,
      })
    ) {
      return {
        location: {
          latitude: coordinates.latitude,
          longitude: coordinates.longitude,
          city: trimmedCity,
          country: trimmedCountry,
        },
        precise: true,
      };
    }

    const centroid = findCityCentroid(trimmedCity, trimmedCountry);
    if (!centroid) {
      return {
        location: { latitude: 0, longitude: 0, city: trimmedCity, country: trimmedCountry },
        precise: false,
      };
    }

    return {
      location: {
        latitude: centroid.latitude,
        longitude: centroid.longitude,
        city: trimmedCity,
        country: trimmedCountry,
      },
      precise: true,
    };
  };

  const onSave = async () => {
    setError(null);
    if (!city.trim() || !country.trim()) {
      setError('Enter both a city and a country.');
      return;
    }
    if (preferences.genders.length === 0) {
      setError('Pick at least one group to see.');
      return;
    }
    if (preferences.relationshipGoals.length === 0) {
      setError('Pick at least one relationship goal.');
      return;
    }

    const { location } = resolveLocation();

    setSaving(true);
    try {
      const updated = await updateProfile({ location, preferences });
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
          testID="location-city"
          style={{ backgroundColor: COLORS.background }}
        />

        <TextInput
          mode="outlined"
          label="Country"
          value={country}
          onChangeText={setCountry}
          autoCapitalize="words"
          testID="location-country"
          style={{ backgroundColor: COLORS.background }}
        />

        <Pressable onPress={detectLocation} style={styles.link} accessibilityRole="button">
          <AppIcon name="crosshairs-gps" size={16} color={COLORS.primary} />
          <Text style={styles.linkText}>Use my current location</Text>
        </Pressable>

        {locating ? <Text style={styles.locating}>Locating...</Text> : null}

        {/*
   Said out loud rather than silently accepted. Without this, typing a town the
   catalog has never heard of looks like it worked, and the only symptom is that
   the person never appears in anyone else's nearby deck.
 */}
        {approximate ? (
          <Text variant="bodySmall" style={styles.approximate}>
            We do not know where {city.trim()} is yet, so nearby distance will be skipped for you.
            Your own deck still works.
          </Text>
        ) : null}

        <DiscoveryPreferences
          preferences={preferences}
          onChange={setPreferences}
          goalHelperText="Compared against everyone else's goal to produce a match score."
        />

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
  form: { gap: SPACING.lg, paddingBottom: SPACING.xl },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingVertical: SPACING.sm,
  },
  linkText: { color: COLORS.primary, fontWeight: '700' },
  locating: { color: COLORS.textSecondary },
  approximate: { color: COLORS.textSecondary },
});
