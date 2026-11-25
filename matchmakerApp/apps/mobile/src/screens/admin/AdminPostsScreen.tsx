import { useState } from 'react';
import { FlatList, Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Chip, FAB, Text } from 'react-native-paper';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ScreenContainer, LoadingState, EmptyState, ErrorBanner, TagInput } from '@/components';
import { useAsync } from '@/hooks/useAsync';
import {
  AdminImportError,
  deletePost,
  listAllTags,
  listPosts,
  updatePostTags,
  type AdminPostSummary,
} from '@/services/admin';
import { postColor, tagColor, tagGlyph, tagLabel } from '@/utils/interests';
import { BORDER_RADIUS, COLORS, FONT_SIZES, SPACING } from '@/constants';
import type { ProfileStackParamList } from '@/navigation/types';

type Nav = NativeStackNavigationProp<ProfileStackParamList, 'AdminPosts'>;

const THUMB = 72;

/**
 * The site-owned photo library.
 *
 * This is where the feed is actually curated. Posts belong to the platform, not
 * to a profile, so unlike the rest of the app there is nothing to log in as to
 * get here: an admin picks pictures from their own device and tags them.
 *
 * The reaction counts are the point of the list. A photo with thirty likes is
 * pulling real pairs together and one with none is doing nothing, and being able
 * to see that is the only feedback available while the tag vocabulary is still
 * being worked out.
 *
 * One column, not a grid. A grid reads better for browsing photographs, but the
 * row expands in place to hold the tag editor, and a half-width chip picker is
 * not a usable one.
 */
export function AdminPostsScreen() {
  const navigation = useNavigation<Nav>();
  // The tag the library is narrowed to, or undefined for all of them.
  const [tag, setTag] = useState<string | undefined>();

  const { data, error, isLoading, refetch } = useAsync<AdminPostSummary[]>(
    () => listPosts(tag),
    [tag]
  );

  // The filter strip. A failure here costs the filter, not the library, so it is
  // not surfaced as an error on the screen.
  const { data: knownTags } = useAsync<Array<{ tag: string; count: number }>>(listAllTags, []);

  useFocusEffect(refetch);

  return (
    <ScreenContainer padded={false}>
      <FlatList
        testID="admin-posts-list"
        data={data ?? []}
        keyExtractor={(entry) => entry.post.id}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text variant="bodySmall" style={styles.hint}>
              Site-owned content. Every photo here belongs to the app, not to a profile.
            </Text>
            {error ? <ErrorBanner message={error} onDismiss={refetch} /> : null}
            {knownTags && knownTags.length > 0 ? (
              <TagFilter tags={knownTags} selected={tag} onSelect={setTag} />
            ) : null}
            {data ? (
              <Text variant="labelLarge" style={styles.count}>
                {data.length} {data.length === 1 ? 'PHOTO' : 'PHOTOS'}
                {tag ? ` TAGGED ${tagLabel(tag).toUpperCase()}` : ''}
              </Text>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          isLoading ? (
            <LoadingState label="Reading the library..." />
          ) : tag ? (
            <EmptyState
              icon="🔍"
              title={`Nothing tagged ${tagLabel(tag)}`}
              message="No photo in the library carries that tag."
              actionLabel="Show every photo"
              onAction={() => setTag(undefined)}
            />
          ) : (
            <EmptyState
              icon="🖼️"
              title="The library is empty"
              message="No photos have been added to the library yet."
              actionLabel="Import photos"
              onAction={() => navigation.navigate('AdminPostImport')}
            />
          )
        }
        renderItem={({ item }) => <PostRow entry={item} onChanged={refetch} />}
      />

      <FAB
        icon="plus"
        label="Import"
        style={styles.fab}
        onPress={() => navigation.navigate('AdminPostImport')}
        accessibilityLabel="Import photos into the library"
        testID="admin-import-fab"
      />
    </ScreenContainer>
  );
}

/**
 * The tag filter strip.
 *
 * A horizontal scroll rather than a wrapping group, because the library's tag
 * vocabulary grows with the library and a wrapping group of forty chips pushes
 * the photos it is meant to filter off the bottom of the screen.
 *
 * The counts are on the chips because "beach" with four photos and "travel" with
 * one are different amounts of information, and picking a tag that leads to a
 * single photo is a waste of a tap if the number was visible first.
 */
function TagFilter({
  tags,
  selected,
  onSelect,
}: {
  tags: Array<{ tag: string; count: number }>;
  selected?: string;
  onSelect: (tag: string | undefined) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.filterRow}
      testID="admin-posts-tag-filter"
    >
      <Chip
        selected={selected === undefined}
        onPress={() => onSelect(undefined)}
        showSelectedCheck={false}
        style={[styles.filterChip, selected === undefined && styles.filterChipSelected]}
        textStyle={[styles.filterChipText, selected === undefined && styles.filterChipTextSelected]}
        accessibilityLabel="Show every photo"
        accessibilityState={{ selected: selected === undefined }}
      >
        All
      </Chip>

      {tags.map((entry) => {
        const isSelected = selected === entry.tag;
        return (
          <Chip
            key={entry.tag}
            selected={isSelected}
            onPress={() => onSelect(isSelected ? undefined : entry.tag)}
            showSelectedCheck={false}
            style={[styles.filterChip, isSelected && styles.filterChipSelected]}
            textStyle={[styles.filterChipText, isSelected && styles.filterChipTextSelected]}
            accessibilityLabel={`Show the ${entry.count} photos tagged ${entry.tag}`}
            accessibilityState={{ selected: isSelected }}
            testID={`admin-posts-filter-${entry.tag}`}
          >
            {tagLabel(entry.tag)} {entry.count}
          </Chip>
        );
      })}
    </ScrollView>
  );
}

