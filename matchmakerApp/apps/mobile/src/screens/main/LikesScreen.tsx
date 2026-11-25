import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
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
  PersonTile,
  personTileGridStyle,
  PhotoViewer,
} from '@/components';
import { useCurrentUser, useFeed } from '@/hooks';
import { usePhotoFeedStore } from '@/stores/photoFeedStore';
import { tasteProgress } from '@/utils/taste';
import { tasteSignalFrom } from '@/utils/matching';
import { BORDER_RADIUS, COLORS, FONT_SIZES, SPACING } from '@/constants';
import type { DeckCandidate } from '@/types';
import type { RootStackParamList, MainTabParamList } from '@/navigation/types';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';

/**
 * The deck, as a grid of people rather than a stack of cards.
 *
 * It was one full-screen card at a time, and that shape caused two separate
 * complaints. Being handed a single profile before answering anything read as
 * being told who to like, rather than being shown a choice. And one card at a
 * time hides the shape of the pool: a grid shows everybody the matcher is
 * offering at once, with the percentage on each, so the choice is visibly a
 * choice. Profiles without an 80% score stay out of the grid.
 *
 * Deciding is still one person at a time — tapping a tile opens them full
 * screen with the like/pass buttons — because that is the one thing the old
 * deck got right: you look properly at one person, then you decide.
 */
