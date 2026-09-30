import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { View, Text, StyleSheet, Pressable, Dimensions, useWindowDimensions, Keyboard } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Lightning, HandSwipeLeft } from "phosphor-react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming, withSpring, Easing, runOnJS,
} from "react-native-reanimated";
import { useTheme } from "../../hooks/useTheme";
import { useColorScheme } from "../../hooks/useColorScheme";
import { useUser } from "../../contexts/UserContext";
import { Profile, Message, Task, HumanInputRequest, getMessageById } from "../../services/storage";
import { LightningCard } from "../../components/LightningCard";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const CARD_WIDTH = SCREEN_WIDTH - 32;
const SWIPE_DISTANCE_THRESHOLD = 120;
const SWIPE_VELOCITY_THRESHOLD = 800;

// Slow opacity/scale pulse on the empty-state bolt — signals "still
// listening for updates" rather than the screen looking frozen/done.
function ShimmerLightningIcon({ color }: { color: string }) {
  const pulse = useSharedValue(0);
  useEffect(() => {
    pulse.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 900, easing: Easing.inOut(Easing.ease) }),
        withTiming(0, { duration: 900, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      false,
    );
  }, [pulse]);
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: 0.5 + pulse.value * 0.5,
    transform: [{ scale: 1 + pulse.value * 0.08 }],
  }));
  return (
    <Animated.View style={animatedStyle}>
      <Lightning size={64} color={color} weight="duotone" />
    </Animated.View>
  );
}

// Cycles through ".", "..", "..." to show active wait/load state.
function AnimatedEllipsis() {
  const [dots, setDots] = useState(".");

  useEffect(() => {
    const interval = setInterval(() => {
      setDots((prev) => {
        if (prev === ".") return "..";
        if (prev === "..") return "...";
        return ".";
      });
    }, 600);
    return () => clearInterval(interval);
  }, []);

  return <Text>{dots}</Text>;
}

