import { useLocalSearchParams, useRouter } from "expo-router";
import {
  Platform,
  View,
  Text,
  StyleSheet,
  SectionList,
  Pressable,
  Image,
  ActivityIndicator,
  Alert,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import {
  CaretLeft,
  Envelope,
  ChatCircle,
  GoogleDriveLogo,
  MicrosoftOutlookLogo,
  MicrosoftTeamsLogo,
  SlackLogo,
  FilePdf,
  File,
  MicrosoftWordLogo,
  MicrosoftExcelLogo,
  MicrosoftPowerpointLogo,
  CalendarCheck,
  Camera,
  ArrowUp,
} from "phosphor-react-native";
import { useTheme } from "../../hooks/useTheme";
import { useColorScheme } from "../../hooks/useColorScheme";
import { useUser } from "../../contexts/UserContext";
import { GmailIcon, SyncedIcon } from "../../components/SimpleIcons";
import { useMemo, useState, useEffect, useCallback, useRef } from "react";
import { formatLocalTimestamp, TimelineRow, deriveTimelineRowState } from "../../components/MessageCard";
import { HumanInputSheet } from "../../components/HumanInputSheet";
import { Message, MessageAttachment, Task, Profile, Deliverable, saveTask, markTasksInactive, uploadCustomAvatarForProfile, deriveAvatarInitials, deriveGroupDisplayName, resolveProfileAvatarUri, groupDeliverablesByTask, getDeliverablesForProfile } from "../../services/storage";
import { GROUP_CLUSTER_CELL_STYLES } from "../../components/MessageCard";
import { GroupMembersSheet } from "../../components/GroupMembersSheet";
import { LinkifiedText } from "../../components/LinkifiedText";
import { AddAgentTaskSheet } from "../../components/AddAgentTaskSheet";
import { viewFile } from "../../services/fileViewer";
import { db, getAppUser } from "../../services/firebase";
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  onSnapshot,
  getDocs,
  Timestamp,
} from "firebase/firestore";

const PAGE_SIZE = 30;

// Same lazy-optional-require pattern as HitlApproveMode.tsx/
// AddAgentTaskSheet.tsx's own glass buttons — used for the fake composer
// bar's liquid-glass pill (see its own usage comment).
let GlassView: React.ComponentType<any> | null = null;
try { GlassView = require("expo-glass-effect").GlassView; } catch { }

const SOURCE_COLORS: Record<string, string> = {
  gmail: "#EA4335",
  outlook: "#0078D4",
  imessage: "#30D158",
  drive: "#34A853",
  slack: "#E01E5A",
  teams: "#6264A7",
  whatsapp: "#25D366",
  synced: "#4429F2",
};

const SOURCE_ICONS: Record<string, React.ComponentType<any>> = {
  gmail: GmailIcon,
  outlook: MicrosoftOutlookLogo,
  imessage: ChatCircle,
  drive: GoogleDriveLogo,
  slack: SlackLogo,
  teams: MicrosoftTeamsLogo,
  whatsapp: ChatCircle,
  synced: SyncedIcon,
};

const FILE_META: Record<string, { icon: React.ComponentType<any>; color: string }> = {
  pdf: { icon: FilePdf, color: "#FF3B30" },
  docx: { icon: MicrosoftWordLogo, color: "#007AFF" },
  xlsx: { icon: MicrosoftExcelLogo, color: "#34C759" },
  pptx: { icon: MicrosoftPowerpointLogo, color: "#FF9500" },
  other: { icon: File, color: "#8E8E93" },
};

function normalizeSubject(subject: string): string {
  return subject.replace(/^(re:\s*)+/i, "").trim();
}

// Resolves a message's actual sender to a short display name, for the
// per-sender label shown above each incoming cluster on a group-thread
// profile (see participants/threadType on Profile — resolveProfileForThread
// in functions/src/tools/helpers.ts is what populates these). Falls back to
// the raw identifier (e.g. an email address) when no matching participant
// name is on file, and to the message's own senderIdentifier as a last
// resort when it isn't in the profile's participants list at all (e.g. a
// participant the profile hasn't caught up to yet).
function resolveSenderDisplayName(
  senderIdentifier: string | undefined,
  participants: { identifier: string; name?: string }[] | undefined,
): string | null {
  if (!senderIdentifier) return null;
  const match = participants?.find(
    (p) => p.identifier.toLowerCase() === senderIdentifier.toLowerCase(),
  );
  return match?.name || senderIdentifier;
}

interface Section {
  title: string;
  data: FeedItem[];
}

function AttachmentCard({ att }: { att: MessageAttachment }) {
  const theme = useTheme();
  const meta = FILE_META[att.type] ?? FILE_META.other;
  const Icon = meta.icon;
  const [opening, setOpening] = useState(false);
  const handlePress = async () => {
    if (opening) return;
    setOpening(true);
    try {
      await viewFile(att.url, att.name);
    } catch (err) {
      console.error("[Conversation] Failed to view attachment:", err);
    } finally {
      setOpening(false);
    }
  };
  return (
    <Pressable
      onPress={handlePress}
      disabled={opening}
      style={({ pressed }) => [
        styles.attachCard,
        { backgroundColor: theme.card, borderColor: theme.cardBorder, opacity: pressed || opening ? 0.7 : 1 },
      ]}
    >
      <View style={[styles.attachIcon, { backgroundColor: meta.color + "20" }]}>
        {opening ? <ActivityIndicator size="small" color={meta.color} /> : <Icon size={14} color={meta.color} weight="duotone" />}
      </View>
      <Text
        style={[styles.attachName, { color: theme.surface, fontFamily: "Inter_600SemiBold" }]}
        numberOfLines={1}
      >
        {att.name}
      </Text>
    </Pressable>
  );
}

function firestoreMessageToMessage(id: string, data: any): Message {
  return {
    id,
    profileId: data.profileId,
    userId: data.userId,
    direction: data.direction,
    text: data.text,
    timestamp: data.timestamp,
    platformMessageId: data.platformMessageId,
    subject: data.subject,
    taskId: data.taskId,
    attachments: data.attachments,
    kind: data.kind,
    calendarEvent: data.calendarEvent,
    senderIdentifier: data.senderIdentifier,
    createdAt:
      data.createdAt instanceof Timestamp
        ? data.createdAt.toDate().toISOString()
        : data.createdAt,
  };
}

