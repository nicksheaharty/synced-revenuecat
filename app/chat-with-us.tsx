import { useCallback } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import {
  CaretLeft,
  CaretRight,
  ChatCircle,
  WhatsappLogo,
  SlackLogo,
  MicrosoftTeamsLogo,
  DiscordLogo,
  MessengerLogo,
  TelegramLogo,
} from "phosphor-react-native";
import { useTheme } from "../hooks/useTheme";
import { initiateSlackBotVerification } from "../services/oauth";

// Same shape as settings.tsx's CONNECTOR_META, scoped to just the platforms
// shown on this page — kept as an independent copy rather than importing
// from settings.tsx (that file doesn't export it, and this page's list is a
// deliberately different subset/order from the main Settings connectors).
// Slack is first: it's the only platform actually wired up (chatbot/, a
// Chat SDK-based Slack bot backed by the SAME agent) — everything else here
// is still "Coming Soon".
const AGENT_PLATFORMS: { id: string; label: string; Icon: React.ComponentType<any>; color: string }[] = [
  { id: "slack", label: "Slack", Icon: SlackLogo, color: "#E01E5A" },
  { id: "imessage", label: "iMessage", Icon: ChatCircle, color: "#30D158" },
  { id: "whatsapp", label: "WhatsApp", Icon: WhatsappLogo, color: "#25D366" },
  { id: "teams", label: "Teams", Icon: MicrosoftTeamsLogo, color: "#6264A7" },
  { id: "discord", label: "Discord", Icon: DiscordLogo, color: "#5865F2" },
  { id: "messenger", label: "Messenger", Icon: MessengerLogo, color: "#00B2FF" },
  { id: "telegram", label: "Telegram", Icon: TelegramLogo, color: "#26A5E4" },
];

export default function ChatWithUsScreen() {
  const theme = useTheme();
  const router = useRouter();

  const handleBack = useCallback(() => {
    router.canGoBack() ? router.back() : router.replace("/(main)/settings");
  }, [router]);

  // Deliberately a PERMANENT setup action, not a one-time connect/disconnect
  // toggle: the Slack bot gets installed per-workspace, and there's no way
  // to remove/reconnect it from here, so the row must always stay
  // "Verify Account" / "Add to Server" rather than ever flipping to a
  // single "Chat" state — re-running this flow is exactly how a user adds
  // the bot to a SECOND (or third...) Slack workspace. On success,
  // initiateSlackBotVerification's own OAuth redirect handles opening
  // Slack for that workspace; nothing else needed here.
  const handleSlackVerify = useCallback(async () => {
    try {
      const res = await initiateSlackBotVerification();
      if (!res.success && res.error) {
        Alert.alert("Verification Failed", res.error);
      }
    } catch (e: any) {
      Alert.alert("Error", e.message || "Failed to verify your Slack account.");
    }
  }, []);

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
          Chat With Us
        </Text>
        <View style={styles.navSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <Text style={[styles.sectionLabel, { color: theme.muted, fontFamily: "Inter_600SemiBold" }]}>
          PLATFORMS
        </Text>
        <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
          {AGENT_PLATFORMS.map(({ id, label, Icon, color }, i) => {
            const isLast = i === AGENT_PLATFORMS.length - 1;
            const isSlack = id === "slack";
            const rowStyle = [
              styles.row,
              !isLast && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.separator },
              !isSlack && { opacity: 0.6 },
            ];

            const content = (
              <View style={rowStyle}>
                <View style={styles.rowLeft}>
                  <View style={[styles.connectorIcon, { backgroundColor: color + "20" }]}>
                    <View style={styles.iconBox}>
                      <Icon size={18} color={color} weight="duotone" />
                    </View>
                  </View>
                  <Text style={[styles.rowLabel, { color: theme.surface, fontFamily: "Inter_400Regular" }]}>
                    {label}
                  </Text>
                </View>
                {isSlack ? (
                  <View style={styles.statusRow}>
                    <Text style={[styles.statusText, { color: theme.muted, fontFamily: "Inter_400Regular" }]}>
                      Add to Server
                    </Text>
                    <CaretRight size={14} color={theme.muted} weight="bold" />
                  </View>
                ) : (
                  <Text style={[styles.comingSoonText, { color: theme.muted, fontFamily: "Inter_500Medium" }]}>
                    Coming Soon
                  </Text>
                )}
              </View>
            );

            if (!isSlack) {
              return <View key={id}>{content}</View>;
            }

            return (
              <Pressable
                key={id}
                onPress={handleSlackVerify}
                style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
              >
                {content}
              </Pressable>
            );
          })}
        </View>
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
  navSpacer: { minWidth: 80 },
  scrollContent: { padding: 20, paddingBottom: 60, gap: 4 },
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
    paddingVertical: 12,
  },
  rowLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
  rowLabel: { fontSize: 15 },
  connectorIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  iconBox: {
    width: 20,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  comingSoonText: { fontSize: 13 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  statusText: { fontSize: 13 },
});