function PostRow({ entry, onChanged }: { entry: AdminPostSummary; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const { post, likes, dislikes } = entry;
  const primary = post.tags[0];

  const remove = async () => {
    setBusy(true);
    try {
      await deletePost(post.id);
      setEditing(false);
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.row}>
      <Pressable
        onPress={() => setEditing((open) => !open)}
        accessibilityRole="button"
        accessibilityLabel={
          primary ? `Edit tags on this ${tagLabel(primary)} photo` : 'Edit tags on this photo'
        }
        testID={`admin-post-${post.id}`}
        style={styles.rowMain}
      >
        {post.thumbUri || post.imageUri ? (
          // The same grid copy the feed uses, for the same reason: this is a
          // forty-point thumbnail and decoding the full image for it is waste.
          <Image
            source={{ uri: post.thumbUri || post.imageUri }}
            style={styles.thumb}
            resizeMode="cover"
          />
        ) : (
          <View style={[styles.thumb, { backgroundColor: postColor(post.tags) }]}>
            <Text style={styles.thumbGlyph}>{primary ? tagGlyph(primary) : '📷'}</Text>
          </View>
        )}

        <View style={styles.rowText}>
          <View style={styles.tagRow}>
            {post.tags.map((tag, index) => (
              <View
                key={tag}
                style={[styles.tag, index === 0 && { backgroundColor: tagColor(tag) }]}
              >
                <Text
                  variant="labelSmall"
                  style={index === 0 ? styles.tagTextPrimary : styles.tagText}
                >
                  {tagLabel(tag)}
                </Text>
              </View>
            ))}
          </View>
          <Text variant="bodySmall" style={styles.counts}>
            ♥ {likes} liked · ✕ {dislikes} passed
          </Text>
          <Text variant="bodySmall" style={styles.hint}>
            {editing ? 'Editing tags' : 'Tap to retag'}
          </Text>
        </View>
      </Pressable>

      {editing ? (
        <TagEditor
          postId={post.id}
          initial={post.tags}
          busy={busy}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            onChanged();
          }}
          onDeleted={remove}
        />
      ) : null}
    </View>
  );
}

/**
 * Retagging and deleting one post.
 *
 * Inline rather than a separate route because a tag is one tap and a screen
 * transition per correction would make curating a batch tedious. The first tag
 * is the primary one and is numbered as such, since that is the tag a co-like
 * gets attributed to in the match reason.
 */
