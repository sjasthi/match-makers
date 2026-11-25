import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useWindowDimensions } from 'react-native';
import { AppIcon, type IconName } from '@/components';
import { PhotoFeedScreen } from '@/screens/main/PhotoFeedScreen';
import { LikesScreen } from '@/screens/main/LikesScreen';
import { MatchesScreen } from '@/screens/main/MatchesScreen';
import { MessagesScreen } from '@/screens/main/MessagesScreen';
import { ProfileScreen } from '@/screens/main/ProfileScreen';
import { COLORS } from '@/constants';
import type { MainTabParamList } from './types';

const Tab = createBottomTabNavigator<MainTabParamList>();
const TAB_BAR_LABEL_BREAKPOINT = 480;

const TAB_LABELS: Record<keyof MainTabParamList, string> = {
  Feed: 'Photos',
  Likes: 'Likes',
  Matches: 'Matches',
  Messages: 'Messages',
  Profile: 'Profile',
};

/**
 * The first two icons are deliberately distinct shapes rather than two hearts.
 * "Feed" is content and "Likes" is people, and a user who has just liked a photo
 * needs to be able to tell at a glance that they have not also liked a person.
 */
const TAB_ICONS: Record<keyof MainTabParamList, IconName> = {
  Feed: 'image-multiple-outline',
  Likes: 'cards-outline',
  Matches: 'heart-outline',
  Messages: 'message-text-outline',
  Profile: 'account-circle-outline',
};

export function MainTabs() {
  const { width } = useWindowDimensions();

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: COLORS.primary,
        tabBarInactiveTintColor: COLORS.textMuted,
        tabBarStyle: { borderTopColor: COLORS.border, backgroundColor: COLORS.background },
        tabBarShowLabel: width >= TAB_BAR_LABEL_BREAKPOINT,
        tabBarAccessibilityLabel: TAB_LABELS[route.name],
        tabBarIcon: ({ color, size }) => (
          <AppIcon name={TAB_ICONS[route.name]} size={size} color={color} />
        ),
      })}
    >
      <Tab.Screen name="Feed" component={PhotoFeedScreen} options={{ title: 'Photos' }} />
      <Tab.Screen name="Likes" component={LikesScreen} options={{ title: 'Likes' }} />
      <Tab.Screen name="Matches" component={MatchesScreen} />
      <Tab.Screen name="Messages" component={MessagesScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}
