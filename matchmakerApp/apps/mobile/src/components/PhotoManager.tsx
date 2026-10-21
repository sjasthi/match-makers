import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Text } from 'react-native-paper';
import type { Photo } from '@match-makers/shared';
import { ProfileImage, type ProfileImageUser } from './ProfileImage';
import { PhotoViewer } from './PhotoViewer';
import { AppIcon } from './AppIcon';
import { photoLimit } from '@/services/profile';
import { importProfilePhotos } from '@/services/imageImport';
import { BORDER_RADIUS, COLORS, FONT_SIZES, SPACING } from '@/constants';

const THUMB_SIZE = 104;

interface Props {
  user: ProfileImageUser;
  photos: Photo[];
  onChange: (next: Photo[]) => void;
}

/**
 * Add, reorder-by-promotion and delete profile photos.
 *
 * Shared by onboarding and profile editing, which is the point: photos were
 * previously only reachable during onboarding, so a seeded placeholder could
 * never be removed once you were past that step.
 */
export function PhotoManager({ user, photos, onChange }: Props) {
  const [busy, setBusy] = useState(false);
  // Messages live here rather than in the parent: they describe this strip, and
  // routing them through a callback meant they vanished if it was not wired.
  const [message, setMessage] = useState<string | null>(null);
  // Which photo is being looked at full size, if any.
  const [previewId, setPreviewId] = useState<string | null>(null);
  const remaining = photoLimit - photos.length;

  /**
   * Adds picked photos, after putting them through the shared resizer.
   *
   * This used to store `asset.uri` verbatim. On web that is the original file as
   * a base64 data URI -- so a 12 megapixel phone photo became a nine-megabyte
   * PNG in a text column, and two profile photos were eighteen megabytes of the
   * database. The same resizer the gallery uses makes them JPEG at a width that
   * covers the deck card, which is about forty-five times smaller.
   *
   * `importProfilePhotos` reports failures per image, so one unreadable file
   * does not lose the rest.
   */
  const append = async (assets: ImagePicker.ImagePickerAsset[]) => {
    setBusy(true);
    try {
      const imported = await importProfilePhotos(assets);
      const usable = imported.filter((image) => image.uri && !image.problem);

      const failed = imported.find((image) => image.problem);
      if (failed?.problem) {
        setMessage(failed.problem);
      }

      if (usable.length === 0) return;

      const added: Photo[] = usable.map((image, index) => ({
        id: `photo_${Date.now()}_${index}`,
        url: image.uri,
        isPrimary: photos.length === 0 && index === 0,
        order: photos.length + index,
      }));

      onChange([...photos, ...added]);
    } catch {
      setMessage('Those pictures could not be added.');
    } finally {
      setBusy(false);
    }
  };

  const pickFromLibrary = async () => {
    setMessage(null);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setMessage('Photo library access is needed to add pictures.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsMultipleSelection: remaining > 1,
        selectionLimit: remaining,
        quality: 0.8,
      });
      if (!result.canceled) await append(result.assets.slice(0, remaining));
    } catch {
      setMessage('Could not open your photo library.');
    }
  };

  const takePhoto = async () => {
    setMessage(null);
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        setMessage('Camera access is needed to take a photo.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({ quality: 0.8 });
      if (!result.canceled) await append(result.assets.slice(0, 1));
    } catch {
      setMessage('Could not open the camera.');
    }
  };

  const makePrimary = (id: string) => {
    onChange(photos.map((photo) => ({ ...photo, isPrimary: photo.id === id })));
  };

  const remove = (id: string) => {
    if (photos.length <= 1) {
      // isProfileComplete() requires at least one photo, so deleting the last
      // one would bounce the user back into onboarding mid-edit.
      setMessage('Keep at least one photo so people recognise you.');
      return;
    }
    const next = photos.filter((photo) => photo.id !== id);
    if (!next.some((photo) => photo.isPrimary)) {
      next[0] = { ...next[0]!, isPrimary: true };
    }
    onChange(next.map((photo, index) => ({ ...photo, order: index })));
    setMessage(null);
  };

  return (
    <View style={styles.container}>
      {message ? (
        <Text style={styles.message} accessibilityLiveRegion="polite">
          {message}
        </Text>
      ) : null}

      <Text variant="labelLarge">
        {photos.length} of {photoLimit} photos
      </Text>
      <Text variant="bodySmall" style={styles.hint}>
        Tap a photo to look at it. You can make it your main one, or remove it, from there.
      </Text>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.strip}
      >
        {photos.map((photo) => (
          <Pressable
            key={photo.id}
            onPress={() => setPreviewId(photo.id)}
            style={[styles.thumb, photo.isPrimary && styles.thumbPrimary]}
            accessibilityRole="button"
            accessibilityLabel={
              photo.isPrimary
                ? `Main photo. Tap to look at it full size`
                : `Photo by ${user.name}. Tap to look at it full size`
            }
            accessibilityHint="Opens the photo, where it can be made the main one or removed"
          >
            <ProfileImage user={user} url={photo.url} initialsScale={0.3} />
            {photo.isPrimary ? (
              <View style={styles.primaryTag}>
                <Text style={styles.primaryTagText}>Main</Text>
              </View>
            ) : null}
          </Pressable>
        ))}

        {/*
         * The full-size view of one of this person's photos, with the two
         * things anybody actually wants to do with a photo -- make it the main
         * one, or take it away -- on the same screen as the picture.
         *
         * Both used to be gestures on the thumbnail: a tap made it the main
         * one, which meant a photo could not be looked at before being
         * promoted, and a long press deleted it, which is a gesture nobody
         * discovers and which a mis-swipe would trigger.
         */}
        <PhotoViewer
          uri={previewId ? (photos.find((photo) => photo.id === previewId)?.url ?? null) : null}
          onClose={() => setPreviewId(null)}
          title={
            previewId
              ? photos.find((photo) => photo.id === previewId)?.isPrimary
                ? 'Your main photo'
                : 'Your photo'
              : undefined
          }
          actions={
            previewId
              ? [
                  ...(photos.find((photo) => photo.id === previewId)?.isPrimary
                    ? []
                    : [
                        {
                          label: 'Make main photo',
                          onPress: () => {
                            makePrimary(previewId);
                            setPreviewId(null);
                          },
                        },
                      ]),
                  {
                    label: 'Remove',
                    tone: 'danger' as const,
                    onPress: () => {
                      remove(previewId);
                      setPreviewId(null);
                    },
                  },
                ]
              : []
          }
          testID="photo-manager-viewer"
        />

        {remaining > 0 ? (
          <Pressable
            onPress={() => void pickFromLibrary()}
            style={styles.addTile}
            accessibilityRole="button"
            accessibilityLabel="Add a photo from your library"
            disabled={busy}
          >
            <AppIcon name="plus" size={28} color={COLORS.primary} />
            <Text style={styles.addTileText}>Add</Text>
          </Pressable>
        ) : null}
      </ScrollView>

      <Pressable
        onPress={() => void takePhoto()}
        style={styles.secondaryAction}
        accessibilityRole="button"
        disabled={busy || remaining <= 0}
      >
        <AppIcon name="camera-outline" size={18} color={COLORS.primary} />
        <Text style={styles.secondaryActionText}>
          {remaining <= 0 ? 'Photo limit reached' : 'Take a photo'}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: SPACING.sm },
  message: {
    color: COLORS.error,
    fontSize: FONT_SIZES.sm,
    backgroundColor: 'rgba(239,68,68,0.08)',
    borderRadius: BORDER_RADIUS.sm,
    padding: SPACING.sm,
  },
  hint: { color: COLORS.textSecondary },
  strip: { gap: SPACING.md, paddingVertical: SPACING.xs },
  thumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: BORDER_RADIUS.md,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  thumbPrimary: { borderColor: COLORS.primary },
  primaryTag: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: COLORS.primary,
    paddingVertical: 2,
  },
  primaryTagText: {
    color: COLORS.background,
    textAlign: 'center',
    fontSize: FONT_SIZES.xs,
    fontWeight: '700',
  },
  addTile: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.xs,
  },
  addTileText: { color: COLORS.primary, fontSize: FONT_SIZES.sm },
  secondaryAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingVertical: SPACING.sm,
  },
  secondaryActionText: { color: COLORS.primary, fontWeight: '700' },
});
