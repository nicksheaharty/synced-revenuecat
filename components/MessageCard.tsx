import React, { useState, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Image,
} from "react-native";
import { useRouter } from "expo-router";
import {
  ArrowBendUpLeft,
  CalendarBlank,
  CheckSquare,
  Check,
  PencilSimple,
  Bell,
  MagnifyingGlass,
  Envelope,
  MicrosoftOutlookLogo,
  MicrosoftTeamsLogo,
  GoogleDriveLogo,
  SlackLogo,
  ChatCircle,
  Lightning,
  CaretDown,
  CaretUp,
  Warning,
  FilePdf,
  FileText,
  FileCsv,
  File,
  MicrosoftExcelLogo,
  MicrosoftWordLogo,
  MicrosoftPowerpointLogo,
  QuestionMark,
  UserCheck,
  Minus,
} from "phosphor-react-native";
import { Profile, ConversationRow, Task, saveTask, Deliverable, Message, deriveAvatarInitials, deriveGroupDisplayName, resolveProfileAvatarUri } from "../services/storage";
import { useUser } from "../contexts/UserContext";
import { viewFile } from "../services/fileViewer";
import { HumanInputSheet } from "./HumanInputSheet";
import { GmailIcon, SyncedIcon } from "./SimpleIcons";
import { LinkifiedText } from "./LinkifiedText";

const SOURCE_ICON: Record<string, React.ComponentType<any>> = {
  gmail: GmailIcon,
  outlook: MicrosoftOutlookLogo,
  slack: SlackLogo,
  teams: MicrosoftTeamsLogo,
  imessage: ChatCircle,
  drive: GoogleDriveLogo,
  synced: SyncedIcon,
};

const SOURCE_COLORS: Record<string, string> = {
  gmail: "#EA4335",
  outlook: "#0078D4",
  slack: "#E01E5A",
  teams: "#6264A7",
  imessage: "#30D158",
  drive: "#34A853",
  synced: "#4429F2",
};

const DISPLAY_NAMES: Record<string, string> = {
  gmail: "Gmail",
  outlook: "Outlook",
  slack: "Slack",
  teams: "Microsoft Teams",
  imessage: "iMessage",
  drive: "Drive",
  synced: "Synced",
};

const TASK_ICON: Record<string, React.ComponentType<any>> = {
  reply_draft: PencilSimple,
  calendar_event: CalendarBlank,
  reminder: Bell,
  document_search: MagnifyingGlass,
};

// Per-member small ROUND avatar placement inside the fixed 36x36 group
// avatar circle (styles.groupAvatarCluster) — matches iMessage's own group
// icon exactly: actual little circles nested inside the outer circle (not
// square/pie tiles filling it edge-to-edge), sized down as member count
// grows and centered as a cluster. 1 member is one big circle roughly
// filling the outer ring; 2 is two overlapping circles side by side; 3 is
// one on top-center, two below; 4 is a tight 2x2 of small circles. All
// values are percentages of the 36x36 container so this scales
// automatically if groupAvatarCluster's fixed size ever changes. Each
// cell's width/height are equal (a true circle, not an oval) and
// styles.groupAvatarCell applies borderRadius: "50%" to round it.
// Exported so app/conversation/[profileId].tsx's nav-bar group avatar (a
// larger version of the same cluster) reuses this exact layout table instead
// of duplicating it — both must stay visually identical.
export const GROUP_CLUSTER_CELL_STYLES: Record<number, { top: `${number}%`; left: `${number}%`; width: `${number}%`; height: `${number}%` }[]> = {
  1: [
    { top: "6%", left: "6%", width: "88%", height: "88%" },
  ],
  2: [
    { top: "14%", left: "0%", width: "62%", height: "62%" },
    { top: "24%", left: "38%", width: "62%", height: "62%" },
  ],
  3: [
    { top: "0%", left: "24%", width: "52%", height: "52%" },
    { top: "48%", left: "0%", width: "52%", height: "52%" },
    { top: "48%", left: "48%", width: "52%", height: "52%" },
  ],
  4: [
    { top: "0%", left: "0%", width: "50%", height: "50%" },
    { top: "0%", left: "50%", width: "50%", height: "50%" },
    { top: "50%", left: "0%", width: "50%", height: "50%" },
    { top: "50%", left: "50%", width: "50%", height: "50%" },
  ],
};

const FILE_TYPE_COLORS: Record<
  string,
  { bg: string; text: string; icon: React.ComponentType<any> }
> = {
  pdf: { bg: "rgba(255, 59, 48, 0.1)", text: "#FF3B30", icon: FilePdf },
  docx: {
    bg: "rgba(0, 122, 255, 0.1)",
    text: "#007AFF",
    icon: MicrosoftWordLogo,
  },
  xlsx: {
    bg: "rgba(52, 199, 89, 0.1)",
    text: "#34C759",
    icon: MicrosoftExcelLogo,
  },
  pptx: {
    bg: "rgba(255, 149, 0, 0.1)",
    text: "#FF9500",
    icon: MicrosoftPowerpointLogo,
  },
  other: { bg: "rgba(142, 142, 147, 0.1)", text: "#8E8E93", icon: File },
};

/**
 * Derives every per-task display flag/color TimelineRow needs from a single
 * Task — the shared single source of truth ActionTimeline, AllTasksSheet,
 * and the collapsed toggle row's single-task preview all call, instead of
 * each recomputing the same isRunning/isFailed/.../iconBg/titleColor logic
 * independently (previously duplicated three times, easy to let drift).
 * Exported for app/conversation/[profileId].tsx, which reuses it (alongside
 * TimelineRow below) to render this profile's tasks inline in the message
 * thread, the same way they render in AllTasksSheet.
 */
