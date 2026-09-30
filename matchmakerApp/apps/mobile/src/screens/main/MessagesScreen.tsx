import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Text, TextInput } from 'react-native-paper';
import { ScreenContainer, Avatar, EmptyState, LoadingState, ErrorBanner } from '@/components';
import { useMatches } from '@/hooks';
import { markConversationRead } from '@/services/matches';
import { useDebouncedValue } from '@/hooks/useAsync';
import { BORDER_RADIUS, COLORS, FONT_SIZES, SPACING } from '@/constants';
import type { RootStackParamList } from '@/navigation/types';

function formatTime(iso: string): string {
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function MessagesScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { matches, state, error, load } = useMatches();
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query);

  useEffect(() => {
    void load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      void load({ refresh: true });
    }, [load])
  );

  const openChat = useCallback(
    async (matchId: string, name: string, avatarUri: string | null) => {
      await markConversationRead(matchId).catch(() => undefined);
      navigation.navigate('Chat', {
        screen: 'Chat',
        params: { matchId, title: name, avatarUri },
      });
    },
    [navigation]
  );

  const filtered = matches.filter((match) =>
    match.user.name.toLowerCase().includes(debouncedQuery.trim().toLowerCase())
  );

  if (state === 'loading' && matches.length === 0) {
    return <LoadingState label="Loading conversations..." fullHeight />;
  }

  return (
    <ScreenContainer padded={false}>
      <View style={styles.header}>
        <Text variant="titleLarge" style={styles.title}>
          Messages
        </Text>
        {matches.length > 0 ? (
          <TextInput
            mode="outlined"
            dense
            placeholder="Search conversations"
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Search conversations"
            style={{ backgroundColor: COLORS.background }}
          />
        ) : null}
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshing={state === 'refreshing'}
        onRefresh={() => void load({ refresh: true })}
        ListHeaderComponent={
          error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null
        }
        ListEmptyComponent={
          <EmptyState
            icon="💬"
            title="No conversations"
            message={
              matches.length === 0
                ? 'Match with someone first, then the chat opens up here.'
                : 'Nobody matches that search.'
            }
          />
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => void openChat(item.id, item.user.name, item.user.photos[0]?.url ?? null)}
            style={styles.row}
            accessibilityRole="button"
            accessibilityLabel={`Open chat with ${item.user.name}`}
          >
            <Avatar
              user={item.user}
              url={item.user.photos[0]?.url}
              size={52}
              verified={item.user.isVerified}
            />
            <View style={styles.rowBody}>
              <View style={styles.rowTop}>
                <Text variant="titleSmall" style={styles.rowTitle} numberOfLines={1}>
                  {item.user.name}
                </Text>
                <Text variant="bodySmall" style={styles.timestamp}>
                  {formatTime(item.lastMessageAt ?? item.createdAt)}
                </Text>
              </View>
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
    gap: SPACING.sm,
  },
  title: { fontWeight: '800' },
  list: { flexGrow: 1, paddingHorizontal: SPACING.lg, paddingBottom: SPACING.lg },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  rowBody: { flex: 1, gap: 2 },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowTitle: { fontWeight: '700', flexShrink: 1 },
  rowPreview: { color: COLORS.textSecondary },
  timestamp: { color: COLORS.textMuted, fontSize: FONT_SIZES.xs },
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
