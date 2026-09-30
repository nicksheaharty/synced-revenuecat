import { View, Text, StyleSheet, Pressable, Image } from "react-native";
import { useRouter } from "expo-router";
import { useTheme } from "../../hooks/useTheme";
import { useColorScheme } from "../../hooks/useColorScheme";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  ChatCircle,
  Lightning,
  CheckCircle,
  CheckSquare,
} from "phosphor-react-native";

const FEATURES = [
  {
    Icon: ChatCircle,
    title: "Capture every message",
    desc: "From Gmail, Outlook, Slack & more",
  },
  {
    Icon: Lightning,
    title: "Action Plans",
    desc: "AI turns texts into to-dos",
  },
  {
    Icon: CheckSquare,
    title: "Human to-dos",
    desc: "Get tasks delegated to you directly from chats",
  },
  {
    Icon: CheckCircle,
    title: "Never miss a beat",
    desc: "Stay on top of what matters",
  },
];

export default function WelcomeScreen() {
  const router = useRouter();
  const theme = useTheme();
  const scheme = useColorScheme();

  const logoSource =
    scheme === "dark"
      ? require("../../assets/logos/justlogo-dark.png")
      : require("../../assets/logos/justlogo-light.png");

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: theme.background }]}
    >
      <View style={styles.content}>
        <View style={styles.logoArea}>
          <Image
            source={require("../../assets/logos/logo3d.png")}
            style={styles.logo3d}
            resizeMode="contain"
          />
          <Image
            source={logoSource}
            style={styles.logoWordmark}
            resizeMode="contain"
          />
          <Text
            style={[
              styles.tagline,
              { color: theme.muted, fontFamily: "Inter_400Regular" },
            ]}
          >
            Turn messages into momentum
          </Text>
        </View>

        <View style={styles.features}>
          {FEATURES.map(({ Icon, title, desc }, i) => (
            <View
              key={i}
              style={[styles.featureRow, { borderColor: theme.separator }]}
            >
              <View
                style={[
                  styles.featureIconWrap,
                  { backgroundColor: theme.actionBg },
                ]}
              >
                <Icon size={22} color={theme.primary} weight="duotone" />
              </View>
              <View style={styles.featureText}>
                <Text
                  style={[
                    styles.featureTitle,
                    { color: theme.surface, fontFamily: "Inter_600SemiBold" },
                  ]}
                >
                  {title}
                </Text>
                <Text
                  style={[
                    styles.featureDesc,
                    { color: theme.muted, fontFamily: "Inter_400Regular" },
                  ]}
                >
                  {desc}
                </Text>
              </View>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.bottom}>
        <Pressable
          style={[styles.primaryBtn, { backgroundColor: theme.primary }]}
          onPress={() => router.push("/(onboarding)/phone")}
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
  content: { flex: 1, paddingHorizontal: 28, paddingTop: 32 },
  logoArea: { alignItems: "center", marginBottom: 52 },
  logo3d: {
    width: 100,
    height: 100,
    marginBottom: 12,
  },
  logoWordmark: {
    width: 140,
    height: 36,
    marginBottom: 8,
  },
  tagline: { fontSize: 16, textAlign: "center" },
  features: { gap: 0 },
  featureRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 14,
  },
  featureIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  featureText: { flex: 1 },
  featureTitle: { fontSize: 15, marginBottom: 2 },
  featureDesc: { fontSize: 13 },
  bottom: { paddingHorizontal: 28, paddingBottom: 32 },
  primaryBtn: {
    height: 54,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  primaryBtnText: { color: "#FFFFFF", fontSize: 17 },
});