export function deriveTimelineRowState(task: Task, theme: Record<string, string>) {
  const isHumanTask = task.assignee === "human";
  const isRunning = !isHumanTask && (task.status === "pending" || task.status === "in_progress");
  const isFailed = task.status === "failed";
  const isCompleted = task.status === "completed";
  const isInactive = task.status === "inactive";
  const isHitl = !isHumanTask && task.status === "awaiting_human_input";
  const isPendingForHuman = isHumanTask && !isCompleted && !isInactive;
  const primaryDel = task.requiredDeliverables[0];
  const Icon = TASK_ICON[primaryDel?.type] ?? CheckSquare;

  // Completed (and inactive) tasks are done, finished business — rendered
  // noticeably more subdued than anything still live/actionable (running,
  // failed, needing approval, pending-for-you), so the eye is drawn to what
  // actually needs attention rather than a checkmark that reads with the
  // same visual weight as an active warning or approval prompt.
  const isDone = isCompleted || isInactive;
  const iconBg = isFailed
    ? "rgba(255, 59, 48, 0.12)"
    : isHitl
      ? theme.actionBg
      : isPendingForHuman
        ? theme.searchBg
        : isDone
          ? theme.searchBg
          : theme.actionBg;
  const lineColor = isFailed
    ? "rgba(255, 59, 48, 0.25)"
    : isHitl
      ? theme.actionBorder
      : theme.separator;
  const titleColor = isFailed
    ? "#FF3B30"
    : isDone || isPendingForHuman
      ? theme.muted
      : theme.surface;

  return { isHumanTask, isRunning, isFailed, isCompleted, isInactive, isHitl, isPendingForHuman, iconBg, lineColor, titleColor, Icon };
}

interface Props {
  // A conversation row is either a solo Profile (1:1) or a GroupThread (2+
  // people) — see ConversationRow in services/storage.ts. `members` is
  // already resolved (looked up against the loaded profiles array) by the
  // caller (home.tsx) for the group case.
  conversation: ConversationRow;
  tasks: Task[];
  isAnalyzing: boolean;
  theme: Record<string, string>;
  scheme: string;
  contactImageUri?: string;
  onHitlPress?: (task: Task) => void;
  onPress?: () => void;
  // Precomputed once per screen by the caller (home.tsx: groupDeliverablesByTask
  // over the full account deliverables list, memoized on that list's
  // identity) and threaded down here — NOT recomputed per card. Building
  // this involves a sort + dedup over every deliverable the account has;
  // doing that independently inside every rendered card (the old behavior)
  // meant N cards each redid the same full-array work on every deliverables
  // update. See groupDeliverablesByTask's own doc comment in services/storage.ts.
  taskDeliverablesMap: Map<string, Deliverable[]>;
}

export function formatLocalTimestamp(dateStr: string): string {
  if (!dateStr) return "Just now";

  let date = new Date(dateStr);

  // Gracefully handle legacy UTC time-only strings (e.g., "05:00 PM")
  const legacyTimeMatch = dateStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (legacyTimeMatch) {
    let hours = parseInt(legacyTimeMatch[1], 10);
    const minutes = parseInt(legacyTimeMatch[2], 10);
    const ampm = legacyTimeMatch[3].toUpperCase();
    if (ampm === "PM" && hours < 12) hours += 12;
    if (ampm === "AM" && hours === 12) hours = 0;

    const parsedDate = new Date();
    parsedDate.setUTCHours(hours, minutes, 0, 0);
    date = parsedDate;
  }

  if (isNaN(date.getTime())) {
    return dateStr;
  }

  try {
    const now = new Date();

    // Check if it is today
    if (date.toDateString() === now.toDateString()) {
      let hours = date.getHours();
      const minutes = date.getMinutes();
      const ampm = hours >= 12 ? "PM" : "AM";
      hours = hours % 12;
      hours = hours ? hours : 12; // 0 hour is 12
      const minutesStr = minutes < 10 ? "0" + minutes : minutes;
      return `${hours}:${minutesStr} ${ampm}`;
    }

    // Check if it was yesterday
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) {
      return "Yesterday";
    }

    // Otherwise show month and day
    const months = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    return `${months[date.getMonth()]} ${date.getDate()}`;
  } catch {
    return dateStr;
  }
}

/**
 * Whether a profile's card renders as the full "highlighted" card (vs. the
 * flat/transparent recessed treatment) — the single source of truth for
 * that visual distinction, so anything sorting/filtering by "highlighted"
 * (see home.tsx) can't drift out of sync with what MessageCard itself
 * actually renders. Mirrors MessageCard's internal useFlatLayout exactly:
 * highlighted = NOT (latest message is outgoing AND no open tasks).
 */
export function isCardHighlighted(tasks: Task[], latestMessage: Message | null): boolean {
  const isLatestOutgoing = latestMessage?.direction === "out";
  const agentTasks = tasks.filter(
    (t) => t.assignee === "agent" || t.status === "awaiting_human_input",
  );
  const hasRunning = agentTasks.some((t) => t.status === "pending" || t.status === "in_progress");
  const hasHitl = agentTasks.some(
    (t) => t.status === "awaiting_human_input" && t.humanInputRequest && !t.humanInputRequest.answer,
  );
  // A task still running OR genuinely awaiting review ("Tap to Review")
  // always keeps the card highlighted, even if the latest visible message
  // happens to be an outgoing reply (e.g. the agent already sent one
  // finished result but is still working on / waiting on another) — "still
  // needs attention" is a stronger signal than "the last message we see was
  // ours."
  if (hasRunning || hasHitl) return true;

  const hasFailed = agentTasks.some((t) => t.status === "failed");
  // A task moved to My Tasks (assignee "human") is now the human's own
  // responsibility to work, not something this specific conversation card
  // needs to keep surfacing — it no longer keeps the card highlighted by
  // itself (see My Tasks / app/(main)/tasks.tsx for where it's actually
  // tracked and actioned).
  const hasNoOpenTasks = !hasFailed;
  const useFlatLayout = isLatestOutgoing || hasNoOpenTasks;
  return !useFlatLayout;
}