// One card in the Tinder-style stack. Only the top card (isTop) is
// gesture-enabled and gets the real glass background (visible=true);
// cards behind it render with visible=false (glassEffectStyle: 'none' —
// see LightningCard's `visible` prop doc comment for why this has to stay
// a plain, non-animated boolean, never a worklet-driven opacity threshold).
// A card that's just been swiped/answered away doesn't reappear directly
// in its old back-of-stack position — it's teleported to the OPPOSITE
// screen edge from the one it exited through, then slides in from there
// into the back-of-stack slot, so its reappearance is a visible motion
// rather than an invisible pop into place.
function StackCard({
  task, request, profile, groupMembers, groupSource, triggeringMessage, isTop, stackPosition, reenterToken, onAnswering, onAnswered, onSwiped,
}: {
  task: Task;
  request: HumanInputRequest;
  profile?: Profile;
  /** Present instead of `profile` when this task belongs to a GroupThread —
   * see LightningCard's identical props for why the two are split. */
  groupMembers?: Profile[];
  groupSource?: Profile["source"];
  triggeringMessage?: Message;
  isTop: boolean;
  stackPosition: number;
  /** Monotonically-increasing counter, non-null only when THIS specific
   * rotation is the one that just sent this card to the back of the deck —
   * a plain "which side" value can't be used for this (see below), so this
   * is a distinct token instead. */
  reenterToken: number | null;
  /** Fires the instant a real answer is submitted (before LightningCard's
   * own 650ms delay) — see LightningCard's onAnswering doc comment. */
  onAnswering: (task: Task) => void;
  onAnswered: (task: Task) => void;
  onSwiped: () => void;
}) {
  // NOTE: this component does NOT remount when a card rotates to the back
  // of the deck (same task.id, same React key — just new stackPosition /
  // reenterToken props) — so useSharedValue's initializer here only ever
  // runs once, on this card's true first mount. The actual "jump
  // off-screen, then slide in" motion has to be driven imperatively inside
  // the effect below.
  const scheme = useColorScheme();
  const translateX = useSharedValue(0);
  const animatedStackPosition = useSharedValue(stackPosition);
  // Always re-enters from the same fixed edge (right), regardless of which
  // direction the card was swiped away in. A left/right value tracking the
  // ACTUAL exit direction was tried first and had a real bug: with only 2
  // cards in the deck, "which side to re-enter from" legitimately repeats
  // the same value every other swipe (only 2 possible states), so no
  // value-based comparison can distinguish "still the same re-entry" from
  // "a brand new one that happens to repeat the previous side" — the
  // animation would silently stop replaying after the first repeat. A
  // monotonically-increasing token side-steps that: it's a different
  // number every single time, by construction, so a plain !== comparison
  // against the last-seen token always correctly detects a new re-entry.
  const lastSeenTokenRef = useRef<number | null>(null);
  useEffect(() => {
    if (reenterToken !== null && reenterToken !== lastSeenTokenRef.current) {
      // Snap instantly off-screen (no animation — this has to happen in
      // the same frame, invisibly, before the slide-in plays) then animate
      // back to resting position.
      translateX.value = CARD_WIDTH * 1.5;
      // Gentler settle specifically for the re-entry case — less bounce
      // than the original config, which felt too springy coming back from
      // off-screen.
      translateX.value = withSpring(0, { damping: 22, stiffness: 260, mass: 0.6 });
    }
    lastSeenTokenRef.current = reenterToken;
    // Stack-depth reposition (a card just moving up one slot) always
    // replays on every stackPosition change — that's a much shorter,
    // subtler motion, correctly re-triggered every time it happens, unlike
    // the one-shot re-entry jump above.
    animatedStackPosition.value = withSpring(stackPosition, { damping: 20, stiffness: 300 });
  }, [stackPosition, reenterToken]);

  const completeSwipe = useCallback(() => {
    onSwiped();
  }, [onSwiped]);

  // LightningCard's own checkmark overlay plays first (its 650ms delay
  // before calling this), so by the time this fires, the card should
  // visually leave the same way a plain swipe does — otherwise a real
  // answer (tapped via the mode buttons, not dragged) just instantly
  // snaps to its new back-of-stack position/scale with no exit motion at
  // all, since only the drag gesture normally drives translateX. By the
  // time this fires the task may have already been gone from the live
  // pendingTasks list for ~650ms (Firestore removes it near-instantly on
  // submit, well before this delayed callback runs) — that's why
  // onAnswering (fired synchronously, at the moment of the real answer,
  // not here) exists separately to snapshot the task before that happens.
  const handleRealAnswer = useCallback(() => {
    translateX.value = withTiming(-CARD_WIDTH * 1.5, { duration: 220 }, () => {
      runOnJS(onAnswered)(task);
    });
  }, [onAnswered, translateX, task]);

  const pan = Gesture.Pan()
    .enabled(isTop)
    .activeOffsetX([-10, 10])
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
        translateX.value = withTiming(direction * CARD_WIDTH * 1.5, { duration: 220 }, () => {
          runOnJS(completeSwipe)();
        });
      } else {
        translateX.value = withSpring(0, { damping: 18, stiffness: 220 });
      }
    });

  // Transform ONLY — no opacity anywhere in this style (see LightningCard's
  // `visible` prop doc comment for why: GlassView breaks at any ancestor
  // alpha < 1). Invisibility for non-top cards comes entirely from
  // LightningCard's own binary visible prop below, never from animating
  // this wrapper's opacity through a range.
  const cardStyle = useAnimatedStyle(() => {
    const depth = animatedStackPosition.value;
    return {
      transform: [
        { translateX: translateX.value },
        { rotateZ: `${(translateX.value / CARD_WIDTH) * 8}deg` },
        { scale: 1 - depth * 0.05 },
        { translateY: depth * 10 },
      ],
    };
  });

  // Every card (top AND peeking) renders the real LightningCard content, at
  // its OWN natural height (up to stackCardSlot's generous ceiling) — never
  // clamped to some OTHER card's height. An earlier version measured the
  // ACTIVE card's height and capped every peeking card to it, which clipped
  // a peeking card that was naturally a different size to the front card's
  // silhouette — visibly cutting it off mid-content instead of showing its
  // own real shape. contentWrap sizes to its child (LightningCard)
  // naturally; the scrim below is a sibling absolutely filling that same
  // (correctly, independently sized) box, so it overlays exactly this
  // card's own real footprint, whatever height that happens to be.
  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[styles.stackCardSlot, cardStyle]} pointerEvents={isTop ? "auto" : "none"}>
        <View style={styles.contentWrap}>
          <LightningCard
            task={task}
            request={request}
            profile={profile}
            groupMembers={groupMembers}
            groupSource={groupSource}
            triggeringMessage={triggeringMessage}
            onAnswering={() => onAnswering(task)}
            onAnswered={handleRealAnswer}
            visible={isTop}
          />
          {/* Dark scrim for peeking (non-top) cards — a depth cue so they
              read as "behind" the active card, not a translucency/glass
              effect (this is a plain solid-colored View, safe to layer
              over anything; it's not touching GlassView's own opacity at
              all). Lighter in light mode — a flat 0.35 black scrim
              (correct against a dark background) read as a heavy, overly
              dark gray bar against the light-mode card underneath it.
              Absolutely positioned to fill contentWrap — sized to THIS
              card's own natural content height (see contentWrap's own doc
              comment), so it overlays exactly this card's real footprint
              rather than the front card's, or the outer slot's worst-case
              height. */}
          {!isTop && (
            <View
              style={[
                styles.peekScrim,
                { backgroundColor: scheme === "dark" ? "rgba(0,0,0,0.35)" : "rgba(0,0,0,0.12)" },
              ]}
              pointerEvents="none"
            />
          )}
        </View>
      </Animated.View>
    </GestureDetector>
  );
}

