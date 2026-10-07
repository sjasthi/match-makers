import { useCallback, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Text } from 'react-native-paper';
import {
  ScreenContainer,
  SwipeCard,
  SwipeActions,
  MatchCelebration,
  EmptyState,
  LoadingState,
  ErrorBanner,
} from '@/components';
import { useCurrentUser, useFeed } from '@/hooks';
import { MatchSetup } from '@/screens/prompts/MatchSetup';
import { hasCompleteQuestionnaire } from '@/services/profile';
import { COLORS, FONT_SIZES, SPACING } from '@/constants';
import type { RootStackParamList } from '@/navigation/types';

export function FeedScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const viewer = useCurrentUser();
  // Nobody is matched until the questionnaire is answered. Showing a deck with
  // percentages on it before then implies a match we have no basis for, and
  // scoring would be reading an empty questionnaire.
  const isMatchable = hasCompleteQuestionnaire(viewer);
  const {
    profiles,
    current,
    state,
    error,
    hasMore,
    blockedReason,
    lastMatch,
    load,
    loadMore,
    swipe,
    dismissMatch,
  } = useFeed();

  // Top up the deck before the user runs out of cards to swipe.
  useEffect(() => {
    if (!isMatchable) return;
    if (hasMore && profiles.length <= 3 && state !== 'loading') {
      void loadMore();
    }
  }, [isMatchable, hasMore, profiles.length, state, loadMore]);

  useEffect(() => {
    if (isMatchable) void load();
  }, [isMatchable, load]);

  // Keep the queue warm when returning from another tab.
  useFocusEffect(
    useCallback(() => {
      if (state === 'success' && profiles.length === 0) {
        void load({ refresh: true });
      }
    }, [state, profiles.length, load])
  );

  const onSwipe = useCallback(
    (action: 'like' | 'pass' | 'super_like') => {
      void swipe(action).catch(() => {
        // The store records the failure; the banner below surfaces it.
      });
    },
    [swipe]
  );

  if (!viewer) {
    return <LoadingState label="Loading your profile..." fullHeight />;
  }

  const showInitialLoading = state === 'loading' && profiles.length === 0;
  if (showInitialLoading) {
    return <LoadingState label="Finding people for you..." fullHeight />;
  }

  const showEmptyState = state !== 'loading' && profiles.length === 0;
  // Named from the server/mock response rather than guessed here. The old copy
  // told people to widen their distance unconditionally, which was advice about
  // a setting that was collected, displayed and never actually applied.
  const emptyTitle = blockedReason ? 'Nobody fits your filters' : 'No profiles yet';
  const emptyMessage =
    blockedReason ??
    'There is nobody else here yet. Check back soon, or share your profile with more people.';

  return (
    <ScreenContainer padded={false}>
      <View style={styles.header}>
        <Text variant="titleLarge" style={styles.title}>
          Discover
        </Text>
        <Text variant="bodySmall" style={styles.subtitle}>
          {hasMore ? 'Swipe right to like, left to pass' : 'You are all caught up'}
        </Text>
      </View>

      {/*
        The questionnaire session lives here rather than on its own route, so
        answering a step advances without a navigation round trip and there is
        no "go back, open prompts again" loop.
      */}
      {!isMatchable ? (
        <View style={styles.body}>
          <MatchSetup onComplete={() => void load({ refresh: true })} />
        </View>
      ) : null}

      {isMatchable ? (
        <View style={styles.body}>
          {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}

          {showEmptyState ? (
            <EmptyState
              icon="🗺️"
              title={emptyTitle}
              message={emptyMessage}
              actionLabel={blockedReason ? 'Adjust preferences' : 'Reload'}
              onAction={() =>
                blockedReason
                  ? navigation.navigate('Profile', { screen: 'Preferences' })
                  : void load({ refresh: true })
              }
            />
          ) : current ? (
            <View style={styles.deck}>
              {/* Render the next card underneath so the deck feels physical. */}
              {profiles[1] ? (
                <View style={styles.nextCard} pointerEvents="none">
                  <SwipeCard
                    user={profiles[1]}
                    viewer={viewer}
                    onLike={() => undefined}
                    onPass={() => undefined}
                    onSuperLike={() => undefined}
                    enabled={false}
                  />
                </View>
              ) : null}

              <SwipeCard
                user={current}
                viewer={viewer}
                onLike={() => onSwipe('like')}
                onPass={() => onSwipe('pass')}
                onSuperLike={() => onSwipe('super_like')}
                onOpenDetail={() =>
                  navigation.navigate('Profile', {
                    screen: 'ProfileDetail',
                    params: { userId: current.id, user: current },
                  })
                }
              />
            </View>
          ) : null}
        </View>
      ) : null}

      {isMatchable && current ? (
        <View style={styles.actions}>
          <SwipeActions
            onPass={() => onSwipe('pass')}
            onLike={() => onSwipe('like')}
            onSuperLike={() => onSwipe('super_like')}
          />
        </View>
      ) : null}

      {lastMatch?.isMatch && lastMatch.matchedUser ? (
        <MatchCelebration
          user={lastMatch.matchedUser}
          viewer={viewer}
          onPress={() => {
            const { matchId, matchedUser } = lastMatch;
            dismissMatch();
            if (matchId) {
              navigation.navigate('Chat', {
                screen: 'Chat',
                params: {
                  matchId,
                  title: matchedUser?.name,
                  avatarUri: matchedUser?.photos[0]?.url ?? null,
                },
              });
            }
          }}
        />
      ) : null}
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
  body: {
    flex: 1,
    paddingHorizontal: SPACING.lg,
    justifyContent: 'center',
  },
  deck: {
    flex: 1,
    marginVertical: SPACING.sm,
  },
  nextCard: {
    ...StyleSheet.absoluteFillObject,
    transform: [{ scale: 0.95 }, { translateY: 12 }],
  },
  actions: {
    paddingVertical: SPACING.md,
  },
});