function MessageCard({
  conversation,
  tasks,
  isAnalyzing,
  theme,
  scheme,
  contactImageUri,
  onHitlPress,
  onPress,
  taskDeliverablesMap,
}: Props) {
  const { messages } = useUser();

  // Group-thread header treatment (like iMessage's group chats): a joined
  // "Spencer, Charlie & Rishab" name and a stacked multi-avatar cluster
  // (each member's REAL photo, resolved from their own solo Profile —
  // see GroupThread in services/storage.ts for why members are resolved
  // via memberProfileIds rather than embedded) instead of a single circle.
  const isGroupThread = conversation.kind === "group";
  const profile = conversation.kind === "solo" ? conversation.profile : undefined;
  const groupMembers = conversation.kind === "group" ? conversation.members : [];

  // Unified identity fields — every render site below reads these instead
  // of reaching into `profile`/`conversation` directly, so the rest of this
  // component's rendering logic doesn't need to branch on solo vs. group.
  const id = conversation.kind === "solo" ? conversation.profile.id : conversation.group.id;
  const name = conversation.kind === "solo" ? conversation.profile.name : (conversation.group.name ?? deriveGroupDisplayName(groupMembers));
  const source = conversation.kind === "solo" ? conversation.profile.source : conversation.group.source;
  const analyzed = conversation.kind === "solo" ? conversation.profile.analyzed : conversation.group.analyzed;
  const platformIdentifier = conversation.kind === "solo" ? conversation.profile.platformIdentifier : undefined;

  const profileMessages = useMemo(
    () => messages
      // kind "calendar_event" is an internal breadcrumb (dedup guard for the
      // agent, not user-facing) — exclude it so the inbox preview shows the
      // agent's actual reply instead of "Calendar event created: ...".
      .filter((m) => m.profileId === id && m.kind !== "calendar_event")
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()),
    [messages, id],
  );
  const latestMessage = profileMessages[0] ?? null;

  // Every other platform's source tag stays a fixed brand color regardless
  // of theme (Gmail red, Slack pink, etc. never change with dark/light
  // mode) — but "synced" has no real external brand color of its own, so it
  // follows the app's own adaptive primary instead of the fixed SOURCE_COLORS
  // purple, matching the running-automation row's color exactly in both modes.
  const srcColor = source === "synced" ? theme.primary : (SOURCE_COLORS[source] ?? "#888");
  const SrcIcon = SOURCE_ICON[source] ?? Envelope;
  const avatarUri = profile ? resolveProfileAvatarUri(profile.customAvatarUri, contactImageUri, profile.avatarUri) : undefined;
  const avatarInitials = profile ? deriveAvatarInitials(profile.name, profile.senderInitial) : "";

  // Cap the visible mini-avatars at 4 (matches iMessage's own group icon) —
  // a real group could have many more members than fit legibly inside one
  // 36pt circle. A 5th+ member is silently dropped from the icon itself
  // (iMessage does the same — the full member list is always still visible
  // once you open the conversation, this is just the icon).
  const groupAvatarParticipants = groupMembers.slice(0, 4);
  const groupDisplayName = name;

  const agentTasks = tasks.filter(
    (t) => t.assignee === "agent" || t.status === "awaiting_human_input",
  );
  const runningAgentTasks = agentTasks.filter(
    (t) => t.status === "pending" || t.status === "in_progress",
  );
  const hitlTasks = agentTasks.filter(
    (t) =>
      t.status === "awaiting_human_input" &&
      t.humanInputRequest &&
      !t.humanInputRequest.answer,
  );

  // Tasks the agent deferred entirely to a human (reassign_to_human) — e.g.
  // "go get me a coffee", something outside the agent's tools. Kept OUT of
  // agentTasks (which drives the running/HITL count above) but shown in the
  // same timeline with their own icon, and reflects "completed" the moment
  // the human checks it off in My Tasks (same Task doc, same status field).
  const humanReassignedTasks = tasks.filter((t) => t.assignee === "human");
  const timelineTasks = [...agentTasks, ...humanReassignedTasks];

  // The collapsed toggle row shows the single most-recent task's own
  // title/status inline (see TimelineRow) instead of a generic count
  // sentence — the dropdown below it then only needs to list what came
  // BEFORE that one, since it's already visible above the dropdown.
  // Exception: with 2+ tasks combined across running + awaiting approval (in
  // any mix — 2 running, 2 HITL, or 1 of each), no single task is
  // representative of "what's happening," so this falls back to a
  // collapsible summary instead. Pure running or pure HITL get their own
  // specific label; a genuine mix gets a generic "N tasks need attention"
  // label since neither word alone would describe every task in the count.
  const sortedTimelineTasks = [...timelineTasks].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const activeAttentionCount = runningAgentTasks.length + hitlTasks.length;
  const showMultiSummary = activeAttentionCount >= 2;
  const multiSummaryIsPureRunning = showMultiSummary && hitlTasks.length === 0;
  const multiSummaryIsPureHitl = showMultiSummary && runningAgentTasks.length === 0;
  // The inline expandable dropdown is for "what's still going on," not a
  // history log — finished business (completed/inactive) has nothing left
  // to act on and belongs in the AllTasksSheet modal (the "full history"
  // view opened by tapping the row), not cluttering this always-visible
  // card. Still-open work only: running, awaiting approval, or a
  // not-yet-completed human task.
  const activeSortedTimelineTasks = sortedTimelineTasks.filter(
    (t) => t.status !== "completed" && t.status !== "inactive",
  );
  // The collapsed single-task preview always prioritizes an ACTIVE task
  // (running or HITL) over a merely-more-recent completed one — a finished
  // task sitting on top of one still needing review/attention would bury
  // the thing that actually matters. Falls back to the newest task overall
  // only when nothing is active at all (everything's done/resolved).
  const latestTimelineTask = !showMultiSummary
    ? (activeSortedTimelineTasks[0] ?? sortedTimelineTasks[0])
    : undefined;
  // Mirrors TimelineRow's own isAwaitingReview — genuinely paused waiting on
  // an unanswered HITL request, not just "status happens to be
  // awaiting_human_input" (which also covers the broken/no-request case).
  // Drives the collapsed row body's tap target: reviewing this task
  // directly instead of opening AllTasksSheet.
  const isLatestAwaitingReview = !!(
    latestTimelineTask
    && latestTimelineTask.assignee === "agent"
    && latestTimelineTask.status === "awaiting_human_input"
    && latestTimelineTask.humanInputRequest
    && !latestTimelineTask.humanInputRequest.answer
  );
  // Non-multi-summary dropdown: everything active EXCEPT the latest task
  // (already shown above it in the collapsed row, no need to repeat it).
  // Multi-summary dropdown: everything active, newest first — the newest
  // active task naturally leads the list, which is exactly "the latest task
  // shown again first" per the user-confirmed expanded layout, with no
  // separate re-injection needed.
  const dropdownTasks = showMultiSummary
    ? activeSortedTimelineTasks
    : activeSortedTimelineTasks.filter((t) => t.id !== latestTimelineTask?.id);

  const [expanded, setExpanded] = useState(false);

  const handleRetryTask = async (taskToRetry: Task) => {
    const updated: Task = {
      ...taskToRetry,
      status: "pending",
      implementationPlan: taskToRetry.implementationPlan.map((step) => ({
        ...step,
        status: "pending",
        result: "",
      })),
      updatedAt: new Date().toISOString(),
    };
    await saveTask(updated);
  };


  // When the latest message is your own outgoing reply, the card sheds its
  // rounded/bordered "card" look for a plain full-width list-row look (like
  // a native Mail/Messages inbox row): edge-to-edge (negative margin cancels
  // the parent list's own horizontal padding), no rounding, no side borders
  // — just a faint tint and hairline top/bottom rules to separate it from
  // neighboring rows.
  // Outgoing-latest rows deliberately recede (no card fill, just a bottom
  // rule) so an incoming-latest card — which keeps its full rounded/bordered
  // treatment — visually pops in comparison. Content stays inside the same
  // horizontal inset as every other card (no edge-to-edge bleed) so avatars
  //
  // A "synced" profile is the special self-request conversation (created via
  // the Add Agent Task sheet — see services/storage.ts's
  // createSyncedAgentTask) — there's no external sender identity to show, so
  // the header below is stripped to just the source tag + timestamp instead
  // of a name/avatar-initial/platformIdentifier row that would otherwise
  // just repeat "Synced" / show the user's own uid. Timeline, bubble, and
  // HITL behavior are completely unchanged from any other profile.
  // and text line up exactly between consecutive rows regardless of type.
  const isLatestOutgoing = latestMessage?.direction === "out";

  // A conversation with nothing left to act on (no running/failed/HITL/
  // pending-human tasks — either fully completed or no tasks at all) gets
  // the same flat/condensed "sent card" treatment as an outgoing-latest
  // card, regardless of who sent the last message: chrome, preview row, and
  // tap-to-open-sheet behavior all follow this, not just isLatestOutgoing.
  // Delegates to the exported isCardHighlighted so home.tsx's sort can never
  // drift out of sync with what this component actually renders.
  const useFlatLayout = !isCardHighlighted(tasks, latestMessage);
  const isSyncedProfile = source === "synced";

  return (
    <View
      style={[
        styles.card,
        useFlatLayout
          ? {
              backgroundColor: "transparent",
              borderRadius: 0,
              borderWidth: 0,
              borderBottomWidth: StyleSheet.hairlineWidth,
              borderColor: theme.separator,
            }
          : { backgroundColor: theme.card, borderColor: theme.cardBorder },
      ]}
    >
      {/* Tappable preview area: header + bubble */}
      <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => ({ opacity: pressed && onPress ? 0.7 : 1 })}>
      {/* Header: avatar + name + meta — minimal variant for the "synced"
          self-request profile (no external sender identity to show; see
          isSyncedProfile's doc comment above). */}
      <View style={styles.header}>
        {!isSyncedProfile && (
          isGroupThread ? (
            // Fixed-size 36pt frame (identical footprint to the solo
            // avatar, so the header never grows/shifts by member count)
            // holding a cluster of small ROUND circles, one per member —
            // matches iMessage's own group icon exactly (real nested
            // circles, not tiled squares). Each circle's border is drawn in
            // the card's own background color, which is what actually
            // reads as the gap SEPARATING each person visually — without
            // it, adjacent circles sitting flush together would blur into
            // one blobby shape instead of a cluster of individuals. Each
            // member is their own solo Profile (see GroupThread in
            // services/storage.ts), so this shows their REAL photo when
            // they have one, falling back to initials only for a member
            // with no avatar on file.
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
                      {
                        backgroundColor: theme.muted,
                        experimental_backgroundImage: theme.avatarGradient,
                        borderColor: useFlatLayout ? theme.background : theme.card,
                      },
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
              {avatarUri ? (
                <Image
                  source={{ uri: avatarUri }}
                  style={styles.avatarImage}
                />
              ) : (
                <Text style={[styles.avatarText, { fontFamily: "Inter_700Bold" }]}>
                  {avatarInitials}
                </Text>
              )}
            </View>
          )
        )}
        <View style={styles.headerText}>
          {!isSyncedProfile && (
            <Text
              style={[
                styles.senderName,
                {
                  color: useFlatLayout ? theme.muted : theme.surface,
                  fontFamily: useFlatLayout ? "Inter_500Medium" : "Inter_600SemiBold",
                },
              ]}
              numberOfLines={1}
            >
              {name}
            </Text>
          )}
          <View style={styles.metaRow}>
            <View
              style={[styles.sourceTag, { backgroundColor: srcColor + "20" }]}
            >
              <SrcIcon size={10} color={srcColor} weight="duotone" />
              <Text
                style={[
                  styles.sourceTagText,
                  { color: srcColor, fontFamily: "Inter_500Medium" },
                ]}
              >
                {DISPLAY_NAMES[source] ?? source}
              </Text>
            </View>
            {!isGroupThread && source !== "slack" && source !== "teams" && !isSyncedProfile && (
              <>
                <Text
                  style={[
                    styles.platformIdentifier,
                    { color: theme.muted, fontFamily: "Inter_400Regular" },
                  ]}
                  numberOfLines={1}
                >
                  {platformIdentifier}
                </Text>
                <Text style={[styles.dotMuted, { color: theme.muted }]}>•</Text>
              </>
            )}
            <Text
              style={[
                styles.timestamp,
                { color: theme.muted, fontFamily: "Inter_400Regular" },
              ]}
            >
              {latestMessage ? formatLocalTimestamp(latestMessage.timestamp) : ""}
            </Text>
          </View>
        </View>
      </View>

      {/* Message preview. A card in flat layout (either your own outgoing
          reply, or an incoming message with nothing left to act on) renders
          as a plain condensed one-line row, no bubble, matching a
          traditional inbox list item rather than a chat bubble, since a big
          blue bubble reads oddly once the card itself has receded to a flat
          row. The back-arrow "you replied" icon only shows for an actually
          outgoing message — a resolved incoming message just shows its text
          plain, since you didn't send it. Otherwise (incoming with open
          tasks) it stays a real chat bubble. */}
      {latestMessage && (
        useFlatLayout ? (
          <View style={[styles.outPreviewRow, { paddingBottom: 10 }]}>
            {isLatestOutgoing && <ArrowBendUpLeft size={12} color={theme.muted} weight="bold" />}
            {/* disableLinks — this row is itself wrapped in an outer
                Pressable that navigates to the conversation on tap; a
                nested tappable link Text here would fight that gesture. */}
            <LinkifiedText
              text={latestMessage.text}
              numberOfLines={1}
              ellipsizeMode="tail"
              disableLinks
              style={[styles.outPreviewText, { color: theme.muted, fontFamily: "Inter_400Regular" }]}
            />
          </View>
        ) : (
          <View style={styles.bubbleRow}>
            <View style={[
              styles.bubble,
              { alignSelf: "flex-start", backgroundColor: theme.bubbleIn, borderTopLeftRadius: 4, borderTopRightRadius: 18 },
            ]}>
              <LinkifiedText
                text={latestMessage.text}
                numberOfLines={2}
                ellipsizeMode="tail"
                disableLinks
                style={[styles.bubbleText, { fontFamily: "Inter_400Regular", color: theme.surface }]}
              />
            </View>
          </View>
        )
      )}
      </Pressable>

      {/* Divider — omitted in flat layout, where there's no card surface to separate from. */}
      {!useFlatLayout && ((analyzed && timelineTasks.length > 0) || isAnalyzing) && (
        <View style={[styles.divider, { backgroundColor: theme.separator }]} />
      )}

      {/* Action area */}
      {((analyzed && timelineTasks.length > 0) || isAnalyzing) && (
        <View style={[styles.actionsArea, useFlatLayout && { paddingTop: 0 }]}>
          {isAnalyzing ? (
            <View style={styles.analyzingRow}>
              <ActivityIndicator size="small" color={theme.primary} />
              <Text
                style={[
                  styles.analyzingText,
                  { color: theme.muted, fontFamily: "Inter_400Regular" },
                ]}
              >
                Cooking...
              </Text>
            </View>
          ) : (
            <View>
              <Pressable
                style={styles.toggleRow}
                onPress={() => {
                  // Multi-summary is the one state that still expands
                  // inline (there's real extra info to reveal — which
                  // tasks) — no separate chevron needed, the whole row
                  // toggles. Every other state just opens the conversation,
                  // where every task for this profile is now viewable
                  // inline (see app/conversation/[profileId].tsx) — except
                  // a single latest task actually awaiting review, which
                  // goes straight to reviewing THAT task instead.
                  if (showMultiSummary) { setExpanded(!expanded); return; }
                  if (latestTimelineTask && isLatestAwaitingReview) {
                    onHitlPress?.(latestTimelineTask);
                    return;
                  }
                  onPress?.();
                }}
              >
                {showMultiSummary ? (
                  <View style={styles.toggleLeft}>
                    {/* Pure HITL gets the question-mark circle (nothing's
                        actually running, so a spinner would be misleading);
                        pure running OR a mix (something IS actively in
                        flight) gets the spinner — the more urgent visual
                        cue when both states are present at once. */}
                    {multiSummaryIsPureHitl ? (
                      <View style={[styles.toggleIconCircle, { backgroundColor: theme.actionBg }]}>
                        <QuestionMark size={11} color={theme.primary} weight="bold" />
                      </View>
                    ) : (
                      <ActivityIndicator
                        size="small"
                        color={theme.primary}
                        style={{ marginRight: 6, transform: [{ scale: 0.8 }] }}
                      />
                    )}
                    <Text
                      style={[
                        styles.toggleText,
                        { color: theme.primary, fontFamily: "Inter_600SemiBold" },
                      ]}
                    >
                      {multiSummaryIsPureRunning
                        ? `${runningAgentTasks.length} tasks running...`
                        : multiSummaryIsPureHitl
                          ? `${hitlTasks.length} waiting for approval...`
                          : `${activeAttentionCount} tasks need attention...`}
                    </Text>
                  </View>
                ) : (
                  latestTimelineTask && (
                    <View style={styles.latestTaskPreview}>
                      <TimelineRow
                        task={latestTimelineTask}
                        theme={theme}
                        onRetryTask={handleRetryTask}
                        {...deriveTimelineRowState(latestTimelineTask, theme)}
                        hasLineBelow={false}
                        isLastRow
                        taskFiles={taskDeliverablesMap.get(latestTimelineTask.id) || []}
                        interactive={false}
                        compact
                      />
                    </View>
                  )
                )}
                {showMultiSummary && (
                  expanded
                    ? <CaretUp size={14} color={theme.muted} weight="bold" />
                    : <CaretDown size={14} color={theme.muted} weight="bold" />
                )}
              </Pressable>
              {/* Renders regardless of useFlatLayout now — multi-summary
                  expand/collapse behaves identically whether this card is
                  flat or highlighted (see the user-confirmed priority: a
                  flat card can still have an active task underneath, and
                  tapping it to expand must actually show something). Rows
                  are always active-only (dropdownTasks) — completed/
                  resolved tasks never render here; the full history is
                  viewable inline in the conversation screen itself now. */}
              {expanded && dropdownTasks.length > 0 && (
                <View style={styles.timelineContainer}>
                  <ActionTimeline
                    tasks={dropdownTasks}
                    theme={theme}
                    onRetryTask={handleRetryTask}
                    onHitlPress={onHitlPress}
                    taskDeliverablesMap={taskDeliverablesMap}
                  />
                </View>
              )}
            </View>
          )}
        </View>
      )}

    </View>
  );
}