function firestoreTaskToTask(id: string, data: any): Task {
  return {
    id,
    profileId: data.profileId,
    userId: data.userId,
    threadId: data.threadId,
    title: data.title,
    assignee: data.assignee,
    status: data.status,
    activityIndicator: data.activityIndicator,
    implementationPlan: data.implementationPlan || [],
    requiredDeliverables: data.requiredDeliverables || [],
    humanInputRequest: data.humanInputRequest,
    humanInputHistory: data.humanInputHistory,
    dueDate:
      data.dueDate instanceof Timestamp
        ? data.dueDate.toDate().toISOString()
        : data.dueDate,
    dueDatePrecision: data.dueDatePrecision,
    createdAt:
      data.createdAt instanceof Timestamp
        ? data.createdAt.toDate().toISOString()
        : data.createdAt,
    updatedAt:
      data.updatedAt instanceof Timestamp
        ? data.updatedAt.toDate().toISOString()
        : data.updatedAt,
    seen: data.seen,
  };
}

// A feed item is either a real Message or a Task shown inline (mirrors how
// AllTasksSheet/MessageCard's dropdown render tasks — see TimelineRow). Kept
// as a tagged union rather than mixing fields onto one shape so
// SectionList's renderItem can cleanly dispatch on `type`.
type FeedItem =
  | { type: "message"; id: string; timestamp: string; message: Message }
  | { type: "task"; id: string; timestamp: string; task: Task };

