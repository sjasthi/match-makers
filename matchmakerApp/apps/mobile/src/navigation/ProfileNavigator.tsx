import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { COLORS } from '@/constants';
import { ProfileScreen } from '@/screens/main/ProfileScreen';
import { EditProfileScreen } from '@/screens/profile/EditProfileScreen';
import { PreferencesScreen } from '@/screens/onboarding/PreferencesScreen';
import { SettingsScreen } from '@/screens/profile/SettingsScreen';
import { VerificationScreen } from '@/screens/profile/VerificationScreen';
import { ProfileDetailScreen } from '@/screens/profile/ProfileDetailScreen';
import type { ProfileStackParamList } from './types';

const Stack = createNativeStackNavigator<ProfileStackParamList>();

export function ProfileNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: COLORS.background },
        headerTitleStyle: { fontWeight: '700' },
        headerTintColor: COLORS.text,
        contentStyle: { backgroundColor: COLORS.background },
        headerBackTitleVisible: false,
      }}
    >
      <Stack.Screen
        name="ProfileHome"
        component={ProfileScreen}
        options={{ title: 'My profile' }}
      />
      <Stack.Screen
        name="EditProfile"
        component={EditProfileScreen}
        options={{ title: 'Edit profile' }}
      />
      <Stack.Screen
        name="Preferences"
        component={ProfilePreferencesScreen}
        options={{ title: 'Discovery preferences' }}
      />
      <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings' }} />
      <Stack.Screen
        name="Verification"
        component={VerificationScreen}
        options={{ title: 'Verification' }}
      />
      <Stack.Screen
        name="ProfileDetail"
        component={ProfileDetailScreen}
        options={{ title: 'Profile' }}
      />
    </Stack.Navigator>
  );
}

/** Preferences reuses the onboarding screen, so it needs a different exit. */
function ProfilePreferencesScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<ProfileStackParamList>>();
  return <PreferencesScreen onComplete={() => navigation.goBack()} />;
}
