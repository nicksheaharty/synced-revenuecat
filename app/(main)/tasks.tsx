import { useState, useEffect, useCallback, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  ActivityIndicator,
  Alert,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useIsFocused } from "expo-router";
import { Host, ContextMenu, Button as NativeButton } from "@expo/ui/swift-ui";
import { useColorScheme } from "../../hooks/useColorScheme";
import { useTheme } from "../../hooks/useTheme";
import {
  CheckSquare,
  Check,
  Checks,
  CaretDown,
  CaretUp,
  FilePdf,
  FileText,
  FileCsv,
  File,
  MicrosoftExcelLogo,
  MicrosoftWordLogo,
  MicrosoftPowerpointLogo,
  Plus,
} from "phosphor-react-native";
import {
  saveTask,
  deleteTasks,
  groupDeliverablesByTask,
  getDeliverablesForTaskIds,
  Profile,
  Task,
  Deliverable,
} from "../../services/storage";
import { useUser } from "../../contexts/UserContext";
import { useEditMode } from "../../contexts/EditModeContext";
import { viewFile } from "../../services/fileViewer";
import { CreateTaskSheet } from "../../components/CreateTaskSheet";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function formatDueDate(dueDate: string, precision?: string | null): string {
  const d = new Date(dueDate);
  if (isNaN(d.getTime())) return "";
  if (precision === "month") return MONTH_NAMES[d.getUTCMonth()];
  const dateStr = d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  if (precision === "datetime") {
    const timeStr = d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
    return `${dateStr}, ${timeStr}`;
  }
  return dateStr;
}

function isOverdue(dueDate: string, status: string): boolean {
  if (status === "completed") return false;
  return new Date(dueDate).getTime() < Date.now();
}

const UPCOMING_WINDOW_MS = 24 * 60 * 60 * 1000;

function isUpcoming(dueDate: string, status: string): boolean {
  if (status === "completed") return false;
  const diff = new Date(dueDate).getTime() - Date.now();
  return diff >= 0 && diff <= UPCOMING_WINDOW_MS;
}

// A muted amber rather than pure system yellow — #FFCC00 nearly disappears
// against a light background. These read as a clear "caution" tone in both
// color schemes without needing a hex tuned per-render.
const CAUTION_COLOR = { light: "#B45309", dark: "#F5A623" };