function TagEditor({
  postId,
  initial,
  busy,
  onClose,
  onSaved,
  onDeleted,
}: {
  postId: string;
  initial: string[];
  busy: boolean;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => Promise<void>;
}) {
  const [tags, setTags] = useState<string[]>(initial);
  const [error, setError] = useState<string | null>(null);

  // Suggestions only. A failure here costs convenience, not capability, so it is
  // not surfaced as an error on the editor itself.
  const { data: knownTags } = useAsync<Array<{ tag: string; count: number }>>(listAllTags, []);

  const save = async () => {
    setError(null);
    try {
      await updatePostTags(postId, tags);
      onSaved();
    } catch (caught) {
      setError(
        caught instanceof AdminImportError ? caught.message : 'Those tags could not be saved.'
      );
    }
  };

  return (
    <View style={styles.editor}>
      <Text variant="bodySmall" style={styles.hint}>
        The first tag is the primary one. It is what a co-like is attributed to in the match reason.
      </Text>

      <TagInput
        tags={tags}
        onChange={setTags}
        suggestions={knownTags ?? []}
        testID="admin-edit-tag-input"
      />

      {error ? (
        <Text variant="bodySmall" style={styles.error} testID="admin-tag-error">
          {error}
        </Text>
      ) : null}

      <View style={styles.editorActions}>
        <Pressable onPress={onClose} accessibilityRole="button" style={styles.linkButton}>
          <Text variant="labelLarge" style={styles.mutedText}>
            Cancel
          </Text>
        </Pressable>

        <Pressable
          onPress={() => void onDeleted()}
          disabled={busy}
          accessibilityRole="button"
          style={styles.linkButton}
          testID={`admin-delete-${postId}`}
        >
          <Text variant="labelLarge" style={styles.dangerText}>
            Delete
          </Text>
        </Pressable>

        <Pressable
          onPress={() => void save()}
          disabled={busy}
          accessibilityRole="button"
          style={styles.saveButton}
          testID={`admin-save-${postId}`}
        >
          {busy ? (
            <ActivityIndicator size="small" color={COLORS.background} />
          ) : (
            <Text variant="labelLarge" style={styles.saveText}>
              Save
            </Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  filterRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
    paddingVertical: SPACING.xs,
  },
  filterChip: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  filterChipSelected: {
    backgroundColor: 'rgba(255,107,107,0.12)',
    borderColor: COLORS.primary,
  },
  filterChipText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textSecondary,
  },
  filterChipTextSelected: {
    color: COLORS.primary,
    fontWeight: '700',
  },
  content: { paddingBottom: SPACING.xxl },
  header: { padding: SPACING.lg, gap: SPACING.sm },
  hint: { color: COLORS.textSecondary, fontSize: FONT_SIZES.sm },
  count: { color: COLORS.textMuted, letterSpacing: 0.8 },
  row: {
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingHorizontal: SPACING.lg,
  },
  rowMain: {
    flexDirection: 'row',
    gap: SPACING.md,
    paddingVertical: SPACING.md,
  },
  thumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: COLORS.surfaceVariant,
  },
  thumbGlyph: { fontSize: 34, textAlign: 'center', lineHeight: THUMB },
  rowText: { flex: 1, gap: 2, justifyContent: 'center' },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs },
  tag: {
    borderRadius: BORDER_RADIUS.full,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 1,
    backgroundColor: COLORS.surfaceVariant,
  },
  tagText: { color: COLORS.textSecondary, fontSize: FONT_SIZES.xs },
  tagTextPrimary: { color: COLORS.background, fontWeight: '700', fontSize: FONT_SIZES.xs },
  counts: { color: COLORS.textMuted },
  editor: {
    gap: SPACING.sm,
    paddingBottom: SPACING.lg,
  },
  error: { color: COLORS.error },
  editorActions: { flexDirection: 'row', alignItems: 'center', gap: SPACING.lg },
  linkButton: { paddingVertical: SPACING.xs },
  mutedText: { color: COLORS.textSecondary },
  dangerText: { color: COLORS.error, fontWeight: '700' },
  saveButton: {
    marginLeft: 'auto',
    backgroundColor: COLORS.primary,
    borderRadius: BORDER_RADIUS.full,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.xs,
  },
  saveText: { color: COLORS.background, fontWeight: '700' },
  fab: { position: 'absolute', right: SPACING.lg, bottom: SPACING.lg },
});
