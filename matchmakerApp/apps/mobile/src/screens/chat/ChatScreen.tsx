import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import type { RouteProp } from '@react-navigation/native';
import { useRoute } from '@react-navigation/native';
import { Text, TextInput } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Avatar, ErrorBanner, LoadingState, AppIcon } from '@/components';
import { fetchMessages, sendMessage, type ChatMessage } from '@/services/matches';
import { BORDER_RADIUS, COLORS, FONT_SIZES, SPACING } from '@/constants';
import type { ChatStackParamList } from '@/navigation/types';

type ChatRoute = RouteProp<ChatStackParamList, 'Chat'>;

function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function ChatScreen() {
  const route = useRoute<ChatRoute>();
  const { matchId } = route.params;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<FlatList<ChatMessage>>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setMessages(await fetchMessages(matchId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load messages');
    } finally {
      setLoading(false);
    }
  }, [matchId]);

  useEffect(() => {
    void load();
  }, [load]);

  const onSend = async () => {
    const content = draft.trim();
    if (!content || sending) return;

    setDraft('');
    setSending(true);
    setError(null);
    try {
      const sent = await sendMessage(matchId, content);
      setMessages((current) => [...current, sent]);
    } catch (caught) {
      // Put the text back so nothing is silently lost.
      setDraft(content);
      setError(caught instanceof Error ? caught.message : 'Message failed to send');
    } finally {
      setSending(false);
    }
  };

  if (loading) return <LoadingState label="Opening conversation..." fullHeight />;

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
      >
        {error ? (
          <View style={styles.bannerWrap}>
            <ErrorBanner
              message={error}
              onDismiss={() => setError(null)}
              onRetry={() => void load()}
            />
          </View>
        ) : null}

        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          ListEmptyComponent={<Text style={styles.empty}>Say hello to break the ice.</Text>}
          renderItem={({ item }) => (
            <View style={[styles.bubbleRow, item.isMine ? styles.mine : styles.theirs]}>
              {!item.isMine ? (
                <Avatar
                  user={{ id: matchId, name: route.params.title ?? 'Chat' }}
                  url={route.params.avatarUri}
                  size={28}
                />
              ) : null}
              <View style={[styles.bubble, item.isMine ? styles.myBubble : styles.theirBubble]}>
                <Text style={item.isMine ? styles.myText : styles.theirText}>{item.content}</Text>
                <Text style={[styles.clock, item.isMine ? styles.myClock : styles.theirClock]}>
                  {formatClock(item.sentAt)}
                </Text>
              </View>
            </View>
          )}
        />

        <View style={styles.inputRow}>
          <TextInput
            mode="flat"
            value={draft}
            onChangeText={setDraft}
            placeholder="Type a message"
            onSubmitEditing={() => void onSend()}
            style={styles.input}
            accessibilityLabel="Message"
            returnKeyType="send"
          />
          <Pressable
            onPress={() => void onSend()}
            style={[styles.send, (!draft.trim() || sending) && styles.sendDisabled]}
            accessibilityRole="button"
            accessibilityLabel="Send message"
            disabled={!draft.trim() || sending}
          >
            <AppIcon name="send" size={20} color={COLORS.background} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.background },
  flex: { flex: 1 },
  bannerWrap: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.sm },
  list: { padding: SPACING.lg, gap: SPACING.sm, flexGrow: 1, justifyContent: 'flex-end' },
  empty: { color: COLORS.textSecondary, textAlign: 'center', paddingVertical: SPACING.xl },
  bubbleRow: { flexDirection: 'row', alignItems: 'flex-end', gap: SPACING.sm, maxWidth: '80%' },
  mine: { alignSelf: 'flex-end' },
  theirs: { alignSelf: 'flex-start' },
  bubble: {
    borderRadius: BORDER_RADIUS.lg,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  myBubble: { backgroundColor: COLORS.primary, borderBottomRightRadius: BORDER_RADIUS.sm },
  theirBubble: { backgroundColor: COLORS.surfaceVariant, borderBottomLeftRadius: BORDER_RADIUS.sm },
  myText: { color: COLORS.background },
  theirText: { color: COLORS.text },
  clock: { fontSize: FONT_SIZES.xs, marginTop: 2, alignSelf: 'flex-end' },
  myClock: { color: 'rgba(255,255,255,0.75)' },
  theirClock: { color: COLORS.textMuted },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.sm,
  },
  input: {
    flex: 1,
    backgroundColor: COLORS.surfaceVariant,
    borderRadius: BORDER_RADIUS.full,
    paddingHorizontal: SPACING.md,
  },
  send: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendDisabled: { backgroundColor: COLORS.textMuted },
});
