import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View, Platform, Image } from 'react-native';
import { Text } from 'react-native-paper';
import type { VerificationStatus } from '@match-makers/shared';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { ScreenContainer, PrimaryButton, ErrorBanner, LoadingState, AppIcon } from '@/components';
import { useCurrentUser } from '@/hooks';
import { fetchVerificationStatus, submitVerification } from '@/services/profile';
import { AuthError } from '@/services/auth/AuthError';
import { BORDER_RADIUS, COLORS, SPACING } from '@/constants';

export function VerificationScreen() {
  const user = useCurrentUser();

  const [status, setStatus] = useState<VerificationStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setStatus(await fetchVerificationStatus());
    } catch (caught) {
      setError(AuthError.unknown(caught).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const pickImage = async (source: 'library' | 'camera') => {
    setError(null);
    try {
      let permission;
      if (source === 'library') {
        permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      } else {
        permission = await ImagePicker.requestCameraPermissionsAsync();
      }

      if (!permission.granted) {
        setError(
          source === 'library'
            ? 'Photo library access is needed to select a photo.'
            : 'Camera access is needed to take a photo.'
        );
        return;
      }

      const result = await (source === 'library'
        ? ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            allowsMultipleSelection: false,
            quality: 0.8,
          })
        : ImagePicker.launchCameraAsync({
            quality: 0.8,
          }));

      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        setSelectedImage(asset.uri);
        setImagePreview(asset.uri);
      }
    } catch {
      setError('Could not pick image. Please try again.');
    }
  };

  const submit = async () => {
    if (!selectedImage) {
      setError('Please select a photo first.');
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      // The admin needs an image that is readable from another device, so send
      // compressed bytes rather than the picker's local file:// URI.
      const prepared = await manipulateAsync(selectedImage, [{ resize: { width: 1200 } }], {
        compress: 0.78,
        format: SaveFormat.JPEG,
        base64: true,
      });
      if (!prepared.base64) throw new Error('Could not prepare this photo for upload.');
      const imageData = `data:image/jpeg;base64,${prepared.base64}`;
      if (imageData.length > 2_200_000) {
        throw new Error('That photo is too large. Please choose a smaller image.');
      }

      const result = await submitVerification(imageData, 'image/jpeg');
      setStatus({
        status: result.status,
        submittedAt: result.submittedAt,
      });
      setSelectedImage(null);
      setImagePreview(null);
    } catch (caught) {
      setError(AuthError.unknown(caught).message);
    } finally {
      setSubmitting(false);
    }
  };

  const removeImage = () => {
    setSelectedImage(null);
    setImagePreview(null);
  };

  if (loading) return <LoadingState label="Checking verification..." fullHeight />;

  const isVerified = status ? status.status === 'verified' : Boolean(user?.isVerified);
  const isPending = status?.status === 'pending';
  const isRejected = status?.status === 'rejected';

  return (
    <ScreenContainer scroll>
      <View style={styles.form}>
        {isVerified ? (
          <View style={styles.verifiedCard}>
            <AppIcon name="check-decagram" size={40} color={COLORS.secondary} />
            <Text variant="titleMedium" style={styles.verifiedTitle}>
              You are verified
            </Text>
            <Text variant="bodySmall" style={styles.verifiedBody}>
              Your badge is visible to everyone you match with.
            </Text>
          </View>
        ) : null}

        {isPending ? (
          <ErrorBanner
            message="Your submission is being reviewed. This usually takes under a day."
            tone="info"
          />
        ) : null}

        {isRejected ? (
          <ErrorBanner
            message={
              status?.rejectionReason ?? 'Your submission was not approved. You can try again.'
            }
            tone="error"
          />
        ) : null}

        {error ? <ErrorBanner message={error} onDismiss={() => setError(null)} /> : null}

        {!isVerified ? (
          <View style={styles.intro}>
            <Text variant="titleMedium" style={styles.title}>
              Submit a photo for verification
            </Text>
            <Text variant="bodyMedium" style={styles.body}>
              Submit any photo for this demo. An admin will review your submission. The badge means
              your photo was reviewed; it is not proof of identity.
            </Text>
          </View>
        ) : null}

        {!isVerified && !isPending && (
          <>
            <View style={styles.imageSection}>
              {imagePreview ? (
                <View style={styles.previewContainer}>
                  <Image source={{ uri: imagePreview }} style={styles.previewImage} />
                  <Pressable
                    onPress={removeImage}
                    style={styles.removeButton}
                    accessibilityLabel="Remove photo"
                  >
                    <AppIcon name="close" size={18} color={COLORS.text} />
                  </Pressable>
                </View>
              ) : (
                <View style={styles.placeholder}>
                  <AppIcon name="image-outline" size={48} color={COLORS.textMuted} />
                  <Text variant="bodyMedium" style={styles.placeholderText}>
                    No photo selected
                  </Text>
                </View>
              )}
            </View>

            <View style={styles.buttonRow}>
              <PrimaryButton
                variant="outlined"
                onPress={() => void pickImage('library')}
                disabled={submitting}
                style={styles.pickButton}
                icon="image-outline"
              >
                Choose from Library
              </PrimaryButton>

              {Platform.OS !== 'web' && (
                <PrimaryButton
                  variant="outlined"
                  onPress={() => void pickImage('camera')}
                  disabled={submitting}
                  style={styles.pickButton}
                  icon="camera-outline"
                >
                  Take Photo
                </PrimaryButton>
              )}
            </View>

            <PrimaryButton
              onPress={submit}
              loading={submitting}
              disabled={submitting || !selectedImage}
              fullWidth
              style={styles.submitButton}
            >
              {isRejected ? 'Resubmit' : 'Submit for Review'}
            </PrimaryButton>
          </>
        )}

        <Pressable onPress={() => void load()} style={styles.refresh} accessibilityRole="button">
          <Text style={styles.refreshText}>Refresh status</Text>
        </Pressable>

        <Text variant="bodySmall" style={styles.footnote}>
          This is a manual demo review. Submitted photos are visible to administrators only.
        </Text>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  form: { gap: SPACING.lg, paddingVertical: SPACING.lg, paddingBottom: SPACING.xxl },
  verifiedCard: {
    alignItems: 'center',
    gap: SPACING.sm,
    backgroundColor: 'rgba(78,205,196,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(78,205,196,0.3)',
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
  },
  verifiedTitle: { fontWeight: '700' },
  verifiedBody: { color: COLORS.textSecondary, textAlign: 'center' },
  intro: { gap: SPACING.xs },
  title: { fontWeight: '700' },
  body: { color: COLORS.textSecondary },
  imageSection: {
    alignItems: 'center',
    gap: SPACING.md,
  },
  previewContainer: {
    position: 'relative',
    width: 200,
    height: 200,
    borderRadius: BORDER_RADIUS.lg,
    overflow: 'hidden',
    backgroundColor: COLORS.surface,
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
  removeButton: {
    position: 'absolute',
    top: SPACING.sm,
    right: SPACING.sm,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: BORDER_RADIUS.full,
    padding: SPACING.xs,
  },
  placeholder: {
    width: 200,
    height: 200,
    borderRadius: BORDER_RADIUS.lg,
    borderWidth: 2,
    borderColor: COLORS.border,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
  },
  placeholderText: { color: COLORS.textMuted },
  buttonRow: {
    flexDirection: 'row',
    gap: SPACING.md,
    justifyContent: 'center',
    flexWrap: 'wrap',
  },
  pickButton: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 160,
  },
  submitButton: { marginTop: SPACING.md },
  refresh: { alignSelf: 'center', padding: SPACING.sm },
  refreshText: { color: COLORS.primary, fontWeight: '700' },
  footnote: { color: COLORS.textMuted, textAlign: 'center' },
});