export default function AnswerScreen() {
  const theme = useTheme();
  // pendingHitlTasks is a dedicated unbounded Firestore query (see
  // UserContext) — NOT derived from the paginated `tasks` array. This
  // screen's whole purpose is surfacing every pending HITL across every
  // conversation; a paginated `tasks` page would silently miss older ones.
  const { pendingHitlTasks, profiles, groupThreads } = useUser();
  // This is a MAX-HEIGHT ceiling for the stack slot, not every card's actual
  // rendered height — LightningCard's own `maxHeight: "100%"` lets it size
  // to its real content up to this cap, so a short "questions" card stays
  // short (each card's own contentWrap sizes to it naturally — see
  // StackCard's own render). LightningCard itself never scrolls — its
  // tallest mode (approve, with header + To/Cc + a capped-but-sizeable
  // draft box + attachments + buttons) needs to fit within this ceiling
  // without
  // clipping, so it's set generously rather than to the shortest card's
  // needs.
  //
  // TAB_BAR_CLEARANCE reserves room for the floating liquid-glass tab bar
  // ((main)/_layout.tsx), which is position:"absolute" and does NOT
  // participate in this SafeAreaView's layout — without this, a tall card
  // (e.g. an approve-mode draft with several option buttons) can render its
  // lower buttons underneath the tab bar. Matches the bottom clearance
  // home.tsx's own scroll content reserves for the same floating bar.
  const insets = useSafeAreaInsets();
  const TAB_BAR_CLEARANCE = 100 + insets.bottom;
  const { height: WINDOW_HEIGHT } = useWindowDimensions();
  const CARD_HEIGHT = Math.min(720, WINDOW_HEIGHT * 0.82 - TAB_BAR_CLEARANCE);

  // Oldest first, matching the order they'd need attention in.
  const pendingTasks = useMemo(() => {
    return pendingHitlTasks
      .filter((t) => t.humanInputRequest && !t.humanInputRequest.answer)
      .sort((a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime());
  }, [pendingHitlTasks]);

  // Snapshot of tasks that were JUST answered, kept around for a grace
  // window after they've already vanished from pendingTasks. Firestore's
  // real-time listener removes an answered task from pendingHitlTasks
  // almost instantly (its humanInputRequest.answer gets set the moment
  // submit() writes), which would otherwise unmount this task's StackCard
  // — and the checkmark-confirmation overlay living inside it — before the
  // user ever sees it, well before LightningCard's own 650ms delay +
  // this file's ~220ms exit animation have played. Grace window is
  // slightly longer than that combined ~870ms so the full sequence always
  // completes on-screen.
  const recentlyAnsweredRef = useRef<Map<string, { task: Task; expiresAt: number }>>(new Map());
  const [recentlyAnsweredTick, setRecentlyAnsweredTick] = useState(0);
  const GRACE_MS = 1000;

  const markRecentlyAnswered = useCallback((task: Task) => {
    recentlyAnsweredRef.current.set(task.id, { task, expiresAt: Date.now() + GRACE_MS });
    setTimeout(() => {
      recentlyAnsweredRef.current.delete(task.id);
      setRecentlyAnsweredTick((n) => n + 1);
    }, GRACE_MS);
  }, []);

  // Local deck order, independent of `pendingTasks`' sort — swiping a card
  // moves it to the bottom LOCALLY without re-sorting everything else, and
  // newly-arrived HITLs (which show up in `pendingTasks` as it updates) are
  // appended to the bottom rather than spliced in at their "correct"
  // chronological position, so the deck doesn't reshuffle under the user
  // mid-review. An answered task's id is kept via recentlyAnsweredRef's
  // grace window above — see there for why it can't just be dropped the
  // instant it leaves pendingTasks.
  const [deckOrder, setDeckOrder] = useState<string[]>([]);
  const pendingIds = pendingTasks.map((t) => t.id).join(",");
  useEffect(() => {
    setDeckOrder((prev) => {
      const stillPending = new Set(pendingTasks.map((t) => t.id));
      const kept = prev.filter((id) => stillPending.has(id) || recentlyAnsweredRef.current.has(id));
      const known = new Set(kept);
      const newlyArrived = pendingTasks.map((t) => t.id).filter((id) => !known.has(id));
      const next = [...kept, ...newlyArrived];
      if (next.length === prev.length && next.every((id, i) => id === prev[i])) return prev;
      return next;
    });
    // pendingIds intentionally used instead of pendingTasks (array identity
    // changes every render even when contents don't) so this only re-runs
    // when the actual set of pending task ids changes. recentlyAnsweredTick
    // additionally re-runs this once an entry's grace window expires, so
    // the id actually gets dropped from deckOrder at that point instead of
    // lingering forever (its ref entry is gone, so `deck` below would
    // silently filter it out anyway, but deckOrder itself needs to shed it
    // too for stackPosition bookkeeping to stay correct).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingIds, recentlyAnsweredTick]);

  const deck: Task[] = useMemo(() => {
    const byId = new Map(pendingTasks.map((t) => [t.id, t] as const));
    return deckOrder
      .map((id) => byId.get(id) ?? recentlyAnsweredRef.current.get(id)?.task)
      .filter((t): t is Task => !!t);
    // recentlyAnsweredTick forces this to re-run once a grace-window entry
    // expires and needs to actually drop out of `deck` (recentlyAnsweredRef
    // itself is a plain ref, not reactive on its own).
  }, [pendingTasks, deckOrder, recentlyAnsweredTick]);

  const profileById = useMemo(() => new Map(profiles.map((p) => [p.id, p] as const)), [profiles]);
  const groupThreadById = useMemo(() => new Map(groupThreads.map((g) => [g.id, g] as const)), [groupThreads]);

  // Triggering messages for the deck's own humanInputRequest.messageId,
  // fetched on demand by id rather than looked up in UserContext's
  // `messages` array — that array is bounded to recent account activity
  // (see UserContext.tsx), so a task that's been sitting pending for a
  // while could have a triggering message old enough to have fallen out of
  // it, silently dropping the "here's what they originally asked" context
  // from this card. The deck is always small (pending HITL tasks), so one
  // getDoc per card is cheap; results are cached by id so re-renders and
  // deck reshuffles don't refetch the same message.
  const [fetchedMessagesById, setFetchedMessagesById] = useState<Map<string, Message>>(new Map());
  const deckMessageIds = useMemo(
    () => Array.from(new Set(deck.map((t) => t.humanInputRequest?.messageId).filter((id): id is string => !!id))),
    [deck],
  );
  useEffect(() => {
    const missing = deckMessageIds.filter((id) => !fetchedMessagesById.has(id));
    if (missing.length === 0) return;
    let cancelled = false;
    (async () => {
      const results = await Promise.all(missing.map((id) => getMessageById(id)));
      if (cancelled) return;
      setFetchedMessagesById((prev) => {
        const next = new Map(prev);
        results.forEach((msg, i) => {
          if (msg) next.set(missing[i], msg);
        });
        return next;
      });
    })();
    return () => { cancelled = true; };
    // fetchedMessagesById intentionally excluded — this effect's own job is
    // to grow that map; including it would re-run every time it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deckMessageIds]);
  const messageById = fetchedMessagesById;

  // Which id most recently rejoined the back of the stack, and a
  // monotonically-increasing token identifying THIS specific rotation
  // event (see StackCard's doc comment for why a plain left/right value
  // doesn't work here — with a 2-card deck it can legitimately repeat).
  const [reenteringId, setReenteringId] = useState<string | null>(null);
  const [reenterToken, setReenterToken] = useState(0);

  // "Position in the current pass through the deck" — a raw rotation
  // counter (how many cards have been swiped/answered since the deck was
  // last empty), never reset or clamped by any effect. Rendered value is
  // derived below as `(rotationCount % deck.length) + 1`, so it's a pure
  // function of "how many rotations have happened" and "how many cards
  // exist right now" — nothing else can independently write to it. The
  // previous approach stored the DISPLAYED 1-based position directly and
  // had a separate effect clamp/reset it whenever deck.length changed;
  // that effect fired again ~100-200ms after every answer (once the
  // grace-window snapshot of the just-answered task finally drops out of
  // deckOrder and deck.length ticks down by one for real), and even though
  // the clamp math was technically consistent, the SECOND state update
  // shortly after the rotation's own update still produced a visible
  // second re-render/flash right after the smooth advance — i.e. the
  // "shift to 2nd, then glitch" the user kept seeing. Counting rotations
  // instead of storing the displayed position directly means later,
  // unrelated deck.length changes never need to touch this value at all.
  const rotationCountRef = useRef(0);
  const [rotationCount, setRotationCount] = useState(0);

  // Swiping (or answering) the top card sends it to the back of the deck.
  // Only the top card is ever gesture-enabled (StackCard.isTop), so this
  // always operates on whichever card is actually on top. Single
  // functional update (not a separate setDeckOrder call reading a
  // possibly-stale closed-over `deckOrder`) so the rotation and the
  // "which id just moved to the back" bookkeeping can never disagree about
  // what the actual current order was at the moment this fired.
  const rotateTopCardToBack = useCallback(() => {
    setDeckOrder((prev) => {
      if (prev.length === 0) return prev;
      const [first, ...rest] = prev;
      // Still fires for a single-card deck (rest is empty, order is
      // unchanged) — the card's own translateX already animated off-screen
      // via the drag/answer exit; without setting these, it would never
      // get the signal to slide back in and just stays stranded off-screen.
      setReenteringId(first);
      setReenterToken((n) => n + 1);
      const next = prev.length < 2 ? prev : [...rest, first];
      return next;
    });
    rotationCountRef.current += 1;
    setRotationCount(rotationCountRef.current);
  }, []);

  const handleCardSwiped = useCallback(() => {
    rotateTopCardToBack();
  }, [rotateTopCardToBack]);

  // Fires when the top card's OWN submit() succeeds (a real answer, not a
  // swipe) — advances the deck immediately rather than waiting for the
  // Firestore round-trip to remove it from pendingTasks; this is purely an
  // optimistic "don't make the user stare at the card they just answered"
  // nudge, not the actual removal mechanism.
  const handleCardAnswered = useCallback(() => {
    rotateTopCardToBack();
  }, [rotateTopCardToBack]);

  // 1-based "Nth card in this pass" display value, wrapped to the deck's
  // CURRENT length — recomputed on every render, not stored, so a
  // deck.length change (e.g. the grace-window snapshot of an already-
  // rotated card finally dropping out) can never trigger its own separate
  // state update/re-render after the rotation that already advanced it.
  const deckPosition = deck.length === 0 ? 1 : (rotationCount % deck.length) + 1;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={["top"]}>
      {/* No bottom-sheet chrome here (LightningCard is a plain swipeable
          card, not a real BottomSheetModal), so its BottomSheetTextInputs
          (questions free-text, approve draft body, etc.) had no way to
          dismiss the keyboard at all once open — no drag handle, no
          backdrop. Rather than one Pressable wrapping the whole body
          (which put every one of LightningCard's own buttons — Reprompt,
          Send, option-select, etc. — behind an ancestor Pressable and broke
          them the same way it broke the nav bar's Back button before),
          the dismiss affordance is applied individually to just the
          genuinely dead-space regions: the empty state, the counter row,
          and the hint row. carouselWrap (which hosts the actual card and
          its buttons) is deliberately left as a plain, non-Pressable View. */}
      <View style={[styles.container, { paddingBottom: TAB_BAR_CLEARANCE }]}>
        {deck.length === 0 ? (
          <Pressable onPress={Keyboard.dismiss} style={styles.emptyBody}>
            <ShimmerLightningIcon color={theme.primary} />
            <Text style={[styles.emptyTitle, { color: theme.surface, fontFamily: "MackinacPro_700Bold" }]}>
              All caught up
            </Text>
            <Text style={[styles.emptyDesc, { color: theme.muted, fontFamily: "Inter_400Regular" }]}>
              Just wait. More is coming<AnimatedEllipsis />
            </Text>
          </Pressable>
        ) : (
          <View style={styles.deckWrap}>
            <Pressable onPress={Keyboard.dismiss} style={styles.counterRow}>
              <Text style={[styles.counterText, { color: theme.muted, fontFamily: "Inter_600SemiBold" }]}>
                {deckPosition} / {deck.length}
              </Text>
            </Pressable>

            <View style={styles.carouselWrap}>
              <View style={[styles.stackBox, { width: CARD_WIDTH, height: CARD_HEIGHT }]}>
                {/* Rendered back-to-front (highest stack position first) so
                    each later sibling paints on top in native z-order by
                    default — the top/interactive card (position 0) is
                    always the very last thing rendered, unambiguously on
                    top for both painting AND touch, no zIndex needed. Only
                    the top 2 are mounted — just the active card plus the one
                    directly behind it. A 3rd card used to be mounted too, but
                    at that depth (scale 0.9, translateY 20) plus the peek
                    scrim on top, it read as barely-there/invisible junk
                    rather than a meaningful part of the stack, so it's not
                    worth the extra mount. */}
                {deck.slice(0, 2).map((item, index) => {
                  const group = item.profileId.startsWith("group_") ? groupThreadById.get(item.profileId) : undefined;
                  const profile = group ? undefined : profileById.get(item.profileId);
                  const groupMembers = group
                    ? group.memberProfileIds.map((id) => profileById.get(id)).filter((p): p is Profile => !!p)
                    : undefined;
                  const request = item.humanInputRequest!;
                  const triggeringMessage = request.messageId ? messageById.get(request.messageId) : undefined;
                  const isReentering = reenteringId === item.id;
                  return (
                    <StackCard
                      key={item.id}
                      task={item}
                      request={request}
                      profile={profile}
                      groupMembers={groupMembers}
                      groupSource={group?.source}
                      triggeringMessage={triggeringMessage}
                      isTop={index === 0}
                      stackPosition={index}
                      reenterToken={isReentering ? reenterToken : null}
                      onAnswering={markRecentlyAnswered}
                      onAnswered={handleCardAnswered}
                      onSwiped={handleCardSwiped}
                    />
                  );
                }).reverse()}
              </View>
            </View>

            <Pressable onPress={Keyboard.dismiss} style={styles.hintRow}>
              <HandSwipeLeft size={12} color={theme.muted} weight="bold" />
              <Text style={[styles.hintText, { color: theme.muted, fontFamily: "Inter_400Regular" }]}>
                Swipe to skip for now · tap the buttons to answer
              </Text>
            </Pressable>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  emptyBody: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  emptyTitle: { fontSize: 28, letterSpacing: -0.3 },
  emptyDesc: { fontSize: 15, textAlign: "center", lineHeight: 22, paddingHorizontal: 40 },
  // No header above this screen anymore (the Decide tab dropped its
  // title/subtitle to push the card stack up) — this top padding replaces
  // that header's vertical space so the counter row isn't flush against
  // the status bar.
  deckWrap: { flex: 1, paddingTop: 24 },
  counterRow: { alignItems: "center", marginBottom: 8 },
  counterText: { fontSize: 14 },
  carouselWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  stackBox: { position: "relative" },
  stackCardSlot: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    paddingVertical: 8,
    justifyContent: "center",
  },
  // Wraps the real LightningCard content (and, for peeking cards, the
  // scrim overlaid on top of it). Sizes to its child's natural content
  // height — no fixed/capped height here, so a peeking card renders at its
  // OWN real size rather than being clipped to some other card's
  // silhouette (see StackCard's own render comment for the regression this
  // fixes). position:"relative" so peekScrim (below) can absolutely-fill
  // exactly this box, whatever that natural size turns out to be, rather
  // than the much taller outer stackCardSlot.
  contentWrap: {
    position: "relative",
  },
  peekScrim: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    // Matches LightningCard's own shadowWrap/card borderRadius (20) — a
    // square-cornered scrim painted on top of a rounded card visibly
    // squared off the card's real rounded corners underneath it.
    borderRadius: 20,
  },
  hintRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
  },
  hintText: { fontSize: 12 },
});