// Memoized — home.tsx re-renders on state changes unrelated to any single
// card's own props (contactImages, selected, editMode, etc.); without this,
// every visible card re-rendered on every one of those, even when its own
// conversation/tasks/theme/etc. props hadn't changed. Still re-renders when
// this card's `messages` (via useUser() inside, not a prop) changes, since
// that read isn't visible to memo's shallow prop comparison — narrowing
// THAT is a separate, larger change (see the unbounded-listener work).
export default React.memo(MessageCard);

function ActionTimeline({
  tasks,
  theme,
  onRetryTask,
  onHitlPress,
  taskDeliverablesMap,
}: {
  tasks: Task[];
  theme: Record<string, string>;
  onRetryTask?: (task: Task) => void;
  onHitlPress?: (task: Task) => void;
  taskDeliverablesMap: Map<string, Deliverable[]>;
}) {
  // Sort tasks descending (newest first). No truncation/"+N previous tasks"
  // footer anymore — every task for this profile is already viewable inline
  // in the conversation screen itself (see app/conversation/[profileId].tsx),
  // so there's no separate "see everything" sheet to link out to here.
  const sortedTasks = [...tasks].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );

  return (
    <View style={styles.timeline}>
      {sortedTasks.map((task, idx) => {
        const isLast = idx === sortedTasks.length - 1;
        const rowState = deriveTimelineRowState(task, theme);

        return (
          <TimelineRow
            key={task.id}
            task={task}
            theme={theme}
            onRetryTask={onRetryTask}
            onHitlPress={onHitlPress}
            {...rowState}
            hasLineBelow={!isLast}
            isLastRow={isLast}
            taskFiles={taskDeliverablesMap.get(task.id) || []}
          />
        );
      })}
    </View>
  );
}

