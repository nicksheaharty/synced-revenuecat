import { StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  runOnJS,
} from "react-native-reanimated";
import { MinusCircle } from "phosphor-react-native";
import { useTheme } from "../hooks/useTheme";

const SWIPE_DISTANCE_THRESHOLD = 90;
const SWIPE_VELOCITY_THRESHOLD = 800;
// How far the row slides once a swipe passes the threshold — a short hop in
// the swipe direction (Gmail-style), then onDismiss fires, then the row
// slides back to in-place. Dismissing here only marks this conversation's
// open tasks resolved — it never removes the row from the list — so unlike
// answer.tsx's Lightning-mode card (which genuinely leaves the deck), this
// row is still here afterward and needs to actually come back.
const EXIT_DISTANCE = 60;

/**
 * Wraps one home-list row (MessageCard + its editMode checkbox overlay) in
 * a horizontal drag gesture — swiping either left OR right past the
 * threshold triggers onDismiss (home.tsx's confirmResolveProfile, same
 * "mark this conversation's open tasks resolved" action already reachable
 * via the row's long-press context menu). Gmail-style: a solid theme.primary
 * panel sits behind the row, revealed as it slides, with just the dismiss
 * icon centered in it (no label text) — same pattern as Gmail's archive/
 * delete swipe backgrounds. The row slides a short distance, onDismiss
 * fires, then it slides back to in-place — it never stays gone, since
 * dismissing doesn't remove the conversation from the list. Low-bounce
 * spring (high damping, no overshoot) rather than a springy snap-back —
 * this is a utility gesture, not a playful one.
 *
 * Only enabled on a FOCUSED row (home.tsx passes the same `highlighted`
 * flag isCardHighlighted already computes per-row — a card with real open
 * tasks needing attention) — a flat/already-resolved row has nothing
 * meaningful left to dismiss, so swipe is a no-op gesture there rather than
 * a real action; disabling it outright avoids a dead gesture that looks
 * like it should do something. Also disabled entirely while `disabled` is
 * true (home.tsx passes editMode) — a drag gesture would otherwise fight
 * with tap-to-select.
 */
export function SwipeToDismissRow({
  children,
  onDismiss,
  focused,
  disabled = false,
}: {
  children: React.ReactNode;
  onDismiss: () => void;
  focused: boolean;
  disabled?: boolean;
}) {
  const theme = useTheme();
  const translateX = useSharedValue(0);

  const pan = Gesture.Pan()
    .enabled(focused && !disabled)
    .activeOffsetX([-10, 10])
    .failOffsetY([-12, 12])
    .onUpdate((e) => {
      "worklet";
      translateX.value = e.translationX;
    })
    .onEnd((e) => {
      "worklet";
      const pastThreshold =
        Math.abs(e.translationX) > SWIPE_DISTANCE_THRESHOLD ||
        Math.abs(e.velocityX) > SWIPE_VELOCITY_THRESHOLD;
      if (pastThreshold) {
        const direction = e.translationX > 0 ? 1 : -1;
        translateX.value = withTiming(direction * EXIT_DISTANCE, { duration: 150 }, () => {
          runOnJS(onDismiss)();
          translateX.value = withSpring(0, { damping: 30, stiffness: 300, overshootClamping: true });
        });
      } else {
        translateX.value = withSpring(0, { damping: 30, stiffness: 300, overshootClamping: true });
      }
    });

  const rowStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));
  // The theme.primary panel itself is only actually visible once dragging
  // has genuinely started — many rows are FLAT (transparent background by
  // design — see MessageCard.tsx's useFlatLayout), so an always-rendered
  // panel behind every idle row showed straight through as a solid purple
  // background on the whole list, not just the one row being swiped. This
  // fades the panel itself in/out with the same drag progress the icon
  // already uses, so it's genuinely invisible until there's real motion.
  const backgroundStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, Math.abs(translateX.value) / 20),
  }));
  // Fixed at each actual edge (not centered, and not animated toward the
  // edge) — the row's own short slide (EXIT_DISTANCE, well under half its
  // width) never uncovers anywhere near the center, so a centered or
  // slide-in icon stayed hidden behind the row on top of it the whole
  // time. Two separate icons, one pinned to each edge; only the one on the
  // side actually being uncovered gets meaningful opacity.
  const leftIconStyle = useAnimatedStyle(() => {
    const progress = Math.max(0, Math.min(1, translateX.value / SWIPE_DISTANCE_THRESHOLD));
    return { opacity: progress, transform: [{ scale: 0.6 + progress * 0.4 }] };
  });
  const rightIconStyle = useAnimatedStyle(() => {
    const progress = Math.max(0, Math.min(1, -translateX.value / SWIPE_DISTANCE_THRESHOLD));
    return { opacity: progress, transform: [{ scale: 0.6 + progress * 0.4 }] };
  });

  return (
    <View style={styles.container}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: theme.primary }, backgroundStyle]}>
        <Animated.View style={[styles.iconWrap, styles.iconLeft, leftIconStyle]}>
          <MinusCircle size={22} color="#FFFFFF" weight="fill" />
        </Animated.View>
        <Animated.View style={[styles.iconWrap, styles.iconRight, rightIconStyle]}>
          <MinusCircle size={22} color="#FFFFFF" weight="fill" />
        </Animated.View>
      </Animated.View>
      <GestureDetector gesture={pan}>
        <Animated.View style={rowStyle}>{children}</Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { position: "relative" },
  iconWrap: {
    position: "absolute",
    top: 0,
    bottom: 0,
    justifyContent: "center",
  },
  // Close to the edge, not centered — matches how far the row's own short
  // slide (EXIT_DISTANCE) actually uncovers, so the icon sits right where
  // the reveal happens instead of deep toward the middle of the row.
  iconLeft: { left: 20 },
  iconRight: { right: 20 },
});
