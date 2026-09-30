import { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { useTheme } from "../../hooks/useTheme";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  setOnboardingComplete,
  saveConnectors,
  Connector,
  removeOAuthIntegration,
} from "../../services/storage";
import { getAppUser } from "../../services/firebase";
import { CaretRight } from "phosphor-react-native";
import { useColorScheme } from "../../hooks/useColorScheme";
import IMessageSetupModal from "../../components/IMessageSetupModal";
import { initiateGmailConnection, initiateOutlookConnection, revokeOutlookSubscription, initiateSlackConnection, initiateTeamsConnection, revokeTeamsSubscription } from "../../services/oauth";
import { useUser } from "../../contexts/UserContext";
import { ConnectPermissionsSheet } from "../../components/ConnectPermissionsSheet";
import { CONNECTOR_META } from "../../constants/connectorMeta";

type ConnectorId = keyof typeof CONNECTOR_META;

// The set of connectors actually connectable FROM THIS SCREEN during
// onboarding — a deliberate subset of every "input" connector in
// CONNECTOR_META (Gmail/Outlook/Slack/Teams have working onboarding OAuth
// flows here). Independent of Settings' own COMING_SOON_IDS: a connector
// could be live in Settings but still lack a working flow on THIS screen,
// or vice versa — so this is its own explicit allowlist, not derived from
// that set. Everything with type: "input" NOT in this set is collapsed
// into a single "More" row (tapping it skips onboarding entirely rather
// than expanding in place, unlike the equivalent row in Settings — see
// handleFinish's doc comment).
const ONBOARDING_CONNECTABLE_IDS = new Set(["gmail", "outlook", "slack", "teams"]);

