import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  RefreshControl,
  Image,
  NativeModules,
  NativeEventEmitter,
  Platform,
  Alert,
  ActivityIndicator,
} from "react-native";

import { Host, ContextMenu, Button as NativeButton } from "@expo/ui/swift-ui";
import { HumanInputSheet } from "../../components/HumanInputSheet";
import { AddAgentTaskSheet } from "../../components/AddAgentTaskSheet";
import { useRouter, useIsFocused } from "expo-router";

import { useTheme } from "../../hooks/useTheme";
import { useColorScheme } from "../../hooks/useColorScheme";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  saveProfile,
  deleteProfiles,
  deleteGroupThreads,
  deleteTasks,
  markTasksInactive,
  deriveGroupDisplayName,
  groupDeliverablesByTask,
  Profile,
  ConversationRow,
  Task,
  Message,
} from "../../services/storage";
import { useUser } from "../../contexts/UserContext";

import { lookupContact, hasContactPermission } from "../../services/contacts";
import MessageCard, { isCardHighlighted } from "../../components/MessageCard";
import { SkeletonMessageList } from "../../components/SkeletonMessageCard";
import { SwipeToDismissRow } from "../../components/SwipeToDismissRow";
import { FolderOpen, Tray, Check, Plus } from "phosphor-react-native";
import { useEditMode } from "../../contexts/EditModeContext";

