import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { COLORS } from '@/constants';
import { useAuthStore } from '@/stores/authStore';
import { ProfileScreen } from '@/screens/main/ProfileScreen';
import { EditProfileScreen } from '@/screens/profile/EditProfileScreen';
import { PreferencesScreen } from '@/screens/profile/PreferencesScreen';
import { MatchProfileScreen } from '@/screens/profile/MatchProfileScreen';
import { SettingsScreen } from '@/screens/profile/SettingsScreen';
import { VerificationScreen } from '@/screens/profile/VerificationScreen';
import { ProfileDetailScreen } from '@/screens/profile/ProfileDetailScreen';
import { AdminUsersScreen } from '@/screens/admin/AdminUsersScreen';
import { AdminUserDetailScreen } from '@/screens/admin/AdminUserDetailScreen';
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
        component={PreferencesScreen}
        options={{ title: 'Discovery preferences' }}
      />
      <Stack.Screen
        name="MatchProfile"
        component={ProfileMatchScreen}
        options={{ title: 'Match profile' }}
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
      <Stack.Screen
        name="AdminUsers"
        component={AdminUsersScreen}
        options={{ title: 'All users' }}
      />
      <Stack.Screen
        name="AdminUserDetail"
        component={AdminUserDetailScreen}
        options={{ title: 'User record' }}
      />
    </Stack.Navigator>
  );
}

/** Reads the questionnaire off the signed-in user rather than fetching it. */
function ProfileMatchScreen() {
  const user = useAuthStore((store) => store.user);
  return <MatchProfileScreen questionnaire={user?.questionnaire} />;
}
