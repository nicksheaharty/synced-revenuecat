import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  TextInput,
  ActivityIndicator,
  LayoutAnimation,
  Alert,
  Platform,
} from "react-native";
import * as Sharing from "expo-sharing";
import { File, Directory, Paths } from "expo-file-system";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import {
  CaretLeft,
  FilePdf,
  FileText,
  FileCsv,
  File as FileIcon,
  MagnifyingGlass,
  ShareNetwork,
  ChatCircle,
  Envelope,
  SlackLogo,
  FolderSimple,
  MicrosoftExcelLogo,
  MicrosoftWordLogo,
  MicrosoftPowerpointLogo,
  X,
  Check,
  Trash,
} from "phosphor-react-native";
import { Host, ContextMenu, Button as NativeButton } from "@expo/ui/swift-ui";
import { useTheme } from "../hooks/useTheme";
import { useColorScheme } from "../hooks/useColorScheme";
import { useUser } from "../contexts/UserContext";
import { db } from "../services/firebase";
import { GmailIcon, SyncedIcon } from "../components/SimpleIcons";
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
} from "firebase/firestore";
import { Deliverable, Task, Profile, deleteDeliverables, getTasksByIds, getProfilesByIds } from "../services/storage";
import { formatLocalTimestamp } from "../components/MessageCard";
import { viewFile } from "../services/fileViewer";

const PAGE_SIZE = 30;

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
  other: { bg: "rgba(142, 142, 147, 0.1)", text: "#8E8E93", icon: FileIcon },
};

const SOURCE_ICONS = {
  gmail: GmailIcon,
  outlook: Envelope,
  slack: SlackLogo,
  imessage: ChatCircle,
  synced: SyncedIcon,
};

const TAB_ICONS = {
  all: FolderSimple,
  pdf: FilePdf,
  docx: MicrosoftWordLogo,
  xlsx: MicrosoftExcelLogo,
  pptx: MicrosoftPowerpointLogo,
};

