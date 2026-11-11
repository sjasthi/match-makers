import React, { type ComponentType } from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { RealtimeNotification, RealtimeStatus } from '@/services/realtime';
import { MatchesScreen } from './MatchesScreen';
import { MessagesScreen } from './MessagesScreen';

const mockLoad = jest.fn();
let mockRealtimeStatus: RealtimeStatus = 'closed';
let mockAuthMode: 'mock' | 'jwt' = 'jwt';
let mockOnUpdate: ((event: RealtimeNotification) => void) | null = null;
let mockSetRealtimeStatus: ((status: RealtimeStatus) => void) | null = null;

jest.mock('@/hooks', () => ({
  useMatches: () => ({
    matches: [],
    state: 'success',
    error: null,
    load: mockLoad,
  }),
}));

jest.mock('@/hooks/useRealtime', () => ({
  useRealtimeUpdates: (onUpdate: (event: RealtimeNotification) => void) => {
    const ReactModule = jest.requireActual('react') as typeof React;
    const [status, setStatus] = ReactModule.useState(mockRealtimeStatus);
    mockOnUpdate = onUpdate;
    mockSetRealtimeStatus = setStatus;
    return status;
  },
}));

jest.mock('@/services/auth', () => ({
  getAuthAdapter: () => ({ mode: mockAuthMode }),
}));

const Stack = createNativeStackNavigator<{ Realtime: undefined }>();

function renderScreen(Screen: ComponentType<Record<string, never>>) {
  return render(
    <NavigationContainer>
      <Stack.Navigator>
        <Stack.Screen name="Realtime" component={Screen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

beforeEach(() => {
  mockLoad.mockReset();
  mockRealtimeStatus = 'closed';
  mockAuthMode = 'jwt';
  mockOnUpdate = null;
  mockSetRealtimeStatus = null;
});

afterEach(() => {
  cleanup();
});

describe.each([
  ['MatchesScreen', MatchesScreen],
  ['MessagesScreen', MessagesScreen],
] as const)('%s', (_name, Screen) => {
  it('refetches after a match or message invalidation', async () => {
    renderScreen(Screen);
    await waitFor(() => expect(mockLoad).toHaveBeenCalled());
    mockLoad.mockClear();

    act(() => {
      mockOnUpdate?.({ type: 'match_created', matchId: 'match-1' });
    });
    expect(mockLoad).toHaveBeenCalledWith({ refresh: true });

    mockLoad.mockClear();
    act(() => {
      mockOnUpdate?.({
        type: 'message',
        matchId: 'match-1',
        senderId: 'user-2',
        messageId: 'message-1',
      });
    });
    expect(mockLoad).toHaveBeenCalledWith({ refresh: true });
  });

  it('refetches when the websocket reconnects', async () => {
    renderScreen(Screen);
    await waitFor(() => expect(mockLoad).toHaveBeenCalled());
    mockLoad.mockClear();

    act(() => mockSetRealtimeStatus?.('open'));

    await waitFor(() => expect(mockLoad).toHaveBeenCalledWith({ refresh: true }));
  });
});
