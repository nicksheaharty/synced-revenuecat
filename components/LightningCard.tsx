import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Image, ActivityIndicator, Pressable, Platform, ScrollView, Alert } from "react-native";
import { Envelope, ChatCircle, GoogleDriveLogo, MicrosoftOutlookLogo, MicrosoftTeamsLogo, SlackLogo, ArrowRight, CheckCircle, MinusCircle, DotsThreeVertical } from "phosphor-react-native";
import { MenuView } from "@expo/ui/community/menu";
import { Task, HumanInputRequest, Profile, Message, markTasksInactive, deriveAvatarInitials, deriveGroupDisplayName, resolveProfileAvatarUri } from "../services/storage";
import { useTheme } from "../hooks/useTheme";
import { useColorScheme } from "../hooks/useColorScheme";
import { useHitlAnswerState, HitlAnswerState } from "./useHitlAnswerState";
import { HitlQuestionsMode } from "./HitlQuestionsMode";
import { HitlApproveMode, HitlApproveModeFooter, HitlRepromptMode } from "./HitlApproveMode";
import { HitlApproveCalendarMode } from "./HitlApproveCalendarMode";
import { GmailIcon, SyncedIcon } from "./SimpleIcons";
import { GROUP_CLUSTER_CELL_STYLES } from "./MessageCard";
import { LinkifiedText } from "./LinkifiedText";

let GlassView: React.ComponentType<any> | null = null;
try { GlassView = require("expo-glass-effect").GlassView; } catch { }

// Same system-red used for every other destructive action in the app (the
// tab bar's delete-row, deliverables.tsx's delete bar) — Dismiss stops the
// agent and discards the pending request, so it reads as destructive too,
// not merely cautionary.
const DESTRUCTIVE_COLOR = "#FF3B30";

const SOURCE_ICON: Record<string, React.ComponentType<any>> = {
  gmail: GmailIcon,
  outlook: MicrosoftOutlookLogo,
  imessage: ChatCircle,
  drive: GoogleDriveLogo,
  slack: SlackLogo,
  teams: MicrosoftTeamsLogo,
  whatsapp: ChatCircle,
  // Generic "email" — see HumanInputSheet.tsx's identical entry for why this
  // exists: draftMetadata.medium can say a draft is an email even though the
  // task's own profile.source is something else (e.g. Slack).
  email: Envelope,
  synced: SyncedIcon,
};

const SOURCE_COLORS: Record<string, string> = {
  gmail: "#EA4335",
  outlook: "#0078D4",
  imessage: "#30D158",
  drive: "#34A853",
  slack: "#E01E5A",
  teams: "#6264A7",
  whatsapp: "#25D366",
  email: "#8E8E93",
  synced: "#4429F2",
};

const SOURCE_DISPLAY: Record<string, string> = {
  gmail: "Gmail",
  outlook: "Outlook",
  imessage: "iMessage",
  drive: "Drive",
  slack: "Slack",
  teams: "Microsoft Teams",
  whatsapp: "WhatsApp",
  email: "Email",
  synced: "Synced",
};

interface Props {
  task: Task;
  request: HumanInputRequest;
  profile?: Profile;
  /** Present instead of `profile` when this task belongs to a GroupThread
   * rather than a solo Profile — see HumanInputSheet.tsx's identical props
   * for why the two are split rather than folded into one shape. */
  groupMembers?: Profile[];
  groupSource?: Profile["source"];
  /** The specific inbound message this HITL pause is about, if resolvable
   * (see HumanInputRequest.messageId — only present on requests created
   * after that field was added). */
  triggeringMessage?: Message;
  onAnswered: () => void;
  /** Fires the INSTANT a real answer is submitted — synchronously, before
   * the 650ms checkmark-overlay delay and before onAnswered. Lets the
   * parent deck snapshot this task immediately, so it can keep rendering
   * it (and this card's exit animation + checkmark) even once the task
   * vanishes from any live Firestore-backed list within that delay
   * window. Optional since not every consumer needs the extra signal. */
  onAnswering?: () => void;
  /** Whether this card should render its glass background right now. Plain
   * boolean, deliberately never driven by an animated/worklet value —
   * GlassView's native UIVisualEffectView renders incorrectly at any alpha
   * < 1 on itself or any ancestor (per Apple's own docs), and a
   * worklet-driven toggle previously raced against separately-animated
   * opacity and broke intermittently. Switches glassEffectStyle discretely
   * between 'regular' and 'none' in the same render as any visibility
   * change, never mid-transition. Defaults to true. */
  visible?: boolean;
}

