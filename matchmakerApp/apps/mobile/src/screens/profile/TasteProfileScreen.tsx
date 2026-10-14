import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { TasteSummary } from '@match-makers/shared';

import { EmptyState, ScreenContainer, TasteMatchGrid, signalFromClosest } from '@/components';
import { fetchTasteSummary } from '@/services/posts';
import { PHOTOS_FOR_FULL_TASTE, tasteProgress } from '@/utils/taste';
import { tagLabel } from '@/utils/interests';
import { BORDER_RADIUS, COLORS, FONT_SIZES, SPACING } from '@/constants';
import type { ProfileStackParamList } from '@/navigation/types';

type Nav = NativeStackNavigationProp<ProfileStackParamList, 'TasteProfile'>;

/**
 * What the matcher has actually worked out about you.
 *
 * This replaced the questionnaire panel, which listed the answers to questions
 * nobody was asked any more. It shows the same kind of thing — a profile the
 * matcher is working from — but the contents are now derived from the photos you
 * answered rather than typed into a form, which means it is a description of
 * behaviour instead of a transcription of claims.
 *
 * It is also the only screen that explains the score in full. The feed shows a
 * one-line tally and the deck shows a sentence per card; this is where somebody
 * goes to find out what is driving either.
 */
export function TasteProfileScreen() {
  const navigation = useNavigation<Nav>();
  const [summary, setSummary] = useState<TasteSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchTasteSummary()
      .then((result) => {
        if (!cancelled) setSummary(result);
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : 'Could not read your taste profile');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <ScreenContainer>
        <EmptyState icon="⚠️" title="Could not load this" message={error} />
      </ScreenContainer>
    );
  }

  if (!summary) {
    return (
      <ScreenContainer>
        <EmptyState
          icon="🖼️"
          title="Loading your taste profile..."
          message="Reading your photo answers."
        />
      </ScreenContainer>
    );
  }

  const answered = summary.likes + summary.dislikes;
  const progress = tasteProgress(answered);
  const leaning = summary.tags.filter((entry) => entry.score > 0);
  const against = summary.tags.filter((entry) => entry.score < 0);

  return (
    <ScreenContainer scroll contentStyle={styles.content}>
      <View style={styles.section}>
        <Text variant="labelLarge" style={styles.sectionTitle}>
          WHAT WE ARE MATCHING ON
        </Text>
        <Text variant="bodySmall" style={styles.body}>
          Nobody fills this in any more. It comes from the photos you answer, which is why it
          describes what you have actually done rather than what you said you want.
        </Text>
      </View>

      <View style={styles.section}>
        <Text variant="labelLarge" style={styles.sectionTitle}>
          HOW MUCH WE KNOW
        </Text>
        <Text
          variant="titleMedium"
          style={progress.provisional ? styles.countProvisional : styles.count}
          testID="taste-progress-count"
        >
          {answered} of {PHOTOS_FOR_FULL_TASTE} photos answered
        </Text>
        <Text variant="bodySmall" style={styles.body}>
          {progress.message}
        </Text>
      </View>

      <View style={styles.section}>
        <Text variant="labelLarge" style={styles.sectionTitle}>
          WHAT YOU LEAN TOWARDS
        </Text>
        {leaning.length === 0 ? (
          <Text variant="bodySmall" style={styles.body}>
            Nothing yet. Like a photo and the tags you have been drawn to will appear here.
          </Text>
        ) : (
          <View style={styles.tags}>
            {leaning.map((entry) => (
              <View key={entry.tag} style={styles.tagRow}>
                <Text style={styles.tagLabel}>{tagLabel(entry.tag)}</Text>
                <Meter
                  value={entry.score}
                  color={COLORS.success}
                  detail={`${entry.likes} liked, ${entry.dislikes} passed`}
                />
              </View>
            ))}
          </View>
        )}
      </View>

      {against.length > 0 ? (
        <View style={styles.section}>
          <Text variant="labelLarge" style={styles.sectionTitle}>
            WHAT YOU LEAN AWAY FROM
          </Text>
          <View style={styles.tags}>
            {against.map((entry) => (
              <View key={entry.tag} style={styles.tagRow}>
                <Text style={styles.tagLabel}>{tagLabel(entry.tag)}</Text>
                <Meter
                  value={Math.abs(entry.score)}
                  color={COLORS.error}
                  detail={`${entry.likes} liked, ${entry.dislikes} passed`}
                />
              </View>
            ))}
          </View>
        </View>
      ) : null}

      <View style={styles.section}>
        <Text variant="labelLarge" style={styles.sectionTitle}>
          WHO YOUR ANSWERS PULLED YOU TOWARDS
        </Text>

        {/*
          Two different empty states, because they are two different problems with
          two different fixes. "Nobody yet" tells somebody to answer more photos.
          That is wrong, and quietly accusatory, when the truth is that everyone
          they share photos with is outside filters they can widen. Blaming the
          person for a setting is the mistake the deck's own empty state was fixed
          for, and it does not get to be reintroduced here.
        */}
        {summary.closest.length === 0 ? (
          <Text variant="bodySmall" style={styles.body}>
            {summary.closestBlockedByFilters ? (
              <>
                Everyone you have photos in common with is outside your current
                discovery filters. Widen those and they will appear here.
              </>
            ) : (
              <>
                Nobody yet. This is where the people you have something in common
                with will show up, with the reason.
              </>
            )}
          </Text>
        ) : (
          <>
            <Text variant="bodySmall" style={styles.body}>
              People you have answered photos in common with, and who your
              preferences allow. The percentage is the same one the deck shows.
            </Text>
            <TasteMatchGrid
              closest={summary.closest}
              onOpen={(person) =>
                navigation.navigate('ProfileDetail', {
                  userId: person.userId,
                  taste: signalFromClosest(person),
                })
              }
            />
          </>
        )}
      </View>
    </ScreenContainer>
  );
}