// Exported for app/conversation/[profileId].tsx — see deriveTimelineRowState's
// doc comment above.
export function TimelineRow({
  task,
  theme,
  onRetryTask,
  onHitlPress,
  isHumanTask,
  isRunning,
  isFailed,
  isCompleted,
  isInactive,
  isHitl,
  isPendingForHuman,
  iconBg,
  lineColor,
  titleColor,
  hasLineBelow,
  isLastRow,
  taskFiles,
  Icon,
  // False only for the collapsed single-task preview in the toggle row,
  // which is already nested inside that row's own Pressable (toggles
  // expand/collapse). Retry/Try Again buttons and file chips are small
  // nested Pressables that RN's touch responder already routes correctly
  // (the innermost Pressable claims the tap, never bubbling to the outer
  // one) — no special-casing needed there. The ONE real conflict is
  // isPendingForHuman below, where the entire row becomes a single
  // Pressable navigating to /tasks; nested inside the toggle row's own
  // Pressable, that isn't "a small button inside a row" the same way, so it
  // has to be suppressed explicitly. Defaults to true (unchanged behavior
  // for the timeline/all-tasks-sheet usage).
  interactive = true,
  // True only for the collapsed single-task preview in the toggle row — no
  // timeline LINE to leave room for (hasLineBelow is always false there
  // anyway), so the icon column can be centered against the full height of
  // the title+subtitle+file-chips block instead of pinned to the top, and
  // padding tightens up since this is meant to read as a compact summary
  // row, not a full timeline entry.
  compact = false,
  // True only in app/conversation/[profileId].tsx's full-history thread
  // view — "Resolved" and "Moved to My Tasks" are status labels only
  // meaningful when reviewing finished/handed-off history there; on the
  // always-visible message card itself (collapsed preview or the inline
  // active-only dropdown), neither task type appears anyway except
  // transiently, and the subtitle was judged as visual noise for that
  // context. Defaults to false, so the card's own TimelineRow usages are
  // unaffected without having to pass it explicitly everywhere.
  showStatusSubtitles = false,
  // Whether multiple attached files collapse to "first file + N pill" —
  // was previously tied directly to `compact`, but the conversation screen
  // ALSO uses compact (for icon centering) while wanting every file shown
  // individually, unlike the card's own collapsed single-task preview which
  // genuinely has no room for a long file list. Defaults to `compact`
  // itself when not explicitly set, so every existing call site (which
  // never passed this) keeps its current behavior unchanged; the
  // conversation screen passes collapseFiles={false} explicitly to opt out.
  collapseFiles,
  // Optional long-press handler applied directly to whichever wrapper this
  // row actually renders (plain View, the isPendingForHuman Pressable, or
  // the isAwaitingReview Pressable) — NOT a second Pressable wrapped around
  // the outside by the caller. RN's touch responder system only lets one
  // Pressable in a nested stack claim a given touch (the innermost one), so
  // an ancestor Pressable's onLongPress silently never fires once this
  // component's own onPress-driven branches are active; giving the long-
  // press to the SAME element that already owns onPress avoids that
  // conflict entirely. Used by app/conversation/[profileId].tsx's
  // long-press-to-resolve.
  onLongPress,
}: {
  task: Task;
  theme: Record<string, string>;
  onRetryTask?: (task: Task) => void;
  onHitlPress?: (task: Task) => void;
  isHumanTask: boolean;
  isRunning: boolean;
  isFailed: boolean;
  isCompleted: boolean;
  isInactive: boolean;
  isHitl: boolean;
  isPendingForHuman: boolean;
  iconBg: string;
  lineColor: string;
  titleColor: string;
  hasLineBelow: boolean;
  isLastRow: boolean;
  taskFiles: Deliverable[];
  Icon: React.ComponentType<any>;
  interactive?: boolean;
  compact?: boolean;
  showStatusSubtitles?: boolean;
  onLongPress?: () => void;
  collapseFiles?: boolean;
}) {
  const shouldCollapseFiles = collapseFiles ?? compact;
  const router = useRouter();
  // Genuinely awaiting the human's review — distinct from isHitl alone,
  // which is also true for the broken/stuck case with no humanInputRequest
  // at all (that one shows "Retry" instead, see below). Mirrors hitlTasks'
  // own filter in the main component (status awaiting_human_input + a
  // request object + no answer yet).
  const isAwaitingReview = isHitl && !!task.humanInputRequest && !task.humanInputRequest.answer;
  const rowContent = (
    <>
      {/* Timeline graphics: icon circle + line. Centered vertically against
          the whole content block in compact mode (position:"relative" +
          alignItems:"center" via styles.timelineLeftCompact), vs. the
          default timeline's fixed top-pinned icon (styles.timelineLeft,
          absolutely positioned so the vertical connecting line can span the
          full row height regardless of content height). */}
      <View style={compact ? styles.timelineLeftCompact : styles.timelineLeft}>
        <View
          style={[
            styles.timelineIconContainer,
            isPendingForHuman
              ? { backgroundColor: "transparent", borderWidth: 1, borderColor: theme.separator, borderStyle: "dashed" }
              : { backgroundColor: iconBg },
          ]}
        >
          {isCompleted ? (
            <Check size={11} color={theme.muted} weight="bold" />
          ) : isInactive ? (
            <Minus size={11} color={theme.muted} weight="bold" />
          ) : isRunning ? (
            <ActivityIndicator size="small" color={theme.primary} style={{ transform: [{ scale: 0.7 }] }} />
          ) : isFailed ? (
            <Warning size={11} color="#FF3B30" weight="bold" />
          ) : isHitl ? (
            <QuestionMark size={11} color={theme.primary} weight="bold" />
          ) : isPendingForHuman ? (
            <UserCheck size={11} color={theme.muted} weight="bold" />
          ) : (
            <Icon size={11} color={theme.primary} weight="bold" />
          )}
        </View>
        {hasLineBelow && <View style={[styles.timelineLine, { backgroundColor: lineColor }]} />}
      </View>

      {/* Timeline content */}
      <View style={[styles.timelineContent, (isLastRow || compact) && { paddingBottom: 0 }, compact && styles.timelineContentCompact]}>
        <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <Text style={[styles.timelineLabel, { color: titleColor, fontFamily: "Inter_600SemiBold" }]}>
            {task.title}
          </Text>
          {isHitl && !task.humanInputRequest && onRetryTask && (
            <Pressable onPress={() => onRetryTask(task)} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
              <Text style={{ color: "#FF9500", fontFamily: "Inter_600SemiBold", fontSize: 11 }}>Retry</Text>
            </Pressable>
          )}
          {isFailed && onRetryTask && (
            <Pressable onPress={() => onRetryTask(task)} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
              <Text style={{ color: "#FF3B30", fontFamily: "Inter_600SemiBold", fontSize: 11 }}>Try Again</Text>
            </Pressable>
          )}
        </View>

        {isAwaitingReview && (
          <Text style={[styles.timelineDetail, { color: theme.primary, fontFamily: "Inter_500Medium" }]}>
            Tap to Review
          </Text>
        )}

        {isPendingForHuman && showStatusSubtitles && (
          <Text style={[styles.timelineDetail, { color: theme.muted, fontFamily: "Inter_400Regular" }]}>
            Moved to My Tasks
          </Text>
        )}

        {isInactive && showStatusSubtitles && (
          <Text style={[styles.timelineDetail, { color: theme.muted, fontFamily: "Inter_400Regular" }]}>
            Resolved
          </Text>
        )}

        {/* "Starting" is the claim-time placeholder value the backend writes
            the instant a task is picked up (see index.ts's onTaskCreated
            handler), before the agent's first real tool call ever runs — it
            never reflects an actual in-progress action, so showing
            "Starting…" to the user is pure noise. Suppress it and just show
            nothing until a real, specific activityIndicator label (e.g.
            "Searching", "Drafting") arrives from an actual tool call. */}
        {isRunning && task.activityIndicator && task.activityIndicator !== "Starting" && (
          <Text style={[styles.timelineDetail, { color: theme.muted, fontFamily: "Inter_400Regular" }]}>
            {task.activityIndicator}…
          </Text>
        )}

        {taskFiles.length > 0 && (
          <View style={styles.badgeRow}>
            {/* The collapsed single-task preview only has room for one file
                chip — showing every attached file stacked the same way a
                full timeline row does reads as near-duplicate rows there
                (e.g. two very similar filenames). Collapse to just the
                first file plus a "+N" pill instead in that case; every file
                is shown individually everywhere else (the inline dropdown,
                and the conversation screen's full-history thread, which
                opts out via collapseFiles={false} even though it also uses
                compact for icon centering — see collapseFiles' doc
                comment). */}
            {(shouldCollapseFiles && taskFiles.length > 1 ? taskFiles.slice(0, 1) : taskFiles).map((file) => {
              const fileConfig = FILE_TYPE_COLORS[file.type] || FILE_TYPE_COLORS.other;
              const FileIcon = fileConfig.icon;
              return (
                <Pressable
                  key={file.id}
                  onPress={() => viewFile(file.url, file.name).catch((err) => console.error("Failed to open file:", err))}
                  style={[styles.fileBadge, { backgroundColor: theme.searchBg }]}
                >
                  <FileIcon size={12} color={fileConfig.text} style={{ marginRight: 4 }} />
                  <Text
                    style={[styles.badgeText, { color: theme.muted, fontFamily: "Inter_500Medium" }]}
                    numberOfLines={1}
                  >
                    {file.name}
                  </Text>
                </Pressable>
              );
            })}
            {/* Its own separate pill, not crammed inside the first file's
                badge — it represents a WHOLE other file, not a suffix of
                the first one's name. */}
            {shouldCollapseFiles && taskFiles.length > 1 && (
              <View style={[styles.badgeCountPill, { backgroundColor: theme.searchBg }]}>
                <Text style={[styles.badgeText, { color: theme.muted, fontFamily: "Inter_600SemiBold" }]}>
                  +{taskFiles.length - 1}
                </Text>
              </View>
            )}
          </View>
        )}
      </View>
    </>
  );

  if (isPendingForHuman && interactive) {
    return (
      <Pressable
        onPress={() => router.push("/tasks")}
        onLongPress={onLongPress}
        style={({ pressed }) => [styles.timelineRow, { opacity: pressed ? 0.6 : 1 }]}
      >
        {rowContent}
      </Pressable>
    );
  }

  if (isAwaitingReview && interactive && onHitlPress) {
    return (
      <Pressable
        onPress={() => onHitlPress(task)}
        onLongPress={onLongPress}
        style={({ pressed }) => [styles.timelineRow, compact && styles.timelineRowCompact, { opacity: pressed ? 0.6 : 1 }]}
      >
        {rowContent}
      </Pressable>
    );
  }

  if (onLongPress) {
    return (
      <Pressable
        onLongPress={onLongPress}
        style={({ pressed }) => [styles.timelineRow, compact && styles.timelineRowCompact, { opacity: pressed ? 0.6 : 1 }]}
      >
        {rowContent}
      </Pressable>
    );
  }

  return <View style={[styles.timelineRow, compact && styles.timelineRowCompact]}>{rowContent}</View>;
}

