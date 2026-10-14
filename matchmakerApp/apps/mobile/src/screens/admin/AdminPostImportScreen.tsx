import { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ScreenContainer, PrimaryButton, ErrorBanner, TagInput, SelectChips } from '@/components';
import { useAuthMode } from '@/hooks';
import { useAsync } from '@/hooks/useAsync';
import { AdminImportError, importPosts, listAllTags } from '@/services/admin';
import {
  DEFAULT_IMPORT_SIZE,
  IMPORT_SIZES,
  MAX_IMPORT_BATCH,
  importSizeWidth,
  pickImages,
  type ImportSizeId,
  type PickedImage,
} from '@/services/imageImport';
import { BORDER_RADIUS, COLORS, FONT_SIZES, SPACING } from '@/constants';
import type { ProfileStackParamList } from '@/navigation/types';

type Nav = NativeStackNavigationProp<ProfileStackParamList, 'AdminPostImport'>;

const PREVIEW = 84;

/**
 * What a batch actually ended up costing, in the units the admin can act on.
 *
 * Kept short on purpose. The useful question after importing twenty photos is
 * "did that land at a sane size", and that is answered by the width and the
 * approximate byte count. Per-image detail is in the picker, not here.
 */
function describeSizes(images: PickedImage[]): string {
  if (images.length === 0) return '';

  const widths = new Set(images.map((image) => image.width).filter((width) => width !== undefined));
  const scaled = images.filter((image) => image.resized).length;
  const thumbs = images.filter((image) => image.thumbUri).length;
  const bytes = images.reduce((total, image) => total + (image.bytes ?? 0), 0);

  const parts: string[] = [];
  if (widths.size === 1) {
    const width = [...widths][0];
    parts.push(`${width} px wide`);
  } else {
    parts.push(`up to ${Math.max(...(widths as Set<number>))} px wide`);
  }
  if (scaled > 0) {
    parts.push(`${scaled} of ${images.length} scaled down`);
  }
  if (thumbs > 0) {
    // Every import writes a grid copy too, so the admin is being charged for
    // two files per photo and should be able to see that rather than infer it
    // from a quota that fills faster than expected.
    parts.push(`${thumbs} with a 640 px grid copy`);
  }
  if (bytes > 0) {
    parts.push(`about ${formatBytes(bytes)} stored`);
  }
  return parts.join(' · ');
}

/** Base64 inflates by 4/3, so this is a deliberately rough "about" figure. */
function formatBytes(bytes: number): string {
  const kb = Math.round(bytes / 1365);
  if (kb < 1000) return `${kb} KB`;
  return `${(kb / 1000).toFixed(1)} MB`;
}

/**
 * Import photos into the site library and tag them.
 *
 * One set of tags for the whole batch, because a curation task is usually "add
 * these six photos of my dog", and asking for the same tags once per image would
 * make bulk import unusable. The preview strip shows the selection so a
 * mis-picked batch is visible before it is written rather than only after.
 *
 * Tags are typed rather than chosen from a list, so the input suggests what the
 * library already uses without restricting anything.
 */
