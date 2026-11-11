import { useCallback, useEffect, useRef } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Text } from 'react-native-paper';
import { ScreenContainer, Avatar, EmptyState, LoadingState, ErrorBanner } from '@/components';
import { useMatches } from '@/hooks';
import { getAuthAdapter } from '@/services/auth';
import type { MatchSummary } from '@/services/matches';
import { REALTIME_POLL_INTERVAL_MS } from '@/services/realtime';
import { useRealtimeUpdates } from '@/hooks/useRealtime';
import { BORDER_RADIUS, COLORS, FONT_SIZES, SPACING } from '@/constants';
import type { RootStackParamList } from '@/navigation/types';

export function MatchesScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { matches, state, error, load } = useMatches();

  const onUpdate = useCallback(() => {
    void load({ refresh: true });
  }, [load]);
  const realtimeStatus = useRealtimeUpdates(onUpdate);
  const realtimeStatusRef = useRef(realtimeStatus);
  realtimeStatusRef.current = realtimeStatus;

  // A reconnect means the socket may have missed a non-durable Postgres event.
  useEffect(() => {
    if (realtimeStatus === 'open') void load({ refresh: true });
  }, [realtimeStatus, load]);

  // Refresh on focus and poll only while this screen is visible and the socket
  // is unavailable. The socket is an optimization, not the only delivery path.
  useFocusEffect(
    useCallback(() => {
      void load({ refresh: true });
      if (getAuthAdapter().mode === 'mock') return undefined;

      const timer = setInterval(() => {
        if (realtimeStatusRef.current !== 'open') void load({ refresh: true });
      }, REALTIME_POLL_INTERVAL_MS);
      return () => clearInterval(timer);
    }, [load])
  );

  const openChat = (match: MatchSummary) => {
    navigation.navigate('Chat', {
      screen: 'Chat',
      params: {
        matchId: match.id,
        title: match.user.name,
        avatarUri: match.user.photos[0]?.url ?? null,
      },
    });
  };

  if (state === 'loading' && matches.length === 0) {
    return <LoadingState label="Loading matches..." fullHeight />;
  }

  return (
    <ScreenContainer padded={false}>
      <View style={styles.header}>
        <Text variant="titleLarge" style={styles.title}>
          Matches
        </Text>
        <Text variant="bodySmall" style={styles.subtitle}>
          {matches.length === 0 ? 'Nobody yet' : `${matches.length} so far`}
        </Text>
      </View>

      <FlatList
        data={matches}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshing={state === 'refreshing'}
        onRefresh={() => void load({ refresh: true })}
        ListHeaderComponent={
          error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null
        }
        ListEmptyComponent={
          <EmptyState
            icon="💘"
            title="No matches yet"
            message="When you and someone else both swipe right, they show up here."
            actionLabel="Go to Discover"
            onAction={() => navigation.navigate('Main', { screen: 'Feed' })}
          />
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => openChat(item)}
            style={styles.row}
            accessibilityRole="button"
            accessibilityLabel={`Chat with ${item.user.name}`}
          >
            <Avatar
              user={item.user}
              url={item.user.photos[0]?.url}
              size={56}
              verified={item.user.isVerified}
            />
            <View style={styles.rowBody}>
              <Text variant="titleSmall" style={styles.rowTitle} numberOfLines={1}>
                {item.user.name}
              </Text>
              <Text variant="bodySmall" style={styles.rowPreview} numberOfLines={1}>
                {item.lastMessagePreview ?? 'You matched. Say hello.'}
              </Text>
            </View>
            {item.unreadCount > 0 ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{item.unreadCount}</Text>
              </View>
            ) : null}
          </Pressable>
        )}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.sm,
    gap: 2,
  },
  title: { fontWeight: '800' },
  subtitle: { color: COLORS.textSecondary, fontSize: FONT_SIZES.xs },
  list: {
    flexGrow: 1,
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  rowBody: { flex: 1, gap: 2 },
  rowTitle: { fontWeight: '700' },
  rowPreview: { color: COLORS.textSecondary },
  badge: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: BORDER_RADIUS.full,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: COLORS.background, fontSize: FONT_SIZES.xs, fontWeight: '700' },
});
