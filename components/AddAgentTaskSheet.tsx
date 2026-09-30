import { useEffect, useMemo, useRef, useState } from "react";
import { Platform, View, StyleSheet, Pressable, ActivityIndicator, Keyboard } from "react-native";
import { useRouter } from "expo-router";
import { Microphone, ArrowUp } from "phosphor-react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
} from "react-native-reanimated";
import Svg, { Defs, RadialGradient, Stop, Rect } from "react-native-svg";
import {
  BottomSheetModal,
  BottomSheetView,
  BottomSheetTextInput,
} from "@expo/ui/community/bottom-sheet";
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "expo-speech-recognition";
import { useTheme } from "../hooks/useTheme";
import { useColorScheme } from "../hooks/useColorScheme";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { createSyncedAgentTask, buildMentionContextBlock, type Profile } from "../services/storage";
import { MentionAutocomplete, rankMentionSuggestions, type MentionSuggestion } from "./MentionAutocomplete";
import { MentionTextOverlay } from "./MentionTextOverlay";

// Same lazy-optional-require pattern as HitlApproveMode.tsx's own glass
// send-button footer, whose exact button geometry this sheet's footer now
// reuses (round 60x60 glass button — icon differs, an up-arrow here rather
// than that footer's paper-plane) — kept as its own require here rather
// than importing across files, matching how that module keeps its own
// copy too.
let GlassView: React.ComponentType<any> | null = null;
try { GlassView = require("expo-glass-effect").GlassView; } catch { }

interface AddAgentTaskSheetProps {
  isPresented: boolean;
  onClose: () => void;
  // Live profiles list, threaded down from UserContext (see home.tsx) rather
  // than fetched here — avoids a second redundant Firestore listener for
  // the same data. Used only to rank/filter @mention suggestions.
  profiles: Profile[];
  // Opens the sheet pre-seeded with a real tracked @mention (not literal
  // "@Name" text) — same as if the user had typed "@" and picked this
  // suggestion themselves — optionally wrapped in plain text before/after
  // it. Used by the conversation page's fake iMessage-style composer (see
  // app/conversation/[profileId].tsx), which is never a real input —
  // tapping it always opens this sheet already addressed to whoever that
  // conversation is with.
  //   - No prefix/suffix (or omitted entirely): "Send @Name: " — the
  //     original default, matches the mention feature's own general
  //     "@Someone: do X" phrasing. The trailing ": " caps off the whole
  //     auto-filled phrase right before where the user starts typing.
  //   - Reply dialog case: prefix 'Reply to ', suffix ' in "Subject": '
  //     produces 'Reply to @Name in "Subject": ' — the mention AND the
  //     subject line both present, since the subject alone doesn't say
  //     WHO to reply to (a solo conversation's profile is implied on
  //     screen, but the sentence sent to the triage LLM should be
  //     self-contained). "in" not "about" — this replies WITHIN that
  //     specific email thread, not merely on that topic. Same trailing
  //     ": " convention as the default.
  initialMention?: { profileId: string; name: string; source: Profile["source"]; identifier: string; prefix?: string; suffix?: string };
}

// A mention rendered INLINE in `text` as literal "@Name" characters, tracked
// by the character range it occupies. `text.slice(start, end)` is always
// exactly `@${name}` — kept in sync on every edit by reconcileMentionEdit
// below. Atomic: any edit that touches so much as one character inside
// [start, end) removes the whole mention, never leaves it partially edited.
interface MentionRange {
  start: number;
  end: number;
  profileId: string;
  name: string;
  source: Profile["source"];
  // Profile.platformIdentifier (real email address / platform handle) —
  // REQUIRED by handleSend's buildMentionContextBlock call so the triage
  // LLM has the actual recipient address to work with. Without this, the
  // model has no way to know a Gmail contact's real email from the
  // mention block alone (profileId is slugified, not a usable address —
  // see MENTION_CONTEXT_PATTERN's doc comment in services/storage.ts) and
  // was confirmed hallucinating a wrong/truncated one instead.
  identifier: string;
}