export function LikesScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const tabNavigation = useNavigation<BottomTabNavigationProp<MainTabParamList>>();
  const viewer = useCurrentUser();
  const {
    profiles,
    state,
    error,
    hasMore,
    blockedReason,
    needsTaste,
    lastMatch,
    load,
    loadMore,
    swipe,
    dismissMatch,
  } = useFeed();

  // Who is being decided on, or null when the grid is just the grid.
  const [deciding, setDeciding] = useState<DeckCandidate | null>(null);
  const [photoPreview, setPhotoPreview] = useState<{ uri: string; title: string } | null>(null);

  // Top up the deck before the user runs out of people to decide on.
  useEffect(() => {
    if (hasMore && profiles.length <= 3 && state !== 'loading') {
      void loadMore();
    }
  }, [hasMore, profiles.length, state, loadMore]);

  // How much of the taste signal exists yet, which is what decides whether the
  // percentage on a tile means anything.
  const summary = usePhotoFeedStore((store) => store.summary);
  const ensureSummary = usePhotoFeedStore((store) => store.ensureSummary);
  useEffect(() => {
    void ensureSummary();
  }, [ensureSummary]);
  const progress = tasteProgress(summary.likes + summary.dislikes);

  /**
   * Refresh the deck whenever it regains focus.
   *
   * The guard reads through a ref rather than closing over `state` and
   * `profiles`. `useFocusEffect` re-runs its effect whenever the callback
   * identity changes. Reading the state from the ref keeps the callback stable
   * while still letting a return from the photo admin screen pick up deleted
   * posts and their recalculated scores.
   */
  const queue = useRef({ state, profiles });
  queue.current = { state, profiles };

  useFocusEffect(
    useCallback(() => {
      const current = queue.current;
      if (current.state === 'loading' || current.state === 'refreshing') return;
      void load({ refresh: current.profiles.length > 0 });
    }, [load])
  );

  const decide = useCallback(
    (action: 'like' | 'pass' | 'super_like') => {
      if (!deciding) return;
      const { user } = deciding;
      setDeciding(null);
      void swipe(user.id, action).catch(() => {
        // The store records the failure; the banner below surfaces it.
      });
    },
    [deciding, swipe]
  );

  if (!viewer) {
    return <LoadingState label="Loading your profile..." fullHeight />;
  }

  const showInitialLoading = state === 'loading' && profiles.length === 0 && !needsTaste;
  if (showInitialLoading) {
    return <LoadingState label="Finding people for you..." fullHeight />;
  }

  const showEmptyState = state !== 'loading' && profiles.length === 0;

  return (
    <ScreenContainer padded={false}>
      <View style={styles.header}>
        <Text variant="titleLarge" style={styles.title}>
          Likes
        </Text>
        <Text variant="bodySmall" style={styles.subtitle}>
          {profiles.length > 0
            ? 'Tap somebody to look properly, then decide'
            : 'Your deck gathers here once there is something to rank it on'}
        </Text>
      </View>

      {/*
        The provisional-score strip. Only alongside a real deck: when the deck
        is empty the empty state below already says the same thing and links to
        the same place, and saying it twice is how a screen teaches somebody to
        stop reading it.
      */}
      {progress.provisional && profiles.length > 0 ? (
        <Pressable
          onPress={() => tabNavigation.navigate('Feed')}
          accessibilityRole="button"
          accessibilityLabel="Answer more photos to improve your matches"
          style={styles.progressStrip}
          testID="likes-building-up"
        >
          <Text variant="labelSmall" style={styles.progressLabel}>
            STILL BUILDING UP
          </Text>
          <Text variant="bodySmall" style={styles.progressText} numberOfLines={2}>
            {progress.message}
          </Text>
        </Pressable>
      ) : null}

      <View style={styles.body}>
        {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}

        {showEmptyState && needsTaste ? (
          /*
            Eligible profiles normally remain visible with "No score yet". This
            fallback is for a backend that reports no taste evidence but has no
            unscored eligible profiles to show.
          */
          <EmptyState
            icon="📷"
            title="Nothing to rank your matches on yet"
            message="Like a photo or two to build your taste score. Eligible profiles can still appear with no score yet."
            actionLabel="Go to the photos"
            onAction={() => tabNavigation.navigate('Feed')}
          />
        ) : showEmptyState ? (
          <>
            {blockedReason?.includes('No strong matches') ? (
              // Eligible profiles exist but none at 80%+
              <EmptyState
                icon="📷"
                title="No strong matches yet"
                message="Like more photos to find people you really click with. Strong matches (80%+) appear here."
                actionLabel="Go to the photos"
                onAction={() => tabNavigation.navigate('Feed')}
              />
            ) : (
              <>
                <Pressable
                  onPress={() => tabNavigation.navigate('Feed')}
                  accessibilityRole="button"
                  accessibilityLabel="Answer some photos to tune who we show you"
                  style={styles.tuneLink}
                  testID="likes-go-to-feed"
                >
                  <Text variant="bodySmall" style={styles.tuneLinkText}>
                    No luck here? Answer a few photos and we will reorder this deck.
                  </Text>
                </Pressable>
                <EmptyState
                  icon="🗺️"
                  title={
                    blockedReason ? 'Nobody fits your filters' : 'No profiles yet'
                  }
                  message={
                    blockedReason ??
                    'There is nobody else here yet. Check back soon, or share your profile with more people.'
                  }
                  actionLabel={blockedReason ? 'Adjust preferences' : 'Reload'}
                  onAction={() =>
                    blockedReason
                      ? navigation.navigate('Profile', { screen: 'Preferences' })
                      : void load({ refresh: true })
                  }
                />
              </>
            )}
          </>
        ) : (
          <ScrollView
            contentContainerStyle={[styles.grid, personTileGridStyle]}
            showsVerticalScrollIndicator={false}
          >
            {profiles.map((profile) => (
              <PersonTile
                key={profile.user.id}
                userId={profile.user.id}
                name={profile.user.name}
                score={profile.compatibility.score}
                reason={profile.compatibility.reason}
                band={profile.band}
                onPress={() => setDeciding(profile)}
                testPrefix="deck-card"
              />
            ))}
          </ScrollView>
        )}
      </View>

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

      {/*
        The decision view. A Modal rather than a route for the same reason the
        photo viewer is one: it is a mode of this screen, not a place, and a
        route would put a back button in the corner the close button lives in.

        The decision closes the modal immediately on any action, rather than
        advancing to the next person. Advancing was the stack's behaviour, where
        it kept you swiping; here you chose this person from a grid, and being
        bounced into deciding about somebody you did not choose is the deck
        deciding for you.
      */}
      <Modal
        visible={deciding !== null && photoPreview === null}
        animationType="slide"
        onRequestClose={() => setDeciding(null)}
        presentationStyle="fullScreen"
        testID="likes-decision"
      >
        {deciding ? (
          <View style={styles.decisionRoot}>
            <View style={styles.decisionChrome}>
              <Pressable
                onPress={() => setDeciding(null)}
                accessibilityRole="button"
                accessibilityLabel="Close and go back to the grid"
                hitSlop={12}
                style={styles.decisionClose}
                testID="likes-decision-close"
              >
                <Text style={styles.decisionCloseText}>✕</Text>
              </Pressable>
            </View>

            <View style={styles.decisionBody}>
              <View style={styles.decisionCard}>
                <SwipeCard
                  user={deciding.user}
                  viewer={viewer}
                  compatibility={deciding.compatibility}
                  band={deciding.band}
                  onLike={() => decide('like')}
                  onPass={() => decide('pass')}
                  onSuperLike={() => decide('super_like')}
                  onOpenPhoto={(uri) =>
                    setPhotoPreview({ uri, title: `${deciding.user.name}'s photo` })
                  }
                  onOpenDetail={() =>
                    navigation.navigate('Profile', {
                      screen: 'ProfileDetail',
                      params: {
                        userId: deciding.user.id,
                        user: deciding.user,
                        taste: tasteSignalFrom(deciding.compatibility),
                      },
                    })
                  }
                />
              </View>

              <View style={styles.actions}>
                <SwipeActions
                  onPass={() => decide('pass')}
                  onLike={() => decide('like')}
                  onSuperLike={() => decide('super_like')}
                />
              </View>
            </View>
          </View>
        ) : null}
      </Modal>

      <PhotoViewer
        uri={photoPreview?.uri ?? null}
        title={photoPreview?.title}
        onClose={() => setPhotoPreview(null)}
        testID="likes-profile-photo-viewer"
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  progressStrip: {
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.warning,
    backgroundColor: COLORS.surface,
    gap: 2,
  },
  progressLabel: {
    color: COLORS.warning,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  progressText: {
    color: COLORS.textSecondary,
  },
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
  },
  grid: {
    paddingBottom: SPACING.lg,
  },
  decisionRoot: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  decisionChrome: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.xl,
    paddingBottom: SPACING.sm,
  },
  decisionClose: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surface,
  },
  decisionCloseText: {
    color: COLORS.text,
    fontSize: FONT_SIZES.lg,
    fontWeight: '700',
  },
  decisionBody: {
    flex: 1,
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.lg,
  },
  decisionCard: {
    flex: 1,
  },
  actions: {
    paddingVertical: SPACING.md,
  },
  tuneLink: {
    alignSelf: 'center',
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
  },
  tuneLinkText: {
    color: COLORS.primary,
    fontWeight: '600',
    textAlign: 'center',
  },
});
