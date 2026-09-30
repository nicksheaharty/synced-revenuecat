import { useRef, useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, Image, ActivityIndicator, Pressable, useWindowDimensions, Alert } from "react-native";
import { Envelope, ChatCircle, GoogleDriveLogo, MicrosoftOutlookLogo, MicrosoftTeamsLogo, SlackLogo, ArrowRight, DotsThreeVertical } from "phosphor-react-native";
import { BottomSheetModal, BottomSheetView, BottomSheetScrollView } from "@expo/ui/community/bottom-sheet";
import { MenuView } from "@expo/ui/community/menu";
import { Task, HumanInputRequest, Profile, deriveAvatarInitials, deriveGroupDisplayName, resolveProfileAvatarUri, markTasksInactive } from "../services/storage";
import { useTheme } from "../hooks/useTheme";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHitlAnswerState } from "./useHitlAnswerState";
import { HitlQuestionsMode } from "./HitlQuestionsMode";
import { HitlApproveMode, HitlApproveModeFooter, HitlRepromptMode } from "./HitlApproveMode";
import { HitlApproveCalendarMode } from "./HitlApproveCalendarMode";
import { GmailIcon, SyncedIcon } from "./SimpleIcons";
import { GROUP_CLUSTER_CELL_STYLES } from "./MessageCard";

const SOURCE_ICON: Record<string, React.ComponentType<any>> = {
  gmail: GmailIcon,
  outlook: MicrosoftOutlookLogo,
  imessage: ChatCircle,
  drive: GoogleDriveLogo,
  slack: SlackLogo,
  teams: MicrosoftTeamsLogo,
  whatsapp: ChatCircle,
  // Generic "email" — used when draftMetadata.medium says this specific
  // draft is an email even though the TASK itself came from a different
  // source (e.g. a Slack task where the sender asked "send this to my
  // email"). Deliberately not resolved to gmail/outlook specifically here —
  // this component doesn't know which provider the user has connected, and
  // guessing would just trade one wrong badge for a different wrong one.
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
  task: Task | null;
  request: HumanInputRequest | null;
  // Solo (1:1) task — the caller resolves this by looking task.profileId up
  // against the `profiles` array. Undefined for a group task (see
  // groupMembers below) — never both set.
  profile?: Profile;
  // Group task — the caller resolves this by looking task.profileId up
  // against `groupThreads`/`profiles` (see GroupThread.id's "group_" prefix
  // convention). Undefined for a solo (1:1) task.
  groupMembers?: Profile[];
  groupSource?: Profile["source"];
  contactImageUri?: string;
  isPresented: boolean;
  onClose: () => void;
  // Fired right before onClose, but ONLY when the human actually submitted an
  // answer (vs. tapping away / pan-down-to-dismiss). Lets the caller
  // distinguish "answered, may need to auto-reopen for a chained pause" from
  // "user backed out, leave it alone" without both paths sharing one signal.
  onAnswered?: () => void;
}

/**
 * Bottom-sheet shell for answering a HumanInputRequest. All the actual
 * mode-specific UI (HitlQuestionsMode / HitlApproveMode /
 * HitlApproveCalendarMode) and state (useHitlAnswerState) are shared with
 * LightningCard, which renders the same mode components inside a swipeable
 * card shell instead of a bottom sheet.
 */
