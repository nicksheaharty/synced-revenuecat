import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, Alert, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { CaretLeft, Check, MagnifyingGlass, Megaphone, Star, Plus, DotsThreeVertical } from "phosphor-react-native";
import { MenuView } from "@expo/ui/community/menu";
import { useTheme } from "../../hooks/useTheme";
import { useUser } from "../../contexts/UserContext";
import { getAppUser } from "../../services/firebase";
import {
  getConnectors,
  saveConnectors,
  removeOAuthIntegration,
  setEmailFilterMode,
  setDefaultAccount,
  OAuthAccount,
  MAX_ACCOUNTS_PER_PROVIDER,
  accountLabel,
} from "../../services/storage";
import {
  revokeOutlookSubscription,
  revokeTeamsSubscription,
  initiateGmailConnection,
  initiateOutlookConnection,
  initiateGoogleDriveConnection,
  initiateOneDriveConnection,
  initiateSlackConnection,
  initiateTeamsConnection,
} from "../../services/oauth";
import { CONNECTOR_META } from "../../constants/connectorMeta";

// Same real connect flow as app/(main)/settings.tsx's per-provider
// handlers, reused here for "Add account" — each opens the provider's own
// OAuth chooser (so the user can pick a genuinely different account than
// any already connected) and returns whether it actually succeeded.
const CONNECT_FLOWS: Record<string, () => Promise<{ success?: boolean; error?: string }>> = {
  gmail: initiateGmailConnection,
  outlook: initiateOutlookConnection,
  drive: initiateGoogleDriveConnection,
  onedrive: initiateOneDriveConnection,
  slack: initiateSlackConnection,
  teams: initiateTeamsConnection,
};

// Connectors whose triage intake filter is actually configurable today —
// see functions/src/pipeline.ts's buildTriagePrompt Rule 1. Teams/Slack
// stay on the hardcoded strict behavior, so they don't get this section.
const EMAIL_FILTER_CONNECTOR_IDS = new Set(["gmail", "outlook"]);

const FILTER_OPTIONS: {
  value: "personalAndDirected" | "loosened";
  label: string;
  description: string;
  Icon: React.ComponentType<any>;
}[] = [
  {
    value: "personalAndDirected",
    label: "Personal & Directed",
    description: "Only one-to-one or small-group messages written by a real person, specifically to you. The default. Filters out newsletters, bulk mail, and automated notices.",
    Icon: MagnifyingGlass,
  },
  {
    value: "loosened",
    label: "Loosened",
    description: "Also allows group threads and automated-but-directed notices, e.g. an account alert or booking update that still needs you to act. Still excludes pure newsletters and marketing.",
    Icon: Megaphone,
  },
];

// Per-connector "Disconnect" copy and side effects — moved here wholesale
// from app/(main)/settings.tsx (previously fired straight from tapping a
// connected row; now this page owns disconnect since the row instead opens
// this settings screen). Each entry mirrors that file's former handler
// body exactly, including the Outlook/Teams subscription-revoke step and
// Outlook's extra "calendar" row clear.
const DISCONNECT_COPY: Record<string, { title: string; message: string; successMessage: string }> = {
  gmail: {
    title: "Disconnect Google Account",
    message: "Are you sure you want to disconnect Google? Synced will no longer be able to read or parse your email, calendar events, or documents.",
    successMessage: "Google account disconnected successfully.",
  },
  outlook: {
    title: "Disconnect Outlook Account",
    message: "Are you sure you want to disconnect Outlook? Synced will no longer be able to read or parse your email or calendar events.",
    successMessage: "Outlook account disconnected successfully.",
  },
  slack: {
    title: "Disconnect Slack Account",
    message: "Are you sure you want to disconnect Slack? Synced will no longer be able to read or reply to your Slack DMs.",
    successMessage: "Slack account disconnected successfully.",
  },
  teams: {
    title: "Disconnect Microsoft Teams",
    message: "Are you sure you want to disconnect Teams? Synced will no longer be able to read your Teams chats. This does not affect your Outlook mail or calendar connection.",
    successMessage: "Teams account disconnected successfully.",
  },
  drive: {
    title: "Disconnect Drive",
    message: "Are you sure you want to disconnect Drive? Synced will no longer be able to read your Drive files. This does not affect your Gmail or Calendar connection.",
    successMessage: "Drive disconnected successfully.",
  },
  onedrive: {
    title: "Disconnect OneDrive",
    message: "Are you sure you want to disconnect OneDrive? Synced will no longer be able to read your OneDrive files. This does not affect your Outlook mail or calendar connection.",
    successMessage: "OneDrive disconnected successfully.",
  },
};

