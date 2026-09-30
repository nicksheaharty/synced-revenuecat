import { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Pressable,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "../hooks/useTheme";
import {
  saveProfile,
  saveMessage,
  getProfiles,
  Profile,
  generateRandomId,
  deriveInitials,
} from "../services/storage";
import { lookupContactByPhone } from "../services/contacts";
import { Lightning } from "phosphor-react-native";

export default function ReceiveMessageScreen() {
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{
    text?: string;
    sender?: string;
    source?: string;
  }>();

  const [status, setStatus] = useState<"analyzing" | "done" | "error">(
    "analyzing",
  );

  useEffect(() => {
    const text = params.text ?? "";
    const sender = params.sender ?? "Unknown";
    const source = (params.source as Profile["source"]) ?? "imessage";

    if (!text) {
      setStatus("error");
      return;
    }

    const run = async () => {
      try {
        // If sender looks like a phone number, resolve to contact name
        const isPhone =
          /^[+\d\s\-().]{7,}$/.test(sender.trim()) &&
          /\d{7,}/.test(sender.replace(/\D/g, ""));
        let resolvedSender = sender;
        if (isPhone) {
          const match = await lookupContactByPhone(sender);
          if (match?.name) resolvedSender = match.name;
        }

        const allProfiles = await getProfiles();
        const existing = allProfiles.find(
          (p) =>
            p.name.toLowerCase() === resolvedSender.toLowerCase() &&
            p.source === source,
        );

        const profileId = existing?.id ?? generateRandomId("profile");
        const now = new Date().toISOString();
        const profile: Profile = {
          id: profileId,
          userId: existing?.userId ?? "dev_user",
          name: resolvedSender,
          senderInitial: deriveInitials(resolvedSender),
          source,
          platformIdentifier:
            source === "gmail"
              ? `${resolvedSender.toLowerCase().replace(/\s+/g, "")}@gmail.com`
              : sender,
          analyzed: false,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        };

        await saveProfile(profile);
        await saveMessage({
          id: generateRandomId("msg"),
          profileId,
          userId: profile.userId,
          direction: "in",
          text,
          timestamp: now,
          createdAt: now,
        });
        setStatus("done");
      } catch (error) {
        console.error(
          "[ReceiveMessage] Error processing incoming webhook message:",
          error,
        );
        setStatus("error");
      }
    };

    run();
  }, []);

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: theme.background }]}
    >
      <View style={styles.content}>
        <View style={[styles.iconCircle, { backgroundColor: theme.primary }]}>
          <Lightning size={32} color="#FFFFFF" weight="duotone" />
        </View>

        <Text
          style={[
            styles.title,
            { color: theme.surface, fontFamily: "MackinacPro_700Bold" },
          ]}
        >
          {status === "analyzing"
            ? "Syncing Message..."
            : status === "done"
              ? "Message Synced"
              : "Something went wrong"}
        </Text>

        {status === "analyzing" && (
          <>
            <ActivityIndicator
              color={theme.primary}
              size="large"
              style={{ marginTop: 24 }}
            />
            <Text
              style={[
                styles.sub,
                { color: theme.muted, fontFamily: "Inter_400Regular" },
              ]}
            >
              Adding message to your queue
            </Text>
          </>
        )}

        {status === "done" && (
          <>
            <Text
              style={[
                styles.sub,
                {
                  color: theme.muted,
                  fontFamily: "Inter_400Regular",
                  textAlign: "center",
                  paddingHorizontal: 20,
                },
              ]}
            >
              Successfully synced message from {params.sender || "sender"}.
              Action planning is starting in the background.
            </Text>
          </>
        )}

        {status === "error" && (
          <Text
            style={[
              styles.sub,
              { color: theme.muted, fontFamily: "Inter_400Regular" },
            ]}
          >
            Make sure to pass ?text=...&sender=... in the URL
          </Text>
        )}

        {status !== "analyzing" && (
          <Pressable
            style={[styles.btn, { backgroundColor: theme.primary }]}
            onPress={() => router.replace("/(main)/home")}
          >
            <Text style={[styles.btnText, { fontFamily: "Inter_600SemiBold" }]}>
              View in Synced
            </Text>
          </Pressable>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    flex: 1,
    alignItems: "center",
    paddingHorizontal: 28,
    paddingTop: 60,
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 20,
    shadowColor: "#4429F2",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 14,
  },
  title: {
    fontSize: 26,
    textAlign: "center",
    marginBottom: 8,
    letterSpacing: -0.3,
  },
  sub: { fontSize: 15, textAlign: "center", marginTop: 8 },
  actionList: { width: "100%", marginTop: 28, gap: 10 },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    gap: 12,
  },
  actionLabel: { fontSize: 14 },
  actionDetail: { fontSize: 12, marginTop: 2 },
  btn: {
    marginTop: 32,
    width: "100%",
    height: 52,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#4429F2",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
  },
  btnText: { color: "#FFF", fontSize: 16 },
});
