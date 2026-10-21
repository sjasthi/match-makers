import { Image, Modal, Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { COLORS, FONT_SIZES, SPACING } from '@/constants';
import { AppIcon } from './AppIcon';

/**
 * A photo, full screen, with optional actions.
 *
 * Three places need "look at this picture properly": the import screen, where a
 * photo can be checked and taken back out of the batch; the profile photo
 * strip, where somebody wants to see their own pictures and remove one; and
 * somebody else's profile, where they only want to look.
 *
 * They are the same gesture and the same layout, so they are one component.
 *
 * A `Modal` rather than a route, for the same reason the photo viewer on the
 * feed is one: this is a mode of the screen underneath, not a place, and a
 * route would put a back button next to a close button for the same corner.
 */
export interface PhotoViewerAction {
  label: string;
  onPress: () => void;
  /** `danger` is for the destructive one, so it reads as different. */
  tone?: 'default' | 'danger';
  icon?: string;
}

/**
 * The colour for text on the dark backdrop.
 *
 * Local rather than in `COLORS`, because `COLORS` is the palette for the light
 * interface and has no inverse set. This viewer is always on a dark backdrop, so
 * the colour that reads on it belongs here.
 */
const ON_DARK = '#FFFFFF';

interface Props {
  /** The image to show, or null when the viewer is closed. */
  uri: string | null;
  onClose: () => void;
  /** A caption, usually the photo's tags or the person's name. */
  title?: string;
  /** Buttons along the bottom. No actions means a read-only viewer. */
  actions?: PhotoViewerAction[];
  testID?: string;
}

export function PhotoViewer({ uri, onClose, title, actions = [], testID = 'photo-viewer' }: Props) {
  return (
    <Modal
      visible={Boolean(uri)}
      animationType="fade"
      transparent
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
      testID={testID}
    >
      <View style={styles.backdrop}>
        <View style={styles.chrome}>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close"
            hitSlop={12}
            style={styles.close}
            testID={`${testID}-close`}
          >
            <AppIcon name="close" size={22} color={ON_DARK} />
          </Pressable>
        </View>

        {uri ? (
          <Image
            source={{ uri }}
            style={styles.image}
            resizeMode="contain"
            accessibilityLabel={title ?? 'A photo'}
            testID={`${testID}-image`}
          />
        ) : null}

        {title ? (
          <Text variant="bodyMedium" style={styles.title} numberOfLines={2}>
            {title}
          </Text>
        ) : null}

        {actions.length > 0 ? (
          <View style={styles.actions}>
            {actions.map((action) => (
              <Pressable
                key={action.label}
                onPress={action.onPress}
                accessibilityRole="button"
                style={[styles.action, action.tone === 'danger' ? styles.actionDanger : null]}
                testID={`${testID}-action-${action.label.toLowerCase().replace(/\s+/g, '-')}`}
              >
                <Text
                  variant="labelLarge"
                  style={action.tone === 'danger' ? styles.actionTextDanger : styles.actionText}
                >
                  {action.label}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.94)',
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.xl,
    paddingBottom: SPACING.lg,
    justifyContent: 'center',
  },
  chrome: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.md,
  },
  close: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  image: {
    width: '100%',
    flex: 1,
  },
  title: {
    color: ON_DARK,
    textAlign: 'center',
    marginTop: SPACING.md,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: SPACING.md,
    marginTop: SPACING.lg,
  },
  action: {
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  actionDanger: {
    backgroundColor: COLORS.error,
  },
  actionText: {
    color: ON_DARK,
    fontSize: FONT_SIZES.md,
    fontWeight: '700',
  },
  actionTextDanger: {
    color: ON_DARK,
    fontSize: FONT_SIZES.md,
    fontWeight: '700',
  },
});