export default function DeliverablesScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useUser();
  const [deliverables, setDeliverables] = useState<Deliverable[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<
    "all" | "pdf" | "docx" | "xlsx" | "pptx"
  >("all");
  const [isFocused, setIsFocused] = useState(false);
  const [sharingId, setSharingId] = useState<string | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  // Local to this screen — unlike the tab-group screens, this is a pushed
  // route with no shared tab bar to swap into a delete affordance, so edit
  // mode here just renders its own floating delete bar instead of relying
  // on EditModeContext (which is scoped to the (main) tab layout only).
  const [editMode, setEditMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const searchInputRef = useRef<TextInput>(null);
  const scheme = useColorScheme();

  useEffect(() => {
    if (!user || !db) {
      setLoading(false);
      return;
    }

    const q = query(
      collection(db, "deliverables"),
      where("userId", "==", user.uid),
      orderBy("createdAt", "desc"),
      limit(pageSize),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: Deliverable[] = [];
        snap.forEach((d) => {
          const data = d.data();
          list.push({
            id: d.id,
            userId: data.userId,
            taskId: data.taskId,
            profileId: data.profileId,
            name: data.name,
            type: data.type,
            mimeType: data.mimeType,
            url: data.url,
            createdAt: data.createdAt,
            updatedAt: data.updatedAt,
          });
        });
        setDeliverables(list);
        setHasMore(snap.size >= pageSize);
        setLoading(false);
        setLoadingMore(false);
      },
      (err) => {
        console.error("[Deliverables] Firestore listener error:", err);
        setLoading(false);
        setLoadingMore(false);
      },
    );

    return () => unsub();
  }, [user, pageSize]);

  const handleLoadMore = useCallback(() => {
    if (loadingMore || !hasMore || searchQuery.trim().length > 0) return;
    setLoadingMore(true);
    setPageSize((prev) => prev + PAGE_SIZE);
  }, [loadingMore, hasMore, searchQuery]);

  // Fetched on demand for exactly the tasks/profiles the CURRENTLY LOADED
  // page of deliverables actually references (getTasksByIds/
  // getProfilesByIds in services/storage.ts) — not from UserContext's own
  // `tasks`/`profiles`, which page independently by their own most-recent-
  // activity cursor. CONFIRMED real bug this fixes: this screen's own
  // deliverables listener pages by createdAt (oldest deliverables load
  // later, on scroll), completely independent of which 30 tasks/profiles
  // context happens to have loaded — a deliverable from an older task
  // showed up with no task title and no source icon once that task fell off
  // context's own page. Re-fetches (additively — see the merge below)
  // whenever the loaded deliverables set grows, so both lists always
  // advance in lockstep.
  const [fetchedTasksById, setFetchedTasksById] = useState<Map<string, Task>>(new Map());
  const [fetchedProfilesById, setFetchedProfilesById] = useState<Map<string, Profile>>(new Map());
  useEffect(() => {
    const neededTaskIds = Array.from(new Set(deliverables.map((d) => d.taskId).filter(Boolean)));
    const neededProfileIds = Array.from(new Set(deliverables.map((d) => d.profileId).filter((id): id is string => !!id)));
    const missingTaskIds = neededTaskIds.filter((id) => !fetchedTasksById.has(id));
    const missingProfileIds = neededProfileIds.filter((id) => !fetchedProfilesById.has(id));
    if (missingTaskIds.length === 0 && missingProfileIds.length === 0) return;
    let cancelled = false;
    (async () => {
      const [newTasks, newProfiles] = await Promise.all([
        getTasksByIds(missingTaskIds),
        getProfilesByIds(missingProfileIds),
      ]);
      if (cancelled) return;
      if (newTasks.length > 0) {
        setFetchedTasksById((prev) => {
          const next = new Map(prev);
          newTasks.forEach((t) => next.set(t.id, t));
          return next;
        });
      }
      if (newProfiles.length > 0) {
        setFetchedProfilesById((prev) => {
          const next = new Map(prev);
          newProfiles.forEach((p) => next.set(p.id, p));
          return next;
        });
      }
    })();
    return () => { cancelled = true; };
    // fetchedTasksById/fetchedProfilesById intentionally excluded — this
    // effect's own job is to grow those maps; including them would re-run
    // every time either changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deliverables]);
  const profileMap = fetchedProfilesById;
  const taskMap = fetchedTasksById;

  const uniqueDeliverables = useMemo(() => {
    const sorted = [...deliverables].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
    const seen = new Set<string>();
    return sorted.filter((d) => {
      const key = `${d.taskId}_${d.name}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [deliverables]);

  const filteredDeliverables = useMemo(() => {
    let list = [...uniqueDeliverables];

    // Tab filter
    if (activeTab !== "all") {
      list = list.filter((d) => d.type === activeTab);
    }

    // Search query filter
    if (searchQuery.trim().length > 0) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter((d) => {
        const nameMatch = d.name.toLowerCase().includes(q);
        const taskObj = taskMap.get(d.taskId);
        const taskMatch = taskObj?.title.toLowerCase().includes(q);
        const profileObj = d.profileId ? profileMap.get(d.profileId) : null;
        const profileMatch =
          profileObj?.name.toLowerCase().includes(q) ||
          profileObj?.platformIdentifier.toLowerCase().includes(q);
        return nameMatch || taskMatch || profileMatch;
      });
    }

    return list;
  }, [uniqueDeliverables, activeTab, searchQuery, profileMap, taskMap]);

  const handleOpenFile = async (item: Deliverable) => {
    if (editMode) {
      toggleSelect(item.id);
      return;
    }
    if (!item.url || viewingId) return;
    setViewingId(item.id);
    try {
      await viewFile(item.url, item.name);
    } catch (err) {
      console.error("[Deliverables] Failed to view file:", err);
      Alert.alert("Couldn't open file", "Something went wrong while opening this file.");
    } finally {
      setViewingId(null);
    }
  };

  const handleShareFile = async (item: Deliverable) => {
    if (!item.url || sharingId) return;
    setSharingId(item.id);
    try {
      const isAvailable = await Sharing.isAvailableAsync();
      if (!isAvailable) {
        Alert.alert("Sharing unavailable", "Sharing isn't supported on this device.");
        return;
      }
      const dir = new Directory(Paths.cache, `shared-deliverables/${item.id}-${Date.now()}`);
      if (dir.exists) dir.delete();
      dir.create({ intermediates: true });
      const downloaded = await File.downloadFileAsync(item.url, dir);
      const destination = new File(dir, item.name);
      if (downloaded.uri !== destination.uri) await downloaded.move(destination);
      await Sharing.shareAsync(downloaded.uri, { mimeType: item.mimeType, dialogTitle: item.name });
    } catch (err) {
      console.error("[Deliverables] Failed to share file:", err);
      Alert.alert("Couldn't share file", "Something went wrong while preparing this file for sharing.");
    } finally {
      setSharingId(null);
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

  const toggleEditMode = () => {
    const next = !editMode;
    setEditMode(next);
    setSelected(new Set());
  };

  const selectInEditMode = useCallback((id: string) => {
    setEditMode(true);
    setSelected((prev) => new Set(prev).add(id));
  }, []);

  const handleDelete = useCallback(async () => {
    if (selected.size === 0) return;
    const ids = Array.from(selected);
    await deleteDeliverables(ids);

    setSelected(new Set());
    setEditMode(false);
  }, [selected]);

  const confirmDeleteSelected = useCallback(() => {
    if (selected.size === 0) return;
    Alert.alert(
      selected.size === 1 ? "Delete Item?" : `Delete ${selected.size} Items?`,
      "This action cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => handleDelete() },
      ],
    );
  }, [selected.size, handleDelete]);

  const confirmDeleteSingle = useCallback((item: Deliverable) => {
    Alert.alert(
      "Delete File?",
      `"${item.name}" will be deleted. This action cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => deleteDeliverables([item.id]),
        },
      ],
    );
  }, []);

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: theme.background }]}
      edges={["top"]}
    >
      {/* Header — standard iOS nav bar: back chevron+label left, centered
          title, Edit right (all three fixed/flexed to equal-ish widths so
          the title stays visually centered regardless of "Edit" vs "Done"). */}
      <View style={[styles.header, { borderBottomColor: theme.separator }]}>
        <View style={styles.headerInner}>
          <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
            <CaretLeft size={20} color={theme.primary} weight="bold" />
            <Text style={[styles.backLabel, { color: theme.primary, fontFamily: "Inter_400Regular" }]}>
              Back
            </Text>
          </Pressable>

          <Text
            style={[
              styles.title,
              { color: theme.surface, fontFamily: "Inter_600SemiBold" },
            ]}
            numberOfLines={1}
          >
            Files Created
          </Text>

          <Pressable onPress={toggleEditMode} style={styles.editBtn}>
            <Text
              style={[
                styles.editBtnText,
                {
                  color: theme.primary,
                  fontFamily: editMode ? "Inter_600SemiBold" : "Inter_400Regular",
                },
              ]}
            >
              {editMode ? "Done" : "Edit"}
            </Text>
          </Pressable>
        </View>
      </View>

      {/* Search Bar */}
      <View style={styles.searchContainer}>
        <View style={styles.searchRow}>
          <View
            style={[
              styles.searchBar,
              { backgroundColor: (theme as any).searchBg || theme.card },
            ]}
          >
            <MagnifyingGlass
              size={18}
              color={theme.muted}
              style={styles.searchIcon}
            />
            <TextInput
              ref={searchInputRef}
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search files, senders, or tasks..."
              placeholderTextColor={theme.muted}
              onFocus={() => {
                LayoutAnimation.configureNext(
                  LayoutAnimation.Presets.easeInEaseOut,
                );
                setIsFocused(true);
              }}
              onBlur={() => {
                LayoutAnimation.configureNext(
                  LayoutAnimation.Presets.easeInEaseOut,
                );
                setIsFocused(false);
              }}
              style={[
                styles.searchInput,
                { color: theme.surface, fontFamily: "Inter_400Regular" },
              ]}
            />
            {searchQuery.length > 0 && (
              <Pressable
                onPress={() => setSearchQuery("")}
                style={[styles.clearButton, { backgroundColor: theme.muted }]}
              >
                <X size={10} color={theme.background} weight="bold" />
              </Pressable>
            )}
          </View>

          {(isFocused || searchQuery.length > 0) && (
            <Pressable
              onPress={() => {
                LayoutAnimation.configureNext(
                  LayoutAnimation.Presets.easeInEaseOut,
                );
                setSearchQuery("");
                searchInputRef.current?.blur();
              }}
              style={styles.cancelButton}
            >
              <Text
                style={[
                  styles.cancelText,
                  { color: theme.primary, fontFamily: "Inter_500Medium" },
                ]}
              >
                Cancel
              </Text>
            </Pressable>
          )}
        </View>
      </View>

      {/* Tabs Filter */}
      <View style={styles.tabsContainer}>
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={["all", "pdf", "docx", "xlsx", "pptx"]}
          keyExtractor={(item) => item}
          contentContainerStyle={styles.tabsList}
          renderItem={({ item }) => {
            const isActive = activeTab === item;
            const label = item.toUpperCase();
            const IconComponent = TAB_ICONS[item as keyof typeof TAB_ICONS] || FolderSimple;
            return (
              <Pressable
                onPress={() => setActiveTab(item as any)}
                style={[
                  styles.tabBtn,
                  {
                    backgroundColor: isActive ? theme.primary : theme.card,
                    borderColor: isActive ? theme.primary : theme.cardBorder,
                  },
                ]}
              >
                <IconComponent
                  size={14}
                  color={isActive ? "#FFFFFF" : theme.muted}
                  weight={isActive ? "fill" : "regular"}
                />
                <Text
                  style={[
                    styles.tabLabel,
                    {
                      color: isActive ? "#FFFFFF" : theme.muted,
                      fontFamily: isActive
                        ? "Inter_600SemiBold"
                        : "Inter_500Medium",
                    },
                  ]}
                >
                  {label === "ALL" ? "All Files" : label}
                </Text>
              </Pressable>
            );
          }}
        />
      </View>

      {/* List */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.primary} />
        </View>
      ) : (
        <FlatList
          data={filteredDeliverables}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[
            styles.list,
            editMode && selected.size > 0 ? { paddingBottom: 96 } : null,
          ]}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.4}
          renderItem={({ item }) => {
            const config =
              FILE_TYPE_COLORS[item.type] || FILE_TYPE_COLORS.other;
            const IconComponent = config.icon;

            const taskObj = taskMap.get(item.taskId);
            const profileObj = item.profileId
              ? profileMap.get(item.profileId)
              : null;
            const SourceIcon = profileObj
              ? SOURCE_ICONS[profileObj.source as keyof typeof SOURCE_ICONS] ||
                Envelope
              : null;
            const isSelected = selected.has(item.id);

            const cardContent = (
              <Pressable
                onPress={() => handleOpenFile(item)}
                disabled={viewingId === item.id}
                style={({ pressed }) => [
                  styles.card,
                  {
                    backgroundColor: theme.card,
                    borderColor: theme.cardBorder,
                    opacity: pressed || viewingId === item.id ? 0.75 : 1,
                    paddingRight: editMode ? 40 : 12,
                  },
                ]}
              >
                {/* File icon */}
                <View
                  style={[styles.iconWrapper, { backgroundColor: config.bg }]}
                >
                  {viewingId === item.id ? (
                    <ActivityIndicator size="small" color={config.text} />
                  ) : (
                    <IconComponent size={24} color={config.text} weight="duotone" />
                  )}
                </View>

                {/* File info */}
                <View style={styles.cardInfo}>
                  <Text
                    style={[
                      styles.fileName,
                      { color: theme.surface, fontFamily: "Inter_600SemiBold" },
                    ]}
                    numberOfLines={1}
                  >
                    {item.name}
                  </Text>

                  <View style={styles.metaRow}>
                    {profileObj && (
                      <View style={styles.senderRow}>
                        {SourceIcon && (
                          <SourceIcon
                            size={11}
                            color={theme.muted}
                            style={{ marginRight: 4 }}
                          />
                        )}
                        <Text
                          style={[
                            styles.senderText,
                            {
                              color: theme.muted,
                              fontFamily: "Inter_400Regular",
                            },
                          ]}
                        >
                          {profileObj.name || profileObj.platformIdentifier}
                        </Text>
                        <Text style={[styles.dotMuted, { color: theme.muted }]}>
                          •
                        </Text>
                      </View>
                    )}
                    <Text
                      style={[
                        styles.dateText,
                        { color: theme.muted, fontFamily: "Inter_400Regular" },
                      ]}
                    >
                      {formatLocalTimestamp(item.createdAt)}
                    </Text>
                  </View>

                  {taskObj && (
                    <View
                      style={[
                        styles.taskBadge,
                        { backgroundColor: theme.cardBorder },
                      ]}
                    >
                      <Text
                        style={[
                          styles.taskRefText,
                          { color: theme.muted, fontFamily: "Inter_500Medium" },
                        ]}
                        numberOfLines={1}
                      >
                        Task: {taskObj.title}
                      </Text>
                    </View>
                  )}
                </View>

                {/* Actions */}
                {!editMode && (
                  <View style={styles.actions}>
                    <Pressable
                      onPress={() => handleShareFile(item)}
                      disabled={sharingId === item.id}
                      style={[
                        styles.actionBtn,
                        { backgroundColor: theme.primary + "15" },
                      ]}
                    >
                      {sharingId === item.id ? (
                        <ActivityIndicator size="small" color={theme.primary} />
                      ) : (
                        <ShareNetwork size={16} color={theme.primary} weight="bold" />
                      )}
                    </Pressable>
                  </View>
                )}
              </Pressable>
            );

            const rowWithCheckbox = (
              <View style={styles.cardWrapper}>
                {cardContent}
                {editMode && (
                  <View
                    pointerEvents="none"
                    style={[
                      styles.selectCheckbox,
                      {
                        borderColor: isSelected ? theme.primary : theme.muted,
                        backgroundColor: isSelected ? theme.primary : "transparent",
                        borderWidth: isSelected ? 0 : 2,
                      },
                    ]}
                  >
                    {isSelected && <Check size={14} color="#FFFFFF" weight="bold" />}
                  </View>
                )}
              </View>
            );

            if (Platform.OS === "ios") {
              return (
                <Host colorScheme={scheme as "light" | "dark"} ignoreSafeArea="all">
                  <ContextMenu>
                    <ContextMenu.Trigger>{rowWithCheckbox}</ContextMenu.Trigger>
                    <ContextMenu.Items>
                      {!editMode ? (
                        <NativeButton
                          label="Select"
                          systemImage="checkmark.circle"
                          onPress={() => selectInEditMode(item.id)}
                        />
                      ) : null}
                      <NativeButton
                        role="destructive"
                        label="Delete"
                        systemImage="trash"
                        onPress={() => confirmDeleteSingle(item)}
                      />
                    </ContextMenu.Items>
                  </ContextMenu>
                </Host>
              );
            }

            return rowWithCheckbox;
          }}
          ListFooterComponent={
            loadingMore ? (
              <View style={styles.loadMoreFooter}>
                <ActivityIndicator size="small" color={theme.primary} />
              </View>
            ) : (
              <View style={styles.listFooterSpacer} />
            )
          }
          ListEmptyComponent={() => (
            <View style={styles.empty}>
              <FolderSimple size={48} color={theme.muted} weight="duotone" />
              <Text
                style={[
                  styles.emptyTitle,
                  {
                    color: theme.surface,
                    fontFamily: "MackinacPro_400Regular",
                  },
                ]}
              >
                No files found
              </Text>
              <Text
                style={[
                  styles.emptyDesc,
                  { color: theme.muted, fontFamily: "Inter_400Regular" },
                ]}
              >
                {searchQuery.trim().length > 0 || activeTab !== "all"
                  ? "Try modifying your search or type filters"
                  : "Documents generated by agent automation runs will appear here"}
              </Text>
            </View>
          )}
        />
      )}

      {/* Floating delete bar — this screen has no shared tab bar to swap
          into a delete affordance (it's a pushed route, not a tab), so edit
          mode surfaces its own bar here instead. */}
      {editMode && selected.size > 0 && (
        <View
          style={[
            styles.deleteBarWrap,
            { paddingBottom: Math.max(insets.bottom, 12) },
          ]}
          pointerEvents="box-none"
        >
          <Pressable
            onPress={confirmDeleteSelected}
            style={[styles.deleteBar, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}
          >
            <Trash size={18} color="#FF3B30" weight="duotone" />
            <Text style={[styles.deleteBarText, { color: "#FF3B30", fontFamily: "Inter_600SemiBold" }]}>
              Delete {selected.size}
            </Text>
          </Pressable>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  // backBtn and editBtn share the same minWidth so the flex:1 centered
  // title (below) sits at the true visual center of the row, regardless of
  // "Edit" vs the wider "Done" label.
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingVertical: 4,
    minWidth: 68,
  },
  backLabel: { fontSize: 17 },
  title: { flex: 1, fontSize: 17, textAlign: "center" },
  editBtn: {
    paddingVertical: 6,
    minWidth: 68,
    alignItems: "flex-end",
  },
  editBtnText: {
    fontSize: 16,
  },
  searchContainer: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 8,
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  searchBar: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    height: 36,
    borderRadius: 10,
  },
  searchIcon: { marginRight: 6 },
  searchInput: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 6,
    height: "100%",
  },
  clearButton: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 6,
    opacity: 0.8,
  },
  cancelButton: {
    marginLeft: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  cancelText: {
    fontSize: 15,
  },
  tabsContainer: {
    paddingTop: 8,
    paddingBottom: 12,
  },
  tabsList: {
    paddingHorizontal: 16,
    paddingRight: 24,
    gap: 8,
  },
  tabBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  tabLabel: {
    fontSize: 12,
  },
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  list: {
    padding: 12,
    gap: 8,
  },
  listFooterSpacer: {
    height: 40,
  },
  loadMoreFooter: {
    paddingVertical: 20,
    alignItems: "center",
  },
  cardWrapper: {
    position: "relative",
  },
  selectCheckbox: {
    position: "absolute",
    top: 16,
    right: 12,
    zIndex: 5,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  iconWrapper: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  cardInfo: {
    flex: 1,
    marginLeft: 12,
  },
  fileName: {
    fontSize: 14,
    lineHeight: 18,
    marginBottom: 2,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  senderRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  senderText: {
    fontSize: 11,
  },
  dotMuted: {
    marginHorizontal: 4,
    fontSize: 11,
  },
  dateText: {
    fontSize: 11,
  },
  taskBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    marginTop: 4,
  },
  taskRefText: {
    fontSize: 10,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    marginLeft: 8,
  },
  actionBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
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
  deleteBarWrap: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 0,
    alignItems: "center",
  },
  deleteBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 100,
    borderWidth: StyleSheet.hairlineWidth,
    minWidth: 200,
  },
  deleteBarText: { fontSize: 16 },
});