const FILE_TYPE_COLORS = {
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

export default function TasksScreen() {
  const theme = useTheme();
  const scheme = useColorScheme();
  // allHumanTasks (NOT the paginated `tasks`) — see UserContext's own doc
  // comment on that field for the real bug this fixes: filtering the
  // paginated `tasks` array down to assignee === "human" silently dropped
  // older human tasks once enough recent agent tasks filled the page.
  const { profiles, allHumanTasks, unseenHumanTasks } = useUser();
  const { editMode, setEditMode, setSelectedCount, setOnDelete } =
    useEditMode();
  const isFocused = useIsFocused();
  const [isCreateSheetOpen, setIsCreateSheetOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);

  // Fetched by exact task id (see getDeliverablesForTaskIds's own doc
  // comment) rather than filtered out of UserContext's `deliverables` —
  // that array is bounded to recent activity, but allHumanTasks (this
  // screen's whole point — see the comment above it) deliberately includes
  // OLD completed tasks too, so their deliverables need their own targeted
  // fetch instead of depending on the bounded array happening to contain
  // them.
  const [taskDeliverables, setTaskDeliverables] = useState<Deliverable[]>([]);
  const humanTaskIds = useMemo(() => allHumanTasks.map((t) => t.id), [allHumanTasks]);
  useEffect(() => {
    let cancelled = false;
    getDeliverablesForTaskIds(humanTaskIds).then((list) => {
      if (!cancelled) setTaskDeliverables(list);
    });
    return () => { cancelled = true; };
    // humanTaskIds is a derived array (new identity each render) — compare
    // by content via the join below so this only refetches when the actual
    // SET of task ids changes, not on every unrelated re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [humanTaskIds.join(",")]);
  const taskDeliverablesMap = useMemo(() => groupDeliverablesByTask(taskDeliverables), [taskDeliverables]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isCompletedExpanded, setIsCompletedExpanded] = useState(false);

  // Triage can resolve a human task by marking it "inactive" (e.g. the ask
  // became moot) rather than "completed" — see writeTriageTasks's
  // taskStatusUpdates/markInactive handling in functions/src/pipeline.ts.
  // Both are done, finished business (matching MessageCard.tsx's
  // isDone = isCompleted || isInactive), so this set — and every other
  // "is this done" check below — treats them the same.
  const [initiallyCompletedSet] = useState(() => {
    const completed = allHumanTasks.filter(
      (t) => t.status === "completed" || t.status === "inactive",
    );
    return new Set(completed.map((t) => t.id));
  });

  const parseDateSafe = (dateStr: string): number => {
    if (!dateStr) return 0;
    const date = new Date(dateStr);
    if (!isNaN(date.getTime())) return date.getTime();

    // Fallback for legacy time-only strings (e.g., "07:31 AM")
    const match = dateStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (match) {
      let hours = parseInt(match[1], 10);
      const minutes = parseInt(match[2], 10);
      const ampm = match[3].toUpperCase();
      if (ampm === "PM" && hours < 12) hours += 12;
      if (ampm === "AM" && hours === 12) hours = 0;
      const d = new Date();
      d.setUTCHours(hours, minutes, 0, 0);
      return d.getTime();
    }
    return 0;
  };

  const sortedTasks = [...allHumanTasks]
    .sort((a, b) => parseDateSafe(b.createdAt) - parseDateSafe(a.createdAt));

  const activeTasks = sortedTasks.filter(
    (t) =>
      (t.status !== "completed" && t.status !== "inactive") ||
      !initiallyCompletedSet.has(t.id),
  );
  const truncatedTasks = sortedTasks.filter(
    (t) =>
      (t.status === "completed" || t.status === "inactive") &&
      initiallyCompletedSet.has(t.id),
  );

  type FlatListItem =
    | { type: "task"; task: Task }
    | { type: "no_active_tasks" }
    | { type: "divider_completed_header"; count: number; isExpanded: boolean }
    | { type: "completed_task"; task: Task };

  const flatListItems: FlatListItem[] = [];
  activeTasks.forEach((task) => flatListItems.push({ type: "task", task }));

  if (truncatedTasks.length > 0) {
    flatListItems.push({
      type: "divider_completed_header",
      count: truncatedTasks.length,
      isExpanded: isCompletedExpanded,
    });
    if (isCompletedExpanded) {
      truncatedTasks.forEach((task) =>
        flatListItems.push({ type: "completed_task", task }),
      );
    }
  }

  // With 0 active tasks but some completed ones, flatListItems isn't truly
  // empty (the completed-tasks divider above still renders), so FlatList's
  // own ListEmptyComponent never fires — this inline placeholder fills that
  // gap instead of leaving blank space below the divider. Hidden once the
  // completed section is expanded — the now-visible completed tasks fill
  // that space instead, so a redundant "all caught up" card between the
  // divider and the completed list would just be clutter.
  if (activeTasks.length === 0 && truncatedTasks.length > 0 && !isCompletedExpanded) {
    flatListItems.push({ type: "no_active_tasks" });
  }

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
    await deleteTasks(ids);

    setSelected(new Set());
    setSelectedCount(0);
    setOnDelete(null);
    setEditMode(false);
  }, [selected, setEditMode, setSelectedCount, setOnDelete]);

  const confirmDeleteSingle = useCallback((task: Task) => {
    Alert.alert(
      "Delete Task?",
      `"${task.title}" will be deleted. This action cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => deleteTasks([task.id]),
        },
      ],
    );
  }, []);

  const selectTaskInEditMode = useCallback(
    (id: string) => {
      if (!editMode) setEditMode(true);
      setSelected((prev) => new Set(prev).add(id));
    },
    [editMode, setEditMode],
  );

  // Keep context in sync — only the focused screen may write into the
  // shared EditModeContext, since Home/Tasks/Deliverables stay mounted
  // simultaneously under the tab navigator and each keeps its own local
  // `selected` set; without this guard, every mounted screen's effect
  // fires on any `editMode` change and the last one to run clobbers the
  // real selection count with its own (empty) local count.
  useEffect(() => {
    if (editMode && isFocused) {
      setSelectedCount(selected.size);
      setOnDelete(() => handleDelete);
    }
  }, [editMode, isFocused, selected.size, handleDelete, setSelectedCount, setOnDelete]);

  // Clean up edit mode on unmount
  useEffect(() => {
    return () => {
      setEditMode(false);
      setSelectedCount(0);
      setOnDelete(null);
    };
  }, [setEditMode, setSelectedCount, setOnDelete]);

  // Mark all unseen human tasks as seen when this screen is active.
  // unseenHumanTasks is a dedicated unbounded Firestore query (see
  // UserContext), NOT derived from the paginated `tasks` array — otherwise
  // older unseen tasks outside the loaded page would never get marked seen.
  useEffect(() => {
    if (unseenHumanTasks.length > 0) {
      unseenHumanTasks.forEach((task) => {
        saveTask({ ...task, seen: true });
      });
    }
  }, [unseenHumanTasks]);

  const toggleTask = async (task: Task) => {
    // Triage marked this moot, not done by the user's own action — leave it
    // as "inactive" rather than resurrecting it to "pending" or relabeling
    // it "completed" from a checkbox tap.
    if (task.status === "inactive") return;
    const nextStatus = task.status === "completed" ? "pending" : "completed";
    const updated: Task = {
      ...task,
      status: nextStatus,
      implementationPlan: task.implementationPlan.map((s) => ({
        ...s,
        status: nextStatus,
      })),
      requiredDeliverables: task.requiredDeliverables.map((d) => ({
        ...d,
        status: nextStatus === "completed" ? "completed" : "pending",
      })),
      updatedAt: new Date().toISOString(),
    };
    try {
      await saveTask(updated);
    } catch (e: any) {
      Alert.alert("Couldn't update task", e?.message || "Please try again.");
    }
  };

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: theme.background }]}
      edges={["top"]}
    >
      <View style={[styles.header, { borderBottomColor: theme.separator }]}>
        <View style={styles.headerInner}>
          <Text
            style={[
              styles.title,
              {
                color: theme.surface,
                fontFamily: "MackinacPro_700Bold",
              },
            ]}
          >
            Your Tasks
          </Text>

          {editMode ? (
            <Pressable
              onPress={toggleEditMode}
              style={styles.editBtn}
              hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
            >
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
              onPress={() => setIsCreateSheetOpen(true)}
              style={styles.addBtn}
              hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
            >
              <Text style={[styles.addBtnText, { color: theme.primary, fontFamily: "Inter_500Medium" }]}>
                New Task
              </Text>
              <Plus size={26} color={theme.primary} weight="duotone" />
            </Pressable>
          )}
        </View>
      </View>

      <FlatList
        data={flatListItems}
        keyExtractor={(item) => {
          if (item.type === "divider_completed_header")
            return "completed_header";
          if (item.type === "no_active_tasks") return "no_active_tasks";
          return item.task.id;
        }}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => {
          if (item.type === "no_active_tasks") {
            return (
              <View style={styles.noActiveTasks}>
                <Checks size={40} color={theme.muted} weight="duotone" />
                <Text
                  style={[
                    styles.noActiveTasksTitle,
                    {
                      color: theme.surface,
                      fontFamily: "MackinacPro_400Regular",
  },
                  ]}
                >
                  All caught up
                </Text>
                <Text
                  style={[
                    styles.noActiveTasksDesc,
                    { color: theme.muted, fontFamily: "Inter_400Regular" },
                  ]}
                >
                  No open tasks right now
                </Text>
              </View>
            );
          }
          if (item.type === "divider_completed_header") {
            return (
              <Pressable
                onPress={() => setIsCompletedExpanded(!isCompletedExpanded)}
                style={[
                  styles.completedHeaderRow,
                  {
                    borderTopColor: theme.separator,
                    marginTop: 8,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.completedHeaderStyle,
                    { color: theme.primary, fontFamily: "Inter_600SemiBold" },
                  ]}
                >
                  {item.count} Task{item.count === 1 ? "" : "s"} Completed
                </Text>
                {item.isExpanded ? (
                  <CaretUp size={16} color={theme.primary} weight="bold" />
                ) : (
                  <CaretDown size={16} color={theme.primary} weight="bold" />
                )}
              </Pressable>
            );
          }

          const task = item.task;
          const profile = profiles.find((p) => p.id === task.profileId);
          // Triage can resolve a task by marking it "inactive" rather than
          // "completed" (see initiallyCompletedSet's comment above) — treat
          // both as done here too, so the checkbox/strikethrough render
          // correctly instead of still showing as open/completeable.
          const isCompleted =
            task.status === "completed" || task.status === "inactive";
          const isSelected = selected.has(task.id);
          const taskFiles = taskDeliverablesMap.get(task.id) || [];
          const cardContent = (
            <Pressable
              onPress={editMode ? () => toggleSelect(task.id) : undefined}
              disabled={!editMode}
              style={styles.cardWrapper}
            >
              <View
                style={[
                  styles.taskCard,
                  {
                    backgroundColor: theme.card,
                    borderColor: theme.cardBorder,
                    paddingRight: editMode ? 48 : 16,
                    opacity: item.type === "completed_task" ? 0.6 : 1.0,
                  },
                ]}
              >
                <Pressable
                  style={styles.checkButton}
                  onPress={() =>
                    !editMode ? toggleTask(task) : toggleSelect(task.id)
                  }
                >
                  <View
                    style={[
                      styles.checkbox,
                      {
                        borderColor: isCompleted ? theme.primary : theme.muted,
                        backgroundColor: isCompleted
                          ? theme.primary
                          : "transparent",
                      },
                    ]}
                  >
                    {isCompleted && (
                      <Check size={12} color="#FFF" weight="bold" />
                    )}
                  </View>
                </Pressable>
                <View style={styles.taskInfo}>
                  <Text
                    style={[
                      styles.taskTitle,
                      {
                        color: isCompleted ? theme.muted : theme.surface,
                        textDecorationLine: isCompleted
                          ? "line-through"
                          : "none",
                        fontFamily: "Inter_600SemiBold",
                      },
                    ]}
                  >
                    {task.title}
                  </Text>
                  {(task.dueDate || profile) && (
                    <View style={styles.subtitleRow}>
                      {task.dueDate && (
                        <Text
                          style={[
                            styles.taskSender,
                            {
                              color: isOverdue(task.dueDate, task.status)
                                ? "#FF3B30"
                                : isUpcoming(task.dueDate, task.status)
                                  ? CAUTION_COLOR[scheme === "dark" ? "dark" : "light"]
                                  : theme.muted,
                              fontFamily: "Inter_500Medium",
                            },
                          ]}
                          numberOfLines={1}
                        >
                          {isOverdue(task.dueDate, task.status)
                            ? `Overdue • ${formatDueDate(task.dueDate, task.dueDatePrecision)}`
                            : `Due ${formatDueDate(task.dueDate, task.dueDatePrecision)}`}
                        </Text>
                      )}
                      {task.dueDate && profile && (
                        <Text
                          style={[
                            styles.taskSender,
                            { color: theme.muted, fontFamily: "Inter_400Regular" },
                          ]}
                        >
                          •
                        </Text>
                      )}
                      {profile && (
                        <Text
                          style={[
                            styles.taskSender,
                            styles.taskSenderFrom,
                            { color: theme.primary, fontFamily: "Inter_500Medium" },
                          ]}
                          numberOfLines={1}
                        >
                          From {profile.name}
                        </Text>
                      )}
                    </View>
                  )}

                  {taskFiles.length > 0 && (
                    <View style={styles.badgeRow}>
                      {taskFiles.map((file) => {
                        const fileConfig =
                          FILE_TYPE_COLORS[file.type] || FILE_TYPE_COLORS.other;
                        const FileIcon = fileConfig.icon;
                        return (
                          <Pressable
                            key={file.id}
                            onPress={() => {
                              if (!editMode) {
                                viewFile(file.url, file.name).catch((err) =>
                                  console.error("[Tasks] Failed to view file:", err)
                                );
                              } else {
                                toggleSelect(task.id);
                              }
                            }}
                            style={[
                              styles.fileBadge,
                              { backgroundColor: theme.searchBg },
                            ]}
                          >
                            <FileIcon
                              size={12}
                              color={fileConfig.text}
                              style={{ marginRight: 4 }}
                            />
                            <Text
                              style={[
                                styles.badgeText,
                                {
                                  color: theme.muted,
                                  fontFamily: "Inter_500Medium",
                                },
                              ]}
                              numberOfLines={1}
                            >
                              {file.name}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  )}
                </View>
              </View>
              {editMode && (
                <View
                  style={[
                    styles.selectCheckbox,
                    {
                      borderColor: isSelected ? theme.primary : theme.muted,
                      backgroundColor: isSelected
                        ? theme.primary
                        : "transparent",
                      borderWidth: isSelected ? 0 : 2,
                    },
                  ]}
                >
                  {isSelected && (
                    <Check size={14} color="#FFFFFF" weight="bold" />
                  )}
                </View>
              )}
            </Pressable>
          );

          if (Platform.OS === "ios") {
            return (
              <Host colorScheme={scheme as "light" | "dark"} ignoreSafeArea="all">
                <ContextMenu>
                  <ContextMenu.Trigger>{cardContent}</ContextMenu.Trigger>
                  <ContextMenu.Items>
                    {!editMode ? (
                      <NativeButton
                        label="Select"
                        systemImage="checkmark.circle"
                        onPress={() => selectTaskInEditMode(task.id)}
                      />
                    ) : null}
                    {!editMode && !isCompleted ? (
                      <NativeButton
                        label="Edit"
                        systemImage="pencil"
                        onPress={() => setEditingTask(task)}
                      />
                    ) : null}
                    <NativeButton
                      role="destructive"
                      label="Delete"
                      systemImage="trash"
                      onPress={() => confirmDeleteSingle(task)}
                    />
                  </ContextMenu.Items>
                </ContextMenu>
              </Host>
            );
          }

          return cardContent;
        }}
        ListEmptyComponent={() => (
          <View style={styles.empty}>
            <CheckSquare size={48} color={theme.muted} weight="duotone" />
            <Text
              style={[
                styles.emptyTitle,
                {
                  color: theme.surface,
                  fontFamily: "MackinacPro_400Regular",
                },
              ]}
            >
              No tasks yet
            </Text>
            <Text
              style={[
                styles.emptyDesc,
                { color: theme.muted, fontFamily: "Inter_400Regular" },
              ]}
            >
              Incoming messages will generate human tasks for you
            </Text>
          </View>
        )}
      />

      <CreateTaskSheet
        isPresented={isCreateSheetOpen || !!editingTask}
        onClose={() => {
          setIsCreateSheetOpen(false);
          setEditingTask(null);
        }}
        task={editingTask}
        profile={
          editingTask
            ? profiles.find((p) => p.id === editingTask.profileId) ?? null
            : null
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: { fontSize: 22, letterSpacing: -0.3 },
  // minHeight: 44 meets Apple HIG's minimum tap-target size — see the
  // identical fix (and comment) on home.tsx's header buttons.
  editBtn: {
    minHeight: 44,
    justifyContent: "center",
    paddingVertical: 6,
    paddingHorizontal: 4,
    marginLeft: 10,
  },
  editBtnText: {
    fontSize: 17,
  },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 44,
    paddingVertical: 6,
    marginLeft: 10,
  },
  addBtnText: { fontSize: 16 },
  list: { padding: 16, gap: 10 },
  cardWrapper: {
    position: "relative",
  },
  taskCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  checkButton: {
    padding: 4,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  selectCheckbox: {
    position: "absolute",
    top: 16,
    right: 16,
    zIndex: 5,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  taskInfo: {
    flex: 1,
  },
  taskTitle: {
    fontSize: 14,
    lineHeight: 18,
    marginBottom: 4,
  },
  taskSender: {
    fontSize: 11,
  },
  subtitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  taskSenderFrom: {
    flexShrink: 1,
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
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingTop: 120,
  },
  emptyTitle: { fontSize: 20 },
  emptyDesc: { fontSize: 14, textAlign: "center", paddingHorizontal: 40 },
  // Inline placeholder shown above the completed-tasks divider when there
  // are 0 active tasks but some completed ones — see flatListItems'
  // "no_active_tasks" comment for why ListEmptyComponent alone can't cover
  // this case.
  noActiveTasks: {
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 48,
  },
  noActiveTasksTitle: { fontSize: 18 },
  noActiveTasksDesc: { fontSize: 13, textAlign: "center", paddingHorizontal: 40 },
  completedHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  completedHeaderStyle: {
    fontSize: 14,
  },
});