export default function ConversationScreen() {
  const { profileId } = useLocalSearchParams<{ profileId: string }>();
  const router = useRouter();
  const theme = useTheme();
  const scheme = useColorScheme();
  const insets = useSafeAreaInsets();
  const { profiles, groupThreads } = useUser();

  // A group conversation is a separate entity (groupThreads/{id}) referencing
  // its members' solo Profile ids — discriminated purely by the "group_" id
  // prefix, same as everywhere else in the app (see ConversationRow in
  // services/storage.ts). Every downstream read in this screen goes through
  // the unified locals derived here rather than branching on profile/group
  // repeatedly, mirroring the pattern established in MessageCard.tsx.
  const isGroupThread = typeof profileId === "string" && profileId.startsWith("group_");
  const profile = isGroupThread ? undefined : profiles.find((p) => p.id === profileId);
  const group = isGroupThread ? groupThreads.find((g) => g.id === profileId) : undefined;
  const profileById = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles]);
  const groupMembers = useMemo(
    () => (group ? group.memberProfileIds.map((id) => profileById.get(id)).filter((p): p is Profile => !!p) : []),
    [group, profileById],
  );
  const name = isGroupThread ? (group?.name ?? (groupMembers.length ? deriveGroupDisplayName(groupMembers) : "Conversation")) : profile?.name;
  const source = isGroupThread ? group?.source : profile?.source;
  const platformIdentifier = isGroupThread ? undefined : profile?.platformIdentifier;
  // Group threads have no participants[] the way legacy Profile-as-thread
  // docs did — participant identity now lives on each member's own solo
  // Profile doc (memberProfileIds), so this is derived here rather than
  // read off a field.
  const threadParticipants = isGroupThread
    ? groupMembers.map((m) => ({ identifier: m.platformIdentifier, name: m.name }))
    : undefined;
  // "synced" has no real external brand color — follows the app's own
  // adaptive theme.primary instead of the fixed SOURCE_COLORS purple (see
  // MessageCard.tsx's identical treatment).
  const srcColor = source ? (source === "synced" ? theme.primary : (SOURCE_COLORS[source] ?? "#888")) : "#888";
  const avatarUri = isGroupThread ? undefined : resolveProfileAvatarUri(profile?.customAvatarUri, profile?.avatarUri);
  const avatarInitials = deriveAvatarInitials(name, isGroupThread ? undefined : profile?.senderInitial);

  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  // The group avatar cluster itself stays derive-only (no tap-to-edit-photo
  // on the cluster as a whole, per the existing "no custom group photo"
  // decision) — tapping it instead opens GroupMembersSheet (see
  // groupMembersSheetOpen below), where each MEMBER's own avatar is
  // individually editable via the same uploadCustomAvatarForProfile helper
  // this handler uses for the solo-contact case.
  const [groupMembersSheetOpen, setGroupMembersSheetOpen] = useState(false);
  // Fake iMessage-style composer bar at the bottom of the thread (see the
  // ListFooterComponent-adjacent render below) — never a real input, purely
  // a tap target that opens AddAgentTaskSheet, pre-addressed to whoever
  // this conversation is with via a real tracked mention for a real
  // contact (see AddAgentTaskSheet's initialMention prop), or with no
  // prefill at all for the Synced self-chat. Solo (non-group) conversations
  // only — group threads have no single profile to seed a mention from.
  const [isAddSheetOpen, setIsAddSheetOpen] = useState(false);
  // Prefix/suffix override for AddAgentTaskSheet's initialMention — set
  // only when the human picked "Reply" in the dialog (see
  // handleComposerTap, defined further below once `messages` is
  // available), producing 'Reply to @Name about "Subject" ' instead of the
  // default 'Send @Name '. Cleared back to undefined for "New Message"/
  // every non-email tap, so those fall back to AddAgentTaskSheet's own
  // default wording.
  const [addSheetMentionWrap, setAddSheetMentionWrap] = useState<{ prefix: string; suffix: string } | undefined>(undefined);
  const handleChangeAvatar = useCallback(async () => {
    if (uploadingAvatar || !profileId || isGroupThread) return;

    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Photo Access Needed", "Enable photo library access in Settings to set a custom photo.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: "images",
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.[0]) return;

    setUploadingAvatar(true);
    try {
      const asset = result.assets[0];
      await uploadCustomAvatarForProfile(profileId, { uri: asset.uri, mimeType: asset.mimeType });
    } catch (e) {
      console.error("[Conversation] Failed to upload custom avatar:", e);
      Alert.alert("Couldn't update photo", "Please try again.");
    } finally {
      setUploadingAvatar(false);
    }
  }, [uploadingAvatar, profileId, isGroupThread]);

  // Paginated, per-conversation message loading — independent of
  // UserContext's global unbounded messages listener (which stays as-is for
  // the home/tasks/deliverables screens). The newest page stays live via
  // onSnapshot; older pages are fetched once on scroll-up (lazy load) via
  // startAfter and merged in. Keyed by id so a message present in both the
  // live newest-page snapshot and a manually-fetched older page (edge case
  // right at the page boundary as new messages arrive) is never duplicated.
  const [messagesById, setMessagesById] = useState<Map<string, Message>>(new Map());
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMoreOlder, setHasMoreOlder] = useState(true);

  useEffect(() => {
    if (!db || !profileId) return;
    const user = getAppUser();
    if (!user) return;

    setMessagesById(new Map());
    setHasMoreOlder(true);
    // Reset alongside messages — a stale closed-tasks page from the
    // PREVIOUS conversation must not leak into this one while its own
    // initial page loads (initialClosedTasksLoadedRef's profileId check
    // below already stops a stale in-flight fetch from writing back, but
    // the accumulated state itself still needs clearing here).
    setClosedProfileTasksById(new Map());

    const qNewest = query(
      collection(db, "messages"),
      where("userId", "==", user.uid),
      where("profileId", "==", profileId),
      orderBy("timestamp", "desc"),
      limit(PAGE_SIZE),
    );
    const unsub = onSnapshot(qNewest, (snap) => {
      setMessagesById((prev) => {
        const next = new Map(prev);
        snap.forEach((d) => next.set(d.id, firestoreMessageToMessage(d.id, d.data())));
        return next;
      });
      if (snap.docs.length < PAGE_SIZE) setHasMoreOlder(false);
    });
    return unsub;
  }, [profileId]);

  // Every currently-OPEN task for this profile, unbounded regardless of age
  // — CONFIRMED real requirement, not an oversight: a task still needing
  // action (pending/in_progress/awaiting_human_input) must never silently
  // disappear from the timeline just because its accompanying message fell
  // off the paginated window below. Cheap in practice — open tasks are a
  // small, naturally-bounded set (closed/completed ones are excluded here),
  // unlike the full history this used to pull.
  const [openProfileTasks, setOpenProfileTasks] = useState<Task[]>([]);
  useEffect(() => {
    if (!db || !profileId) return;
    const user = getAppUser();
    if (!user) return;

    const qOpenTasks = query(
      collection(db, "tasks"),
      where("userId", "==", user.uid),
      where("profileId", "==", profileId),
      // "failed" deliberately stays visible (not excluded) — a failed task
      // still shows its retry affordance in the timeline (see TimelineRow's
      // isFailed handling), so it counts as "open" for this purpose exactly
      // like pending/in_progress/awaiting_human_input.
      where("status", "not-in", ["completed", "inactive"]),
    );
    const unsub = onSnapshot(qOpenTasks, (snap) => {
      setOpenProfileTasks(snap.docs.map((d) => firestoreTaskToTask(d.id, d.data())));
    }, (err) => {
      // FAILED_PRECONDITION here means Firestore needs a composite index for
      // (userId ==, profileId ==, status not-in) on `tasks` — same situation
      // as UserContext.tsx's identical open-tasks query; the error's own
      // message includes a Firebase Console link that auto-creates it.
      console.error("[Conversation] Open tasks subscription error (may need a composite index):", err);
    });
    return unsub;
  }, [profileId]);

  // CLOSED (completed/inactive) tasks, paginated in lockstep with messages —
  // see loadOlderMessages below, which fetches both a page of older messages
  // AND closed tasks from the same time cursor together. Previously this was
  // one single unbounded listener returning the profile's ENTIRE task
  // history regardless of how many messages were actually loaded —
  // CONFIRMED real bug: scrolling up past the loaded messages hit a long
  // run of task rows with no messages interleaved (older tasks were all
  // present, but the messages that originally sat alongside them in time
  // hadn't been paginated in yet), reading as "a wall of tasks" out of step
  // with the conversation. Keyed by id for the same dedup reason as
  // messagesById.
  const [closedProfileTasksById, setClosedProfileTasksById] = useState<Map<string, Task>>(new Map());

  // Fetched directly by profileId (getDeliverablesForProfile in
  // services/storage.ts) rather than filtered out of UserContext's
  // `deliverables` — that array is now bounded to recent activity, but this
  // conversation's own deliverable history can genuinely be old (a file
  // generated by a task from long before the current visible window). One
  // fetch per conversation opened, re-scoped to exactly this profile's own
  // deliverables before handing off to the shared groupDeliverablesByTask
  // (see its own doc comment in services/storage.ts).
  const [profileDeliverables, setProfileDeliverables] = useState<Deliverable[]>([]);
  useEffect(() => {
    if (!profileId) return;
    let cancelled = false;
    getDeliverablesForProfile(profileId).then((list) => {
      if (!cancelled) setProfileDeliverables(list);
    });
    return () => { cancelled = true; };
  }, [profileId]);
  const taskDeliverablesMap = useMemo(() => groupDeliverablesByTask(profileDeliverables), [profileDeliverables]);

  const [hitlSheetTask, setHitlSheetTask] = useState<Task | null>(null);
  const handleRetryTask = useCallback(async (taskToRetry: Task) => {
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
  }, []);

  // Long-press on any individual task row here dismisses just that ONE task
  // — distinct from home.tsx's profile-level "Dismiss Tasks" long-press
  // (which clears every open task for the whole conversation at once).
  const handleResolveTask = useCallback((task: Task) => {
    Alert.alert(
      "Dismiss Task?",
      `"${task.title}" will be marked resolved${task.assignee === "agent" ? " and the agent will stop working on it" : ""}.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Dismiss", style: "destructive", onPress: () => { markTasksInactive([task.id]); } },
      ],
    );
  }, []);

  // Fetches closed (completed/inactive) tasks whose createdAt falls in
  // (untilExclusive, sinceInclusive] — i.e. the exact time window the
  // messages page just loaded/about-to-load covers — and merges them into
  // closedProfileTasksById. Shared by both the initial page load and
  // loadOlderMessages below so tasks always advance in lockstep with
  // messages, never independently. `untilExclusive` omitted means "no lower
  // bound yet" (the very first page).
  //
  // sinceInclusive/untilExclusive are ISO strings (sourced from Message.
  // timestamp, which IS stored as a plain string — see isoTimestamp in
  // functions/src/index.ts) but Task.createdAt is written server-side as a
  // real Firestore Timestamp (FieldValue.serverTimestamp() — see
  // pipeline.ts). A range where() against a Timestamp field must be given a
  // Timestamp, not a string, or the comparison silently matches nothing —
  // converted here via Timestamp.fromDate before querying.
  const loadClosedTasksInRange = useCallback(async (sinceInclusive: string, untilExclusive?: string) => {
    if (!db || !profileId) return;
    const user = getAppUser();
    if (!user) return;
    try {
      const constraints = [
        where("userId", "==", user.uid),
        where("profileId", "==", profileId),
        where("status", "in", ["completed", "inactive"]),
        where("createdAt", "<=", Timestamp.fromDate(new Date(sinceInclusive))),
        ...(untilExclusive ? [where("createdAt", ">", Timestamp.fromDate(new Date(untilExclusive)))] : []),
      ];
      const qClosedTasks = query(collection(db, "tasks"), ...constraints);
      const snap = await getDocs(qClosedTasks);
      setClosedProfileTasksById((prev) => {
        const next = new Map(prev);
        snap.forEach((d) => next.set(d.id, firestoreTaskToTask(d.id, d.data())));
        return next;
      });
    } catch (e) {
      // FAILED_PRECONDITION here means Firestore needs a composite index for
      // (userId ==, profileId ==, status in, createdAt <=[, createdAt >]) —
      // same situation as the open-tasks query above; the error's own
      // message includes a Firebase Console link that auto-creates it.
      console.error("[Conversation] Failed to load closed tasks for range:", e);
    }
  }, [profileId]);

  // Initial closed-tasks page — fires once the first messages page has fully
  // resolved (hasMoreOlder has settled to its real value, not just the
  // optimistic `true` default — see the messages effect above), bounded to
  // exactly the time range that FIRST page of messages covers: from its
  // newest message down to its oldest (or unbounded-below if the whole
  // conversation fit in one page, i.e. hasMoreOlder is already false).
  // Deliberately NOT re-run on every subsequent live message update (only on
  // profileId change) — re-fetching this page on every new incoming message
  // would undo the whole point of pagination.
  const initialClosedTasksLoadedRef = useRef<string | null>(null);
  useEffect(() => {
    if (initialClosedTasksLoadedRef.current === profileId) return;
    if (messagesById.size === 0) return;
    let newestTs: string | null = null;
    let oldestTs: string | null = null;
    for (const m of messagesById.values()) {
      if (!newestTs || m.timestamp > newestTs) newestTs = m.timestamp;
      if (!oldestTs || m.timestamp < oldestTs) oldestTs = m.timestamp;
    }
    if (!newestTs || !oldestTs) return;
    initialClosedTasksLoadedRef.current = profileId;
    loadClosedTasksInRange(newestTs, hasMoreOlder ? oldestTs : undefined);
  }, [profileId, messagesById, hasMoreOlder, loadClosedTasksInRange]);

  const loadOlderMessages = useCallback(async () => {
    if (!db || !profileId || loadingOlder || !hasMoreOlder) return;
    const user = getAppUser();
    if (!user) return;

    // Oldest timestamp among what's currently loaded — fetch strictly
    // before it. Computed fresh each call (not memoized) since it must
    // reflect the latest accumulated state.
    let oldestTs: string | null = null;
    for (const m of messagesById.values()) {
      if (!oldestTs || m.timestamp < oldestTs) oldestTs = m.timestamp;
    }
    if (!oldestTs) return;

    setLoadingOlder(true);
    try {
      const qOlder = query(
        collection(db, "messages"),
        where("userId", "==", user.uid),
        where("profileId", "==", profileId),
        orderBy("timestamp", "desc"),
        startAfter(oldestTs),
        limit(PAGE_SIZE),
      );
      const snap = await getDocs(qOlder);
      setMessagesById((prev) => {
        const next = new Map(prev);
        snap.forEach((d) => next.set(d.id, firestoreMessageToMessage(d.id, d.data())));
        return next;
      });
      if (snap.docs.length < PAGE_SIZE) setHasMoreOlder(false);
      // Closed tasks for exactly the window this page just covered — from
      // the OLD oldest boundary (exclusive) down to the NEW oldest message
      // just fetched (inclusive), same page-by-page lockstep as messages.
      // If this page came back short (fewer than PAGE_SIZE, i.e. hit the
      // very start of the conversation), there's no further/older boundary
      // to worry about — every closed task at or before oldestTs is fetched
      // in one go since nothing older exists to page into separately.
      let newOldestTs = oldestTs;
      snap.forEach((d) => {
        const ts = d.data().timestamp;
        if (ts && ts < newOldestTs) newOldestTs = ts;
      });
      await loadClosedTasksInRange(oldestTs, snap.docs.length < PAGE_SIZE ? undefined : newOldestTs);
    } catch (e) {
      console.error("[Conversation] Failed to load older messages:", e);
    } finally {
      setLoadingOlder(false);
    }
  }, [profileId, messagesById, loadingOlder, hasMoreOlder, loadClosedTasksInRange]);

  const messages = useMemo(() => Array.from(messagesById.values()), [messagesById]);

  // Email profiles (Gmail/Outlook) have a real "subject" concept a reply
  // can be unambiguously anchored to — other sources (Slack/Teams/
  // iMessage/WhatsApp) don't, so the Reply/New Message dialog below only
  // applies there. Uses the RAW subject line off the most recent message
  // that has one (not the agent's own generated task title) — the actual
  // "Re: ..." text a real email client would show, per the explicit choice
  // made when this was scoped.
  const isEmailProfile = profile?.source === "gmail" || profile?.source === "outlook";
  const mostRecentSubject = useMemo(() => {
    if (!isEmailProfile) return undefined;
    return [...messages]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .find((m) => !!m.subject)?.subject;
  }, [messages, isEmailProfile]);
  const handleComposerTap = useCallback(() => {
    if (!isEmailProfile || !mostRecentSubject) {
      // No subject to reply to (or not an email profile at all) — same
      // "just open, no extra prefill beyond the usual @mention" behavior
      // as before this dialog existed.
      setAddSheetMentionWrap(undefined);
      setIsAddSheetOpen(true);
      return;
    }
    // Truncated ONLY for the dialog button's own label — RN's Alert
    // doesn't wrap/ellipsize button text on its own, so a long subject
    // line (e.g. a real "RE: RE: ..." chain) rendered raw overflowed the
    // button. The actual prefill sentence sent to AddAgentTaskSheet below
    // still uses the full, untruncated mostRecentSubject — this is purely
    // a display concern for the button, not a content change.
    const truncatedSubjectForButton = mostRecentSubject.length > 15
      ? `${mostRecentSubject.slice(0, 15).trimEnd()}…`
      : mostRecentSubject;
    Alert.alert(
      "New Agent Task",
      undefined,
      [
        {
          text: `Reply to "${truncatedSubjectForButton}"`,
          onPress: () => {
            // Produces 'Reply to @Name in "Subject": ' — the mention AND
            // the subject both present (see initialMention's own doc
            // comment on AddAgentTaskSheet for why the subject alone
            // isn't enough); trailing ": " caps off the auto-filled phrase.
            // "in" (not "about") — this replies WITHIN that specific email
            // thread, it isn't merely a message on that topic.
            setAddSheetMentionWrap({ prefix: "Reply to ", suffix: ` in "${mostRecentSubject}": ` });
            setIsAddSheetOpen(true);
          },
        },
        {
          text: "New Message",
          onPress: () => {
            setAddSheetMentionWrap(undefined);
            setIsAddSheetOpen(true);
          },
        },
        { text: "Cancel", style: "cancel" },
      ],
    );
  }, [isEmailProfile, mostRecentSubject, setAddSheetMentionWrap, setIsAddSheetOpen]);

  // Per-sender attribution needs "have 2+ DISTINCT people actually SENT a
  // message in this thread" — a different question from profile.threadType
  // (participants.length >= 3, see deriveThreadType in
  // functions/src/tools/helpers.ts), which measures addressable-party COUNT
  // and is used elsewhere for reply-all scoping (prompt.ts, the Reply All
  // button in HitlApproveMode.tsx) where that count-based meaning is
  // correct. A thread can have exactly 2 non-owner participants who BOTH
  // send messages — threadType stays "oneOnOne" there (correctly, for
  // reply-all purposes) but the UI still needs to show who said what.
  // Computed client-side from already-loaded messages rather than persisted,
  // since it's a rendering-only concern.
  const distinctIncomingSenders = useMemo(() => {
    const set = new Set<string>();
    for (const msg of messages) {
      const isIncoming = source === "synced" ? msg.direction !== "in" : msg.direction === "in";
      if (isIncoming && msg.senderIdentifier) set.add(msg.senderIdentifier.toLowerCase());
    }
    return set;
  }, [messages, source]);
  const needsSenderAttribution = distinctIncomingSenders.size >= 2;

  // inverted SectionList: sections newest-first, items newest-first within each section
  const sections = useMemo<Section[]>(() => {
    const messageItems: FeedItem[] = messages
      .filter((m) => m.profileId === profileId)
      .map((m) => ({ type: "message", id: m.id, timestamp: m.timestamp, message: m }));
    // Tasks are positioned by createdAt — when this task actually entered
    // the conversation — not updatedAt, so a task doesn't visually jump
    // around the thread every time its status changes (running → HITL →
    // completed all stay planted at the same point in time it was created).
    // openProfileTasks (unbounded, always-live) + closedProfileTasksById
    // (paginated in lockstep with messages — see loadClosedTasksInRange) —
    // merged here so the timeline always shows a task if either (a) it's
    // still open regardless of age, or (b) it's closed AND its time window
    // has actually been paged in alongside the surrounding messages.
    const allProfileTasks = [...openProfileTasks, ...closedProfileTasksById.values()];
    const taskItems: FeedItem[] = allProfileTasks.map((t) => ({ type: "task", id: t.id, timestamp: t.createdAt, task: t }));
    const thread = [...messageItems, ...taskItems].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    if (thread.length === 0) return [];

    // Group consecutive items sharing a subject into one section. An item
    // with no subject (a calendar-event breadcrumb, or a task — neither is
    // tied to any single email) never starts a new section on its own — it
    // just joins whichever section is currently open, and doesn't change
    // that section's title. Without this, any subject-less item sandwiched
    // between two same-subject messages fractured the thread into three
    // sections instead of staying as one.
    const groups: Section[] = [];
    let currentTitle = "";
    let currentGroup: FeedItem[] = [];

    for (const item of thread) {
      const subject = item.type === "message" ? item.message.subject : undefined;
      const normalized = subject ? normalizeSubject(subject) : null;
      if (normalized === null && currentGroup.length > 0) {
        currentGroup.push(item);
        continue;
      }
      const title = normalized ?? "";
      if (currentGroup.length === 0 || title !== currentTitle) {
        if (currentGroup.length > 0) groups.push({ title: currentTitle, data: currentGroup });
        currentTitle = title;
        currentGroup = [item];
      } else {
        currentGroup.push(item);
      }
    }
    if (currentGroup.length > 0) groups.push({ title: currentTitle, data: currentGroup });

    // Reverse for inverted list: newest section first, items newest-first within section
    return groups.reverse().map(g => ({ ...g, data: [...g.data].reverse() }));
  }, [messages, openProfileTasks, closedProfileTasksById, profileId]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: scheme === "dark" ? "#000000" : "#FFFFFF" }]} edges={["top"]}>
      {/* iOS-style nav bar */}
      <View style={[styles.navBar, { borderBottomColor: theme.separator }]}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/(main)/home"))}
          style={styles.backBtn}
          hitSlop={12}
        >
          <CaretLeft size={20} color={theme.primary} weight="bold" />
          <Text style={[styles.backLabel, { color: theme.primary, fontFamily: "Inter_400Regular" }]}>Back</Text>
        </Pressable>
        <View style={styles.navCenter}>
          {source === "synced" ? null : isGroupThread ? (
            // The cluster itself stays derive-only — no upload flow on the
            // cluster as a WHOLE, per the existing "no custom group photo"
            // decision — but tapping it opens GroupMembersSheet, a real
            // roster (name + email per member) where each member's own
            // avatar IS individually editable. Same nested-circles-within-
            // a-circle layout as MessageCard's home-list cluster
            // (GROUP_CLUSTER_CELL_STYLES) — matches iMessage's own group
            // icon instead of a linear overlapping fan.
            <Pressable onPress={() => setGroupMembersSheetOpen(true)} hitSlop={8} style={styles.navAvatarWrap}>
              <View style={styles.navGroupCluster}>
                {groupMembers.slice(0, 4).map((member, i) => {
                  const memberAvatarUri = resolveProfileAvatarUri(member.customAvatarUri, member.avatarUri);
                  const cellStyle = GROUP_CLUSTER_CELL_STYLES[Math.min(groupMembers.length, 4)]?.[i];
                  return (
                    <View
                      key={member.id}
                      style={[
                        styles.navGroupAvatarItem,
                        cellStyle,
                        { backgroundColor: theme.muted, experimental_backgroundImage: theme.avatarGradient, borderColor: theme.background },
                      ]}
                    >
                      {memberAvatarUri ? (
                        <Image source={{ uri: memberAvatarUri }} style={styles.navGroupAvatarImage} />
                      ) : (
                        <Text style={[styles.navGroupAvatarText, { fontFamily: "Inter_700Bold" }]}>
                          {deriveAvatarInitials(member.name, member.senderInitial)}
                        </Text>
                      )}
                    </View>
                  );
                })}
              </View>
            </Pressable>
          ) : (
            <Pressable onPress={handleChangeAvatar} disabled={uploadingAvatar} hitSlop={8} style={styles.navAvatarWrap}>
              {avatarUri ? (
                <Image
                  source={{ uri: avatarUri }}
                  style={[styles.navAvatar, { backgroundColor: theme.muted, opacity: uploadingAvatar ? 0.5 : 1 }]}
                />
              ) : (
                <View style={[styles.navAvatar, { backgroundColor: theme.muted, experimental_backgroundImage: theme.avatarGradient, opacity: uploadingAvatar ? 0.5 : 1 }]}>
                  <Text style={[styles.navAvatarText, { fontFamily: "Inter_700Bold" }]}>
                    {avatarInitials}
                  </Text>
                </View>
              )}
              {uploadingAvatar && (
                <ActivityIndicator size="small" color="#FFF" style={styles.navAvatarSpinner} />
              )}
              {/* Small camera badge signals the avatar is tappable to change
                  the photo — without it, a plain circular image gives no
                  visual hint that it's interactive. Hidden while uploading
                  so it doesn't compete with the spinner. */}
              {!uploadingAvatar && (
                <View style={[styles.navAvatarEditBadge, { backgroundColor: "#FFFFFF", borderColor: theme.background }]}>
                  <Camera size={12} color={theme.primary} weight="fill" />
                </View>
              )}
            </Pressable>
          )}
          <Text style={[styles.navName, { color: theme.surface, fontFamily: "Inter_600SemiBold" }]} numberOfLines={1}>
            {name ?? "Conversation"}
          </Text>
          <Text style={[styles.navSub, { color: theme.muted, fontFamily: "Inter_400Regular" }]} numberOfLines={1}>
            {!isGroupThread && source !== "slack" && source !== "teams" && source !== "synced"
              ? platformIdentifier ?? ""
              : ""}
          </Text>
        </View>
        <View style={styles.navRight} />
      </View>

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        stickySectionHeadersEnabled={false}
        inverted
        onScrollToIndexFailed={() => { }}
        onEndReached={loadOlderMessages}
        onEndReachedThreshold={0.5}
        renderSectionHeader={() => null}
        renderSectionFooter={({ section }) =>
          section.title ? (
            <View style={styles.sectionHeader}>
              <View style={[styles.sectionLine, { backgroundColor: theme.separator }]} />
              <Text style={[styles.sectionTitle, { color: theme.muted, fontFamily: "Inter_500Medium" }]}>
                {section.title}
              </Text>
              <View style={[styles.sectionLine, { backgroundColor: theme.separator }]} />
            </View>
          ) : null
        }
        renderItem={({ item, index, section }) => {
          // A task renders as its own status row (icon/title/subtitle/file
          // chips), same as AllTasksSheet — see TimelineRow/
          // deriveTimelineRowState, exported from MessageCard.tsx
          // specifically for this reuse. Fully interactive: tapping a task
          // still awaiting review opens the same HumanInputSheet the "Tap to
          // Review" row does elsewhere; file chips still preview.
          if (item.type === "task") {
            // A task that's already completed/resolved has nothing left to
            // resolve, and a task moved to My Tasks (assignee: "human") is
            // no longer this conversation's to close out — it's tracked and
            // resolved from the My Tasks tab instead. No long-press handler
            // passed at all for either case. onLongPress is passed straight
            // INTO TimelineRow (not a second Pressable wrapped around the
            // outside) — RN's touch responder only lets one Pressable in a
            // nested stack claim a given touch, so an ancestor Pressable's
            // onLongPress would otherwise silently never fire once
            // TimelineRow's own onPress-driven branches (e.g. "Tap to
            // Review") are active. See onLongPress's doc comment on
            // TimelineRow itself.
            const isAlreadyResolved = item.task.status === "completed" || item.task.status === "inactive";
            const isHumanTask = item.task.assignee === "human";
            return (
              <View style={[styles.taskRowWrap, { backgroundColor: theme.searchBg }]}>
                <TimelineRow
                  task={item.task}
                  theme={theme}
                  onRetryTask={handleRetryTask}
                  onHitlPress={setHitlSheetTask}
                  {...deriveTimelineRowState(item.task, theme)}
                  hasLineBelow={false}
                  isLastRow
                  taskFiles={taskDeliverablesMap.get(item.task.id) || []}
                  showStatusSubtitles
                  compact
                  collapseFiles={false}
                  onLongPress={isAlreadyResolved || isHumanTask ? undefined : () => handleResolveTask(item.task)}
                />
              </View>
            );
          }

          const message = item.message;

          // For every other profile, direction "in" means the OTHER person
          // sent it (gray, left) and "out" means the human user sent it
          // (blue, right). A "synced" profile inverts that: the human typed
          // the request themselves (stored as direction "in" — see
          // createSyncedAgentTask) and the AGENT is the one replying (stored
          // as "out" — see handleSendSyncedReply). Flipping which side each
          // renders on makes the bubble colors match who's actually
          // speaking, instead of literally following the in/out field.
          const isOut = source === "synced" ? message.direction === "in" : message.direction === "out";
          const hasAttachments = message.attachments && message.attachments.length > 0;

          // Cluster consecutive same-direction messages sent within a short
          // window (like iMessage/Mail) — the avatar and timestamp only
          // render on the LAST message of a cluster (chronologically), and
          // spacing tightens between clustered bubbles. Section data is
          // newest-first (inverted list), so the chronologically-next
          // message is at index - 1 and the chronologically-previous one is
          // at index + 1. Task items never cluster with message bubbles —
          // only compared against sibling items that are themselves messages.
          const CLUSTER_WINDOW_MS = 10 * 60 * 1000;
          const nextChrono = index > 0 ? section.data[index - 1] : null;
          const prevChrono = index < section.data.length - 1 ? section.data[index + 1] : null;
          const isClusteredWithNext =
            !!nextChrono &&
            nextChrono.type === "message" &&
            nextChrono.message.kind !== "calendar_event" &&
            nextChrono.message.direction === message.direction &&
            new Date(nextChrono.timestamp).getTime() - new Date(message.timestamp).getTime() <= CLUSTER_WINDOW_MS;
          const isClusteredWithPrev =
            !!prevChrono &&
            prevChrono.type === "message" &&
            prevChrono.message.kind !== "calendar_event" &&
            prevChrono.message.direction === message.direction &&
            new Date(message.timestamp).getTime() - new Date(prevChrono.timestamp).getTime() <= CLUSTER_WINDOW_MS;
          const isLastInCluster = !isClusteredWithNext;

          // Calendar-event confirmations render as a small centered
          // breadcrumb (like an iMessage system note), not a chat bubble —
          // the agent's own reply already states this in natural language,
          // so a full-size bubble would just repeat it.
          if (message.kind === "calendar_event") {
            return (
              <View style={styles.eventBreadcrumbRow}>
                <View style={[styles.eventBreadcrumb, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
                  <CalendarCheck size={13} color={theme.muted} weight="bold" />
                  <Text style={[styles.eventBreadcrumbText, { color: theme.muted, fontFamily: "Inter_500Medium" }]} numberOfLines={2}>
                    {message.text}
                  </Text>
                </View>
                <Text style={[styles.eventBreadcrumbTime, { color: theme.muted, fontFamily: "Inter_400Regular" }]}>
                  {formatLocalTimestamp(message.timestamp)}
                </Text>
              </View>
            );
          }

          return (
            <View
              style={[
                styles.msgRow,
                isOut ? styles.msgRowOut : styles.msgRowIn,
                isClusteredWithPrev && styles.msgRowClustered,
              ]}
            >
              {/* No avatar at all for a "synced" self-request thread — see
                  the identical nav-bar carve-out above; there's no external
                  sender identity to show. In a group thread, use the actual
                  sender's own real photo (resolved off their solo Profile)
                  rather than the generic conversation avatar. */}
              {!isOut && source !== "synced" && (() => {
                const senderMember = isGroupThread && message.senderIdentifier
                  ? groupMembers.find((m) => m.platformIdentifier.toLowerCase() === message.senderIdentifier!.toLowerCase())
                  : undefined;
                const bubbleAvatarUri = senderMember ? resolveProfileAvatarUri(senderMember.customAvatarUri, senderMember.avatarUri) : avatarUri;
                const bubbleAvatarInitials = senderMember ? deriveAvatarInitials(senderMember.name, senderMember.senderInitial) : avatarInitials;
                return (
                  <View style={[styles.bubbleAvatar, { backgroundColor: theme.muted, experimental_backgroundImage: theme.avatarGradient }, !isLastInCluster && styles.bubbleAvatarHidden]}>
                    {isLastInCluster && (
                      bubbleAvatarUri
                        ? <Image source={{ uri: bubbleAvatarUri }} style={styles.bubbleAvatarImg} />
                        : <Text style={[styles.bubbleAvatarText, { fontFamily: "Inter_700Bold" }]}>{bubbleAvatarInitials}</Text>
                    )}
                  </View>
                );
              })()}
              <View style={[styles.bubbleWrap, isOut && styles.bubbleWrapOut]}>
                {/* Per-sender attribution — shown whenever 2+ distinct
                    people have actually SENT a message in this thread (see
                    needsSenderAttribution above), independent of
                    profile.threadType (which tracks participant COUNT for
                    reply-all scoping, not who has actually spoken). Shown
                    once at the start of each incoming cluster, not on every
                    bubble, matching how the avatar/timestamp already
                    collapse across a cluster. */}
                {!isOut && needsSenderAttribution && !isClusteredWithPrev && (() => {
                  const senderName = resolveSenderDisplayName(message.senderIdentifier, threadParticipants);
                  return senderName ? (
                    <Text style={[styles.senderLabel, { color: theme.muted, fontFamily: "Inter_600SemiBold" }]}>
                      {senderName}
                    </Text>
                  ) : null;
                })()}
                {message.text ? (
                  <View style={[
                    styles.bubble,
                    // Only the very FIRST bubble of a cluster gets the sharp
                    // "tail" corner (pointing toward where the avatar sits) —
                    // every other bubble in the cluster, middle or last, is
                    // fully rounded. isClusteredWithPrev means this bubble is
                    // NOT the first one, so !isClusteredWithPrev is exactly
                    // "is the first bubble of its cluster" (also true for any
                    // standalone, non-clustered message).
                    isOut
                      ? {
                        backgroundColor: "#007AFF",
                        borderTopLeftRadius: 18,
                        borderBottomLeftRadius: 18,
                        borderTopRightRadius: !isClusteredWithPrev ? 4 : 18,
                        borderBottomRightRadius: 18,
                      }
                      : {
                        backgroundColor: theme.bubbleIn,
                        borderTopRightRadius: 18,
                        borderBottomRightRadius: 18,
                        borderTopLeftRadius: !isClusteredWithPrev ? 4 : 18,
                        borderBottomLeftRadius: 18,
                      },
                  ]}>
                    <LinkifiedText
                      text={message.text}
                      style={[
                        styles.bubbleText,
                        { color: isOut ? "#FFFFFF" : theme.surface, fontFamily: "Inter_400Regular" },
                      ]}
                      // On the blue outgoing bubble, plain white with an
                      // underline is the only reliable way to read as "link"
                      // without a second color competing with the bubble's
                      // own blue. On an incoming (gray) bubble, the theme's
                      // own primary accent reads clearly as a link the same
                      // way it does everywhere else in the app.
                      linkStyle={{
                        color: isOut ? "#FFFFFF" : theme.primary,
                        textDecorationLine: "underline",
                      }}
                    />
                  </View>
                ) : null}
                {hasAttachments && (
                  <View style={[styles.attachList, isOut && styles.attachListOut]}>
                    {message.attachments!.map((att, i) => (
                      <AttachmentCard key={i} att={att} />
                    ))}
                  </View>
                )}
                {isLastInCluster && (
                  <Text style={[
                    styles.timestamp,
                    { color: theme.muted, fontFamily: "Inter_400Regular" },
                    isOut && styles.timestampOut,
                  ]}>
                    {formatLocalTimestamp(message.timestamp)}
                  </Text>
                )}
              </View>
            </View>
          );
        }}
        ListHeaderComponent={
          <View style={styles.disclaimer}>
            <Text style={[styles.disclaimerText, { color: theme.muted, fontFamily: "Inter_400Regular" }]}>
              Messages are AI-summarized previews, not full text.
            </Text>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={[styles.emptyText, { color: theme.muted, fontFamily: "Inter_400Regular" }]}>
              No messages yet
            </Text>
          </View>
        }
        ListFooterComponent={
          loadingOlder ? (
            <View style={styles.loadingOlder}>
              <ActivityIndicator size="small" color={theme.muted} />
            </View>
          ) : null
        }
      />

      {/* Fake iMessage-style composer — never a real text input. This
          conversation only ever gets a real reply through the agent (there
          is no direct-send path from this screen), so tapping this bar
          opens AddAgentTaskSheet — pre-addressed to this profile via a
          real @mention for a real contact, or with no prefill at all for
          the Synced self-chat (nothing to @mention when this IS the
          self-issued-task identity). Solo (non-group) conversations only.
          No background bar behind it — transparent wrapper floats directly
          on the chat background, and the pill itself uses the same
          liquid-glass GlassView blur (with a translucent-color fallback)
          as HitlApproveMode.tsx/AddAgentTaskSheet.tsx's own glass buttons,
          instead of a flat theme.searchBg fill. */}
      {!isGroupThread && profile && (
        <Pressable
          onPress={handleComposerTap}
          style={[styles.fakeComposer, { paddingBottom: Math.max(insets.bottom, 10) }]}
        >
          <View style={styles.fakeComposerPill}>
            {Platform.OS === "ios" && GlassView
              ? <GlassView style={[StyleSheet.absoluteFill, styles.fakeComposerPillRadius]} colorScheme={scheme} glassEffectStyle="regular" />
              : <View style={[StyleSheet.absoluteFill, styles.fakeComposerPillRadius, { backgroundColor: scheme === "dark" ? "rgba(40,40,44,0.92)" : "rgba(235,235,240,0.92)" }]} />}
            <Text style={[styles.fakeComposerText, { color: theme.muted, fontFamily: "Inter_400Regular" }]} numberOfLines={1}>
              {profile.source === "synced" ? "New Agent Task..." : `Ask Synced to reply to ${profile.name.split(/\s+/)[0]}`}
            </Text>
          </View>
          <View style={styles.fakeComposerSendBtn}>
            {Platform.OS === "ios" && GlassView
              ? <GlassView style={[StyleSheet.absoluteFill, styles.fakeComposerSendBtnRadius]} colorScheme={scheme} glassEffectStyle="regular" />
              : <View style={[StyleSheet.absoluteFill, styles.fakeComposerSendBtnRadius, { backgroundColor: scheme === "dark" ? "rgba(40,40,44,0.92)" : "rgba(235,235,240,0.92)" }]} />}
            <ArrowUp size={18} color={theme.primary} weight="bold" />
          </View>
        </Pressable>
      )}

      <HumanInputSheet
        task={hitlSheetTask}
        request={hitlSheetTask?.humanInputRequest ?? null}
        profile={profile}
        groupMembers={isGroupThread ? groupMembers : undefined}
        groupSource={isGroupThread ? source : undefined}
        isPresented={!!hitlSheetTask?.humanInputRequest}
        onClose={() => setHitlSheetTask(null)}
      />

      {!isGroupThread && profile && (
        <AddAgentTaskSheet
          isPresented={isAddSheetOpen}
          onClose={() => setIsAddSheetOpen(false)}
          profiles={profiles}
          // No prefill at all for the Synced self-chat — there's no
          // "whoever this is" to @mention when this profile IS the
          // self-issued-task identity (mirrors createSyncedAgentTask's own
          // un-mentioned path, same as opening the sheet from home.tsx).
          // addSheetMentionWrap (set only after choosing "Reply" in the
          // dialog above) overrides the default "Send "/": " wording with
          // "Reply to "/' in "Subject": ' — see handleComposerTap.
          initialMention={
            profile.source === "synced"
              ? undefined
              : { profileId: profile.id, name: profile.name, source: profile.source, identifier: profile.platformIdentifier, ...addSheetMentionWrap }
          }
        />
      )}

      {isGroupThread && (
        <GroupMembersSheet
          members={groupMembers}
          isPresented={groupMembersSheetOpen}
          onClose={() => setGroupMembersSheetOpen(false)}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  navBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingHorizontal: 6,
    minWidth: 70,
  },
  backLabel: { fontSize: 17 },
  navCenter: { flex: 1, alignItems: "center", gap: 2 },
  navAvatarWrap: { marginBottom: 2 },
  navAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  navAvatarEditBadge: {
    position: "absolute",
    bottom: -3,
    right: -3,
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.25,
    shadowRadius: 2,
    elevation: 3,
  },
  navAvatarSpinner: { position: "absolute", top: 0, left: 0, right: 0, height: 32 },
  // Fixed 32x32 positioning frame — each member is placed inside it via
  // GROUP_CLUSTER_CELL_STYLES percentages (see navGroupAvatarItem), same
  // pattern as MessageCard's groupAvatarCluster/groupAvatarCell.
  navGroupCluster: { width: 32, height: 32 },
  navGroupAvatarItem: {
    position: "absolute",
    borderRadius: "50%",
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  navGroupAvatarImage: { width: "100%", height: "100%", borderRadius: 999 },
  navGroupAvatarText: { color: "#FFF", fontSize: 9 },
  navAvatarText: { color: "#FFF", fontSize: 12 },
  navName: { fontSize: 14, lineHeight: 17 },
  navSub: { fontSize: 11 },
  navRight: { minWidth: 70 },
  list: { padding: 16, gap: 12, paddingBottom: 48 },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginVertical: 8,
  },
  sectionLine: { flex: 1, height: StyleSheet.hairlineWidth },
  sectionTitle: { fontSize: 12 },
  msgRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 6,
  },
  msgRowIn: { justifyContent: "flex-start" },
  msgRowOut: { justifyContent: "flex-end", },
  // Pulls a clustered row closer to the sibling immediately above it in
  // layout order (applied when THIS row has a chronologically-previous
  // clustered sibling — marginTop always means "space above me in layout,"
  // independent of the list's `inverted` prop, which only reverses render
  // order/scroll direction, not what marginTop/marginBottom mean). Cancels
  // most of the list's fixed contentContainerStyle gap so consecutive
  // same-direction messages sent close together read as one visual group.
  msgRowClustered: { marginBottom: 0, marginTop: -8 },
  eventBreadcrumbRow: {
    alignItems: "center",
    marginVertical: 6,
    gap: 3,
  },
  eventBreadcrumb: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    maxWidth: "78%",
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  eventBreadcrumbText: { fontSize: 12, flexShrink: 1, textAlign: "center" },
  eventBreadcrumbTime: { fontSize: 10 },
  bubbleAvatar: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    overflow: "hidden",
    marginBottom: 18,
  },
  // Kept in the layout (not display:none) so the bubble stays aligned with
  // where the avatar would be — only its content is hidden via isLastInCluster.
  bubbleAvatarHidden: { opacity: 0 },
  bubbleAvatarText: { color: "#FFF", fontSize: 9 },
  bubbleAvatarImg: { width: 26, height: 26, borderRadius: 13 },
  bubbleWrap: { maxWidth: "82%", gap: 6 },
  bubbleWrapOut: { alignItems: "flex-end" },
  senderLabel: { fontSize: 12, marginLeft: 4, marginBottom: -2 },
  bubble: {
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bubbleText: { fontSize: 16, lineHeight: 22 },
  attachList: { gap: 6, alignItems: "flex-start" },
  attachListOut: { alignItems: "flex-end" },
  attachCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 7,
    minWidth: 160,
    maxWidth: 260,
  },
  attachIcon: {
    width: 28,
    height: 28,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  attachName: { flex: 1, fontSize: 12, lineHeight: 15 },
  timestamp: { fontSize: 11, paddingHorizontal: 2 },
  timestampOut: { textAlign: "right" },
  empty: { alignItems: "center", paddingTop: 80 },
  loadingOlder: { paddingVertical: 16, alignItems: "center" },
  emptyText: { fontSize: 14 },
  disclaimer: { alignItems: "center", paddingVertical: 16, paddingHorizontal: 24 },
  disclaimerText: { fontSize: 11, textAlign: "center", lineHeight: 16 },
  // TimelineRow (from MessageCard.tsx) expects a card-like surface — inside
  // MessageCard it's already on top of theme.card, but here it floats
  // directly on the plain chat background. Faint, square, and full-bleed
  // (negative margin cancels the list's own horizontal padding) — reads as
  // a flat status strip running the full width of the thread, not a bubble
  // or a bordered card competing with the message bubbles around it.
  taskRowWrap: {
    marginHorizontal: -16,
    paddingHorizontal: 16,
    paddingVertical: 10,
    alignSelf: "stretch",
  },
  // Fake iMessage-style composer bar — see its own usage comment for why
  // this is never a real TextInput. Visually reads as a normal message
  // composer (liquid-glass pill placeholder + round glass send button), no
  // background bar of its own — floats transparently over the chat.
  fakeComposer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  // overflow:"hidden" clips the absolutely-filled GlassView/fallback below
  // to the pill's own rounded corners — the fill itself carries no
  // border/background of its own on this outer style, just shape+sizing.
  fakeComposerPill: {
    flex: 1,
    minHeight: 36,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 8,
    justifyContent: "center",
    overflow: "hidden",
  },
  fakeComposerPillRadius: { borderRadius: 18 },
  fakeComposerText: { fontSize: 15 },
  fakeComposerSendBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  fakeComposerSendBtnRadius: { borderRadius: 15 },
});