/**
 * A bar for one tag's strength.
 *
 * A number alone would read as a claim of precision the maths does not support:
 * `0.857` means "six likes and no passes", not "85.7% sure". The count beside it
 * is the honest reading, and the bar is there to make ten tags scannable.
 */
function Meter({ value, color, detail }: { value: number; color: string; detail: string }) {
  const [trackWidth, setTrackWidth] = useState(0);

  return (
    <View style={styles.meter}>
      {/* Measured rather than given a percentage string: this React Native
          version's `DimensionValue` has no template-literal percentage, and a
          width that needs a cast is a width that will be wrong at some point. */}
      <View
        style={styles.meterTrack}
        onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
      >
        <View
          style={[
            styles.meterFill,
            {
              backgroundColor: color,
              width: Math.round(trackWidth * Math.min(1, Math.max(0, value))),
            },
          ]}
        />
      </View>
      <Text variant="labelSmall" style={styles.meterDetail}>
        {detail}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: SPACING.lg,
    paddingVertical: SPACING.lg,
    paddingBottom: SPACING.xxl,
  },
  section: { gap: SPACING.sm },
  sectionTitle: { color: COLORS.textMuted, letterSpacing: 0.8 },
  body: { color: COLORS.textSecondary },
  count: { fontWeight: '800', color: COLORS.text },
  countProvisional: { fontWeight: '800', color: COLORS.warning },
  tags: { gap: SPACING.md },
  tagRow: { gap: SPACING.xs },
  tagLabel: { fontWeight: '700' },
  meter: { gap: 2 },
  meterTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.surfaceVariant,
    overflow: 'hidden',
  },
  meterFill: { height: '100%', borderRadius: 3 },
  meterDetail: { color: COLORS.textMuted, fontSize: FONT_SIZES.xs },
  closest: { gap: SPACING.md },
  closestRow: {
    gap: 2,
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  closestHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  closestName: { fontWeight: '700' },
  affinity: { color: COLORS.primary, fontWeight: '700' },
});
