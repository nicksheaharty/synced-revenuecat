import { useEffect, useRef } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { BottomSheetModal, BottomSheetView } from "@expo/ui/community/bottom-sheet";
import { MagnifyingGlass, ShieldCheck, ArrowSquareOut } from "phosphor-react-native";
import { useTheme } from "../hooks/useTheme";
import { useColorScheme } from "../hooks/useColorScheme";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CONNECTOR_META } from "../constants/connectorMeta";

// Shown before the OAuth flow for any connector — splits what the agent
// gets access to into two honest buckets, grounded in how the backend
// actually behaves rather than generic scope-name copy:
//   - "automatic" = read/context-gathering the agent does on its own
//     (matches the read-oriented scopes each provider requests in
//     services/oauth.ts, e.g. gmail.readonly, Mail.Read, im:history).
//   - "always asks first" = anything that sends/creates something on the
//     user's behalf. This isn't just a UI promise — every one of these
//     goes through request_human_input's structural approval gate before
//     the corresponding send/create tool call is allowed to run (see
//     functions/src/langchain/deep-agent-loop.ts's emailApproved/
//     calendarApproved gates and loop-guards.ts) — the agent CANNOT send
//     without it, this isn't a policy that could be silently skipped.
export interface ConnectPermissionsCopy {
  label: string;
  automatic: string[];
  alwaysPrompts: string[];
}

export const CONNECT_PERMISSIONS: Record<string, ConnectPermissionsCopy> = {
  gmail: {
    label: "Gmail",
    automatic: ["Read your inbox to understand context", "Search past emails when relevant to a task", "Read your contacts to identify senders"],
    alwaysPrompts: ["Sending any email on your behalf", "Creating or changing calendar events"],
  },
  calendar: {
    label: "Gmail",
    automatic: ["Read your inbox to understand context", "Search past emails when relevant to a task", "Read your contacts to identify senders"],
    alwaysPrompts: ["Sending any email on your behalf", "Creating or changing calendar events"],
  },
  outlook: {
    label: "Outlook",
    automatic: ["Read your inbox to understand context", "Search past emails when relevant to a task", "Read your calendar to check availability"],
    alwaysPrompts: ["Sending any email on your behalf", "Creating or changing calendar events"],
  },
  drive: {
    label: "Google Drive",
    automatic: ["Search your files when relevant to a task", "Read file contents to use in a document"],
    alwaysPrompts: [],
  },
  onedrive: {
    label: "OneDrive",
    automatic: ["Search your files when relevant to a task", "Read file contents to use in a document"],
    alwaysPrompts: [],
  },
  slack: {
    label: "Slack",
    automatic: ["Read your direct messages to understand context", "Search past DMs when relevant to a task"],
    alwaysPrompts: ["Sending any Slack message on your behalf"],
  },
  teams: {
    label: "Microsoft Teams",
    automatic: ["Read your chats to understand context", "Search past chats when relevant to a task"],
    alwaysPrompts: ["Sending any Teams message on your behalf"],
  },
};

export function ConnectPermissionsSheet({
  connectorId,
  isPresented,
  onClose,
  onConfirm,
}: {
  connectorId: string | null;
  isPresented: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const theme = useTheme();
  const scheme = useColorScheme();
  const insets = useSafeAreaInsets();
  const sheetRef = useRef<any>(null);
  const copy = connectorId ? CONNECT_PERMISSIONS[connectorId] : undefined;
  const meta = connectorId ? CONNECTOR_META[connectorId] : undefined;
  const iconColor = meta ? (typeof meta.color === "function" ? meta.color(scheme) : meta.color) : theme.primary;

  useEffect(() => {
    if (isPresented) {
      sheetRef.current?.present();
    } else {
      sheetRef.current?.dismiss();
    }
  }, [isPresented]);

  if (!copy) return null;

  return (
    <BottomSheetModal ref={sheetRef} enablePanDownToClose onDismiss={onClose}>
      <BottomSheetView>
        <View style={styles.container}>
          <View style={styles.headerRow}>
            {meta && (
              <View style={[styles.connectorIconWell, { backgroundColor: iconColor + "20" }]}>
                <meta.Icon size={24} color={iconColor} weight="duotone" />
              </View>
            )}
            <View style={styles.headerText}>
              <Text
                style={[
                  styles.title,
                  { color: theme.surface, fontFamily: "MackinacPro_700Bold" },
                ]}
              >
                {copy.label}
              </Text>
              <Text
                style={[
                  styles.subtitle,
                  { color: theme.muted, fontFamily: "Inter_400Regular" },
                ]}
              >
                Request Permissions
              </Text>
            </View>
          </View>

          <View style={styles.sectionHeader}>
            <View style={[styles.iconWell, { backgroundColor: theme.actionBg }]}>
              <MagnifyingGlass size={16} color={theme.primary} weight="bold" />
            </View>
            <Text style={[styles.sectionTitle, { color: theme.surface, fontFamily: "Inter_600SemiBold" }]}>
              Used Automatically in Discovery
            </Text>
          </View>
          <View style={styles.itemGroup}>
            {copy.automatic.map((item, i) => (
              <View
                key={i}
                style={[styles.itemBox, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}
              >
                <Text style={[styles.itemText, { color: theme.surface, fontFamily: "Inter_400Regular" }]}>
                  {item}
                </Text>
              </View>
            ))}
          </View>

          {copy.alwaysPrompts.length > 0 && (
            <>
              <View style={styles.sectionHeader}>
                <View style={[styles.iconWell, { backgroundColor: theme.actionBg }]}>
                  <ShieldCheck size={16} color={theme.primary} weight="bold" />
                </View>
                <Text style={[styles.sectionTitle, { color: theme.surface, fontFamily: "Inter_600SemiBold" }]}>
                  Needs Your Direct Approval
                </Text>
              </View>
              <View style={styles.itemGroup}>
                {copy.alwaysPrompts.map((item, i) => (
                  <View
                    key={i}
                    style={[styles.itemBox, { backgroundColor: theme.actionBg, borderColor: theme.actionBorder }]}
                  >
                    <Text style={[styles.itemText, { color: theme.surface, fontFamily: "Inter_400Regular" }]}>
                      {item}
                    </Text>
                  </View>
                ))}
              </View>
            </>
          )}

          <Pressable
            onPress={() => {
              onConfirm();
              onClose();
            }}
            style={({ pressed }) => [
              styles.connectBtn,
              { backgroundColor: theme.primary, opacity: pressed ? 0.8 : 1, marginBottom: Math.max(insets.bottom, 16) },
            ]}
          >
            <View style={styles.connectBtnContent}>
              <Text style={[styles.connectBtnText, { fontFamily: "Inter_600SemiBold" }]}>
                Connect {copy.label}
              </Text>
              <ArrowSquareOut size={18} color="#FFF" weight="bold" />
            </View>
          </Pressable>
        </View>
      </BottomSheetView>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 20, paddingTop: 8 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 24 },
  connectorIconWell: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  headerText: { flex: 1 },
  title: { fontSize: 24, letterSpacing: -0.3 },
  subtitle: { fontSize: 13, marginTop: 2 },
  itemGroup: { gap: 8, marginBottom: 24 },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  iconWell: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionTitle: { fontSize: 15 },
  itemBox: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  itemText: { fontSize: 13, lineHeight: 18 },
  connectBtn: {
    height: 54,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 4,
  },
  connectBtnContent: { flexDirection: "row", alignItems: "center", gap: 8 },
  connectBtnText: { color: "#FFF", fontSize: 17 },
});
