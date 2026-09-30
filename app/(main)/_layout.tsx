import { Tabs } from "expo-router";
import { View, Text, Pressable, StyleSheet, Platform, Alert } from "react-native";
import {
  ChatCircle,
  CheckFat,
  UserCircleGear,
  Trash,
  Lightning,
} from "phosphor-react-native";
import { useTheme } from "../../hooks/useTheme";
import { useColorScheme } from "../../hooks/useColorScheme";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { EditModeProvider, useEditMode } from "../../contexts/EditModeContext";
import { useUser } from "../../contexts/UserContext";

let GlassView: React.ComponentType<any> | null = null;

try {
  GlassView = require("expo-glass-effect").GlassView;
} catch {}

const TABS = [
  { name: "home", label: "Messages", Icon: ChatCircle },
  { name: "answer", label: "Decide", Icon: Lightning },
  { name: "tasks", label: "Tasks", Icon: CheckFat },
  { name: "settings", label: "Settings", Icon: UserCircleGear },
] as const;

function LiquidGlassTabBar({ state, navigation }: any) {
  const theme = useTheme();
  const scheme = useColorScheme();
  const insets = useSafeAreaInsets();
  const { editMode, selectedCount, onDelete } = useEditMode();
  // openHumanTaskCount is a dedicated unbounded Firestore query (see
  // UserContext), NOT derived from the paginated `tasks` array — the array
  // only holds the most-recent page, which would silently undercount this
  // badge once the user has more open tasks than one page holds.
  const { openHumanTaskCount, pendingHitlTasks } = useUser();
  const openTasksCount = openHumanTaskCount;
  // Same filter answer.tsx itself uses to build the Decide deck (a pending
  // HITL request with no answer yet) — this badge should always match
  // exactly how many cards are actually waiting there.
  const decideCount = pendingHitlTasks.filter(
    (t) => t.humanInputRequest && !t.humanInputRequest.answer,
  ).length;
  const bottom = (insets.bottom || 16) + 4;

  const confirmDelete = () => {
    if (!onDelete) return;
    Alert.alert(
      selectedCount === 1 ? "Delete Item?" : `Delete ${selectedCount} Items?`,
      "This action cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => onDelete() },
      ],
    );
  };

  // ── Edit mode: replace tab bar with a delete button ──────────────────
  if (editMode) {
    const hasSelection = selectedCount > 0;
    return (
      <View style={[styles.glassHost, { bottom }]} pointerEvents="box-none">
        <View
          style={[
            styles.capsuleWrapper,
            {
              borderColor: theme.cardBorder,
              borderWidth: StyleSheet.hairlineWidth,
            },
          ]}
          pointerEvents="box-none"
        >
          {GlassView && (
            <GlassView
              style={StyleSheet.absoluteFill}
              colorScheme={scheme}
              glassEffectStyle="regular"
            />
          )}
          <View
            style={[
              StyleSheet.absoluteFill,
              {
                backgroundColor:
                  scheme === "dark"
                    ? "rgba(10, 10, 12, 0.75)"
                    : "rgba(227, 223, 255, 0.3)",
              },
            ]}
            pointerEvents="none"
          />
          <Pressable
            onPress={() => hasSelection && confirmDelete()}
            style={styles.deleteRow}
          >
            <Trash
              size={20}
              color={hasSelection ? "#FF3B30" : theme.muted}
              weight="duotone"
            />
            <Text
              style={[
                styles.deleteLabel,
                {
                  color: hasSelection ? "#FF3B30" : theme.muted,
                  fontFamily: "Inter_600SemiBold",
                },
              ]}
            >
              {hasSelection
                ? `Delete ${selectedCount}`
                : "Select items to delete"}
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // ── Normal tab bar ────────────────────────────────────────────────────
  const canUseGlass = Platform.OS === "ios" && !!GlassView;

  if (canUseGlass && GlassView) {
    const GV = GlassView;
    return (
      <View style={[styles.glassHost, { bottom }]} pointerEvents="box-none">
        <View
          style={[
            styles.capsuleWrapper,
            {
              borderColor: theme.cardBorder,
              borderWidth: StyleSheet.hairlineWidth,
            },
          ]}
          pointerEvents="box-none"
        >
          <GV
            style={StyleSheet.absoluteFill}
            colorScheme={scheme}
            glassEffectStyle="regular"
          />
          <View
            style={[
              StyleSheet.absoluteFill,
              {
                backgroundColor:
                  scheme === "dark"
                    ? "rgba(10, 10, 12, 0.75)"
                    : "rgba(227, 223, 255, 0.3)",
              },
            ]}
            pointerEvents="none"
          />
          <View style={styles.tabsRow} pointerEvents="box-none">
            {state.routes.map((route: any, index: number) => {
              const tab = TABS.find((t) => t.name === route.name);
              if (!tab) return null;
              const active = state.index === index;
              const color = active ? theme.primary : theme.muted;

              return (
                <Pressable
                  key={route.key}
                  style={styles.tabBtn}
                  onPress={() => {
                    if (!active) navigation.navigate(route.name);
                  }}
                >
                  <View style={{ position: "relative" }}>
                    <View style={tab.name === "answer" ? styles.decideIconTilt : undefined}>
                      <tab.Icon
                        size={24}
                        color={color}
                        weight="duotone"
                      />
                    </View>
                    {tab.name === "tasks" && openTasksCount > 0 && (
                      <View
                        style={[styles.badge, { backgroundColor: theme.primary }]}
                      >
                        <Text style={styles.badgeText}>{openTasksCount}</Text>
                      </View>
                    )}
                    {tab.name === "answer" && decideCount > 0 && (
                      <View
                        style={[styles.badge, { backgroundColor: theme.primary }]}
                      >
                        <Text style={styles.badgeText}>{decideCount}</Text>
                      </View>
                    )}
                  </View>
                  {tab.label ? (
                    <Text
                      style={[
                        styles.tabLabel,
                        {
                          color,
                          fontFamily: active
                            ? "Inter_600SemiBold"
                            : "Inter_400Regular",
                        },
                      ]}
                    >
                      {tab.label}
                    </Text>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
    );
  }

  // Fallback plain RN tab bar
  return (
    <View
      style={[
        styles.tabBar,
        {
          backgroundColor: theme.background,
          borderTopColor: theme.separator,
          paddingBottom: insets.bottom || 16,
        },
      ]}
    >
      {state.routes.map((route: any, index: number) => {
        const tab = TABS.find((t) => t.name === route.name);
        if (!tab) return null;
        const active = state.index === index;
        const color = active ? theme.primary : theme.muted;
        return (
          <Pressable
            key={route.key}
            style={styles.fallbackTabBtn}
            onPress={() => {
              if (!active) navigation.navigate(route.name);
            }}
          >
            <View style={{ position: "relative" }}>
              <View style={tab.name === "answer" ? styles.decideIconTilt : undefined}>
                <tab.Icon
                  size={24}
                  color={color}
                  weight="duotone"
                />
              </View>
              {tab.name === "tasks" && openTasksCount > 0 && (
                <View style={[styles.badge, { backgroundColor: theme.primary }]}>
                  <Text style={styles.badgeText}>{openTasksCount}</Text>
                </View>
              )}
              {tab.name === "answer" && decideCount > 0 && (
                <View style={[styles.badge, { backgroundColor: theme.primary }]}>
                  <Text style={styles.badgeText}>{decideCount}</Text>
                </View>
              )}
            </View>
            {tab.label ? (
              <Text
                style={[
                  styles.tabLabel,
                  {
                    color,
                    fontFamily: active ? "Inter_600SemiBold" : "Inter_400Regular",
                  },
                ]}
              >
                {tab.label}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

function MainTabs() {
  return (
    <Tabs
      tabBar={(props) => <LiquidGlassTabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Screen name="home" />
      <Tabs.Screen name="answer" />
      <Tabs.Screen name="tasks" />
      <Tabs.Screen name="settings" />
    </Tabs>
  );
}

export default function MainLayout() {
  return (
    <EditModeProvider>
      <MainTabs />
    </EditModeProvider>
  );
}

const styles = StyleSheet.create({
  glassHost: {
    position: "absolute",
    left: 16,
    right: 16,
    alignItems: "center",
  },
  capsuleWrapper: {
    borderRadius: 100,
    overflow: "hidden",
    alignSelf: "center",
  },
  tabsRow: {
    flexDirection: "row",
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  tabBtn: {
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minWidth: 76,
  },
  tabLabel: { fontSize: 10 },
  // A plain vertical bolt reads as static — tilting it slightly clockwise
  // (as if caught mid-strike) gives the Decide tab's icon a sense of motion
  // the other tab icons don't need.
  decideIconTilt: { transform: [{ rotate: "15deg" }] },
  deleteRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 28,
    paddingVertical: 14,
    minWidth: 260,
  },
  deleteLabel: { fontSize: 16 },
  tabBar: {
    flexDirection: "row",
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 10,
  },
  fallbackTabBtn: { flex: 1, alignItems: "center", gap: 4 },
  badge: {
    position: "absolute",
    top: -4,
    right: -8,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  badgeText: {
    color: "#FFFFFF",
    fontSize: 9,
    fontFamily: "Inter_700Bold",
  },
});
