import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import type { TasteSummary as TasteSummaryData } from '@match-makers/shared';

import { BORDER_RADIUS, COLORS, FONT_SIZES, SPACING } from '@/constants';
import { tagLabel } from '@/utils/interests';

interface Props {
  summary: TasteSummaryData;
  expanded: boolean;
  onToggle: () => void;
}

/**
 * What the feed has worked out so far, and who it has worked it out about.
 *
 * This exists because the alternative is a grid of taps with no stated
 * consequence. The matching engine reads a reactions table nobody ever sees, and
 * a signal that is invisible is a signal nobody believes, so the feed has to
 * show its working: what it thinks you like, and which people that has moved.
 *
 * The `closest` lines are the part that earns the rest. "12 likes" on its own
 * could be anyone else's engagement number; naming Priya and saying why is what
 * makes the next tap worth making.
 *
 * Collapsed it is one line, because it sits above a grid and every row of height
 * is photos somebody could be looking at instead. Expanded it earns its space by
 * naming people. Open by default — the legibility argument only works if the
 * panel is actually visible.
 */
export function TasteSummary({ summary, expanded, onToggle }: Props) {
  const { likes, dislikes, tags, closest } = summary;
  const strongest = tags.filter((entry) => entry.score > 0).slice(0, 3);
  const untouched = likes === 0 && dislikes === 0;

  return (
    <View style={styles.panel} testID="taste-summary">
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={
          expanded ? 'Hide what we have learned' : 'Show what we have learned'
        }
        style={styles.headerRow}
        testID="taste-summary-toggle"
      >
        <Text variant="labelSmall" style={styles.heading}>
          {untouched ? 'WHAT THIS IS FOR' : 'WHAT WE HAVE LEARNED'}
        </Text>
        <Text variant="labelSmall" style={styles.chevron} testID="taste-summary-chevron">
          {expanded ? '⌃' : '⌄'}
        </Text>
      </Pressable>

      {untouched ? (
        <>
          <Text variant="bodySmall" style={styles.blank} numberOfLines={expanded ? undefined : 1}>
            {expanded
              ? 'Every photo you answer sharpens who we put in front of you. Nobody sees this feed but you.'
              : 'Answer some photos to tune who we show you'}
          </Text>
        </>
      ) : (
        <>
          <View style={styles.countRow}>
            <Text variant="labelSmall" style={styles.counts}>
              {likes} LIKED{dislikes > 0 ? ` · ${dislikes} PASSED` : ''}
            </Text>
          </View>

          {strongest.length > 0 ? (
            <View style={styles.tagRow}>
              {strongest.map((entry) => (
                <View key={entry.tag} style={styles.tag}>
                  <Text style={styles.tagText}>{tagLabel(entry.tag)}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {expanded && closest.length > 0 ? (
            <View style={styles.closest}>
              {closest.map((entry) => (
                <Text
                  key={entry.userId}
                  variant="bodySmall"
                  style={styles.closestLine}
                  numberOfLines={2}
                >
                  <Text variant="bodySmall" style={styles.closestName}>
                    {entry.name}
                  </Text>
                  {' — '}
                  {lowercaseFirst(entry.reason)}
                </Text>
              ))}
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}

/** The reasons are written as sentences; mid-panel they read better as clauses. */
function lowercaseFirst(sentence: string): string {
  return sentence.charAt(0).toLowerCase() + sentence.slice(1);
}

const styles = StyleSheet.create({
  panel: {
    gap: SPACING.xs,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  heading: {
    color: COLORS.textMuted,
    letterSpacing: 0.8,
    fontWeight: '700',
    flexShrink: 1,
  },
  chevron: {
    color: COLORS.textSecondary,
    fontWeight: '700',
  },
  counts: {
    color: COLORS.textMuted,
    letterSpacing: 0.4,
    fontWeight: '700',
  },
  countRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  blank: {
    color: COLORS.textSecondary,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.xs,
  },
  tag: {
    backgroundColor: COLORS.surfaceVariant,
    borderRadius: BORDER_RADIUS.full,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
  },
  tagText: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text,
    fontWeight: '600',
  },
  closest: {
    gap: 2,
    marginTop: SPACING.xs,
  },
  closestLine: {
    color: COLORS.textSecondary,
  },
  closestName: {
    color: COLORS.text,
    fontWeight: '700',
  },
});