// Finds the [changeStart, oldEnd, newEnd) edit region between two strings —
// the shortest common-prefix/common-suffix diff. RN's onChangeText only
// gives the resulting full string, not a delta, so this reconstructs what
// changed on every keystroke (typing, pasting, backspace, cut all collapse
// to one contiguous replaced region).
function diffRegion(oldText: string, newText: string): { start: number; oldEnd: number; newEnd: number } {
  let start = 0;
  const maxPrefix = Math.min(oldText.length, newText.length);
  while (start < maxPrefix && oldText[start] === newText[start]) start++;

  let oldEnd = oldText.length;
  let newEnd = newText.length;
  while (oldEnd > start && newEnd > start && oldText[oldEnd - 1] === newText[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }
  return { start, oldEnd, newEnd };
}

// Reconciles `mentions` against an onChangeText transition. Two cases:
//  1. The edit falls entirely outside every mention range — plain typing
//     elsewhere in the text. Ranges after the edit just shift by the length
//     delta.
//  2. The edit touches ANY character inside a mention's [start, end) range
//     (including backspacing at its boundary) — that mention is atomic, so
//     its ENTIRE "@Name" text is removed from the string (not just the
//     single character the user touched) and it's dropped from the list.
//     Since removing it changes the string further, this re-diffs against
//     the ORIGINAL oldText once more with the mention excised, which also
//     correctly handles the (rare) case of an edit spanning multiple
//     mentions at once by recursing.
function reconcileMentionEdit(
  oldText: string,
  newText: string,
  mentions: MentionRange[],
): { text: string; mentions: MentionRange[] } {
  const { start, oldEnd, newEnd } = diffRegion(oldText, newText);
  if (start === oldEnd && start === newEnd) return { text: newText, mentions }; // no-op

  const hit = mentions.find((m) => start < m.end && oldEnd > m.start);
  if (!hit) {
    const delta = newEnd - oldEnd;
    const shifted = mentions.map((m) =>
      m.start >= oldEnd ? { ...m, start: m.start + delta, end: m.end + delta } : m,
    );
    return { text: newText, mentions: shifted };
  }

  // Excise the whole hit mention from oldText and recurse — this collapses
  // "delete one character inside @Jordan Lee" into "delete all of @Jordan
  // Lee", then re-evaluates against whatever the user's edit actually did
  // around it.
  const excisedOld = oldText.slice(0, hit.start) + oldText.slice(hit.end);
  const remainingMentions = mentions
    .filter((m) => m !== hit)
    .map((m) => (m.start >= hit.end ? { ...m, start: m.start - (hit.end - hit.start), end: m.end - (hit.end - hit.start) } : m));
  // The user's replacement text for the edit region, re-anchored onto
  // excisedOld's coordinate space.
  const replacement = newText.slice(start, newEnd);
  const adjustedStart = Math.max(0, Math.min(start, hit.start));
  const excisedNew = excisedOld.slice(0, adjustedStart) + replacement + excisedOld.slice(Math.max(adjustedStart, oldEnd - (hit.end - hit.start)));
  return reconcileMentionEdit(excisedOld, excisedNew, remainingMentions);
}

// Finds the active "@query" span (if any) ending at the cursor — the
// nearest "@" walking backward from cursor that isn't preceded immediately
// by a non-space, non-start character (so "email@x" doesn't trigger), has
// no whitespace between it and the cursor, and isn't already inside an
// existing mention range.
function findActiveMentionQuery(
  text: string,
  cursor: number,
  mentions: MentionRange[],
): { start: number; query: string } | null {
  const upToCursor = text.slice(0, cursor);
  const at = upToCursor.lastIndexOf("@");
  if (at === -1) return null;
  if (mentions.some((m) => at >= m.start && at < m.end)) return null; // inside an existing mention
  const before = at > 0 ? upToCursor[at - 1] : "";
  if (before && !/\s/.test(before)) return null; // mid-word "@", e.g. "email@x"
  const query = upToCursor.slice(at + 1);
  if (/\s/.test(query)) return null; // whitespace after "@" closes the trigger
  return { start: at, query };
}

// continuous:false stops listening after just ~3s of silence on iOS 17 and
// below (see expo-speech-recognition's own doc comment on this option) —
// far too aggressive for dictating a whole task description, where a brief
// pause mid-sentence would otherwise cut recording off early. continuous:
// true keeps listening until a final result or an explicit stop() call.
const SPEECH_RECOGNITION_OPTIONS = {
  lang: "en-US",
  interimResults: true,
  continuous: true,
} as const;

export function AddAgentTaskSheet({ isPresented, onClose, profiles, initialMention }: AddAgentTaskSheetProps) {
  const theme = useTheme();
  const scheme = useColorScheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const sheetRef = useRef<any>(null);
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [recognizing, setRecognizing] = useState(false);
  // Mentions rendered inline in `text` as literal "@Name" characters — see
  // MentionRange's doc comment. Each fans out to its own independent task
  // on submit (see handleSend).
  const [mentions, setMentions] = useState<MentionRange[]>([]);
  const [cursor, setCursor] = useState(0);
  // Only set right after we programmatically move the cursor ourselves
  // (selectMention below) — passed as BottomSheetTextInput's `selection`
  // prop for exactly one render to actually command the NATIVE cursor
  // there, then cleared. `cursor` alone is pure JS-side bookkeeping (used
  // by findActiveMentionQuery) and setting it does NOT move the real
  // native cursor — RN's TextInput only syncs its native selection when a
  // `selection` prop is actually passed and differs from what the native
  // side last reported. Without this, selecting a mention updated our own
  // `cursor` state while the real caret stayed wherever it natively was
  // before the text was replaced, which is what caused the cursor to
  // visibly land in the wrong place after picking a suggestion.
  const [forcedSelection, setForcedSelection] = useState<{ start: number; end: number } | null>(null);

  const activeMention = useMemo(() => findActiveMentionQuery(text, cursor, mentions), [text, cursor, mentions]);
  const suggestions = useMemo(
    () => (activeMention ? rankMentionSuggestions(profiles, activeMention.query) : []),
    [activeMention, profiles],
  );

  const handleChangeText = (newText: string) => {
    const { text: reconciledText, mentions: reconciledMentions } = reconcileMentionEdit(text, newText, mentions);
    setText(reconciledText);
    setMentions(reconciledMentions);
  };

  const selectMention = (suggestion: MentionSuggestion) => {
    if (!activeMention) return;
    // Replace the "@query" span that triggered this suggestion with the
    // full "@Name" — inline, right where the user was typing. A trailing
    // space is appended too (so the user can keep typing straight into the
    // rest of the sentence without needing to type the space themselves),
    // but it's deliberately NOT included in the mention's own range — it's
    // ordinary text the user can freely edit/delete on its own without
    // taking the atomic mention down with it, exactly like a space typed
    // by hand anywhere else.
    const mentionText = `@${suggestion.name}`;
    const insertedText = `${mentionText} `;
    const before = text.slice(0, activeMention.start);
    const after = text.slice(activeMention.start + 1 + activeMention.query.length);
    const nextText = `${before}${insertedText}${after}`;
    const insertedRange: MentionRange = {
      start: activeMention.start,
      end: activeMention.start + mentionText.length,
      profileId: suggestion.profileId,
      name: suggestion.name,
      source: suggestion.source,
      identifier: suggestion.identifier,
    };
    // Ranges after the replaced span shift by the length delta between the
    // old "@query" span and the new full "@Name " (with trailing space) text.
    const delta = insertedText.length - (1 + activeMention.query.length);
    const shiftedExisting = mentions.map((m) =>
      m.start >= activeMention.start ? { ...m, start: m.start + delta, end: m.end + delta } : m,
    );
    const nextCursor = insertedRange.end + 1; // +1 to land after the trailing space, not before it.
    setText(nextText);
    setMentions([...shiftedExisting, insertedRange].sort((a, b) => a.start - b.start));
    setCursor(nextCursor);
    // Actually commands the native cursor there (see forcedSelection's doc
    // comment above) — setCursor alone only updates our own bookkeeping.
    setForcedSelection({ start: nextCursor, end: nextCursor });
  };

  // Glow from the bottom of the sheet while actively listening — a slow
  // breathing pulse, not tied to any single transcript update.
  const glowOpacity = useSharedValue(0);
  // A separate, snappier pulse on the input itself each time new transcript
  // text actually arrives — the "text coming in with subtle magic" cue,
  // distinct from the steady listening glow above.
  const textArrivalPulse = useSharedValue(0);

  useEffect(() => {
    if (isPresented) {
      sheetRef.current?.present();
    } else {
      sheetRef.current?.dismiss();
    }
  }, [isPresented]);

  useEffect(() => {
    if (recognizing) {
      glowOpacity.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.ease) }),
          withTiming(0.4, { duration: 1200, easing: Easing.inOut(Easing.ease) }),
        ),
        -1,
        true,
      );
    } else {
      glowOpacity.value = withTiming(0, { duration: 300 });
    }
  }, [recognizing, glowOpacity]);

  useEffect(() => {
    if (isPresented) {
      if (initialMention) {
        // Seeds the same shape selectMention itself produces (a real
        // "@Name" mention range, not literal text), optionally wrapped in
        // plain prefix/suffix text — see initialMention's own doc comment
        // for the default vs. Reply-dialog shapes.
        const prefix = initialMention.prefix ?? "Send ";
        const suffix = initialMention.suffix ?? ": ";
        const mentionText = `@${initialMention.name}`;
        setText(`${prefix}${mentionText}${suffix}`);
        setMentions([{
          start: prefix.length,
          end: prefix.length + mentionText.length,
          profileId: initialMention.profileId,
          name: initialMention.name,
          source: initialMention.source,
          identifier: initialMention.identifier,
        }]);
        setCursor(prefix.length + mentionText.length + suffix.length);
      } else {
        setText("");
        setMentions([]);
        setCursor(0);
      }
      setForcedSelection(null);
      setSubmitting(false);
      // Recording starts automatically the moment the sheet opens for a
      // blank task — but NOT when opened with a seeded mention: dictation
      // replaces the ENTIRE transcript on every partial result (see the
      // "result" speech event below), which would immediately destroy the
      // seeded prefill the instant the mic picks up the first spoken word.
      // The user can still tap the mic manually once they've seen/kept the
      // prefilled text. Permission is requested here too since this is the
      // first thing that happens on open, not a user-initiated tap; a
      // denial just leaves the mic idle and the user can still type.
      if (!initialMention) {
        (async () => {
          const result = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
          if (!result.granted) return;
          ExpoSpeechRecognitionModule.start(SPEECH_RECOGNITION_OPTIONS);
        })();
      }
    } else {
      // Leaving the sheet mid-dictation shouldn't leave the mic listening in
      // the background — matches tapping the mic button to stop.
      ExpoSpeechRecognitionModule.stop();
    }
    // initialMention deliberately excluded — this effect's job is "seed
    // state at the MOMENT the sheet opens" (guarded by isPresented), not
    // "keep state synced to whatever initialMention currently is" — the
    // caller passes a fresh value each time it opens the sheet, but
    // re-running this on every parent re-render while already open would
    // clobber whatever the user has since typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPresented]);

  useSpeechRecognitionEvent("start", () => setRecognizing(true));
  useSpeechRecognitionEvent("end", () => setRecognizing(false));
  useSpeechRecognitionEvent("result", (event) => {
    const transcript = event.results[0]?.transcript;
    if (transcript) {
      // Dictation replaces the whole transcript on every partial result
      // (not an incremental append), so this is never mixed with typed
      // @mentions in practice — routed through handleChangeText anyway to
      // keep `mentions` correctly reconciled rather than silently stale.
      handleChangeText(transcript);
      // Snap up then ease back down — a quick, subtle flash each time new
      // words land, distinct from the slow ambient listening glow.
      textArrivalPulse.value = 1;
      textArrivalPulse.value = withTiming(0, { duration: 500, easing: Easing.out(Easing.ease) });
    }
  });
  useSpeechRecognitionEvent("error", (event) => {
    console.warn("[AddAgentTaskSheet] Speech recognition error:", event.error, event.message);
    setRecognizing(false);
  });

  const toggleDictation = async () => {
    if (recognizing) {
      ExpoSpeechRecognitionModule.stop();
      return;
    }
    // Typing and dictating are mutually exclusive here — starting to record
    // should immediately get the keyboard out of the way, not leave it
    // sitting open while also listening.
    Keyboard.dismiss();
    const result = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!result.granted) return;
    ExpoSpeechRecognitionModule.start(SPEECH_RECOGNITION_OPTIONS);
  };

  const handleSend = async () => {
    if (!text.trim() || submitting) return;
    setSubmitting(true);
    try {
      if (recognizing) ExpoSpeechRecognitionModule.stop();
      // Always a self-issued task against the reserved synced profile —
      // @mentions never change WHERE the task is created or WHICH send
      // tool it runs through; they're purely a disambiguation aid for the
      // triage LLM. Each mention's "@Name" span is replaced IN PLACE (not
      // stripped + appended at the end) with buildMentionContextBlock's
      // machine-readable block, so the LLM sees exactly which profile is
      // meant right where it was referenced in the sentence — e.g. "tell
      // [Referring to: Nick Harty, gmail, profile id xyz] about the
      // update". Substituted right-to-left by position so earlier offsets
      // stay valid as later ones get replaced with a longer string.
      const sentence = mentions
        .slice()
        .sort((a, b) => b.start - a.start)
        .reduce(
          (acc, m) => acc.slice(0, m.start) + buildMentionContextBlock(m.name, m.identifier, m.source as string, m.profileId) + acc.slice(m.end),
          text,
        );
      await createSyncedAgentTask(sentence);
      onClose();
      // The home list is already live-sorted by each conversation's most
      // recent message timestamp (see home.tsx's sortedConversations), so
      // this new message alone is what puts Synced at the top — no manual
      // reordering needed. router.navigate (not push/replace) is what
      // gives the "only if not already there" behavior: it reuses the
      // existing home screen instance already in the stack rather than
      // stacking a duplicate or forcing a fresh mount if the user is
      // already on it (e.g. sending from home.tsx itself).
      router.navigate("/(main)/home");
    } finally {
      setSubmitting(false);
    }
  };

  const canSend = text.trim().length > 0 && !submitting;

  const glowStyle = useAnimatedStyle(() => ({ opacity: glowOpacity.value }));
  // Fully invisible at rest (0), only flashing briefly to full opacity right
  // as new words land, then easing back out — not a permanently-visible bar.
  const textArrivalStyle = useAnimatedStyle(() => ({
    opacity: textArrivalPulse.value,
  }));

  return (
    <BottomSheetModal ref={sheetRef} enablePanDownToClose onDismiss={onClose} snapPoints={["55%"]}>
      <BottomSheetView style={styles.sheetFill}>
        <View style={[styles.container, { paddingBottom: insets.bottom, paddingTop: Math.max(insets.top, 16) }]}>
          {/* Ambient glow rising from the bottom of the sheet while
              actively listening — a soft, slow breathing pulse in the
              app's own primary color, purely atmospheric (pointerEvents
              "none" so it never intercepts touches meant for the footer
              button above it). */}
          <Animated.View pointerEvents="none" style={[styles.glow, glowStyle]}>
            <Svg width="100%" height="100%">
              <Defs>
                {/* Radial gradient centered on the bottom-middle edge, fully
                    opaque there and fading to fully transparent outward —
                    a real soft glow (RN's shadowRadius/shadowOffset on a
                    plain View does NOT blur anything; it just draws the
                    view's own flat-filled rectangle, which read as a hard
                    solid block here). */}
                <RadialGradient id="glowGradient" cx="50%" cy="100%" r="75%">
                  <Stop offset="0%" stopColor={theme.primary} stopOpacity={0.55} />
                  <Stop offset="60%" stopColor={theme.primary} stopOpacity={0.18} />
                  <Stop offset="100%" stopColor={theme.primary} stopOpacity={0} />
                </RadialGradient>
              </Defs>
              <Rect x="0" y="0" width="100%" height="100%" fill="url(#glowGradient)" />
            </Svg>
          </Animated.View>

          <View style={styles.body}>
            <View style={styles.inputWrapper}>
              {/* Only mounted once a mention exists — the overlay+
                  transparent-input stacking below is unnecessary work (and
                  unnecessary risk) for the common no-mention case, which
                  keeps rendering exactly as before this feature. */}
              {mentions.length > 0 && (
                <View pointerEvents="none" style={styles.textOverlayWrap}>
                  <MentionTextOverlay text={text} mentions={mentions} textStyle={[styles.textInput, { color: theme.surface }]} />
                </View>
              )}
              <BottomSheetTextInput
                value={text}
                onChangeText={handleChangeText}
                // Only passed right after selectMention deliberately moves
                // the cursor (see forcedSelection's doc comment) — RN's
                // TextInput ignores/no-ops a `selection` prop that already
                // matches its own last-reported native selection, so
                // leaving this defined on every render (rather than null
                // outside that one moment) wouldn't fight normal typing,
                // but is kept minimal/explicit anyway rather than relying
                // on that no-op behavior.
                selection={forcedSelection ?? undefined}
                onSelectionChange={(e: any) => {
                  setCursor(e.nativeEvent.selection.end);
                  // The native side just reported its real selection —
                  // whether or not it matches what we forced, our job here
                  // is done; holding a stale forced value would fight the
                  // user's own next cursor move (tap-to-position, arrow
                  // keys, etc).
                  if (forcedSelection) setForcedSelection(null);
                }}
                onFocus={() => {
                  // Tapping into the input to type by hand means the user
                  // is done dictating — same mutual-exclusivity as above,
                  // just triggered from the other direction.
                  if (recognizing) ExpoSpeechRecognitionModule.stop();
                }}
                placeholder={recognizing ? "Listening for Agent Task..." : "New Agent Task.\ne.g. Draft a follow-up to the Acme team about pricing. Type @ to mention someone."}
                placeholderTextColor={theme.muted}
                multiline
                scrollEnabled
                // Once mentions exist, the overlay above renders the actual
                // visible glyphs — this input's own text is made transparent
                // (not removed) so typing/cursor/selection/caret all keep
                // working exactly like a normal TextInput, just invisible
                // text sitting on top of the styled overlay underneath.
                style={[
                  styles.textInput,
                  { color: mentions.length > 0 ? "transparent" : theme.surface },
                ]}
              />
              {/* A quick, subtle highlight bar under the input flashes each
                  time new transcribed words actually land — distinct from
                  the steady glow above, this is the "text arriving with a
                  bit of magic" cue. */}
              <Animated.View
                pointerEvents="none"
                style={[styles.textArrivalBar, { backgroundColor: theme.primary }, textArrivalStyle]}
              />
            </View>
          </View>

          {/* Rendered as a normal (non-absolutely-positioned) sibling
              between `body` and `footer` — NOT floated over the input.
              inputWrapper is flex:1 and nearly fills the whole sheet, so an
              absolutely-positioned dropdown anchored "above" it via
              bottom:"100%" had nowhere to grow and got clipped against the
              sheet's own top edge; anchoring it to a fixed pixel offset
              below the input broke as soon as the typed text wrapped past
              one line, since it would sit on TOP of the second line
              instead of below all of it. Taking real layout space here
              means it always sits fully below the input's current height,
              however many lines that is, pushing the footer down slightly
              while a suggestion list is showing — a transient, self-
              correcting state, not a bug. */}
          <MentionAutocomplete suggestions={suggestions} onSelect={selectMention} />

          <View
            style={[
              styles.footer,
              { paddingBottom: Math.max(insets.bottom, 16) },
            ]}
          >
            {/* Mic on the left, send on the right — same round glass-button
                treatment as HitlApproveMode.tsx's own approve footer
                (glassBtn: 60x60, borderRadius 30, GlassView blur with a
                translucent-color fallback where GlassView isn't
                available), so this sheet's controls read as the same
                control family as the rest of the app's action rows instead
                of the previous single full-width "Complete with Synced"
                bar. */}
            <Pressable onPress={toggleDictation} style={styles.glassBtn}>
              {Platform.OS === "ios" && GlassView
                ? <GlassView style={[StyleSheet.absoluteFill, styles.glassFillRadius]} colorScheme={scheme} glassEffectStyle="regular" />
                : <View style={[StyleSheet.absoluteFill, styles.glassFillRadius, { backgroundColor: theme.card }]} />}
              <Microphone
                size={22}
                color={recognizing ? "#FF3B30" : theme.surface}
                weight={recognizing ? "fill" : "regular"}
              />
            </Pressable>
            <Pressable
              onPress={handleSend}
              disabled={!canSend}
              style={({ pressed }) => [styles.glassBtn, { opacity: pressed || !canSend ? 0.6 : 1 }]}
            >
              {Platform.OS === "ios" && GlassView
                ? <GlassView style={[StyleSheet.absoluteFill, styles.glassFillRadius]} colorScheme={scheme} glassEffectStyle="regular" />
                : <View style={[StyleSheet.absoluteFill, styles.glassFillRadius, { backgroundColor: theme.card }]} />}
              {submitting
                ? <ActivityIndicator color={theme.primary} size="small" />
                : <ArrowUp size={22} color={theme.primary} weight="bold" />}
            </Pressable>
          </View>
        </View>
      </BottomSheetView>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  // BottomSheetView itself needs flex:1 too, otherwise it just wraps its
  // content and the snapPoints height on BottomSheetModal has nothing
  // beneath it to actually stretch.
  sheetFill: { flex: 1 },
  // Fills the sheet's real height (from snapPoints={["55%"]} on
  // BottomSheetModal above — an explicit height, not the default
  // shrink-to-content sizing) so body can flex to fill everything above the
  // footer, keeping the send button pinned to the actual bottom instead of
  // trailing right after however tall the input happens to be.
  container: { flex: 1 },
  body: {
    flex: 1,
    paddingHorizontal: 14,
    paddingTop: 4,
    paddingBottom: 8,
  },
  inputWrapper: {
    flex: 1,
    position: "relative",
  },
  // Absolutely fills the exact same box `textInput` occupies (inputWrapper
  // is `position: relative` with textInput as its sole flex:1 child, so
  // top/left/right/bottom: 0 here lands on the identical rect). Must NOT
  // set flex:1 itself — an absolutely-positioned view ignores flex sizing
  // from its parent and needs explicit edges instead.
  textOverlayWrap: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  textInput: {
    flex: 1,
    paddingHorizontal: 2,
    paddingTop: 6,
    fontSize: 20,
    // Explicit, not left to the platform default — TextInput and Text can
    // resolve to subtly different default system fonts on iOS when
    // unstyled, which is exactly the kind of small per-character width
    // mismatch that compounds into a visibly drifting cursor the more
    // text is typed (confirmed: "cursor is a letter behind" after typing
    // further into the sentence). Setting the SAME loaded font explicitly
    // here (and MentionTextOverlay.tsx inherits it via this same style
    // object) removes that font-identity ambiguity entirely.
    fontFamily: "Inter_400Regular",
    textAlignVertical: "top",
  },
  // Container for the real SVG radial-gradient glow (see the RadialGradient
  // usage above) — sized generously so the gradient has room to fade to
  // fully transparent well before its edges.
  glow: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: -60,
    height: 220,
    opacity: 0,
  },
  // No longer inset from the right for a floating mic button (the mic
  // moved out to the footer) — spans the input's full width.
  textArrivalBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 2,
    borderRadius: 1,
  },
  // Row layout, buttons pushed to opposite ends — mic on the left, send on
  // the right (see this file's usage comment). No top border/background
  // bar behind them anymore now that this isn't one full-width primary
  // button; the two round glass buttons read as floating controls, same
  // as HitlApproveMode.tsx's own approve footer.
  footer: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  // Matches HitlApproveMode.tsx's own glassBtn exactly (60x60, borderRadius
  // 30, GlassView blur — see this file's usage comment for why).
  glassBtn: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  glassFillRadius: { borderRadius: 30 },
});
