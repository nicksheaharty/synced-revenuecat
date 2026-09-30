import { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Alert,
  Platform,
  Switch,
  Linking,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "../../hooks/useTheme";
import { useColorScheme } from "../../hooks/useColorScheme";
import { useThemePreference } from "../../hooks/useThemePreference";
import {
  Sun,
  Moon,
  DeviceMobile,
  ArrowLeft,
  SignOut,
  Calendar,
  CaretRight,
  CaretUp,
  Palette,
  PenNib,
  ChatText,
  FlaskIcon,
  InstagramLogo,
  Headset,
  BellSimple,
  Microphone,
  Info,
} from "phosphor-react-native";
import { useRouter, useIsFocused } from "expo-router";
import {
  getConnectors,
  Connector,
  clearOnboarding,
  saveConnectors,
  setSandboxMode,
} from "../../services/storage";
import { signOutUser } from "../../services/firebase";
import type { ThemePreference } from "../../services/prefs";
import { initiateGmailConnection, initiateOutlookConnection, initiateGoogleDriveConnection, initiateOneDriveConnection, initiateSlackConnection, initiateTeamsConnection } from "../../services/oauth";
import { useUser } from "../../contexts/UserContext";
import { ConnectPermissionsSheet } from "../../components/ConnectPermissionsSheet";
import { CONNECTOR_META, COMING_SOON_IDS } from "../../constants/connectorMeta";
import { GmailIcon } from "../../components/SimpleIcons";
import { getNotificationPermissionStatus, unregisterPushNotificationsAsync } from "../../services/notifications";
import { ExpoSpeechRecognitionModule } from "expo-speech-recognition";
import * as Application from "expo-application";

const APPEARANCE_OPTIONS: {
  value: ThemePreference;
  label: string;
  Icon: React.ComponentType<any>;
}[] = [
    { value: "light", label: "Light", Icon: Sun },
    { value: "dark", label: "Dark", Icon: Moon },
    { value: "system", label: "System", Icon: DeviceMobile },
  ];

const SUPPORT_EMAIL = "meet.synced.it@gmail.com";
const INSTAGRAM_URL = "https://instagram.com/synced.it";

function formatCensoredPhoneNumber(phone: string): string {
  if (!phone) return "";
  const cleaned = phone.replace(/\D/g, "");
  if (cleaned.length === 11 && cleaned.startsWith("1")) {
    return `+1 (***) ***-${cleaned.slice(7)}`;
  } else if (cleaned.length === 10) {
    return `(***) ***-${cleaned.slice(6)}`;
  }
  if (phone.length > 7) {
    const visibleStart = phone.slice(0, 3);
    const visibleEnd = phone.slice(-4);
    const middleCensored = "*".repeat(phone.length - 7);
    return `${visibleStart}${middleCensored}${visibleEnd}`;
  }
  return "***-***-" + phone.slice(-4);
}

export default function SettingsScreen() {
  const theme = useTheme();
  const scheme = useColorScheme();
  const { preference, setPreference } = useThemePreference();
  const router = useRouter();
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const { user, userDoc, plan, weeklyActionPlanCount, weeklyActionPlanLimit } = useUser();
  const [messengersExpanded, setMessengersExpanded] = useState(false);
  const [connectorsExpanded, setConnectorsExpanded] = useState(false);
  // The connector id currently showing the pre-connect permissions sheet
  // (see ConnectPermissionsSheet) — null when no sheet is open. The real
  // handleXConnect() only runs after the user taps "Connect" inside the
  // sheet, never directly from tapping the connector row.
  const [pendingConnectorId, setPendingConnectorId] = useState<string | null>(null);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [microphoneEnabled, setMicrophoneEnabled] = useState(false);
  const isFocused = useIsFocused();

  useEffect(() => {
    getConnectors().then(setConnectors);
  }, [userDoc]);

  // Re-checked every time this screen regains focus — covers the real flow
  // of "tap this row, get sent to the OS Settings app, toggle notifications,
  // come back" (permission can only be flipped from OFF back to ON there;
  // iOS gives no in-app re-prompt API once denied — see
  // getNotificationPermissionStatus's own doc comment).
  useEffect(() => {
    if (!isFocused) return;
    getNotificationPermissionStatus().then(setNotificationsEnabled);
  }, [isFocused]);

  // Same read-only, no-prompt pattern as notifications above — reflects
  // whether Lightning-mode dictation (AddAgentTaskSheet's expo-speech-
  // recognition flow) actually has microphone access, re-checked on focus
  // so flipping it in OS Settings and coming back updates this immediately.
  useEffect(() => {
    if (!isFocused) return;
    ExpoSpeechRecognitionModule.getMicrophonePermissionsAsync()
      .then((res) => setMicrophoneEnabled(res.status === "granted"))
      .catch(() => setMicrophoneEnabled(false));
  }, [isFocused]);

  // Chat With Us is disabled (see the row below) but still reachable for
  // testing via a hidden triple-tap — three taps within 600ms navigates in,
  // anything slower resets the count so an accidental double-tap doesn't
  // accumulate across unrelated later taps.
  const chatWithUsTapCountRef = useRef(0);
  const chatWithUsTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleChatWithUsTap = () => {
    chatWithUsTapCountRef.current += 1;
    if (chatWithUsTapTimerRef.current) clearTimeout(chatWithUsTapTimerRef.current);
    if (chatWithUsTapCountRef.current >= 3) {
      chatWithUsTapCountRef.current = 0;
      router.push("/chat-with-us");
      return;
    }
    chatWithUsTapTimerRef.current = setTimeout(() => {
      chatWithUsTapCountRef.current = 0;
    }, 600);
  };

  const refreshConnectors = () => {
    getConnectors().then(setConnectors);
  };

  // Each returns whether the connection actually succeeded, so runConnect
  // (below) can navigate into the new connector-settings page right after —
  // without this, a successful first-time connect just leaves the user
  // staring at the same Settings list with no obvious next step.
  const handleGmailConnect = async (): Promise<boolean> => {
    try {
      const res = await initiateGmailConnection();
      if (res.success && res.email) {
        // Sync local storage with dynamically checked scopes from Firestore
        const updated = await getConnectors();
        await saveConnectors(updated);
        refreshConnectors();
        return true;
      } else if (res.error) {
        Alert.alert("Connection Failed", res.error);
      }
    } catch (e: any) {
      Alert.alert("Error", e.message || "Failed to connect Google.");
    }
    return false;
  };

  const handleOutlookConnect = async (): Promise<boolean> => {
    try {
      const res = await initiateOutlookConnection();
      if (res.success && res.email) {
        const updated = await getConnectors();
        await saveConnectors(updated);
        refreshConnectors();
        return true;
      } else if (res.error) {
        Alert.alert("Connection Failed", res.error);
      }
    } catch (e: any) {
      Alert.alert("Error", e.message || "Failed to connect Outlook.");
    }
    return false;
  };

  const handleSlackConnect = async (): Promise<boolean> => {
    try {
      const res = await initiateSlackConnection();
      if (res.success) {
        const updated = await getConnectors();
        await saveConnectors(updated);
        refreshConnectors();
        return true;
      } else if (res.error) {
        Alert.alert("Connection Failed", res.error);
      }
    } catch (e: any) {
      Alert.alert("Error", e.message || "Failed to connect Slack.");
    }
    return false;
  };

  const handleTeamsConnect = async (): Promise<boolean> => {
    try {
      const res = await initiateTeamsConnection();
      if (res.success) {
        const updated = await getConnectors();
        await saveConnectors(updated);
        refreshConnectors();
        return true;
      } else if (res.error) {
        Alert.alert("Connection Failed", res.error);
      }
    } catch (e: any) {
      Alert.alert("Error", e.message || "Failed to connect Teams.");
    }
    return false;
  };

  const handleGoogleDriveConnect = async (): Promise<boolean> => {
    try {
      const res = await initiateGoogleDriveConnection();
      if (res.success) {
        const updated = await getConnectors();
        await saveConnectors(updated);
        refreshConnectors();
        return true;
      } else if (res.error) {
        Alert.alert("Connection Failed", res.error);
      }
    } catch (e: any) {
      Alert.alert("Error", e.message || "Failed to connect Drive.");
    }
    return false;
  };

  const handleOneDriveConnect = async (): Promise<boolean> => {
    try {
      const res = await initiateOneDriveConnection();
      if (res.success) {
        const updated = await getConnectors();
        await saveConnectors(updated);
        refreshConnectors();
        return true;
      } else if (res.error) {
        Alert.alert("Connection Failed", res.error);
      }
    } catch (e: any) {
      Alert.alert("Error", e.message || "Failed to connect OneDrive.");
    }
    return false;
  };

  // Runs the REAL connect flow for a given connector id — only ever called
  // from ConnectPermissionsSheet's "Connect" button now, never directly
  // from tapping a connector row (see handlePressConnector below). On
  // success, navigates straight into that connector's new settings page
  // (email filter, disconnect) rather than leaving the user on the same
  // list. "calendar" settles into gmail's page, same as handlePressConnector.
  const runConnect = async (connectorId: string) => {
    let succeeded = false;
    if (connectorId === "gmail" || connectorId === "calendar") {
      succeeded = await handleGmailConnect();
    } else if (connectorId === "drive") {
      succeeded = await handleGoogleDriveConnect();
    } else if (connectorId === "outlook") {
      succeeded = await handleOutlookConnect();
    } else if (connectorId === "onedrive") {
      succeeded = await handleOneDriveConnect();
    } else if (connectorId === "slack") {
      succeeded = await handleSlackConnect();
    } else if (connectorId === "teams") {
      succeeded = await handleTeamsConnect();
    }
    if (succeeded) {
      const settingsId = connectorId === "calendar" ? "gmail" : connectorId;
      router.push(`/connector-settings/${settingsId}`);
    }
  };

  // Connectors exclusive to Pro (per the pricing page: Free gets Gmail,
  // Drive, OneDrive, Calendar; Pro adds Notion, GitHub, Slack, Teams).
  // Notion/GitHub aren't wired to a real connect flow yet (see
  // COMING_SOON_IDS in constants/connectorMeta.ts) so gating them here is a
  // no-op until they ship — listed anyway so the gate applies automatically
  // the day they do, with no second place to remember to update.
  const PRO_ONLY_CONNECTOR_IDS = new Set(["notion", "github", "slack", "teams"]);

  // Connected → push the per-connector settings sub-page (filter
  // preferences, disconnect). Not connected → open the pre-connect
  // permissions sheet, same as before, UNLESS this connector is Pro-only
  // and the user is on Free — routes to the paywall instead. "calendar" is
  // a derived/display-only row backed by the SAME integration doc as gmail
  // (see getConnectors()), so it opens gmail's settings page rather than
  // having its own.
  const handlePressConnector = (connector: Connector) => {
    if (connector.connected) {
      const settingsId = connector.id === "calendar" ? "gmail" : connector.id;
      router.push(`/connector-settings/${settingsId}`);
    } else if (plan === "free" && PRO_ONLY_CONNECTOR_IDS.has(connector.id)) {
      router.push("/paywall");
    } else {
      setPendingConnectorId(connector.id);
    }
  };

  const handleLogOut = () => {
    Alert.alert("Log Out", "Are you sure you want to log out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Log Out",
        style: "destructive",
        onPress: async () => {
          try {
            if (user?.uid) {
              await unregisterPushNotificationsAsync(user.uid);
            }
            await signOutUser();
            await clearOnboarding();
            router.replace("/(onboarding)/welcome");
          } catch (error: any) {
            console.error("[Settings] Log out error:", error);
            Alert.alert(
              "Log Out Failed",
              error.message || "Failed to log out. Please try again.",
            );
          }
        },
      },
    ]);
  };

  const inputs = connectors.filter(
    (c) => CONNECTOR_META[c.id]?.type === "input",
  );
  // "calendar" has no connect/disconnect action or settings page of its own
  // — it's a derived, display-only stub backed by the same integration doc
  // as gmail (see getConnectors()). The agent's calendar tools always follow
  // the SAME provider/account resolution as email now (no separate "primary
  // calendar" choice to make), so it's excluded from the normal
  // connect/disconnect list — rendered instead as a plain, non-interactive
  // row (see calendarLinkedAccountCount below) that just states how many
  // Gmail+Outlook accounts are linked, since either backs the calendar.
  const outputs = connectors.filter(
    (c) => CONNECTOR_META[c.id]?.type === "output" && c.id !== "calendar",
  );
  const calendarLinkedAccountCount =
    (connectors.find((c) => c.id === "gmail")?.accountCount ?? 0) +
    (connectors.find((c) => c.id === "outlook")?.accountCount ?? 0);

  // The first 2 connectors in each section (by list order, regardless of
  // connected/not-connected/coming-soon status) always render as normal
  // ungrouped rows. Everything after that collapses into a single "N
  // Other..." row (with a stacked icon preview) if none of the remaining
  // ones are connected — a connected connector further down the list still
  // needs its own row, so it's excluded from the group and shown ungrouped
  // too; only actually-inactive ones (not connected / coming soon) collapse.
  const ALWAYS_SHOWN_COUNT = 2;
  const inputsHead = inputs.slice(0, ALWAYS_SHOWN_COUNT);
  const inputsTail = inputs.slice(ALWAYS_SHOWN_COUNT);
  const inputsLive = [...inputsHead, ...inputsTail.filter((c) => c.connected)];
  const inputsOther = inputsTail.filter((c) => !c.connected);
  const outputsHead = outputs.slice(0, ALWAYS_SHOWN_COUNT);
  const outputsTail = outputs.slice(ALWAYS_SHOWN_COUNT);
  const outputsLive = [...outputsHead, ...outputsTail.filter((c) => c.connected)];
  const outputsOther = outputsTail.filter((c) => !c.connected);

  const sandboxModeEnabled = userDoc?.sandboxMode ?? false;
  const handleToggleSandboxMode = async (value: boolean) => {
    if (!user) return;
    await setSandboxMode(user.uid, value);
  };
  const handleSandboxModeSwitch = (value: boolean) => {
    if (value) {
      Alert.alert(
        "Turn On Sandbox Mode?",
        "The agent will run normally, but nothing will actually be sent — no real emails, calendar events, Slack, or Teams messages.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Turn On", onPress: () => handleToggleSandboxMode(true) },
        ],
      );
    } else {
      Alert.alert(
        "Turn Off Sandbox Mode?",
        "The agent will resume actually sending real emails, calendar events, Slack, and Teams messages.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Turn Off", style: "destructive", onPress: () => handleToggleSandboxMode(false) },
        ],
      );
    }
  };

  const ConnectorRow = ({
    connector,
    isLast,
  }: {
    connector: Connector;
    isLast: boolean;
  }) => {
    const meta = CONNECTOR_META[connector.id];
    if (!meta) return null;
    const { label, Icon } = meta;
    const color = typeof meta.color === "function" ? meta.color(scheme) : meta.color;
    const isInteractive =
      connector.id === "gmail" ||
      connector.id === "drive" ||
      connector.id === "calendar" ||
      connector.id === "outlook" ||
      connector.id === "onedrive" ||
      connector.id === "slack" ||
      connector.id === "teams"
    const isComingSoon = COMING_SOON_IDS.has(connector.id);

    const Content = (
      <View
        style={[
          styles.row,
          !isLast && {
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: theme.separator,
          },
          isComingSoon && { opacity: 0.7 },
        ]}
      >
        <View style={styles.rowLeft}>
          <View
            style={[styles.connectorIcon, { backgroundColor: color + "20" }]}
          >
            <View style={styles.iconBox}>
              <Icon size={18} color={color} weight="duotone" />
            </View>
          </View>
          <View>
            <Text
              style={[
                styles.rowLabel,
                { color: theme.surface, fontFamily: "Inter_400Regular" },
              ]}
            >
              {label}
            </Text>
            {connector.accountCount > 1 ? (
              <Text
                style={{
                  color: theme.muted,
                  fontSize: 11,
                  marginTop: 2,
                  fontFamily: "Inter_400Regular",
                }}
              >
                {connector.accountCount} accounts connected
              </Text>
            ) : connector.email ? (
              <Text
                style={{
                  color: theme.muted,
                  fontSize: 11,
                  marginTop: 2,
                  fontFamily: "Inter_400Regular",
                }}
              >
                {connector.email}
              </Text>
            ) : null}
          </View>
        </View>
        {isComingSoon ? (
          <View style={styles.statusRow}>
            <Text
              style={[
                styles.statusText,
                { color: theme.muted, fontFamily: "Inter_400Regular" },
              ]}
            >
              Coming Soon
            </Text>
          </View>
        ) : connector.connected ? (
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, { backgroundColor: theme.primary }]} />
            <Text
              style={[
                styles.statusText,
                { color: theme.primary, fontFamily: "Inter_500Medium" },
              ]}
            >
              Connected
            </Text>
            <CaretRight size={14} color={theme.muted} weight="bold" />
          </View>
        ) : (
          <View style={styles.statusRow}>
            <Text
              style={[
                styles.statusText,
                { color: theme.muted, fontFamily: "Inter_400Regular" },
              ]}
            >
              Connect
            </Text>
            <CaretRight size={14} color={theme.muted} weight="bold" />
          </View>
        )}
      </View>
    );

    if (isInteractive) {
      return (
        <Pressable
          onPress={() => handlePressConnector(connector)}
          style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
        >
          {Content}
        </Pressable>
      );
    }

    return Content;
  };

  // Bundles every not-yet-connected connector in a section (whether
  // "coming soon" or just not connected) into one summary "N More" row
  // (top 3 icons stacked), expanding in place to show each one individually
  // (as a normal ConnectorRow) on tap.
  const OtherConnectorsGroupRow = ({
    connectors: group,
    expanded,
    onToggle,
    isLast,
  }: {
    connectors: Connector[];
    expanded: boolean;
    onToggle: () => void;
    isLast: boolean;
  }) => {
    if (group.length === 0) return null;

    if (expanded) {
      return (
        <>
          {group.map((c) => (
            <ConnectorRow key={c.id} connector={c} isLast={false} />
          ))}
          <Pressable
            onPress={onToggle}
            style={({ pressed }) => [
              styles.row,
              !isLast && {
                borderBottomWidth: StyleSheet.hairlineWidth,
                borderBottomColor: theme.separator,
              },
              { opacity: pressed ? 0.5 : 1 },
            ]}
          >
            <Text
              style={[
                styles.rowLabel,
                { color: theme.muted, fontFamily: "Inter_400Regular" },
              ]}
            >
              Show less
            </Text>
            <CaretUp size={14} color={theme.muted} weight="bold" />
          </Pressable>
        </>
      );
    }

    const stackIcons = group.slice(0, 3);

    return (
      <Pressable
        onPress={onToggle}
        style={({ pressed }) => [
          styles.row,
          !isLast && {
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: theme.separator,
          },
          { opacity: pressed ? 0.5 : 1 },
        ]}
      >
        <View style={styles.rowLeft}>
          <View style={[styles.iconStack, { width: 32 + (stackIcons.length - 1) * 14 }]}>
            {stackIcons.map(({ id }, i) => {
              const meta = CONNECTOR_META[id];
              const color = typeof meta.color === "function" ? meta.color(scheme) : meta.color;
              return (
                // Backing view is opaque and matches the card background —
                // sits behind each translucent colored circle so overlapping
                // icons cut a clean edge into the one behind instead of the
                // two translucent colors blending together.
                <View
                  key={id}
                  style={[
                    styles.stackedIconBacking,
                    {
                      left: i * 14,
                      zIndex: stackIcons.length - i,
                      backgroundColor: theme.card,
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.connectorIcon,
                      { backgroundColor: color + "20" },
                    ]}
                  >
                    <View style={styles.iconBox}>
                      <meta.Icon size={16} color={color} weight="duotone" />
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
          <Text
            style={[
              styles.rowLabel,
              { color: theme.surface, fontFamily: "Inter_400Regular" },
            ]}
          >
            {group.length} More
          </Text>
        </View>
        <CaretRight size={14} color={theme.muted} weight="bold" />
      </Pressable>
    );
  };

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: theme.background }]}
      edges={["top"]}
    >
      <View style={[styles.header, { borderBottomColor: theme.separator }]}>
        <Text
          style={[
            styles.title,
            { color: theme.surface, fontFamily: "MackinacPro_700Bold" },
          ]}
        >
          {userDoc?.fullName
            ? `Hi, ${userDoc.fullName.split(" ")[0]}`
            : "Settings"}
        </Text>
        {userDoc?.fullName && user?.phoneNumber ? (
          <Text
            style={[
              styles.phoneNumber,
              { color: theme.muted, fontFamily: "Inter_400Regular" },
            ]}
          >
            {formatCensoredPhoneNumber(user.phoneNumber)}
          </Text>
        ) : null}
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Usage */}
        <View style={styles.section}>
          <Text
            style={[
              styles.sectionLabel,
              { color: theme.muted, fontFamily: "Inter_600SemiBold" },
            ]}
          >
            USAGE
          </Text>
          <View
            style={[
              styles.card,
              styles.usageCard,
              { backgroundColor: theme.card, borderColor: theme.cardBorder },
            ]}
          >
            <View style={styles.usageHeaderRow}>
              <Text
                style={[
                  styles.usageLabel,
                  { color: theme.surface, fontFamily: "Inter_500Medium" },
                ]}
              >
                Action Plans this week
              </Text>
              <Text style={{ fontFamily: "Inter_600SemiBold" }}>
                <Text style={[styles.usageCount, { color: theme.surface }]}>
                  {weeklyActionPlanCount}
                </Text>
                <Text style={[styles.usageCap, { color: theme.muted, fontFamily: "Inter_500Medium" }]}>
                  {" "}/ {weeklyActionPlanLimit}
                </Text>
              </Text>
            </View>
            <View style={[styles.usageTrack, { backgroundColor: theme.separator }]}>
              <View
                style={[
                  styles.usageFill,
                  {
                    backgroundColor: theme.primary,
                    width: `${Math.min(100, (weeklyActionPlanCount / weeklyActionPlanLimit) * 100)}%`,
                    shadowColor: theme.primary,
                  },
                ]}
              />
            </View>
            <View style={styles.usageFooterRow}>
              <Text
                style={[
                  styles.usageResetLabel,
                  { color: theme.muted, fontFamily: "Inter_400Regular" },
                ]}
              >
                Resets weekly
              </Text>
              {plan === "free" && (
                <Pressable onPress={() => router.push("/paywall")} hitSlop={8}>
                  <Text
                    style={[
                      styles.upgradeLink,
                      { color: theme.primary, fontFamily: "Inter_600SemiBold" },
                    ]}
                  >
                    Upgrade to Pro
                  </Text>
                </Pressable>
              )}
            </View>
          </View>
        </View>

        {/* Inputs */}
        {inputs.length > 0 && (
          <View style={styles.section}>
            <Text
              style={[
                styles.sectionLabel,
                { color: theme.muted, fontFamily: "Inter_600SemiBold" },
              ]}
            >
              SIGNALS
            </Text>
            <View
              style={[
                styles.card,
                { backgroundColor: theme.card, borderColor: theme.cardBorder },
              ]}
            >
              {inputsLive.map((c, i) => (
                <ConnectorRow
                  key={c.id}
                  connector={c}
                  isLast={inputsOther.length === 0 && i === inputsLive.length - 1}
                />
              ))}
              <OtherConnectorsGroupRow
                connectors={inputsOther}
                expanded={messengersExpanded}
                onToggle={() => setMessengersExpanded((v) => !v)}
                isLast
              />
            </View>
          </View>
        )}

        {/* Sources */}
        <View style={styles.section}>
          <Text
            style={[
              styles.sectionLabel,
              { color: theme.muted, fontFamily: "Inter_600SemiBold" },
            ]}
          >
            CONNECTORS
          </Text>
          <View
            style={[
              styles.card,
              { backgroundColor: theme.card, borderColor: theme.cardBorder },
            ]}
          >
            {/* Purely informational — no tap target, no navigation, no
                picker. Calendar has no connect/disconnect action or settings
                page of its own (see outputs' own doc comment above); this
                just states how many Gmail+Outlook accounts back it. */}
            <View
              style={[
                styles.row,
                { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.separator },
              ]}
            >
              <View style={styles.rowLeft}>
                <View style={[styles.connectorIcon, { backgroundColor: "#4285F4" + "20" }]}>
                  <View style={styles.iconBox}>
                    <Calendar size={18} color="#4285F4" weight="duotone" />
                  </View>
                </View>
                <Text
                  style={[
                    styles.rowLabel,
                    { color: theme.surface, fontFamily: "Inter_400Regular" },
                  ]}
                >
                  Calendar
                </Text>
              </View>
              <Text
                style={[
                  styles.statusText,
                  calendarLinkedAccountCount > 0
                    ? { color: theme.primary, fontFamily: "Inter_500Medium" }
                    : { color: theme.muted, fontFamily: "Inter_400Regular" },
                ]}
              >
                {calendarLinkedAccountCount > 0
                  ? `${calendarLinkedAccountCount} account${calendarLinkedAccountCount === 1 ? "" : "s"}`
                  : "No Linked Accounts"}
              </Text>
            </View>

            {outputsLive.map((c, i) => (
              <ConnectorRow
                key={c.id}
                connector={c}
                isLast={outputsOther.length === 0 && i === outputsLive.length - 1}
              />
            ))}
            <OtherConnectorsGroupRow
              connectors={outputsOther}
              expanded={connectorsExpanded}
              onToggle={() => setConnectorsExpanded((v) => !v)}
              isLast
            />
          </View>
        </View>

        {/* Agents */}
        <View style={styles.section}>
          <Text
            style={[
              styles.sectionLabel,
              { color: theme.muted, fontFamily: "Inter_600SemiBold" },
            ]}
          >
            AGENTS
          </Text>
          {/* Disabled for now — the row itself still looks and reads as
              inert ("Coming Soon", dimmed), but a hidden triple-tap
              (handleChatWithUsTap above) opens it for testing without
              surfacing it to everyone. Remove the Pressable/onPress once
              ready to re-enable this normally. */}
          <Pressable
            onPress={handleChatWithUsTap}
            style={[
              styles.card,
              styles.row,
              {
                backgroundColor: theme.card,
                borderColor: theme.cardBorder,
                opacity: 0.5,
              },
            ]}
          >
            <Text
              style={[
                styles.rowLabel,
                { color: theme.surface, fontFamily: "Inter_400Regular" },
              ]}
            >
              Chat With Us!
            </Text>
            <Text
              style={[
                styles.comingSoonText,
                { color: theme.muted, fontFamily: "Inter_500Medium" },
              ]}
            >
              Coming Soon
            </Text>
          </Pressable>
        </View>

        {/* Document Creation */}
        <View style={styles.section}>
          <Text
            style={[
              styles.sectionLabel,
              { color: theme.muted, fontFamily: "Inter_600SemiBold" },
            ]}
          >
            CUSTOMIZATION
          </Text>
          <View
            style={[
              styles.card,
              { backgroundColor: theme.card, borderColor: theme.cardBorder },
            ]}
          >
            <Pressable
              onPress={() => router.push("/brand")}
              style={[
                styles.row,
                {
                  borderBottomWidth: StyleSheet.hairlineWidth,
                  borderBottomColor: theme.separator,
                },
              ]}
            >
              <View style={styles.rowLeft}>
                <View style={[styles.connectorIcon, { backgroundColor: "#8E8E93" + "20" }]}>
                  <View style={styles.iconBox}>
                    <Palette size={18} color="#8E8E93" weight="duotone" />
                  </View>
                </View>
                <Text
                  style={[
                    styles.rowLabel,
                    { color: theme.surface, fontFamily: "Inter_400Regular" },
                  ]}
                >
                  Document Branding
                </Text>
              </View>
              <CaretRight size={14} color={theme.muted} weight="bold" />
            </Pressable>

            <View
              style={[
                styles.row,
                {
                  opacity: 0.5,
                  borderBottomWidth: StyleSheet.hairlineWidth,
                  borderBottomColor: theme.separator,
                },
              ]}
            >
              <View style={styles.rowLeft}>
                <View style={[styles.connectorIcon, { backgroundColor: "#8E8E93" + "20" }]}>
                  <View style={styles.iconBox}>
                    <PenNib size={18} color="#8E8E93" weight="duotone" />
                  </View>
                </View>
                <Text
                  style={[
                    styles.rowLabel,
                    { color: theme.surface, fontFamily: "Inter_400Regular" },
                  ]}
                >
                  Email Signature
                </Text>
              </View>
              <Text
                style={[
                  styles.comingSoonText,
                  { color: theme.muted, fontFamily: "Inter_500Medium" },
                ]}
              >
                Coming Soon
              </Text>
            </View>

            <View style={[styles.row, { opacity: 0.5 }]}>
              <View style={styles.rowLeft}>
                <View style={[styles.connectorIcon, { backgroundColor: "#8E8E93" + "20" }]}>
                  <View style={styles.iconBox}>
                    <ChatText size={18} color="#8E8E93" weight="duotone" />
                  </View>
                </View>
                <Text
                  style={[
                    styles.rowLabel,
                    { color: theme.surface, fontFamily: "Inter_400Regular" },
                  ]}
                >
                  Personal Voice
                </Text>
              </View>
              <Text
                style={[
                  styles.comingSoonText,
                  { color: theme.muted, fontFamily: "Inter_500Medium" },
                ]}
              >
                Coming Soon
              </Text>
            </View>
          </View>
        </View>

        {/* Developer Beta */}
        <View style={styles.section}>
          <Text
            style={[
              styles.sectionLabel,
              { color: theme.muted, fontFamily: "Inter_600SemiBold" },
            ]}
          >
            DEVELOPER BETA
          </Text>
          <View
            style={[
              styles.card,
              { backgroundColor: theme.card, borderColor: theme.cardBorder },
            ]}
          >
            <View style={styles.row}>
              <View style={[styles.rowLeft, { flex: 1, marginRight: 12 }]}>
                <View style={[styles.connectorIcon, { backgroundColor: "#8E8E93" + "20" }]}>
                  <View style={styles.iconBox}>
                    <FlaskIcon size={18} color="#8E8E93" weight="duotone" />
                  </View>
                </View>
                <View style={{ flex: 1 }}>
                  <Text
                    style={[
                      styles.rowLabel,
                      { color: theme.surface, fontFamily: "Inter_400Regular" },
                    ]}
                  >
                    Sandbox Mode
                  </Text>
                  <Text
                    style={[
                      styles.rowSubtext,
                      { color: theme.muted, fontFamily: "Inter_400Regular" },
                    ]}
                  >
                    Nothing actually sends
                  </Text>
                </View>
              </View>
              <Switch
                value={sandboxModeEnabled}
                onValueChange={handleSandboxModeSwitch}
              />
            </View>
          </View>
        </View>

        {/* Appearance */}
        <View style={styles.section}>
          <Text
            style={[
              styles.sectionLabel,
              { color: theme.muted, fontFamily: "Inter_600SemiBold" },
            ]}
          >
            APPEARANCE
          </Text>
          <View
            style={[
              styles.card,
              { backgroundColor: theme.card, borderColor: theme.cardBorder },
            ]}
          >
            {APPEARANCE_OPTIONS.map(({ value, label, Icon }, i) => {
              const active = preference === value;
              return (
                <Pressable
                  key={value}
                  onPress={() => setPreference(value)}
                  style={[
                    styles.row,
                    i < APPEARANCE_OPTIONS.length - 1 && {
                      borderBottomWidth: StyleSheet.hairlineWidth,
                      borderBottomColor: theme.separator,
                    },
                  ]}
                >
                  <View style={styles.rowLeft}>
                    <View style={styles.iconBox}>
                      <Icon
                        size={20}
                        color={active ? theme.primary : theme.muted}
                        weight="duotone"
                      />
                    </View>
                    <Text
                      style={[
                        styles.rowLabel,
                        {
                          color: theme.surface,
                          fontFamily: active
                            ? "Inter_600SemiBold"
                            : "Inter_400Regular",
                        },
                      ]}
                    >
                      {label}
                    </Text>
                  </View>
                  {active && (
                    <View
                      style={[styles.dot, { backgroundColor: theme.primary }]}
                    />
                  )}
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* About */}
        <View style={styles.section}>
          <Text
            style={[
              styles.sectionLabel,
              { color: theme.muted, fontFamily: "Inter_600SemiBold" },
            ]}
          >
            ABOUT
          </Text>
          <View
            style={[
              styles.card,
              { backgroundColor: theme.card, borderColor: theme.cardBorder },
            ]}
          >
            <Pressable
              onPress={() => Linking.openSettings()}
              style={({ pressed }) => [
                styles.row,
                {
                  borderBottomWidth: StyleSheet.hairlineWidth,
                  borderBottomColor: theme.separator,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <View style={styles.rowLeft}>
                <View style={styles.iconBox}>
                  <BellSimple size={20} color="#8E8E93" weight="duotone" />
                </View>
                <Text
                  style={[
                    styles.rowLabel,
                    { color: theme.surface, fontFamily: "Inter_400Regular" },
                  ]}
                >
                  Notifications
                </Text>
              </View>
              <View style={styles.statusRow}>
                <View
                  style={[
                    styles.statusDot,
                    { backgroundColor: notificationsEnabled ? theme.primary : theme.muted },
                  ]}
                />
                <Text
                  style={[
                    styles.statusText,
                    notificationsEnabled
                      ? { color: theme.primary, fontFamily: "Inter_500Medium" }
                      : { color: theme.muted, fontFamily: "Inter_400Regular" },
                  ]}
                >
                  {notificationsEnabled ? "On" : "Off"}
                </Text>
              </View>
            </Pressable>

            <Pressable
              onPress={() => Linking.openSettings()}
              style={({ pressed }) => [
                styles.row,
                {
                  borderBottomWidth: StyleSheet.hairlineWidth,
                  borderBottomColor: theme.separator,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <View style={styles.rowLeft}>
                <View style={styles.iconBox}>
                  <Microphone size={20} color="#8E8E93" weight="duotone" />
                </View>
                <Text
                  style={[
                    styles.rowLabel,
                    { color: theme.surface, fontFamily: "Inter_400Regular" },
                  ]}
                >
                  Microphone
                </Text>
              </View>
              <View style={styles.statusRow}>
                <View
                  style={[
                    styles.statusDot,
                    { backgroundColor: microphoneEnabled ? theme.primary : theme.muted },
                  ]}
                />
                <Text
                  style={[
                    styles.statusText,
                    microphoneEnabled
                      ? { color: theme.primary, fontFamily: "Inter_500Medium" }
                      : { color: theme.muted, fontFamily: "Inter_400Regular" },
                  ]}
                >
                  {microphoneEnabled ? "On" : "Off"}
                </Text>
              </View>
            </Pressable>

            <Pressable
              onPress={() => Linking.openURL(INSTAGRAM_URL)}
              style={({ pressed }) => [
                styles.row,
                {
                  borderBottomWidth: StyleSheet.hairlineWidth,
                  borderBottomColor: theme.separator,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <View style={styles.rowLeft}>
                <View style={styles.iconBox}>
                  <InstagramLogo size={20} color="#8E8E93" weight="duotone" />
                </View>
                <Text
                  style={[
                    styles.rowLabel,
                    { color: theme.surface, fontFamily: "Inter_400Regular" },
                  ]}
                >
                  Follow Us on Instagram
                </Text>
              </View>
            </Pressable>

            <Pressable
              onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}`)}
              style={({ pressed }) => [
                styles.row,
                {
                  borderBottomWidth: StyleSheet.hairlineWidth,
                  borderBottomColor: theme.separator,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <View style={styles.rowLeft}>
                <View style={styles.iconBox}>
                  <Headset size={20} color="#8E8E93" weight="duotone" />
                </View>
                <Text
                  style={[
                    styles.rowLabel,
                    { color: theme.surface, fontFamily: "Inter_400Regular" },
                  ]}
                >
                  Get Support
                </Text>
              </View>
            </Pressable>

            <View
              style={[
                styles.row,
                {
                  borderBottomWidth: StyleSheet.hairlineWidth,
                  borderBottomColor: theme.separator,
                },
              ]}
            >
              <View style={styles.rowLeft}>
                <View style={styles.iconBox}>
                  <Info size={20} color="#8E8E93" weight="duotone" />
                </View>
                <Text
                  style={[
                    styles.rowLabel,
                    { color: theme.surface, fontFamily: "Inter_400Regular" },
                  ]}
                >
                  Version
                </Text>
              </View>
              <Text
                style={[
                  styles.statusText,
                  { color: theme.muted, fontFamily: "Inter_400Regular" },
                ]}
              >
                {Application.nativeApplicationVersion ?? "—"}
              </Text>
            </View>

            <Pressable
              onPress={handleLogOut}
              style={({ pressed }) => [
                styles.row,
                { opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <View style={styles.rowLeft}>
                <View style={styles.iconBox}>
                  <SignOut size={20} color="#FF3B30" weight="duotone" />
                </View>
                <Text
                  style={[
                    styles.rowLabel,
                    { color: "#FF3B30", fontFamily: "Inter_600SemiBold" },
                  ]}
                >
                  Log Out
                </Text>
              </View>
            </Pressable>
          </View>
        </View>
      </ScrollView>

      <ConnectPermissionsSheet
        connectorId={pendingConnectorId}
        isPresented={pendingConnectorId !== null}
        onClose={() => setPendingConnectorId(null)}
        onConfirm={() => {
          if (pendingConnectorId) runConnect(pendingConnectorId);
        }}
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
  title: { fontSize: 28, letterSpacing: -0.3 },
  phoneNumber: {
    fontSize: 15,
    marginTop: 4,
  },
  scrollContent: { paddingBottom: 120 },
  section: { paddingHorizontal: 20, paddingTop: 20 },
  sectionLabel: { fontSize: 11, letterSpacing: 0.8, marginBottom: 10 },
  card: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  usageCard: { paddingHorizontal: 16, paddingVertical: 16, gap: 12 },
  usageHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  usageLabel: { fontSize: 14 },
  usageCount: { fontSize: 14 },
  usageCap: { fontSize: 14 },
  usageTrack: {
    height: 10,
    borderRadius: 5,
    overflow: "hidden",
  },
  usageFill: {
    height: "100%",
    borderRadius: 5,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 6,
    elevation: 3,
  },
  usageResetLabel: { fontSize: 12 },
  usageFooterRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  upgradeLink: { fontSize: 12 },
  rowLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
  iconBox: {
    width: 20,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  connectorIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  iconStack: {
    height: 36,
    justifyContent: "center",
  },
  stackedIconBacking: {
    position: "absolute",
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  rowLabel: { fontSize: 15 },
  rowSubtext: { fontSize: 12, marginTop: 2 },
  comingSoonText: { fontSize: 12 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  statusText: { fontSize: 12 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
});