export default function ConnectorSettingsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { userDoc } = useUser();
  const [busyAccountId, setBusyAccountId] = useState<string | null>(null);
  const [addingAccount, setAddingAccount] = useState(false);

  const meta = CONNECTOR_META[id];
  const currentFilterMode = userDoc?.emailFilterMode ?? "personalAndDirected";
  // integrations.{id} is an array of OAuthAccount (see
  // services/storage.ts's UserDocument.integrations) — only active accounts
  // are shown/managed here, matching getConnectors()'s own accountCount
  // definition.
  const accounts: OAuthAccount[] = (userDoc?.integrations?.[id] || []).filter(
    (a: OAuthAccount) => a.status === "active",
  );
  const atAccountCap = accounts.length >= MAX_ACCOUNTS_PER_PROVIDER;

  // Self-heal: if this provider has accounts but none is marked default
  // (e.g. legacy data from before isDefault existed), silently promote the
  // oldest one — a provider with connected accounts should never be left
  // with no default, since that's what onTaskCreated falls back to for a
  // brand-new outbound task with no triggering message.
  useEffect(() => {
    if (accounts.length === 0 || accounts.some((a) => a.isDefault)) return;
    const user = getAppUser();
    if (!user) return;
    const oldest = accounts.reduce((a, b) => (a.connectedAt < b.connectedAt ? a : b));
    setDefaultAccount(user.uid, id, oldest.accountId).catch(() => {});
  }, [accounts, id]);

  const handleBack = useCallback(() => {
    router.canGoBack() ? router.back() : router.replace("/(main)/settings");
  }, [router]);

  const handleSelectFilterMode = useCallback(
    (mode: "personalAndDirected" | "loosened") => {
      const user = getAppUser();
      if (!user) return;
      setEmailFilterMode(user.uid, mode);
    },
    [],
  );

  const handleSetDefault = useCallback(
    async (accountId: string) => {
      const user = getAppUser();
      if (!user) return;
      setBusyAccountId(accountId);
      try {
        await setDefaultAccount(user.uid, id, accountId);
      } catch (e: any) {
        Alert.alert("Error", e.message || "Failed to set default account.");
      } finally {
        setBusyAccountId(null);
      }
    },
    [id],
  );

  const handleAddAccount = useCallback(async () => {
    const connectFlow = CONNECT_FLOWS[id];
    if (!connectFlow || atAccountCap) return;
    setAddingAccount(true);
    try {
      const res = await connectFlow();
      if (res.success) {
        const updated = await getConnectors();
        await saveConnectors(updated);
      } else if (res.error) {
        Alert.alert("Connection Failed", res.error);
      }
    } catch (e: any) {
      Alert.alert("Error", e.message || `Failed to connect another ${meta?.label ?? id} account.`);
    } finally {
      setAddingAccount(false);
    }
  }, [id, meta, atAccountCap]);

  const handleDisconnectAccount = useCallback(
    (account: OAuthAccount) => {
      const user = getAppUser();
      const copy = DISCONNECT_COPY[id];
      if (!user || !copy) return;
      const label = accountLabel(account);

      Alert.alert(
        copy.title,
        accounts.length > 1 ? `${copy.message}\n\nThis only disconnects ${label} — your other ${meta?.label ?? id} accounts stay connected.` : copy.message,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Disconnect",
            style: "destructive",
            onPress: async () => {
              setBusyAccountId(account.accountId);
              try {
                // Outlook/Teams have a Graph webhook subscription that needs
                // to be explicitly torn down before the account goes away —
                // mirrors settings.tsx's former handleOutlookDisconnect /
                // handleTeamsDisconnect bodies exactly, just scoped to THIS
                // account's own token/subscription now.
                if (id === "outlook") {
                  const subscriptionId = account.meta?.subscriptionId;
                  if (subscriptionId && account.accessToken) {
                    await revokeOutlookSubscription(account.accessToken, subscriptionId);
                  }
                  // Sent Items subscription (see createGraphMailSubscription
                  // in services/oauth.ts) — a separate Graph subscription
                  // object from Inbox's, so it needs its own revoke call or
                  // it keeps POSTing notifications for a mailbox that's no
                  // longer connected.
                  const sentSubscriptionId = account.meta?.sentSubscriptionId;
                  if (sentSubscriptionId && account.accessToken) {
                    await revokeOutlookSubscription(account.accessToken, sentSubscriptionId);
                  }
                } else if (id === "teams") {
                  const subscriptionId = account.meta?.subscriptionId;
                  if (subscriptionId && account.accessToken) {
                    await revokeTeamsSubscription(account.accessToken, subscriptionId);
                  }
                }

                await removeOAuthIntegration(user.uid, id, account.accountId);

                const remainingCount = accounts.length - 1;
                const currentConnectors = await getConnectors();
                const updated = currentConnectors.map((c) =>
                  // Outlook disconnect also clears the derived "calendar" row
                  // once NO Outlook accounts remain, same as the original
                  // settings.tsx handler.
                  (c.id === id || (id === "outlook" && c.id === "calendar")) && remainingCount === 0
                    ? { ...c, connected: false, email: undefined }
                    : c,
                );
                await saveConnectors(updated);

                if (remainingCount === 0) {
                  Alert.alert("Disconnected", copy.successMessage, [
                    { text: "OK", onPress: handleBack },
                  ]);
                }
              } catch (e: any) {
                Alert.alert("Error", e.message || `Failed to disconnect ${meta?.label ?? id}.`);
              } finally {
                setBusyAccountId(null);
              }
            },
          },
        ],
      );
    },
    [id, accounts, meta, handleBack],
  );

  if (!meta) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={["top"]}>
        <View style={[styles.navBar, { borderBottomColor: theme.separator }]}>
          <Pressable onPress={handleBack} style={styles.backBtn} hitSlop={12}>
            <CaretLeft size={20} color={theme.primary} weight="bold" />
            <Text style={[styles.backLabel, { color: theme.primary, fontFamily: "Inter_400Regular" }]}>
              Settings
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const { label } = meta;
  const showEmailFilter = EMAIL_FILTER_CONNECTOR_IDS.has(id);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={["top"]}>
      <View style={[styles.navBar, { borderBottomColor: theme.separator }]}>
        <Pressable onPress={handleBack} style={styles.backBtn} hitSlop={12}>
          <CaretLeft size={20} color={theme.primary} weight="bold" />
          <Text style={[styles.backLabel, { color: theme.primary, fontFamily: "Inter_400Regular" }]}>
            Settings
          </Text>
        </Pressable>
        <Text style={[styles.navTitle, { color: theme.surface, fontFamily: "Inter_600SemiBold" }]}>
          {label}
        </Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <Text style={[styles.sectionLabel, { color: theme.muted, fontFamily: "Inter_600SemiBold", marginTop: 0 }]}>
          ACCOUNTS
        </Text>
        <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
          {accounts.map((account, i) => {
            const isBusy = busyAccountId === account.accountId;
            return (
              <View
                key={account.accountId}
                style={[
                  styles.identityRow,
                  { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.separator },
                ]}
              >
                <View style={{ flex: 1 }}>
                  <Text
                    style={[styles.identityLabel, { color: theme.surface, fontFamily: "Inter_600SemiBold" }]}
                    numberOfLines={1}
                  >
                    {accountLabel(account)}
                  </Text>
                  {account.isDefault && (
                    <View style={[styles.defaultBadge, { backgroundColor: theme.primary + "1A" }]}>
                      <Star size={10} color={theme.primary} weight="fill" />
                      <Text style={[styles.defaultBadgeText, { color: theme.primary, fontFamily: "Inter_600SemiBold" }]}>
                        Default
                      </Text>
                    </View>
                  )}
                </View>
                {isBusy ? (
                  <ActivityIndicator size="small" color={theme.muted} />
                ) : (
                  <MenuView
                    style={styles.menuTrigger}
                    onPressAction={({ nativeEvent }) => {
                      if (nativeEvent.event === "setDefault") handleSetDefault(account.accountId);
                      else if (nativeEvent.event === "disconnect") handleDisconnectAccount(account);
                    }}
                    actions={[
                      ...(!account.isDefault
                        ? [{ id: "setDefault", title: "Set as Default", image: "star" as const }]
                        : []),
                      {
                        id: "disconnect",
                        title: "Disconnect",
                        image: "trash" as const,
                        attributes: { destructive: true },
                      },
                    ]}
                  >
                    <View style={styles.menuTriggerHit} hitSlop={8}>
                      <DotsThreeVertical size={20} color={theme.muted} weight="bold" />
                    </View>
                  </MenuView>
                )}
              </View>
            );
          })}
          {accounts.length === 0 && (
            <View style={[styles.identityRow, { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.separator }]}>
              <Text style={[styles.identityEmail, { color: theme.muted, fontFamily: "Inter_400Regular" }]}>
                No accounts connected.
              </Text>
            </View>
          )}
          {!!CONNECT_FLOWS[id] && (
            <Pressable
              onPress={handleAddAccount}
              disabled={atAccountCap || addingAccount}
              style={({ pressed }) => [
                styles.addAccountRow,
                { opacity: atAccountCap ? 0.5 : pressed ? 0.7 : 1 },
              ]}
            >
              {addingAccount ? (
                <ActivityIndicator size="small" color={theme.primary} />
              ) : (
                <Plus size={16} color={theme.primary} weight="bold" />
              )}
              <Text style={[styles.addAccountText, { color: theme.primary, fontFamily: "Inter_500Medium" }]}>
                {atAccountCap
                  ? `Maximum of ${MAX_ACCOUNTS_PER_PROVIDER} accounts reached`
                  : `Add ${label} account`}
              </Text>
            </Pressable>
          )}
        </View>
        <Text style={[styles.sectionSubtext, { color: theme.muted, fontFamily: "Inter_400Regular" }]}>
          The default account handles new conversations. Up to {MAX_ACCOUNTS_PER_PROVIDER} accounts.
        </Text>

        {showEmailFilter && (
          <>
            <Text style={[styles.sectionLabel, { color: theme.muted, fontFamily: "Inter_600SemiBold" }]}>
              EMAIL FILTER
            </Text>
            <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
              {FILTER_OPTIONS.map((opt, i) => {
                const isSelected = currentFilterMode === opt.value;
                const isLast = i === FILTER_OPTIONS.length - 1;
                return (
                  <Pressable
                    key={opt.value}
                    onPress={() => handleSelectFilterMode(opt.value)}
                    style={({ pressed }) => [
                      styles.filterOption,
                      !isLast && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.separator },
                      { opacity: pressed ? 0.7 : 1 },
                    ]}
                  >
                    <View
                      style={[
                        styles.filterOptionIconWell,
                        { backgroundColor: isSelected ? theme.primary + "1A" : theme.searchBg },
                      ]}
                    >
                      <opt.Icon size={16} color={isSelected ? theme.primary : theme.muted} weight="bold" />
                    </View>
                    <View style={styles.filterOptionBody}>
                      <Text
                        style={[
                          styles.filterOptionLabel,
                          { color: isSelected ? theme.primary : theme.surface, fontFamily: "Inter_600SemiBold" },
                        ]}
                      >
                        {opt.label}
                      </Text>
                      <Text style={[styles.filterOptionDesc, { color: theme.muted, fontFamily: "Inter_400Regular" }]}>
                        {opt.description}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.radio,
                        { borderColor: isSelected ? theme.primary : theme.muted },
                        isSelected && { backgroundColor: theme.primary },
                      ]}
                    >
                      {isSelected && <Check size={11} color="#FFF" weight="bold" />}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  navBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { flexDirection: "row", alignItems: "center", gap: 4, minWidth: 80 },
  backLabel: { fontSize: 16 },
  navTitle: { fontSize: 16 },
  scrollContent: { padding: 20, paddingBottom: 60, gap: 4 },
  identityRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  identityLabel: { fontSize: 16 },
  identityEmail: { fontSize: 13, marginTop: 2 },
  sectionLabel: { fontSize: 11, letterSpacing: 0.8, marginTop: 20, marginBottom: 10 },
  sectionSubtext: { fontSize: 11, lineHeight: 14, marginTop: 6, paddingHorizontal: 2 },
  defaultBadge: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 3,
    marginTop: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 8,
  },
  defaultBadgeText: { fontSize: 10 },
  menuTrigger: { marginLeft: 8 },
  menuTriggerHit: { padding: 4 },
  addAccountRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
  },
  addAccountText: { fontSize: 15 },
  filterOption: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: 14,
    gap: 12,
  },
  filterOptionIconWell: {
    width: 32,
    height: 32,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  filterOptionBody: { flex: 1, gap: 3 },
  filterOptionLabel: { fontSize: 15, lineHeight: 20 },
  filterOptionDesc: { fontSize: 13, lineHeight: 18 },
  radio: {
    width: 20,
    height: 20,
    marginTop: 2,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  card: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
});