/**
 * One card in the Lightning-mode swipeable deck — a compact preview of the
 * message the HITL request is about, followed by the same shared mode
 * component (HitlQuestionsMode / HitlApproveMode / HitlApproveCalendarMode)
 * HumanInputSheet renders inside its bottom sheet. Submitting an answer
 * calls onAnswered so the parent deck can remove this card; there is no
 * "decline"/dismiss action here distinct from the mode's own approve/decline
 * buttons — swiping the card only reorders the deck (see LightningScreen),
 * it never submits or discards an answer.
 */
export function LightningCard({ task, request, profile, groupMembers, groupSource, triggeringMessage, onAnswered, onAnswering, visible = true }: Props) {
  const theme = useTheme();
  const scheme = useColorScheme();
  const canUseGlass = Platform.OS === "ios" && !!GlassView;
  const GV = GlassView;
  const isGroupTask = !!groupMembers?.length;
  const threadParticipants = isGroupTask
    ? groupMembers!.map((m) => ({ identifier: m.platformIdentifier, name: m.name }))
    : (profile ? [{ identifier: profile.platformIdentifier, name: profile.name }] : undefined);
  const threadType: "oneOnOne" | "group" | undefined = isGroupTask ? "group" : (profile ? "oneOnOne" : undefined);
  // Same cap/layout as MessageCard.tsx's home-list cluster and the
  // conversation page's nav header — real per-member photos nested in a
  // circle, not a single generic initials circle for the whole group.
  const groupAvatarParticipants = isGroupTask ? groupMembers!.slice(0, 4) : [];
  // Shows a brief checkmark confirmation instead of the card instantly
  // being replaced by the next one the moment submit() resolves — the deck
  // advance (onAnswered) is deliberately delayed until after the overlay
  // has had a moment to be seen. "dismissed" is a distinct sentinel (not a
  // real HitlAnswerState mode) for the "Dismiss" shortcut below, which
  // skips useHitlAnswerState.submit() entirely.
  const [justAnswered, setJustAnswered] = useState(false);
  const [answeredMode, setAnsweredMode] = useState<HitlAnswerState["mode"] | "dismissed" | null>(null);
  const answeredTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [dismissing, setDismissing] = useState(false);
  // Snapshot the mode at answer-time (not read live) — after a successful
  // submit, state.mode may already have advanced to a new chained question
  // before this overlay's 650ms delay elapses, which would otherwise show
  // the wrong confirmation label.
  const modeRef = useRef<HitlAnswerState["mode"]>("questions");
  const handleAnswered = useCallback(() => {
    onAnswering?.();
    setAnsweredMode(modeRef.current);
    setJustAnswered(true);
    answeredTimeoutRef.current = setTimeout(() => {
      onAnswered();
    }, 650);
  }, [onAnswered, onAnswering]);
  useEffect(() => {
    return () => {
      if (answeredTimeoutRef.current) clearTimeout(answeredTimeoutRef.current);
    };
  }, []);
  // "Dismiss" shortcut — marks the task inactive without answering the
  // HITL request at all (no submit(), no send/approve). Uses the same
  // underlying write (markTasksInactive) as the existing profile/task-row
  // "Resolve" actions elsewhere (see conversation/[profileId].tsx's
  // handleResolveTask and home.tsx's confirmResolveProfile) — same effect,
  // different label here since this specific spot reads as discarding the
  // pending request rather than resolving a finished task.
  const handleDismiss = useCallback(() => {
    Alert.alert(
      "Dismiss Task?",
      `"${task.title}" will be marked resolved${task.assignee === "agent" ? " and the agent will stop working on it" : ""}.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Dismiss",
          style: "destructive",
          onPress: async () => {
            setDismissing(true);
            onAnswering?.();
            try {
              await markTasksInactive([task.id]);
            } catch (e) {
              console.error("[LightningCard] Failed to dismiss task:", e);
            } finally {
              setDismissing(false);
            }
            setAnsweredMode("dismissed");
            setJustAnswered(true);
            answeredTimeoutRef.current = setTimeout(() => {
              onAnswered();
            }, 650);
          },
        },
      ],
    );
  }, [task, onAnswering, onAnswered]);
  // onClose intentionally omitted (undefined) — a card has no "dismiss"
  // concept of its own the way a bottom sheet does; onAnswered alone is
  // enough for the deck to react to a real submit.
  // 3-dot menu trigger — replaces the old always-visible plain-text
  // "Dismiss" link (matches connector-settings/[id].tsx's identical
  // MenuView/DotsThreeVertical pattern for a per-row overflow action).
  // handleDismiss already shows its own destructive Alert.alert
  // confirmation before actually dismissing, so this menu only needs the
  // one action — no double confirmation layer needed here.
  const dismissMenu = (
    <MenuView
      onPressAction={({ nativeEvent }) => {
        if (nativeEvent.event === "dismiss") handleDismiss();
      }}
      actions={[
        { id: "dismiss", title: "Dismiss", image: "minus.circle", attributes: { destructive: true } },
      ]}
    >
      <View style={styles.dismissMenuTrigger} hitSlop={8}>
        <DotsThreeVertical size={18} color={theme.muted} weight="bold" />
      </View>
    </MenuView>
  );
  // The task's own profile.source is only the DEFAULT medium — the model can
  // send THIS SPECIFIC draft through a different channel than where the
  // request came in (e.g. a Slack task where the sender asked "send this to
  // my email"), flagged via request.draftMetadata.medium (see
  // HumanInputSheet.tsx for the identical fix this mirrors). Falls back to
  // profile.source whenever the model didn't set it.
  const effectiveSource =
    request?.mode === "approve" && request.draftMetadata?.medium
      ? request.draftMetadata.medium
      : (profile?.source ?? groupSource);
  // Slack and Teams drafts both use a platform user ID as the recipient
  // (no email, no CC concept) — see useHitlAnswerState's isSlack doc
  // comment for why this stays named isSlack rather than being renamed.
  // Driven by effectiveSource so a cross-medium email reply from a
  // Slack/Teams task correctly renders a real "To" email field. "synced"
  // joins this group too (see the identical fix in HumanInputSheet.tsx).
  const isPlatformIdRecipient = effectiveSource === "slack" || effectiveSource === "teams" || effectiveSource === "synced";
  // This task's own mailbox provider (NOT effectiveSource, which can cross
  // mediums for a single draft) — powers the From dropdown's account list.
  const taskMailboxProvider = profile?.source ?? groupSource;
  const state = useHitlAnswerState(
    task, request, handleAnswered, undefined, isPlatformIdRecipient,
    effectiveSource === "synced" ? profile?.platformIdentifier : undefined,
    taskMailboxProvider === "gmail" || taskMailboxProvider === "outlook" ? taskMailboxProvider : undefined,
  );
  const { mode, stepIndex, totalSteps, repromptOpen } = state;
  modeRef.current = mode;

  // Avatar circle color stays tied to the CONTACT's own profile.source (who
  // you're talking to) — only the badge/tag below reflects the per-draft
  // effectiveSource (where THIS message is actually going). "synced" has no
  // real external brand color (see MessageCard.tsx's identical srcColor
  // treatment) — follows the app's own adaptive theme.primary instead.
  const avatarColor = effectiveSource ? (effectiveSource === "synced" ? theme.primary : (SOURCE_COLORS[effectiveSource] ?? "#888")) : "#888";
  const badgeColor = effectiveSource ? (effectiveSource === "synced" ? theme.primary : (SOURCE_COLORS[effectiveSource] ?? "#888")) : avatarColor;
  const BadgeIcon = effectiveSource ? (SOURCE_ICON[effectiveSource] ?? Envelope) : Envelope;
  const avatarUri = resolveProfileAvatarUri(profile?.customAvatarUri, profile?.avatarUri);
  const avatarInitials = isGroupTask
    ? deriveAvatarInitials(deriveGroupDisplayName(groupMembers!), undefined)
    : deriveAvatarInitials(profile?.name, profile?.senderInitial);

  return (
    <View style={styles.shadowWrap}>
    <View style={[styles.card, { borderColor: theme.cardBorder }]}>
      {canUseGlass && GV
        ? <GV
            style={StyleSheet.absoluteFill}
            colorScheme={scheme}
            // Plain string driven by plain React state — see the `visible`
            // prop doc comment. Never animated through a fractional state.
            glassEffectStyle={visible ? "regular" : "none"}
          />
        : <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.card }]} />}
      {/* Reprompt (mode="approve" or "approve_calendar") is a dedicated
          full-page screen — see HitlRepromptMode's own doc comment — that
          replaces the entire card body (header/draft/footer) instead of
          swapping just the footer's buttons, matching HumanInputSheet's
          identical branch. Shared across both approve modes now — see
          that file's own comment on why approve_calendar's separate inline
          reprompt row was unified here. */}
      {(mode === "approve" || mode === "approve_calendar") && repromptOpen ? (
        <HitlRepromptMode state={state} bottomInset={16} />
      ) : (
      <>
      {/* Header/message-preview/mode-body scroll independently of the
          footer below — a card's content (e.g. several question options, or
          a long approve-mode draft) can be taller than the fixed stack slot
          this renders in (see StackCard/answer.tsx's CARD_HEIGHT), and
          unlike HumanInputSheet's BottomSheetScrollView equivalent, this
          isn't inside a real bottom sheet, so a plain ScrollView is used
          instead. The footer (questions' Next/Submit, or approve's
          Reprompt/Send) stays pinned outside it, always reachable without
          scrolling — mirroring HumanInputSheet's identical split. */}
      <ScrollView
        style={styles.scrollBody}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
      {profile && profile.source === "synced" ? (
        // Keyed off profile.source, NOT effectiveSource — see the identical
        // fix in HumanInputSheet.tsx: a synced task's reply can cross
        // mediums (e.g. "send this to Aum's email"), where effectiveSource
        // becomes "email" even though this is still a self-issued task. The
        // minimal header stays minimal (no avatar/name) regardless of where
        // this particular draft is actually going, but still shows the
        // "Synced" source badge — same sourceTag block the non-synced
        // branch renders below, just without the avatar/name it'd otherwise
        // sit next to — so it's still clear at a glance which medium this
        // card is. Still renders an empty spacer View even with no badge/
        // step counter — the mode body below (HitlQuestionsMode's
        // promptRow / HitlApproveMode's deliveredWrap) has no top padding
        // of its own since it's shared with HumanInputSheet's bottom sheet,
        // which gets its own top space from the drag handle instead.
        <View style={styles.cardHeader}>
          <View style={styles.headerText}>
            <View style={styles.metaRow}>
              <View style={[styles.sourceTag, { backgroundColor: badgeColor + "20" }]}>
                <BadgeIcon size={10} color={badgeColor} weight="duotone" />
                <Text style={[styles.sourceTagText, { color: badgeColor, fontFamily: "Inter_500Medium" }]}>
                  {(effectiveSource && SOURCE_DISPLAY[effectiveSource]) ?? effectiveSource}
                </Text>
              </View>
            </View>
          </View>
          <View style={styles.headerRightCol}>
            {mode === "questions" && totalSteps > 1 && (
              <Text style={[styles.progress, { color: theme.muted, fontFamily: "Inter_500Medium" }]}>
                {stepIndex + 1}/{totalSteps}
              </Text>
            )}
            {dismissing ? <ActivityIndicator size="small" color={theme.muted} /> : dismissMenu}
          </View>
        </View>
      ) : (profile || isGroupTask) && (
        <View style={styles.cardHeader}>
          {isGroupTask ? (
            <View style={styles.groupAvatarCluster}>
              {groupAvatarParticipants.map((member, i) => {
                const memberAvatarUri = resolveProfileAvatarUri(member.customAvatarUri, member.avatarUri);
                const cellStyle = GROUP_CLUSTER_CELL_STYLES[groupAvatarParticipants.length]?.[i];
                return (
                  <View
                    key={member.id}
                    style={[
                      styles.groupAvatarCell,
                      cellStyle,
                      { backgroundColor: theme.muted, experimental_backgroundImage: theme.avatarGradient, borderColor: theme.card },
                    ]}
                  >
                    {memberAvatarUri ? (
                      <Image source={{ uri: memberAvatarUri }} style={styles.groupAvatarImage} />
                    ) : (
                      <Text style={[styles.groupAvatarText, { fontFamily: "Inter_700Bold" }]}>
                        {deriveAvatarInitials(member.name, member.senderInitial)}
                      </Text>
                    )}
                  </View>
                );
              })}
            </View>
          ) : (
            <View style={[styles.avatar, { backgroundColor: theme.muted, experimental_backgroundImage: theme.avatarGradient }]}>
              {avatarUri
                ? <Image source={{ uri: avatarUri }} style={styles.avatarImage} />
                : <Text style={[styles.avatarText, { fontFamily: "Inter_700Bold" }]}>{avatarInitials}</Text>
              }
            </View>
          )}
          <View style={styles.headerText}>
            <Text style={[styles.senderName, { color: theme.surface, fontFamily: "Inter_600SemiBold" }]}>
              {isGroupTask ? deriveGroupDisplayName(groupMembers!) : profile!.name}
            </Text>
            <View style={styles.metaRow}>
              <View style={[styles.sourceTag, { backgroundColor: badgeColor + "20" }]}>
                <BadgeIcon size={10} color={badgeColor} weight="duotone" />
                <Text style={[styles.sourceTagText, { color: badgeColor, fontFamily: "Inter_500Medium" }]}>
                  {(effectiveSource && SOURCE_DISPLAY[effectiveSource]) ?? effectiveSource}
                </Text>
              </View>
            </View>
          </View>
          <View style={styles.headerRightCol}>
            {mode === "questions" && totalSteps > 1 && (
              <Text style={[styles.progress, { color: theme.muted, fontFamily: "Inter_500Medium" }]}>
                {stepIndex + 1}/{totalSteps}
              </Text>
            )}
            {dismissing ? <ActivityIndicator size="small" color={theme.muted} /> : dismissMenu}
          </View>
        </View>
      )}

      {/* Compact preview of the message this HITL is about — same chat
          bubble treatment as MessageCard's own incoming-message bubble
          (theme.bubbleIn), so this reads as "the actual message", not a
          separate quoted/flat box. Skipped for "synced" tasks: the
          triggering message is just the human's own request text repeated
          back at them (there's no separate sender to give context about),
          and HitlApproveMode's isSynced "delivered result" layout below
          already carries all the context that matters here. */}
      {triggeringMessage && effectiveSource !== "synced" && (
        <View style={styles.messagePreviewWrap}>
          {!!triggeringMessage.subject && (
            <Text style={[styles.messageSubject, { color: theme.muted, fontFamily: "Inter_600SemiBold" }]} numberOfLines={1}>
              {triggeringMessage.subject}
            </Text>
          )}
          <View
            style={[
              styles.messageBubble,
              { backgroundColor: theme.bubbleIn, borderTopLeftRadius: 4 },
            ]}
          >
            <LinkifiedText
              text={triggeringMessage.text}
              numberOfLines={3}
              ellipsizeMode="tail"
              style={[styles.messageBubbleText, { fontFamily: "Inter_400Regular", color: theme.surface }]}
              linkStyle={{ color: theme.primary, textDecorationLine: "underline" }}
            />
          </View>
        </View>
      )}

      {mode === "approve_calendar" && (
        <View style={styles.promptRow}>
          <Text style={[styles.prompt, { color: theme.surface, fontFamily: "Inter_500Medium" }]}>
            {state.eventDraft?.eventId ? "Review calendar update" : "Review calendar invite"}
          </Text>
        </View>
      )}
      {mode === "questions" && <HitlQuestionsMode state={state} />}
      {mode === "approve" && (
        <HitlApproveMode
          state={state}
          maxDraftInputHeight={200}
          recipientNames={isPlatformIdRecipient && profile?.platformIdentifier ? { [profile.platformIdentifier]: profile.name } : undefined}
          isSynced={effectiveSource === "synced"}
          threadParticipants={threadParticipants}
          threadType={threadType}
        />
      )}
      {mode === "approve_calendar" && <HitlApproveCalendarMode state={state} bottomInset={16} />}
      </ScrollView>

      {/* Footer pinned outside the scroll body — always reachable without
          scrolling, mirroring HumanInputSheet's identical split. */}
      {mode === "questions" && (
        <View style={styles.footer}>
          <Pressable
            style={({ pressed }) => [
              styles.btnPrimary,
              { backgroundColor: theme.primary, opacity: pressed || state.submitting || !state.canAdvance ? 0.4 : 1 },
            ]}
            onPress={state.handleNext}
            disabled={state.submitting || !state.canAdvance}
          >
            {state.submitting
              ? <ActivityIndicator color="#FFF" size="small" />
              : <View style={styles.btnInner}>
                  <Text style={[styles.btnPrimaryText, { fontFamily: "Inter_600SemiBold" }]}>
                    {state.isLastQuestion ? "Submit" : "Next"}
                  </Text>
                  {!state.isLastQuestion && <ArrowRight size={16} color="#FFF" weight="bold" />}
                </View>
            }
          </Pressable>
        </View>
      )}
      {mode === "approve" && <HitlApproveModeFooter state={state} bottomInset={16} isSynced={effectiveSource === "synced"} />}
      </>
      )}

      {justAnswered && (
        <View style={[styles.answeredOverlay, { backgroundColor: theme.card }]}>
          {answeredMode === "dismissed"
            ? <MinusCircle size={56} color={DESTRUCTIVE_COLOR} weight="fill" />
            : <CheckCircle size={56} color="#30D158" weight="fill" />}
          <Text style={[styles.answeredText, { color: theme.surface, fontFamily: "Inter_600SemiBold" }]}>
            {answeredMode === "dismissed" ? "Dismissed" : answeredMode === "approve" ? "Sent" : answeredMode === "approve_calendar" ? "Done" : "Answered"}
          </Text>
        </View>
      )}
    </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Shadow lives on this outer wrapper, not `card` — `card` needs
  // overflow:"hidden" to clip the glass fill to its rounded corners, and
  // overflow:"hidden" clips shadows too, so the shadow has to be on an
  // unclipped ancestor instead.
  shadowWrap: {
    borderRadius: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 20,
    elevation: 10,
  },
  card: {
    maxHeight: "100%",
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  // flexShrink lets this actually shrink to fit within `card`'s maxHeight
  // cap instead of growing the card unbounded — without it, a ScrollView
  // as a plain (non-flex) child just sizes to its content like any other
  // View, and the ability to scroll never kicks in. This is what makes a
  // tall card's mode body (many question options, a long approve draft)
  // scroll instead of clipping past the fixed stack slot in answer.tsx.
  scrollBody: { flexShrink: 1 },
  scrollContent: { paddingBottom: 20 },
  answeredOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  answeredText: { fontSize: 17 },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 10,
    gap: 10,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
  },
  avatarImage: { width: 36, height: 36, borderRadius: 18 },
  avatarText: { color: "#FFF", fontSize: 15 },
  // Same 36x36 frame as `avatar` above, holding a cluster of small ROUND
  // circles (one per member) via GROUP_CLUSTER_CELL_STYLES — matches
  // MessageCard.tsx's home-list cluster and the conversation page's nav
  // header exactly, instead of a single generic initials circle.
  groupAvatarCluster: { width: 36, height: 36 },
  groupAvatarCell: {
    position: "absolute",
    borderRadius: "50%",
    borderWidth: 1.5,
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
  },
  groupAvatarImage: { width: "100%", height: "100%", borderRadius: 999 },
  groupAvatarText: { color: "#FFF", fontSize: 10 },
  headerText: { flex: 1 },
  senderName: { fontSize: 14, marginBottom: 3 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  sourceTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  sourceTagText: { fontSize: 10 },
  headerRightCol: { alignItems: "flex-end", gap: 4 },
  progress: { fontSize: 13 },
  dismissMenuTrigger: { width: 24, height: 24, alignItems: "center", justifyContent: "center" },
  messagePreviewWrap: {
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  messageSubject: { fontSize: 12, marginBottom: 6 },
  messageBubble: {
    alignSelf: "flex-start",
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
    maxWidth: "100%",
  },
  messageBubbleText: { fontSize: 14, lineHeight: 20 },
  promptRow: { paddingHorizontal: 16, paddingBottom: 12 },
  prompt: { fontSize: 15, lineHeight: 22 },
  footer: { paddingHorizontal: 14, paddingTop: 14, paddingBottom: 16 },
  btnPrimary: {
    height: 50,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  btnInner: { flexDirection: "row", alignItems: "center", gap: 6 },
  btnPrimaryText: { color: "#FFF", fontSize: 15 },
});
