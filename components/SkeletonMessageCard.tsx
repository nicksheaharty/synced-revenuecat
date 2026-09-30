import { useEffect } from "react";
import { View, StyleSheet } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
} from "react-native-reanimated";
import { useTheme } from "../hooks/useTheme";
import { SyncedIcon } from "./SimpleIcons";

// Placeholder shown in place of a real MessageCard while the initial
// profiles/messages Firestore listeners in UserContext are still resolving
// (see home.tsx's `loading` gate) — without this, a fresh load briefly
// rendered the FlatList's "No profiles yet" empty state (correct for a
// genuinely empty account, wrong here) before the real cards streamed in.
// Dimensions deliberately mirror MessageCard's actual layout (36px avatar,
// 18px radius; 20px card radius; same header padding) so the skeleton reads
// as "this card is loading" rather than a generic, disconnected shape.
function ShimmerBlock({ style }: { style: any }) {
  const theme = useTheme();
  const opacity = useSharedValue(0.5);

  useEffect(() => {
    opacity.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 700, easing: Easing.inOut(Easing.ease) }),
        withTiming(0.5, { duration: 700, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
    );
  }, [opacity]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      style={[style, animatedStyle, { backgroundColor: theme.searchBg }]}
    />
  );
}

// Grayscale Synced mark that pulses opacity the same way ShimmerBlock does
// — used as a branded loading state (paywall offerings fetch, etc.) in place
// of a plain ActivityIndicator. theme.muted keeps it desaturated in both
// light and dark mode rather than tinting it the brand purple, since this
// reads as "loading" chrome, not a colored UI element.
export function ShimmerSyncedIcon({ size = 44 }: { size?: number }) {
  const theme = useTheme();
  const opacity = useSharedValue(0.5);

  useEffect(() => {
    opacity.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 700, easing: Easing.inOut(Easing.ease) }),
        withTiming(0.5, { duration: 700, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
    );
  }, [opacity]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View style={animatedStyle}>
      <SyncedIcon size={size} color={theme.muted} />
    </Animated.View>
  );
}

// Deliberately NO card background/border here (unlike the real MessageCard
// it stands in for) — just the shimmer bars floating directly on the page
// background. A white/theme.card box behind still-loading gray bars read as
// its own "card" chrome rendering wrong, not a loading placeholder.
export function SkeletonMessageCard() {
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <ShimmerBlock style={styles.avatar} />
        <View style={styles.headerText}>
          <ShimmerBlock style={styles.nameLine} />
          <ShimmerBlock style={styles.metaLine} />
        </View>
      </View>
      <View style={styles.bubbleRow}>
        <ShimmerBlock style={styles.bubble} />
      </View>
    </View>
  );
}

// Renders a fixed stack of skeleton cards — used as home.tsx's
// ListEmptyComponent while `loading` is true, standing in for however many
// real cards will appear once the profiles listener resolves. 4 fills a
// typical screen height without looking sparse or requiring scroll math.
export function SkeletonMessageList() {
  return (
    // 8, not 16 — matches home.tsx's cardWrapperFlatInset (the inset most
    // real rows actually get once loaded; cardWrapperInset's fuller 16 is
    // reserved for highlighted/needs-attention cards, the less common
    // case), so the skeleton's total edge-to-text inset lines up with what
    // most real cards look like once they stream in, not the outlier.
    <View style={{ gap: 12, paddingHorizontal: 8 }}>
      {[0, 1, 2, 3].map((i) => (
        <SkeletonMessageCard key={i} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  // Purely a layout grouper for the header/bubble rows below — no
  // background/border, unlike the real MessageCard it stands in for (see
  // this component's own doc comment for why).
  card: {},
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 12,
    gap: 10,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  headerText: { flex: 1, gap: 6 },
  nameLine: {
    width: "45%",
    height: 12,
    borderRadius: 6,
  },
  metaLine: {
    width: "30%",
    height: 10,
    borderRadius: 5,
  },
  bubbleRow: {
    paddingHorizontal: 14,
    paddingBottom: 14,
  },
  bubble: {
    width: "70%",
    height: 34,
    borderRadius: 16,
  },
});