export function AdminPostImportScreen() {
  const navigation = useNavigation<Nav>();
  const [authMode] = useAuthMode();
  const isMock = authMode === 'mock';

  const [picked, setPicked] = useState<PickedImage[]>([]);
  const [size, setSize] = useState<ImportSizeId>(DEFAULT_IMPORT_SIZE);
  const [tags, setTags] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Scaling a dozen camera files takes long enough that an indeterminate
  // spinner reads as a hang, so the batch reports what it is on.
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  // Suggestions only, so a failure here is not worth an error banner: the input
  // accepts anything regardless, it just offers fewer shortcuts. Guarded on
  // mock mode because that is the only place the library is readable, and the
  // service throws rather than returning empty everywhere else.
  const { data: knownTags } = useAsync<Array<{ tag: string; count: number }>>(
    async () => (isMock ? listAllTags() : []),
    [isMock]
  );

  const usable = picked.filter((image) => image.uri);

  const choose = async () => {
    setError(null);
    setBusy(true);
    setProgress(null);
    try {
      const images = await pickImages(MAX_IMPORT_BATCH, size, (done, total) => {
        setProgress({ done, total });
      });
      if (images.length === 0) return;

      const rejected = images.filter((image) => image.problem);
      if (rejected.length > 0) {
        setError(rejected[0]!.problem ?? 'Some images could not be read.');
      }
      if (images.some((image) => image.uri)) {
        // Replaces rather than appends, so a second pick does not silently
        // double the batch and import images the admin already dismissed.
        setPicked(images);
      }
    } catch {
      setError('Could not open your photo library.');
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const submit = async () => {
    if (usable.length === 0) {
      setError('Pick at least one photo to import.');
      return;
    }
    if (tags.length === 0) {
      setError('Pick at least one tag, otherwise the photo cannot be matched on.');
      return;
    }

    setError(null);
    setBusy(true);
    try {
      await importPosts(
        usable.map((image) => ({
          imageUri: image.uri,
          tags,
          // Spread rather than assigned: an absent key and an explicit undefined
          // are different to the storage layer, and a photo with no grid copy
          // must not gain an empty-string one on the way through.
          ...(image.thumbUri ? { thumbUri: image.thumbUri } : {}),
          ...(image.width ? { width: image.width } : {}),
          ...(image.height ? { height: image.height } : {}),
        }))
      );
      navigation.goBack();
    } catch (caught) {
      setError(
        caught instanceof AdminImportError ? caught.message : 'Those photos could not be imported.'
      );
    } finally {
      setBusy(false);
    }
  };

  if (!isMock) {
    return (
      <ScreenContainer>
        <Text variant="bodyMedium">
          Imported photos are stored in the mock database. Switch the auth mode
          back to mock in Settings to use this.
        </Text>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer scroll>
      <View style={styles.body}>
        <Text variant="bodySmall" style={styles.hint}>
          These photos belong to the app, not to a profile. Everyone sees the
          same library; liking one is how two people get pulled together.
        </Text>

        {error ? <ErrorBanner message={error} onDismiss={() => setError(null)} /> : null}

        <View style={styles.section}>
          <SelectChips
            label="SIZE"
            options={IMPORT_SIZES.map((option) => ({
              value: option.id,
              label: `${option.label} · ${option.detail}`,
            }))}
            selected={[size]}
            onToggle={setSize}
            multiple={false}
            testID="admin-import-size"
            helperText={
              picked.length === 0
                ? 'Photos are scaled to this width on import. Camera files are far larger than the app ever renders.'
                : `These ${usable.length} were imported at the previous size. Choose different photos to apply ${importSizeWidth(size)} px.`
            }
          />
        </View>

        <View style={styles.section}>
          <Text variant="labelLarge" style={styles.sectionTitle}>
            PHOTOS ({usable.length})
          </Text>
          {progress ? (
            <Text style={styles.sizing} testID="admin-import-progress">
              Resizing {progress.done} of {progress.total}
            </Text>
          ) : picked.length === 0 ? null : (
            <Text style={styles.sizing}>{describeSizes(usable)}</Text>
          )}

          {picked.length === 0 ? (
            <Pressable
              onPress={() => void choose()}
              accessibilityRole="button"
              accessibilityLabel="Choose photos to import"
              style={styles.dropZone}
              testID="admin-import-choose"
            >
              <Text style={styles.dropGlyph}>🖼️</Text>
              <Text variant="bodyMedium" style={styles.dropText}>
                Choose up to {MAX_IMPORT_BATCH} photos
              </Text>
            </Pressable>
          ) : (
            <>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={styles.previewRow}>
                  {picked.map((image, index) => (
                    <View key={`${image.uri.slice(0, 24)}_${index}`} style={styles.preview}>
                      {image.uri ? (
                        <Image
                          source={{ uri: image.uri }}
                          style={styles.previewImage}
                          resizeMode="cover"
                        />
                      ) : (
                        <View style={[styles.previewImage, styles.previewRejected]}>
                          <Text style={styles.previewRejectedGlyph}>⚠️</Text>
                        </View>
                      )}
                    </View>
                  ))}
                </View>
              </ScrollView>

              <Pressable
                onPress={() => void choose()}
                accessibilityRole="button"
                style={styles.chooseAgain}
                testID="admin-import-choose-again"
              >
                <Text variant="labelLarge" style={styles.linkText}>
                  Choose different photos
                </Text>
              </Pressable>
            </>
          )}
        </View>

        <View style={styles.section}>
          <Text variant="labelLarge" style={styles.sectionTitle}>
            TAGS
          </Text>
          <Text variant="bodySmall" style={styles.hint}>
            Applied to all {usable.length} {usable.length === 1 ? 'photo' : 'photos'}. The
            first tag is the primary one and is what a co-like is credited to.
          </Text>

          <TagInput
            tags={tags}
            onChange={setTags}
            suggestions={knownTags ?? []}
            hint={`Applied to all ${usable.length} ${
              usable.length === 1 ? 'photo' : 'photos'
            }. The first tag is the primary one and is what a co-like is credited to.`}
            testID="admin-import-tag-input"
          />
        </View>

        <PrimaryButton
          onPress={() => void submit()}
          disabled={busy || usable.length === 0 || tags.length === 0}
          loading={busy}
          testID="admin-import-submit"
        >
          {busy
            ? 'Importing...'
            : usable.length === 0
              ? 'Import photos'
              : `Import ${usable.length} ${usable.length === 1 ? 'photo' : 'photos'}`}
        </PrimaryButton>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  body: { gap: SPACING.lg, paddingVertical: SPACING.lg },
  hint: { color: COLORS.textSecondary },
  section: { gap: SPACING.sm },
  sectionTitle: { color: COLORS.textMuted, letterSpacing: 0.8 },
  dropZone: {
    alignItems: 'center',
    gap: SPACING.sm,
    paddingVertical: SPACING.xl,
    borderRadius: BORDER_RADIUS.lg,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  sizing: { color: COLORS.textMuted, fontSize: FONT_SIZES.xs },
  dropGlyph: { fontSize: 40 },
  dropText: { color: COLORS.textSecondary },
  previewRow: { flexDirection: 'row', gap: SPACING.sm },
  preview: {
    width: PREVIEW,
    height: PREVIEW,
    borderRadius: BORDER_RADIUS.md,
    overflow: 'hidden',
    backgroundColor: COLORS.surfaceVariant,
  },
  previewImage: { width: '100%', height: '100%' },
  previewRejected: { alignItems: 'center', justifyContent: 'center' },
  previewRejectedGlyph: { fontSize: 24 },
  chooseAgain: { alignSelf: 'flex-start', paddingVertical: SPACING.xs },
  linkText: { color: COLORS.primary, fontWeight: '700' },
  tagGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  tagOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    borderRadius: BORDER_RADIUS.full,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  tagGlyph: { fontSize: 16 },
  tagOptionText: { fontSize: FONT_SIZES.sm, color: COLORS.textSecondary },
  tagOptionTextSelected: { color: COLORS.background, fontWeight: '700' },
});