export default function HomeScreen() {
  const router = useRouter();
  const theme = useTheme();
  const scheme = useColorScheme();
  const insets = useSafeAreaInsets();
  const {
    profiles, groupThreads, tasks, messages, deliverables, loading, profilesLoading,
    loadMoreProfiles, loadMoreGroupThreads, loadMoreTasks,
    hasMoreProfiles, hasMoreGroupThreads, hasMoreTasks,
  } = useUser();
  const [contactImages, setContactImages] = useState<Record<string, string>>(
    {},
  );
  const [refreshing, setRefreshing] = useState(false);
  const { editMode, setEditMode, setSelectedCount, setOnDelete } =
    useEditMode();
  const isFocused = useIsFocused();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [hitlSheetTask, setHitlSheetTask] = useState<Task | null>(null);
  const [isAddSheetOpen, setIsAddSheetOpen] = useState(false);
  // Sequential-pause auto-chaining: when the human closes the sheet after
  // submitting an answer (e.g. approving a calendar invite), the agent may
  // resume and immediately pause again for the next step (e.g. the follow-up
  // email approval) on the SAME task. Without this, the sheet just closes and
  // the user has to notice the "Review & Approve" button reappeared and tap
  // it a second time. `recentlyInteractedTaskId` tracks the task the sheet
  // was just closed for; if that exact task re-enters awaiting_human_input
  // with a fresh unanswered request within the window below, the sheet
  // reopens automatically. Scoped strictly to that one task — a different
  // task's first-time HITL request is never auto-opened, only surfaced via
  // the normal "Review & Approve" button (MessageCard's hitlTasks).
  const [recentlyInteractedTaskId, setRecentlyInteractedTaskId] = useState<string | null>(null);
  const recentlyInteractedAtRef = useRef<number>(0);
  const AUTO_REOPEN_WINDOW_MS = 45000;

  // Sort by each profile's most recent real message (matching MessageCard's
  // own latestMessage logic — calendar-event breadcrumbs don't count).
  // Primary key: "highlighted" — calls the exact same isCardHighlighted
  // function MessageCard itself uses to decide the full-card vs. flat/
  // recessed treatment, so this can never drift out of sync with what's
  // actually on screen. Highlighted cards always sort above non-highlighted
  // ones; recency only breaks ties within each group.
  //
  // All of this — the two lookup Maps, the merged/sorted row list, AND each
  // row's highlighted flag — used to be plain consts recomputed from scratch
  // on EVERY render (including renders triggered by state unrelated to this
  // data, like toggling a checkbox in edit mode), with isCardHighlighted
  // called again per row inside renderItem below on top of that. Wrapped in
  // one useMemo so it only redoes this work when profiles/groupThreads/
  // messages/tasks actually change, and highlightedById is computed ONCE
  // per row here (not re-derived a second time in renderItem).
  // Reused both inside the sort/aggregation memo below AND by the HITL
  // sheet's group-member lookup further down — built once here rather than
  // twice (it used to be rebuilt inline inside the sort memo with no way
  // for that second call site to reach it).
  const profileById = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles]);

  const { tasksByProfile, highlightedById, sortedConversations } = useMemo(() => {
    const latestMessageByProfile = new Map<string, Message>();
    for (const m of messages) {
      if (m.kind === "calendar_event") continue;
      const existing = latestMessageByProfile.get(m.profileId);
      if (!existing || new Date(m.timestamp).getTime() > new Date(existing.timestamp).getTime()) {
        latestMessageByProfile.set(m.profileId, m);
      }
    }
    const tasksByProfile = new Map<string, Task[]>();
    for (const t of tasks) {
      if (!t.profileId) continue;
      const list = tasksByProfile.get(t.profileId) ?? [];
      list.push(t);
      tasksByProfile.set(t.profileId, list);
    }
    // One row per conversation — a solo Profile (1:1) or a GroupThread (2+
    // people), merged and sorted together by the same highlighted/recency
    // rule (see isCardHighlighted). Both Profile and GroupThread expose the
    // same id/latestMessageId/createdAt shape needed for this, so the sort
    // comparator itself doesn't need to branch on kind.
    //
    // A solo Profile can now exist WITHOUT ever having a direct 1:1 message —
    // e.g. someone who's only ever been a member of a group thread still gets
    // their own solo Profile doc (so their name/avatar are resolvable), but
    // they've never actually messaged the user one-on-one. That profile must
    // stay invisible here until it has a real message of its own; otherwise
    // every group member shows up a SECOND time as an empty, contentless 1:1
    // row alongside the real group conversation.
    const profileRows: ConversationRow[] = profiles
      .filter((profile) => latestMessageByProfile.has(profile.id))
      .map((profile) => ({ kind: "solo" as const, profile }));
    const groupRows: ConversationRow[] = groupThreads.map((group) => ({
      kind: "group" as const,
      group,
      members: group.memberProfileIds.map((id) => profileById.get(id)).filter((p): p is Profile => !!p),
    }));
    const highlightedById = new Map<string, boolean>();
    const sortedConversations = [...profileRows, ...groupRows].sort((a, b) => {
      const aId = a.kind === "solo" ? a.profile.id : a.group.id;
      const bId = b.kind === "solo" ? b.profile.id : b.group.id;
      const aCreatedAt = a.kind === "solo" ? a.profile.createdAt : a.group.createdAt;
      const bCreatedAt = b.kind === "solo" ? b.profile.createdAt : b.group.createdAt;
      const aMsg = latestMessageByProfile.get(aId) ?? null;
      const bMsg = latestMessageByProfile.get(bId) ?? null;
      // Cache per-id — the sort comparator visits the same id multiple times
      // across an O(n log n) sort, and renderItem below reuses this same map
      // instead of calling isCardHighlighted a third time per row.
      let aHighlighted = highlightedById.get(aId);
      if (aHighlighted === undefined) {
        aHighlighted = isCardHighlighted(tasksByProfile.get(aId) ?? [], aMsg);
        highlightedById.set(aId, aHighlighted);
      }
      let bHighlighted = highlightedById.get(bId);
      if (bHighlighted === undefined) {
        bHighlighted = isCardHighlighted(tasksByProfile.get(bId) ?? [], bMsg);
        highlightedById.set(bId, bHighlighted);
      }
      if (aHighlighted !== bHighlighted) return aHighlighted ? -1 : 1;

      const aTime = aMsg ? new Date(aMsg.timestamp).getTime() : new Date(aCreatedAt).getTime();
      const bTime = bMsg ? new Date(bMsg.timestamp).getTime() : new Date(bCreatedAt).getTime();
      return bTime - aTime;
    });
    return { tasksByProfile, highlightedById, sortedConversations };
  }, [profiles, groupThreads, messages, tasks, profileById]);

  // Precomputed once per screen (see groupDeliverablesByTask's own doc
  // comment) and threaded down to every MessageCard as a prop, instead of
  // each rendered card independently re-sorting/deduping the full
  // deliverables array itself.
  const taskDeliverablesMap = useMemo(() => groupDeliverablesByTask(deliverables), [deliverables]);

  const loadContactImages = useCallback(async (profs: Profile[]) => {
    const hasPerm = await hasContactPermission();
    if (!hasPerm) return;
    const entries = await Promise.all(
      profs.map(async (p) => {
        const match = await lookupContact(p.name);
        return [p.id, match?.imageUri] as [string, string | undefined];
      }),
    );
    const images: Record<string, string> = {};
    for (const [id, uri] of entries) {
      if (uri) images[id] = uri;
    }
    setContactImages(images);
  }, []);

  // Load contact images when profiles update, then once more after a short
  // delay to catch the freshly-built contact cache (a first-open permission
  // grant can populate the OS contacts cache slightly after this effect's
  // immediate call already ran). One effect, not two separate ones each
  // independently calling loadContactImages — this used to double-fire on
  // every single profiles update (immediate + a redundant 2s-later repeat),
  // which is currently pure waste since services/contacts.ts is fully
  // stubbed (hasContactPermission() always resolves false, so both calls
  // short-circuit immediately) — but the double-fire would matter once that
  // module is implemented for real.
  useEffect(() => {
    loadContactImages(profiles);
    const t = setTimeout(() => {
      loadContactImages(profiles);
    }, 2000);
    return () => clearTimeout(t);
  }, [profiles, loadContactImages]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadContactImages(profiles);
    setRefreshing(false);
  }, [profiles, loadContactImages]);

  const toggleEditMode = () => {
    const next = !editMode;
    setEditMode(next);
    setSelected(new Set());
    if (!next) {
      setSelectedCount(0);
      setOnDelete(null);
    }
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDelete = useCallback(async () => {
    if (selected.size === 0) return;
    const ids = Array.from(selected);
    // Delete profiles
    await deleteProfiles(ids);

    // Cascade delete linked tasks
    const tasksToDelete = tasks
      .filter((t) => ids.includes(t.profileId))
      .map((t) => t.id);
    if (tasksToDelete.length > 0) {
      await deleteTasks(tasksToDelete);
    }

    setSelected(new Set());
    setSelectedCount(0);
    setOnDelete(null);
    setEditMode(false);
  }, [selected, tasks, setEditMode, setSelectedCount, setOnDelete]);

  const deleteSingleProfile = useCallback(
    async (id: string) => {
      // Dispatches by id prefix (see GroupThread.id's doc comment) — a
      // group conversation lives in the groupThreads collection, not
      // profiles, so deleting it needs the matching helper or the doc
      // simply wouldn't exist to delete.
      if (id.startsWith("group_")) {
        await deleteGroupThreads([id]);
      } else {
        await deleteProfiles([id]);
      }
      const tasksToDelete = tasks
        .filter((t) => t.profileId === id)
        .map((t) => t.id);
      if (tasksToDelete.length > 0) {
        await deleteTasks(tasksToDelete);
      }
    },
    [tasks],
  );

  const confirmDeleteSingleProfile = useCallback(
    (id: string, name: string) => {
      Alert.alert(
        "Delete Conversation?",
        `Your conversation with ${name} will be deleted. This action cannot be undone.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: () => deleteSingleProfile(id),
          },
        ],
      );
    },
    [deleteSingleProfile],
  );

  // "Still open" — the set of statuses a Dismiss action should clear. Mirrors
  // the same appendable/active distinction the backend's triage consolidation
  // uses (see appendableStatuses in functions/src/pipeline.ts) — completed,
  // failed, and already-inactive tasks are left untouched since there's
  // nothing further to stop.
  const OPEN_TASK_STATUSES = ["pending", "in_progress", "awaiting_human_input"];

  const resolveProfile = useCallback(
    async (id: string) => {
      // Only agent-assigned tasks — a task assigned to "human" is the user's
      // own responsibility to work, not the agent's, so bulk-resolving a
      // profile should never silently mark those done out from under them.
      // "awaiting_human_input" is still assignee "agent" here (an agent task
      // just paused on a question), so it's correctly included, not excluded.
      const openTaskIds = tasks
        .filter((t) => t.profileId === id && t.assignee === "agent" && OPEN_TASK_STATUSES.includes(t.status))
        .map((t) => t.id);
      if (openTaskIds.length > 0) {
        await markTasksInactive(openTaskIds);
      }
    },
    [tasks],
  );

  const confirmResolveProfile = useCallback(
    (id: string, name: string) => {
      Alert.alert(
        "Dismiss Tasks?",
        `All open agent tasks with ${name} will be marked resolved and the agent will stop working on them. Tasks assigned to you are not affected.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Dismiss Tasks",
            style: "destructive",
            onPress: () => resolveProfile(id),
          },
        ],
      );
    },
    [resolveProfile],
  );

  const selectProfileInEditMode = useCallback(
    (id: string) => {
      if (!editMode) setEditMode(true);
      setSelected((prev) => new Set(prev).add(id));
    },
    [editMode, setEditMode],
  );

  // Keep context in sync — only the focused screen may write into the
  // shared EditModeContext (see identical comment in tasks.tsx for why).
  useEffect(() => {
    if (editMode && isFocused) {
      setSelectedCount(selected.size);
      setOnDelete(() => handleDelete);
    }
  }, [editMode, isFocused, selected.size, handleDelete, setSelectedCount, setOnDelete]);

  // Auto-reopen the HITL sheet when the task we just answered re-enters
  // awaiting_human_input with a new unanswered request (see state comment
  // above for why). Self-consumes on match so it never fires more than once
  // per close, and expires after the window so a much-later re-pause (e.g.
  // thread consolidation reopening the same task after the user left) falls
  // back to the normal button instead of surprising the user.
  useEffect(() => {
    if (!recentlyInteractedTaskId) return;
    if (Date.now() - recentlyInteractedAtRef.current > AUTO_REOPEN_WINDOW_MS) {
      setRecentlyInteractedTaskId(null);
      return;
    }
    const t = tasks.find((t) => t.id === recentlyInteractedTaskId);
    if (
      t &&
      t.status === "awaiting_human_input" &&
      t.humanInputRequest &&
      !t.humanInputRequest.answer &&
      hitlSheetTask?.id !== t.id
    ) {
      setHitlSheetTask(t);
      setRecentlyInteractedTaskId(null);
    }
  }, [tasks, recentlyInteractedTaskId, hitlSheetTask]);

  // Arms the auto-reopen watch — called ONLY when the human actually
  // submitted an answer (HumanInputSheet's onAnswered), never on a plain
  // tap-away/pan-down dismiss. Arming on every close caused the sheet to
  // immediately reopen itself when a user backed out without answering: the
  // task's humanInputRequest is still unanswered, so the watch effect below
  // would match right away and snap the sheet back open.
  const handleHitlAnswered = useCallback(() => {
    if (hitlSheetTask) {
      setRecentlyInteractedTaskId(hitlSheetTask.id);
      recentlyInteractedAtRef.current = Date.now();
    }
  }, [hitlSheetTask]);

  const handleHitlSheetClose = useCallback(() => {
    setHitlSheetTask(null);
  }, []);

  // HumanInputSheet needs solo-vs-group dispatch too — a task's profileId
  // may point at either collection (see the id.startsWith('group_')
  // convention used throughout, e.g. sortedConversations above).
  const hitlSheetGroup = hitlSheetTask?.profileId?.startsWith("group_")
    ? groupThreads.find((g) => g.id === hitlSheetTask.profileId)
    : undefined;
  const hitlSheetGroupMembers = hitlSheetGroup
    ? hitlSheetGroup.memberProfileIds.map((id) => profileById.get(id)).filter((p): p is Profile => !!p)
    : undefined;

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {/* Absolute header */}
      <View
        style={[
          styles.header,
          {
            backgroundColor: theme.background,
            paddingTop: insets.top + 14,
            paddingBottom: 14,
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: theme.separator,
          },
        ]}
      >
        <View style={styles.headerInner}>
          {/* Left: Deliverables shortcut — moved here from its old top-right
              spot when the Edit button (previously here) was removed; edit
              mode is now entered via a card's long-press "Select" action
              instead (see the per-card ContextMenu below). Lightning Mode
              (formerly here too) now lives in the bottom nav as "Decide". */}
          {editMode ? (
            <Pressable onPress={toggleEditMode} style={styles.editBtn}>
              <Text
                style={[
                  styles.editBtnText,
                  { color: theme.primary, fontFamily: "Inter_600SemiBold" },
                ]}
              >
                Done
              </Text>
            </Pressable>
          ) : (
            <Pressable
              style={styles.deliverablesBtn}
              onPress={() => router.push("/deliverables")}
              hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
            >
              <FolderOpen size={24} color={theme.primary} weight="duotone" />
              <Text
                numberOfLines={1}
                style={[styles.headerBtnText, { color: theme.primary, fontFamily: "Inter_500Medium" }]}
              >
                Files
              </Text>
            </Pressable>
          )}

          {/* Center: Logo */}
          <Image
            source={
              scheme === "dark"
                ? require("../../assets/logos/logo-dark.png")
                : require("../../assets/logos/logo-light.png")
            }
            style={styles.logoWordmark}
            resizeMode="contain"
          />

          {/* Right: Add Agent Task — mimics tasks.tsx's own add button. */}
          {!editMode && (
            <Pressable
              style={styles.addBtn}
              onPress={() => setIsAddSheetOpen(true)}
              hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
            >
              <Text style={[styles.headerBtnText, { color: theme.primary, fontFamily: "Inter_500Medium" }]}>
                New
              </Text>
              <Plus size={26} color={theme.primary} weight="duotone" />
            </Pressable>
          )}
        </View>
      </View>

      <HumanInputSheet
        task={hitlSheetTask}
        request={hitlSheetTask?.humanInputRequest ?? null}
        profile={hitlSheetGroup ? undefined : profiles.find(p => p.id === hitlSheetTask?.profileId)}
        groupMembers={hitlSheetGroupMembers}
        groupSource={hitlSheetGroup?.source}
        isPresented={!!hitlSheetTask?.humanInputRequest}
        onClose={handleHitlSheetClose}
        onAnswered={handleHitlAnswered}
      />

      <AddAgentTaskSheet
        isPresented={isAddSheetOpen}
        onClose={() => setIsAddSheetOpen(false)}
        profiles={profiles}
      />

      <FlatList
        data={sortedConversations}
        keyExtractor={(item) => (item.kind === "solo" ? item.profile.id : item.group.id)}
        contentContainerStyle={[
          styles.listContent,
          { paddingTop: insets.top + 60 + 24 },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.primary}
          />
        }
        // profiles/groupThreads/tasks are each paginated at PAGE_SIZE=30
        // (UserContext.tsx) — without this, scrolling near the bottom of
        // this list did nothing, so any conversation past the first 30
        // profiles/groups/tasks was simply invisible. This was also the
        // cause of group rows rendering a bare "Group" placeholder instead
        // of real member names: deriveGroupDisplayName falls back to that
        // string when NONE of a group's members resolved (MessageCard.tsx),
        // which happens whenever a member's own solo Profile doc ranks past
        // the current profiles page — a real member whose own 1:1 thread
        // hasn't been active recently sinks below page 30 by
        // updatedAt-descending order even though they're still an active
        // GROUP participant. Loading more of all three closes that gap as
        // the user scrolls, rather than requiring a full reload.
        onEndReached={() => {
          if (hasMoreProfiles) loadMoreProfiles();
          if (hasMoreGroupThreads) loadMoreGroupThreads();
          if (hasMoreTasks) loadMoreTasks();
        }}
        onEndReachedThreshold={0.5}
        ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
        renderItem={({ item }) => {
          const itemId = item.kind === "solo" ? item.profile.id : item.group.id;
          const itemName = item.kind === "solo" ? item.profile.name : (item.group.name ?? deriveGroupDisplayName(item.members));
          const itemAnalyzed = item.kind === "solo" ? item.profile.analyzed : item.group.analyzed;
          const isSelected = selected.has(itemId);
          // Both precomputed once in the useMemo above (same sort pass that
          // already needed this exact data) — no more re-scanning the full
          // `tasks` array or re-calling isCardHighlighted per row per render.
          const linkedTasks = tasksByProfile.get(itemId) ?? [];
          // Same isCardHighlighted verdict the sort above already computed —
          // a non-highlighted (flat/recessed) card gets no horizontal inset
          // here, so it renders edge-to-edge like a plain list row instead of
          // sitting in the same 16pt gutter as a real card. listContent no
          // longer sets paddingHorizontal at all; it's applied per-row here
          // instead, only for highlighted cards.
          const highlighted = highlightedById.get(itemId) ?? false;

          const cardContent = (
            <View style={[styles.cardWrapper, highlighted ? styles.cardWrapperInset : styles.cardWrapperFlatInset]}>
              <MessageCard
                conversation={item}
                tasks={linkedTasks}
                isAnalyzing={!itemAnalyzed}
                theme={theme}
                scheme={scheme}
                contactImageUri={contactImages[itemId]}
                onHitlPress={setHitlSheetTask}
                onPress={() => !editMode && router.push(`/conversation/${itemId}`)}
                taskDeliverablesMap={taskDeliverablesMap}
              />
              {editMode && (
                <>
                  <Pressable
                    onPress={() => toggleSelect(itemId)}
                    style={StyleSheet.absoluteFill}
                  />
                  <View
                    style={[
                      styles.checkbox,
                      {
                        // Position from the visible card edge, not the outer
                        // row edge. Highlighted and flat cards use different
                        // horizontal insets above.
                        right: (highlighted ? 16 : 8) + 12,
                      },
                      {
                        borderColor: isSelected ? theme.primary : theme.muted,
                        backgroundColor: isSelected ? theme.primary : "transparent",
                        borderWidth: isSelected ? 0 : 2,
                      },
                    ]}
                  >
                    {isSelected && <Check size={14} color="#FFFFFF" weight="bold" />}
                  </View>
                </>
              )}
            </View>
          );

          if (Platform.OS === "ios") {
            const contextCard = (
              <Host colorScheme={scheme as "light" | "dark"} ignoreSafeArea="all">
                <ContextMenu>
                  <ContextMenu.Trigger>{cardContent}</ContextMenu.Trigger>
                  <ContextMenu.Items>
                    {!editMode ? (
                      <NativeButton
                        label="Select"
                        systemImage="checkmark.circle"
                        onPress={() => selectProfileInEditMode(itemId)}
                      />
                    ) : null}
                    <NativeButton
                      role="destructive"
                      label="Dismiss Tasks"
                      systemImage="minus.circle"
                      onPress={() => confirmResolveProfile(itemId, itemName)}
                    />
                    <NativeButton
                      role="destructive"
                      label="Delete"
                      systemImage="trash"
                      onPress={() => confirmDeleteSingleProfile(itemId, itemName)}
                    />
                  </ContextMenu.Items>
                </ContextMenu>
              </Host>
            );

            return (
              <SwipeToDismissRow focused={highlighted} disabled={editMode} onDismiss={() => confirmResolveProfile(itemId, itemName)}>
                {contextCard}
              </SwipeToDismissRow>
            );
          }

          return (
            <SwipeToDismissRow focused={highlighted} disabled={editMode} onDismiss={() => confirmResolveProfile(itemId, itemName)}>
              {cardContent}
            </SwipeToDismissRow>
          );
        }}
        ListEmptyComponent={() =>
          loading || profilesLoading ? (
            // Initial profiles/messages listeners in UserContext haven't
            // resolved yet — show a placeholder shaped like real cards
            // instead of "No profiles yet", which would be actively wrong
            // (implies an empty account) for a still-loading one. `loading`
            // alone isn't enough: it only tracks the small users/{uid} doc,
            // which resolves well before the separately-paginated profiles
            // listener's first snapshot does — profilesLoading covers that
            // gap (see UserContext's own doc comment on the field).
            <SkeletonMessageList />
          ) : (
            <View style={styles.empty}>
              <Tray size={48} color={theme.muted} weight="duotone" />
              <Text
                style={[
                  styles.emptyTitle,
                  {
                    color: theme.surface,
                    fontFamily: "MackinacPro_400Regular",
                  },
                ]}
              >
                No conversations yet
              </Text>
              <Text
                style={[
                  styles.emptyDesc,
                  { color: theme.muted, fontFamily: "Inter_400Regular" },
                ]}
              >
                New messages from your connected accounts will appear here
              </Text>
            </View>
          )
        }
        // Visual continuation past the bottom edge — without this, hitting
        // the current page's end (see onEndReached above) looked like the
        // list had genuinely finished, not that more was still loading.
        ListFooterComponent={
          sortedConversations.length > 0 && (hasMoreProfiles || hasMoreGroupThreads || hasMoreTasks)
            ? (
              <View style={styles.loadMoreFooter}>
                <ActivityIndicator size="small" color={theme.muted} />
              </View>
            )
            : null
        }
      />

    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    paddingHorizontal: 20,
  },
  headerInner: {
    position: "relative",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 44,
  },
  logoWordmark: {
    position: "absolute",
    left: "50%",
    marginLeft: -60,
    width: 120,
    height: 32,
  },
  // minHeight: 44 meets Apple HIG's minimum tap-target size — these header
  // buttons previously had only paddingVertical:6 around a ~20px icon,
  // well under that. hitSlop (on the Pressables themselves) extends the
  // touchable area further still without growing the visible layout.
  editBtn: { width: 60, minHeight: 44, justifyContent: "center", paddingVertical: 6 },
  editBtnText: { fontSize: 17 },
  deliverablesBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 44,
    paddingVertical: 6,
  },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 44,
    paddingVertical: 6,
  },
  headerBtnText: { fontSize: 16 },
  // No horizontal padding here anymore — applied per-row instead (see
  // cardWrapperInset below), so a non-highlighted/flat row can render
  // edge-to-edge instead of sitting in the same gutter as a real card.
  listContent: { paddingTop: 120, paddingBottom: 140 },
  loadMoreFooter: { paddingVertical: 20, alignItems: "center" },
  cardWrapper: {
    position: "relative",
  },
  cardWrapperInset: {
    paddingHorizontal: 16,
  },
  // A flat/non-highlighted row still gets a touch of breathing room from the
  // screen edges — fully edge-to-edge (0) read as too tight against the
  // hairline divider.
  cardWrapperFlatInset: {
    paddingHorizontal: 8,
  },
  checkbox: {
    position: "absolute",
    top: 12,
    zIndex: 5,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  cardContent: { flex: 1 },
  empty: { flex: 1, alignItems: "center", paddingTop: 80, gap: 12 },
  emptyTitle: { fontSize: 20 },
  emptyDesc: { fontSize: 14, textAlign: "center", paddingHorizontal: 40 },
});