export default function ConnectorsScreen() {
  const router = useRouter();
  const theme = useTheme();
  const scheme = useColorScheme();

  // Derived from the SAME CONNECTOR_META/COMING_SOON_IDS used by
  // app/(main)/settings.tsx and ConnectPermissionsSheet.tsx, rather than a
  // separate hardcoded list — a connector's label/icon/color/coming-soon
  // status can never drift between onboarding and Settings again. Colors
  // that are a function of scheme (Notion/GitHub) are resolved here, inside
  // the component, since module scope has no access to the current
  // colorScheme.
  const allInputEntries = Object.entries(CONNECTOR_META)
    .filter(([, meta]) => meta.type === "input")
    .map(([id, meta]) => ({
      id: id as ConnectorId,
      label: meta.label,
      Icon: meta.Icon,
      color: typeof meta.color === "function" ? meta.color(scheme) : meta.color,
    }));
  const INPUTS = allInputEntries.filter((c) => ONBOARDING_CONNECTABLE_IDS.has(c.id));
  const COMING_SOON_INPUTS = allInputEntries.filter((c) => !ONBOARDING_CONNECTABLE_IDS.has(c.id));
  const OUTPUTS = Object.entries(CONNECTOR_META)
    .filter(([, meta]) => meta.type === "output")
    .map(([id, meta]) => ({
      id: id as ConnectorId,
      label: meta.label,
      Icon: meta.Icon,
      color: typeof meta.color === "function" ? meta.color(scheme) : meta.color,
    }));
  const [connected, setConnected] = useState<Set<ConnectorId>>(new Set());
  const [loading, setLoading] = useState<ConnectorId | null>(null);
  const [showIMessageSetup, setShowIMessageSetup] = useState(false);
  const [gmailEmail, setGmailEmail] = useState<string | undefined>(undefined);
  const [outlookEmail, setOutlookEmail] = useState<string | undefined>(undefined);
  const [slackEmail, setSlackEmail] = useState<string | undefined>(undefined);
  const [teamsEmail, setTeamsEmail] = useState<string | undefined>(undefined);
  // The connector id currently showing the pre-connect permissions sheet
  // (see ConnectPermissionsSheet) — null when no sheet is open. Matches
  // the same pattern used in app/(main)/settings.tsx: toggle() only ever
  // OPENS this sheet for a not-yet-connected connector; the real connect
  // call (runConnect below) fires only from the sheet's own "Connect"
  // button, never directly from tapping a connector row.
  const [pendingConnectorId, setPendingConnectorId] = useState<ConnectorId | null>(null);
  const { userDoc } = useUser();

  useEffect(() => {
    // integrations.{id} is an array of OAuthAccount now (see
    // services/storage.ts's UserDocument.integrations) — onboarding only
    // ever deals with a user's FIRST connection per provider (multi-account
    // management lives on connector-settings/[id]), so "connected" here
    // means accountCount > 0 and the displayed identity is always the
    // DEFAULT account's, matching Settings' own main-page row treatment.
    const gmailAccounts = userDoc?.integrations?.gmail || [];
    const activeGmail = gmailAccounts.filter((a) => a.status === "active");
    const defaultGmail = activeGmail.find((a) => a.isDefault) || activeGmail[0];
    if (defaultGmail) {
      const scopes = defaultGmail.scopes || [];
      const hasGmail = scopes.some((s: string) => s.includes("gmail"));
      const hasDrive = scopes.some((s: string) => s.includes("drive"));
      const hasCalendar = scopes.some((s: string) => s.includes("calendar"));

      setConnected((prev) => {
        const next = new Set(prev);
        if (hasGmail) next.add("gmail");
        else next.delete("gmail");
        if (hasDrive) next.add("drive");
        else next.delete("drive");
        if (hasCalendar) next.add("calendar");
        else next.delete("calendar");
        return next;
      });
      setGmailEmail(defaultGmail.email);
    } else {
      setConnected((prev) => {
        const next = new Set(prev);
        next.delete("gmail");
        next.delete("drive");
        next.delete("calendar");
        return next;
      });
      setGmailEmail(undefined);
    }

    const outlookAccounts = userDoc?.integrations?.outlook || [];
    const activeOutlook = outlookAccounts.filter((a) => a.status === "active");
    const defaultOutlook = activeOutlook.find((a) => a.isDefault) || activeOutlook[0];
    if (defaultOutlook) {
      setConnected((prev) => new Set(prev).add("outlook"));
      setOutlookEmail(defaultOutlook.email);
    } else {
      setConnected((prev) => {
        const next = new Set(prev);
        next.delete("outlook");
        return next;
      });
      setOutlookEmail(undefined);
    }

    const slackAccounts = userDoc?.integrations?.slack || [];
    const activeSlack = slackAccounts.filter((a) => a.status === "active");
    const defaultSlack = activeSlack.find((a) => a.isDefault) || activeSlack[0];
    if (defaultSlack) {
      setConnected((prev) => new Set(prev).add("slack"));
      // Slack rarely returns an email — show "<workspace> · <display name>"
      // instead, matching the same fallback used in services/storage.ts.
      const slackSubtitle = [defaultSlack.meta?.teamName, defaultSlack.meta?.displayName]
        .filter(Boolean)
        .join(" · ");
      setSlackEmail(defaultSlack.email || slackSubtitle || undefined);
    } else {
      setConnected((prev) => {
        const next = new Set(prev);
        next.delete("slack");
        return next;
      });
      setSlackEmail(undefined);
    }

    const teamsAccounts = userDoc?.integrations?.teams || [];
    const activeTeams = teamsAccounts.filter((a) => a.status === "active");
    const defaultTeams = activeTeams.find((a) => a.isDefault) || activeTeams[0];
    if (defaultTeams) {
      setConnected((prev) => new Set(prev).add("teams"));
      setTeamsEmail(defaultTeams.email);
    } else {
      setConnected((prev) => {
        const next = new Set(prev);
        next.delete("teams");
        return next;
      });
      setTeamsEmail(undefined);
    }
  }, [userDoc]);

  const toggle = async (id: ConnectorId) => {
    if (loading) return;
    if (connected.has(id)) {
      if (id === "gmail" || id === "drive" || id === "calendar") {
        Alert.alert(
          "Disconnect Google Account",
          "Are you sure you want to disconnect Google? This will disconnect Gmail, Calendar, and Drive.",
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Disconnect",
              style: "destructive",
              onPress: async () => {
                const user = getAppUser();
                if (user) {
                  try {
                    // Onboarding only ever manages the DEFAULT account — a
                    // second Gmail account (if any) can only be added/removed
                    // from connector-settings/[id] after onboarding.
                    const gmailAccounts = userDoc?.integrations?.gmail || [];
                    const defaultGmail = gmailAccounts.find((a) => a.isDefault) || gmailAccounts[0];
                    if (defaultGmail) {
                      await removeOAuthIntegration(user.uid, "gmail", defaultGmail.accountId);
                    }
                  } catch (e: any) {
                    Alert.alert(
                      "Error",
                      e.message || "Failed to disconnect Google.",
                    );
                  }
                }
              },
            },
          ],
        );
      } else if (id === "outlook") {
        Alert.alert(
          "Disconnect Outlook Account",
          "Are you sure you want to disconnect Outlook?",
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Disconnect",
              style: "destructive",
              onPress: async () => {
                const user = getAppUser();
                if (user) {
                  try {
                    const outlookAccounts = userDoc?.integrations?.outlook || [];
                    const defaultOutlook = outlookAccounts.find((a) => a.isDefault) || outlookAccounts[0];
                    const subscriptionId = defaultOutlook?.meta?.subscriptionId;
                    if (subscriptionId && defaultOutlook?.accessToken) {
                      await revokeOutlookSubscription(defaultOutlook.accessToken, subscriptionId);
                    }
                    // Sent Items subscription (see createGraphMailSubscription
                    // in services/oauth.ts) — a separate Graph subscription
                    // object from Inbox's, needs its own revoke call too.
                    const sentSubscriptionId = defaultOutlook?.meta?.sentSubscriptionId;
                    if (sentSubscriptionId && defaultOutlook?.accessToken) {
                      await revokeOutlookSubscription(defaultOutlook.accessToken, sentSubscriptionId);
                    }
                    if (defaultOutlook) {
                      await removeOAuthIntegration(user.uid, "outlook", defaultOutlook.accountId);
                    }
                  } catch (e: any) {
                    Alert.alert(
                      "Error",
                      e.message || "Failed to disconnect Outlook.",
                    );
                  }
                }
              },
            },
          ],
        );
      } else if (id === "slack") {
        Alert.alert(
          "Disconnect Slack Account",
          "Are you sure you want to disconnect Slack?",
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Disconnect",
              style: "destructive",
              onPress: async () => {
                const user = getAppUser();
                if (user) {
                  try {
                    const slackAccounts = userDoc?.integrations?.slack || [];
                    const defaultSlack = slackAccounts.find((a) => a.isDefault) || slackAccounts[0];
                    if (defaultSlack) {
                      await removeOAuthIntegration(user.uid, "slack", defaultSlack.accountId);
                    }
                  } catch (e: any) {
                    Alert.alert(
                      "Error",
                      e.message || "Failed to disconnect Slack.",
                    );
                  }
                }
              },
            },
          ],
        );
      } else if (id === "teams") {
        Alert.alert(
          "Disconnect Microsoft Teams",
          "Are you sure you want to disconnect Teams?",
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Disconnect",
              style: "destructive",
              onPress: async () => {
                const user = getAppUser();
                if (user) {
                  try {
                    const teamsAccounts = userDoc?.integrations?.teams || [];
                    const defaultTeams = teamsAccounts.find((a) => a.isDefault) || teamsAccounts[0];
                    const subscriptionId = defaultTeams?.meta?.subscriptionId;
                    if (subscriptionId && defaultTeams?.accessToken) {
                      await revokeTeamsSubscription(defaultTeams.accessToken, subscriptionId);
                    }
                    if (defaultTeams) {
                      await removeOAuthIntegration(user.uid, "teams", defaultTeams.accountId);
                    }
                  } catch (e: any) {
                    Alert.alert(
                      "Error",
                      e.message || "Failed to disconnect Teams.",
                    );
                  }
                }
              },
            },
          ],
        );
      } else {
        setConnected((prev) => {
          const n = new Set(prev);
          n.delete(id);
          return n;
        });
      }
      return;
    }
    if (id === "imessage") {
      setShowIMessageSetup(true);
      return;
    }
    if (id === "gmail" || id === "drive" || id === "calendar" || id === "outlook" || id === "slack" || id === "teams") {
      // Show the permissions sheet FIRST — the real OAuth flow only fires
      // from the sheet's own "Connect" button (runConnect below), never
      // directly from tapping the row. Matches app/(main)/settings.tsx's
      // handlePressConnector.
      setPendingConnectorId(id);
      return;
    }
    setLoading(id);
    await new Promise((r) => setTimeout(r, 900));
    setLoading(null);
    setConnected((prev) => new Set([...prev, id]));
  };

  // Runs the REAL connect flow for a given connector id — only ever called
  // from ConnectPermissionsSheet's "Connect" button now, never directly
  // from tapping a connector row (see toggle above).
  const runConnect = async (id: ConnectorId) => {
    if (id === "gmail" || id === "drive" || id === "calendar") {
      setLoading(id);
      try {
        const res = await initiateGmailConnection();
        if (res.success && res.email) {
          // useEffect updates state dynamically
        } else if (res.error) {
          Alert.alert("Connection Failed", res.error);
        }
      } catch (e: any) {
        Alert.alert("Error", e.message || "Failed to connect Google.");
      } finally {
        setLoading(null);
      }
      return;
    }
    if (id === "outlook") {
      setLoading(id);
      try {
        const res = await initiateOutlookConnection();
        if (res.success && res.email) {
          // useEffect updates state dynamically
        } else if (res.error) {
          Alert.alert("Connection Failed", res.error);
        }
      } catch (e: any) {
        Alert.alert("Error", e.message || "Failed to connect Outlook.");
      } finally {
        setLoading(null);
      }
      return;
    }
    if (id === "slack") {
      setLoading(id);
      try {
        const res = await initiateSlackConnection();
        if (res.success) {
          // useEffect updates state dynamically
        } else if (res.error) {
          Alert.alert("Connection Failed", res.error);
        }
      } catch (e: any) {
        Alert.alert("Error", e.message || "Failed to connect Slack.");
      } finally {
        setLoading(null);
      }
      return;
    }
    if (id === "teams") {
      setLoading(id);
      try {
        const res = await initiateTeamsConnection();
        if (res.success) {
          // useEffect updates state dynamically
        } else if (res.error) {
          Alert.alert("Connection Failed", res.error);
        }
      } catch (e: any) {
        Alert.alert("Error", e.message || "Failed to connect Teams.");
      } finally {
        setLoading(null);
      }
      return;
    }
  };

  // Also used as the "skip" action for the collapsed "More" row — unlike
  // Settings' equivalent row (which expands in place to show each
  // connector), none of these are actually connectable yet during
  // onboarding, so there's nothing useful to expand to; tapping it just
  // finishes onboarding with whatever's already connected, same as the
  // primary button but without requiring Gmail first.
  const handleFinish = async () => {
    const allConnectors = [...INPUTS, ...OUTPUTS];
    const connectors: Connector[] = allConnectors.map((c) => ({
      id: c.id as Connector["id"],
      connected: connected.has(c.id),
      email: c.id === "gmail" ? gmailEmail : c.id === "outlook" ? outlookEmail : c.id === "slack" ? slackEmail : c.id === "teams" ? teamsEmail : undefined,
      accountCount: connected.has(c.id) ? 1 : 0,
    }));
    await saveConnectors(connectors);
    await setOnboardingComplete();
    router.replace("/(main)/home");
  };

  // Messenger-section row, styled to match Settings' ConnectorRow exactly
  // (icon, label, connected email, status text with caret) — sits inside a
  // single bordered card with hairline separators between rows, same as
  // Settings' SIGNALS section.
  const ConnectorRow = ({
    id,
    label,
    Icon,
    color,
    email,
    isLast,
  }: (typeof INPUTS)[0] & { email?: string; isLast: boolean }) => {
    const isConnected = connected.has(id);
    const isLoading = loading === id;

    return (
      <Pressable
        onPress={() => toggle(id)}
        style={({ pressed }) => [
          styles.row,
          !isLast && {
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: theme.separator,
          },
          { opacity: pressed ? 0.7 : 1 },
        ]}
      >
        <View style={styles.rowLeft}>
          <View style={[styles.connectorIcon, { backgroundColor: color + "20" }]}>
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
            {email ? (
              <Text
                style={{
                  color: theme.muted,
                  fontSize: 11,
                  marginTop: 2,
                  fontFamily: "Inter_400Regular",
                }}
              >
                {email}
              </Text>
            ) : null}
          </View>
        </View>
        {isConnected ? (
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
          </View>
        ) : (
          <View style={styles.statusRow}>
            <Text
              style={[
                styles.statusText,
                { color: theme.muted, fontFamily: "Inter_400Regular" },
              ]}
            >
              {isLoading ? "..." : "Connect"}
            </Text>
            <CaretRight size={14} color={theme.muted} weight="bold" />
          </View>
        )}
      </Pressable>
    );
  };

  // Collapsed row for the not-yet-connectable messenger connectors —
  // stacked icon preview (top 3), styled to match Settings'
  // OtherConnectorsGroupRow exactly. Unlike Settings (which expands in
  // place), tapping it skips onboarding outright (see handleFinish's doc
  // comment) since none of these are actually connectable yet here. Always
  // the last row in the SIGNALS card, so no bottom border.
  const MoreConnectorsRow = () => {
    const stackIcons = COMING_SOON_INPUTS.slice(0, 3);
    return (
      <Pressable
        onPress={handleFinish}
        style={({ pressed }) => [
          styles.row,
          { opacity: pressed ? 0.5 : 1 },
        ]}
      >
        <View style={styles.rowLeft}>
          <View style={[styles.iconStack, { width: 32 + (stackIcons.length - 1) * 14 }]}>
            {stackIcons.map(({ id, Icon, color }, i) => (
              <View
                key={id}
                style={[
                  styles.stackedIconBacking,
                  { left: i * 14, zIndex: stackIcons.length - i, backgroundColor: theme.card },
                ]}
              >
                <View style={[styles.connectorIcon, { backgroundColor: color + "20" }]}>
                  <View style={styles.iconBox}>
                    <Icon size={16} color={color} weight="duotone" />
                  </View>
                </View>
              </View>
            ))}
          </View>
          <Text
            style={[
              styles.rowLabel,
              { color: theme.surface, fontFamily: "Inter_400Regular" },
            ]}
          >
            More
          </Text>
        </View>
        <CaretRight size={14} color={theme.muted} weight="bold" />
      </Pressable>
    );
  };

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: theme.background }]}
    >
      <View style={styles.header}>
        <Text
          style={[
            styles.title,
            { color: theme.surface, fontFamily: "MackinacPro_700Bold" },
          ]}
        >
          Signals
        </Text>
        <Text
          style={[
            styles.subtitle,
            { color: theme.muted, fontFamily: "Inter_400Regular" },
          ]}
        >
          Choose what flows in and what gets acted on.
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Inputs */}
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
              {
                backgroundColor: theme.card,
                borderColor: theme.cardBorder,
                flexDirection: "column",
                alignItems: "stretch",
                padding: 0,
              },
            ]}
          >
            {INPUTS.map((c, i) => (
              <ConnectorRow
                key={c.id}
                {...c}
                email={c.id === "gmail" ? gmailEmail : c.id === "outlook" ? outlookEmail : c.id === "slack" ? slackEmail : c.id === "teams" ? teamsEmail : undefined}
                isLast={false}
              />
            ))}
            <MoreConnectorsRow />
          </View>
        </View>
      </ScrollView>

      <View style={styles.bottom}>
        <Pressable
          style={[
            styles.primaryBtn,
            {
              backgroundColor: connected.has("gmail")
                ? theme.primary
                : theme.separator,
            },
          ]}
          onPress={handleFinish}
          disabled={!connected.has("gmail")}
        >
          <Text
            style={[
              styles.primaryBtnText,
              {
                fontFamily: "Inter_600SemiBold",
                opacity: connected.has("gmail") ? 1 : 0.5,
              },
            ]}
          >
            Finish Setup
          </Text>
        </Pressable>
      </View>

      <IMessageSetupModal
        visible={showIMessageSetup}
        theme={theme}
        onApprove={() => {
          setShowIMessageSetup(false);
          setConnected((prev) => new Set([...prev, "imessage"]));
        }}
        onClose={() => setShowIMessageSetup(false)}
      />

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
  header: { paddingHorizontal: 28, paddingTop: 20, paddingBottom: 8 },
  step: {
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 1.2,
    marginBottom: 8,
  },
  title: { fontSize: 30, marginBottom: 10, letterSpacing: -0.3 },
  subtitle: { fontSize: 15, lineHeight: 22 },
  scrollContent: { paddingBottom: 16 },
  section: { paddingHorizontal: 20, paddingTop: 20 },
  sectionLabel: { fontSize: 11, letterSpacing: 0.8, marginBottom: 10 },
  sectionList: { gap: 10 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden",
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 14,
  },
  cardText: { flex: 1 },
  cardLabel: { fontSize: 15, marginBottom: 2 },
  cardDesc: { fontSize: 12 },
  statusPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  statusText: { fontSize: 12 },
  // Settings-style row (SIGNALS section) — mirrors app/(main)/settings.tsx
  // exactly: row/rowLeft/connectorIcon/iconBox/rowLabel/statusRow/statusDot.
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
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
  statusRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  bottom: { paddingHorizontal: 28, paddingBottom: 32, paddingTop: 16 },
  primaryBtn: {
    height: 54,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  primaryBtnText: { color: "#FFFFFF", fontSize: 17 },
});
