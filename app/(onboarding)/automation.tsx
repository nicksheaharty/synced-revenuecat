import { useState } from "react";
import { View, Text, StyleSheet, Pressable, Switch } from "react-native";
import { useRouter } from "expo-router";
import { useTheme } from "../../hooks/useTheme";
import { SafeAreaView } from "react-native-safe-area-context";
import { setOnboardingComplete } from "../../services/storage";
import { Lightning, Bell, MagicWand, List } from "phosphor-react-native";

interface AutoSetting {
  id: string;
  label: string;
  desc: string;
  Icon: React.ComponentType<any>;
  enabled: boolean;
}

const DEFAULTS: AutoSetting[] = [
  {
    id: "auto_analyze",
    label: "Auto-analyze messages",
    desc: "AI creates action plans on arrival",
    Icon: Lightning,
    enabled: true,
  },
  {
    id: "high_priority",
    label: "High priority alerts",
    desc: "Notify for urgent messages only",
    Icon: Bell,
    enabled: true,
  },
  {
    id: "shortcuts",
    label: "Siri Shortcuts",
    desc: 'Enable "Receive Message" shortcut',
    Icon: MagicWand,
    enabled: true,
  },
  {
    id: "batch",
    label: "Batch digests",
    desc: "Daily summary of all pending actions",
    Icon: List,
    enabled: false,
  },
];

export default function AutomationScreen() {
  const router = useRouter();
  const theme = useTheme();
  const [settings, setSettings] = useState<AutoSetting[]>(DEFAULTS);

  const toggle = (id: string) => {
    setSettings((prev) =>
      prev.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s)),
    );
  };

  const handleDone = async () => {
    await setOnboardingComplete();
    router.replace("/(main)/home");
  };

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: theme.background }]}
    >
      <View style={styles.header}>
        <Text
          style={[
            styles.step,
            { color: theme.primary, fontFamily: "Inter_600SemiBold" },
          ]}
        >
          Step 2 of 2
        </Text>
        <Text
          style={[
            styles.title,
            { color: theme.surface, fontFamily: "MackinacPro_700Bold" },
          ]}
        >
          Setup Automation
        </Text>
        <Text
          style={[
            styles.subtitle,
            { color: theme.muted, fontFamily: "Inter_400Regular" },
          ]}
        >
          Customize how the app works in the background for you.
        </Text>
      </View>

      <View style={styles.list}>
        {settings.map(({ id, label, desc, Icon, enabled }) => (
          <View
            key={id}
            style={[
              styles.card,
              { backgroundColor: theme.card, borderColor: theme.cardBorder },
            ]}
          >
            <View
              style={[styles.iconCircle, { backgroundColor: theme.actionBg }]}
            >
              <Icon size={22} color={theme.primary} weight="duotone" />
            </View>
            <View style={styles.cardText}>
              <Text
                style={[
                  styles.cardLabel,
                  { color: theme.surface, fontFamily: "Inter_600SemiBold" },
                ]}
              >
                {label}
              </Text>
              <Text
                style={[
                  styles.cardDesc,
                  { color: theme.muted, fontFamily: "Inter_400Regular" },
                ]}
              >
                {desc}
              </Text>
            </View>
            <Switch
              value={enabled}
              onValueChange={() => toggle(id)}
              trackColor={{ false: theme.separator, true: theme.primary }}
              thumbColor="#FFFFFF"
            />
          </View>
        ))}
      </View>

      <View
        style={[
          styles.infoBox,
          { backgroundColor: theme.actionBg, borderColor: theme.actionBorder },
        ]}
      >
        <MagicWand
          size={16}
          color={theme.primary}
          weight="duotone"
          style={{ marginTop: 1 }}
        />
        <Text
          style={[
            styles.infoText,
            { color: theme.surface, fontFamily: "Inter_400Regular" },
          ]}
        >
          The{" "}
          <Text style={{ fontFamily: "Inter_600SemiBold" }}>
            Receive Message
          </Text>{" "}
          shortcut lets Siri send any message directly into the app for instant
          AI analysis.
        </Text>
      </View>

      <View style={styles.bottom}>
        <Pressable
          style={[styles.primaryBtn, { backgroundColor: theme.primary }]}
          onPress={handleDone}
        >
          <Text
            style={[styles.primaryBtnText, { fontFamily: "Inter_600SemiBold" }]}
          >
            Get Started
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 28, paddingTop: 20, paddingBottom: 24 },
  step: {
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 1.2,
    marginBottom: 8,
  },
  title: { fontSize: 30, marginBottom: 10, letterSpacing: -0.3 },
  subtitle: { fontSize: 15, lineHeight: 22 },
  list: { paddingHorizontal: 20, gap: 10 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 14,
  },
  cardText: { flex: 1, marginRight: 8 },
  cardLabel: { fontSize: 15, marginBottom: 2 },
  cardDesc: { fontSize: 12 },
  infoBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    marginHorizontal: 20,
    marginTop: 16,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  infoText: { fontSize: 13, lineHeight: 19, flex: 1 },
  bottom: { paddingHorizontal: 28, paddingBottom: 32, paddingTop: 16 },
  primaryBtn: {
    height: 54,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  primaryBtnText: { color: "#FFFFFF", fontSize: 17 },
});
