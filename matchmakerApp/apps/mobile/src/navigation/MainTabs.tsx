import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { AppIcon, type IconName } from '@/components';
import { FeedScreen } from '@/screens/main/FeedScreen';
import { MatchesScreen } from '@/screens/main/MatchesScreen';
import { MessagesScreen } from '@/screens/main/MessagesScreen';
import { ProfileScreen } from '@/screens/main/ProfileScreen';
import { COLORS } from '@/constants';
import type { MainTabParamList } from './types';

const Tab = createBottomTabNavigator<MainTabParamList>();

const TAB_ICONS: Record<keyof MainTabParamList, IconName> = {
  Feed: 'cards-outline',
  Matches: 'heart-outline',
  Messages: 'message-text-outline',
  Profile: 'account-circle-outline',
};

export function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: COLORS.primary,
        tabBarInactiveTintColor: COLORS.textMuted,
        tabBarStyle: { borderTopColor: COLORS.border, backgroundColor: COLORS.background },
        tabBarIcon: ({ color, size }) => (
          <AppIcon name={TAB_ICONS[route.name]} size={size} color={color} />
        ),
      })}
    >
      <Tab.Screen name="Feed" component={FeedScreen} options={{ title: 'Discover' }} />
      <Tab.Screen name="Matches" component={MatchesScreen} />
      <Tab.Screen name="Messages" component={MessagesScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}
