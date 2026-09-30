import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { COLORS } from '@/constants';
import { ChatScreen } from '@/screens/chat/ChatScreen';
import type { ChatStackParamList } from './types';

const Stack = createNativeStackNavigator<ChatStackParamList>();

export function ChatNavigator() {
  return (
    <Stack.Navigator
      screenOptions={({ route }) => ({
        headerStyle: { backgroundColor: COLORS.background },
        headerTitleStyle: { fontWeight: '700' },
        headerTintColor: COLORS.text,
        contentStyle: { backgroundColor: COLORS.background },
        headerBackTitleVisible: false,
        title: route.params.title ?? 'Chat',
      })}
    >
      <Stack.Screen name="Chat" component={ChatScreen} />
    </Stack.Navigator>
  );
}