const BUBBLE_BLUE = "#007AFF";
const BUBBLE_GREEN = "#34C759";

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
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
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
  },
  avatarImage: { width: 36, height: 36, borderRadius: 18 },
  avatarText: { color: "#FFF", fontSize: 15 },
  // Fixed 36x36 — identical footprint to the solo avatar (styles.avatar)
  // regardless of member count, so the header never grows/shifts. No clip
  // on the container itself (unlike the old single-circle version) — each
  // member is its OWN small round circle (styles.groupAvatarCell), so
  // there's nothing here to mask; the container is just a positioning
  // frame per GROUP_CLUSTER_CELL_STYLES above.
  groupAvatarCluster: {
    width: 36,
    height: 36,
  },
  // borderRadius: "50%" always renders a true circle regardless of the
  // per-count size this gets (width/height are always set equal in
  // GROUP_CLUSTER_CELL_STYLES) — RN resolves a percentage borderRadius
  // against the element's own box, unlike a fixed pixel radius which would
  // need a different value per size. The border (in the container's own
  // background color, applied inline where rendered) is what actually
  // reads as the small gap BETWEEN circles, matching iMessage's look — a
  // circle sitting flush against its neighbor with no separation reads as
  // one blobby shape instead of a cluster of individual people.
  groupAvatarCell: {
    position: "absolute",
    borderRadius: "50%",
    borderWidth: 1.5,
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
  },
  groupAvatarText: { color: "#FFF", fontSize: 10 },
  groupAvatarImage: { width: "100%", height: "100%", borderRadius: 999 },
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
  platformIdentifier: {
    fontSize: 11,
    maxWidth: 140,
  },
  dotMuted: {
    fontSize: 11,
    marginHorizontal: 1,
  },
  timestamp: { fontSize: 11 },
  bubbleRow: {
    paddingHorizontal: 14,
    paddingBottom: 14,
  },
  outPreviewRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingBottom: 12,
  },
  outPreviewText: {
    fontSize: 13,
    flexShrink: 1,
  },
  bubble: {
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
    maxWidth: "85%",
  },
  bubbleText: { color: "#FFFFFF", fontSize: 14, lineHeight: 21 },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: 14 },
  actionsArea: {
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 12,
  },
  analyzingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  analyzingText: { fontSize: 13 },
  timeline: {
    marginTop: 4,
  },
  timelineRow: {
    flexDirection: "row",
    position: "relative",
    minHeight: 28,
  },
  // Compact (collapsed single-task preview): a plain flex row, no reserved
  // timeline-line height — the icon is a normal flex sibling of the content
  // block instead of an absolutely-positioned overlay, so alignItems:
  // "center" centers it against the content's actual rendered height
  // (title + subtitle + file chips), whatever that turns out to be.
  timelineRowCompact: {
    alignItems: "center",
    minHeight: 0,
  },
  timelineLeft: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    width: 22,
    alignItems: "center",
  },
  // Compact mode's icon column — see timelineRowCompact above for why this
  // is a normal (non-absolute) flex child instead.
  timelineLeftCompact: {
    width: 22,
    alignItems: "center",
    marginRight: 10,
  },
  timelineIconContainer: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
  },
  timelineLine: {
    position: "absolute",
    top: 22,
    bottom: 0,
    width: 1.5,
    zIndex: 1,
  },
  timelineContent: {
    flex: 1,
    paddingLeft: 32,
    paddingBottom: 12,
  },
  // Compact mode: no paddingLeft (timelineLeftCompact's marginRight already
  // provides the icon-to-text gap as a normal sibling, not an absolute
  // overlay needing the content to reserve space for it).
  timelineContentCompact: {
    paddingLeft: 0,
  },
  timelineLabel: {
    fontSize: 12,
    lineHeight: 16,
  },
  timelineDetail: {
    fontSize: 11,
    lineHeight: 15,
    marginTop: 1,
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  toggleRowMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
  },
  toggleLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  toggleText: {
    fontSize: 13,
  },
  toggleIconCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  latestTaskPreview: {
    flex: 1,
    marginRight: 8,
  },
  timelineContainer: {
    marginTop: 12,
  },
  badgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 6,
  },
  fileBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 8,
    paddingRight: 10,
    paddingVertical: 4,
    borderRadius: 6,
    maxWidth: 200,
  },
  badgeText: {
    fontSize: 11,
    flexShrink: 1,
  },
  badgeCountPill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
});