export function HumanInputSheet({ task, request, profile, groupMembers, groupSource, contactImageUri, isPresented, onClose, onAnswered }: Props) {
  const isGroupTask = !!groupMembers?.length;
  // Reply-All's threadParticipants/threadType (see HitlApproveMode) need
  // real names now, resolved from each member's own solo Profile — not the
  // old embedded {identifier,name?} array. threadType only ever needs to
  // distinguish "is there more than one other person" for that button's
  // gate, so any group task here is 'group' regardless of member count.
  const threadParticipants = isGroupTask
    ? groupMembers!.map((m) => ({ identifier: m.platformIdentifier, name: m.name }))
    : (profile ? [{ identifier: profile.platformIdentifier, name: profile.name }] : undefined);
  const threadType: "oneOnOne" | "group" | undefined = isGroupTask ? "group" : (profile ? "oneOnOne" : undefined);
  // Same cap/layout as MessageCard.tsx's home-list cluster and the
  // conversation page's nav header — real per-member photos nested in a
  // circle, not a single generic initials circle for the whole group.
  const groupAvatarParticipants = isGroupTask ? groupMembers!.slice(0, 4) : [];
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const sheetRef = useRef<any>(null);
  const [dismissing, setDismissing] = useState(false);
  // Same underlying write (markTasksInactive) and confirmation copy as
  // LightningCard's identical handleDismiss — marks the task resolved
  // without answering the HITL request at all (no submit(), no send/
  // approve). Exposed via the 3-dot menu next to the header, matching
  // LightningCard's dismissMenu.
  const handleDismiss = useCallback(() => {
    if (!task) return;
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
            try {
              await markTasksInactive([task.id]);
              onClose();
            } catch (e) {
              console.error("[HumanInputSheet] Failed to dismiss task:", e);
            } finally {
              setDismissing(false);
            }
          },
        },
      ],
    );
  }, [task, onClose]);
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
        {dismissing ? <ActivityIndicator size="small" color={theme.muted} /> : <DotsThreeVertical size={18} color={theme.muted} weight="bold" />}
      </View>
    </MenuView>
  );
  // The task's own profile.source is only the DEFAULT medium — the model
  // can send THIS SPECIFIC draft through a different channel than where the
  // request came in (e.g. a Slack task where the sender asked "send this to
  // my email"), and flags that via request.draftMetadata.medium (see
  // requestHumanInputSchema in functions/src/langchain/tools.ts). Only
  // meaningful for mode="approve" (the only mode with draftMetadata at all)
  // — falls back to profile.source whenever the model didn't set it
  // (unambiguous same-medium case, or an older draft predating this field).
  const effectiveSource =
    request?.mode === "approve" && request.draftMetadata?.medium
      ? request.draftMetadata.medium
      : (profile?.source ?? groupSource);
  // Slack and Teams drafts both use a platform user ID as the recipient
  // (no email, no CC concept) — see useHitlAnswerState's isSlack doc
  // comment for why this stays named isSlack rather than being renamed.
  // Driven by effectiveSource (not profile.source directly) so a
  // cross-medium email reply from a Slack/Teams task correctly renders a
  // real "To" email field instead of a platform-ID lookup. "synced" joins
  // this group too — it likewise has a single fixed, non-removable,
  // non-email recipient (this same profile) rather than an editable list.
  const isPlatformIdRecipient = effectiveSource === "slack" || effectiveSource === "teams" || effectiveSource === "synced";
  // This task's own mailbox provider (NOT effectiveSource, which can cross
  // mediums for a single draft) — powers the From dropdown's account list.
  const taskMailboxProvider = profile?.source ?? groupSource;
  const state = useHitlAnswerState(
    task, request, onAnswered, onClose, isPlatformIdRecipient,
    effectiveSource === "synced" ? profile?.platformIdentifier : undefined,
    taskMailboxProvider === "gmail" || taskMailboxProvider === "outlook" ? taskMailboxProvider : undefined,
  );
  const { mode, stepIndex, totalSteps, canAdvance, submitting, handleNext, repromptOpen } = state;
  // Sheet auto-sizes to content up to the "large" detent — this caps the
  // scrollable body short of the full screen (leaving room for the header
  // chrome above the sheet) so it actually becomes scrollable rather than
  // just growing indefinitely with fitToContents.
  const { height: windowHeight } = useWindowDimensions();
  const scrollBodyMaxHeight = windowHeight * 0.75;

  useEffect(() => {
    if (isPresented) {
      sheetRef.current?.present();
    } else {
      sheetRef.current?.dismiss();
    }
  }, [isPresented]);

  // Avatar circle color stays tied to the CONTACT's own profile.source
  // (who you're talking to) — only the badge/tag below reflects the
  // per-draft effectiveSource (where THIS message is actually going).
  // "synced" has no real external brand color (see MessageCard.tsx's
  // identical srcColor treatment) — follows the app's own adaptive
  // theme.primary instead of the fixed SOURCE_COLORS purple.
  const avatarColor = effectiveSource ? (effectiveSource === "synced" ? theme.primary : (SOURCE_COLORS[effectiveSource] ?? "#888")) : "#888";
  const badgeColor = effectiveSource ? (effectiveSource === "synced" ? theme.primary : (SOURCE_COLORS[effectiveSource] ?? "#888")) : avatarColor;
  const BadgeIcon = effectiveSource ? (SOURCE_ICON[effectiveSource] ?? Envelope) : Envelope;
  const avatarUri = resolveProfileAvatarUri(profile?.customAvatarUri, contactImageUri, profile?.avatarUri);
  const avatarInitials = deriveAvatarInitials(profile?.name, profile?.senderInitial);

  // Reprompt (mode="approve" or "approve_calendar") is a dedicated
  // full-page screen — see HitlRepromptMode's own doc comment — that
  // replaces the entire sheet body (header/draft/footer) rather than
  // swapping just the footer's buttons, so it visually matches the
  // mode="questions" step-by-step flow instead of reading as an inline
  // correction to the draft still showing above it. Shared across both
  // approve modes (previously approve_calendar had its own separate
  // inline reprompt row inside HitlApproveCalendarMode — unified here so
  // both reprompt flows look and behave identically).
  if ((mode === "approve" || mode === "approve_calendar") && repromptOpen) {
    return (
      <BottomSheetModal ref={sheetRef} enablePanDownToClose onDismiss={onClose}>
        <BottomSheetView>
          <View style={styles.container}>
            <HitlRepromptMode state={state} bottomInset={insets.bottom} />
          </View>
        </BottomSheetView>
      </BottomSheetModal>
    );
  }

  return (
    <BottomSheetModal ref={sheetRef} enablePanDownToClose onDismiss={onClose}>
      <BottomSheetView>
        <View style={[styles.container, { paddingBottom: mode === "approve" || mode === "approve_calendar" ? 0 : insets.bottom }]}>
        <BottomSheetScrollView style={[styles.scrollBody, { maxHeight: scrollBodyMaxHeight }]} showsVerticalScrollIndicator={false}>

          {profile && profile.source === "synced" ? (
            // Keyed off the profile's own source, NOT effectiveSource — a
            // synced task's reply can cross mediums (e.g. "send this to
            // Aum's email"), where effectiveSource becomes "email" even
            // though this is still fundamentally a self-issued task. The
            // minimal header (no avatar, no name/badge clutter) should stay
            // minimal regardless of where THIS particular draft ends up
            // going — the real destination is already shown in the
            // To field below, so the header doesn't need to repeat it. A
            // synced self-request has no external sender to show — an
            // avatar + "Synced"/"Synced" name+badge pair would just repeat
            // itself (see MessageCard.tsx's identical isSyncedProfile
            // treatment). mode="approve" for this medium already reads as a
            // delivered-result card (see HitlApproveMode's isSynced layout).
            // Still shows the "Synced" source badge, though — same sourceTag
            // block the non-synced branch renders, just without the
            // avatar/name it'd otherwise sit next to — so it's still clear
            // at a glance which medium this card is even when there's no
            // external sender identity to show. Still renders an empty
            // spacer View even with no badge/step counter — the mode body
            // below has no top padding of its own (shared with
            // LightningCard's card shell, which needs the same spacer for
            // the identical reason — see its own copy of this comment).
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
              {mode === "questions" && totalSteps > 1 && (
                <Text style={[styles.progress, { color: theme.muted, fontFamily: "Inter_500Medium" }]}>
                  {stepIndex + 1}/{totalSteps}
                </Text>
              )}
              {task && dismissMenu}
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
                  {!isPlatformIdRecipient && !isGroupTask && (
                    <Text style={[styles.platformId, { color: theme.muted, fontFamily: "Inter_400Regular" }]} numberOfLines={1}>
                      {profile!.platformIdentifier}
                    </Text>
                  )}
                </View>
              </View>
              {mode === "questions" && totalSteps > 1 && (
                <Text style={[styles.progress, { color: theme.muted, fontFamily: "Inter_500Medium" }]}>
                  {stepIndex + 1}/{totalSteps}
                </Text>
              )}
              {task && dismissMenu}
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
              maxDraftInputHeight={420}
              recipientNames={isPlatformIdRecipient && profile?.platformIdentifier ? { [profile.platformIdentifier]: profile.name } : undefined}
              isSynced={effectiveSource === "synced"}
              threadParticipants={threadParticipants}
              threadType={threadType}
            />
          )}
          {mode === "approve_calendar" && <HitlApproveCalendarMode state={state} bottomInset={insets.bottom} />}

        </BottomSheetScrollView>
        {mode === "questions" && (
          <View style={[styles.footer, { borderTopColor: theme.separator, paddingBottom: Math.max(insets.bottom, 16) }]}>
            <Pressable
              style={({ pressed }) => [
                styles.btnPrimary,
                { backgroundColor: theme.primary, opacity: pressed || submitting || !canAdvance ? 0.4 : 1 },
              ]}
              onPress={handleNext}
              disabled={submitting || !canAdvance}
            >
              {submitting
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
        {mode === "approve" && <HitlApproveModeFooter state={state} bottomInset={insets.bottom} isSynced={effectiveSource === "synced"} />}
        </View>
      </BottomSheetView>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  container: {},
  scrollBody: {},
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 14,
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
  platformId: { fontSize: 11, maxWidth: 140 },
  progress: { fontSize: 13 },
  dismissMenuTrigger: { width: 24, height: 24, alignItems: "center", justifyContent: "center" },
  promptRow: {
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  prompt: {
    fontSize: 15,
    lineHeight: 22,
  },
  footer: {
    paddingHorizontal: 14,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 8,
  },
  btnPrimary: {
    height: 50,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  btnInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  btnPrimaryText: { color: "#FFF", fontSize: 15 },
});
