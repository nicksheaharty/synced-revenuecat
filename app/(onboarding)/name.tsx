import { useState, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { useTheme } from "../../hooks/useTheme";
import { SafeAreaView } from "react-native-safe-area-context";
import { ArrowLeft } from "phosphor-react-native";
import { getAppUser } from "../../services/firebase";
import {
  saveUserFullName,
  hasAnyConnections,
  setOnboardingComplete,
} from "../../services/storage";

export default function NameScreen() {
  const router = useRouter();
  const theme = useTheme();
  const [fullName, setFullName] = useState("");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<TextInput>(null);

  const isValid = fullName.trim().length >= 2;

  const handleContinue = async () => {
    if (!isValid || saving) return;
    setSaving(true);

    try {
      const appUser = getAppUser();
      if (!appUser) {
        throw new Error("You must be logged in to save your name.");
      }

      await saveUserFullName(appUser.uid, fullName.trim());

      // Only ask for connections if the user has no connections
      const hasConn = await hasAnyConnections();
      if (!hasConn) {
        router.push("/(onboarding)/connectors");
      } else {
        // Onboarding complete
        await setOnboardingComplete();
        router.replace("/(main)/home");
      }
    } catch (error: any) {
      console.error("[NameScreen] Save name error:", error);
      Alert.alert(
        "Failed to Save Name",
        error.message ||
          "An error occurred while saving your name. Please try again.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: theme.background }]}
    >
      <KeyboardAvoidingView
        style={styles.inner}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View style={styles.content}>
          <View style={styles.topBar}>
            <Pressable onPress={() => router.back()} style={styles.backBtn}>
              <ArrowLeft size={24} color={theme.surface} />
            </Pressable>
          </View>

          <Text
            style={[
              styles.title,
              { color: theme.surface, fontFamily: "MackinacPro_700Bold" },
            ]}
          >
            Your name
          </Text>
          <Text
            style={[
              styles.subtitle,
              { color: theme.muted, fontFamily: "Inter_400Regular" },
            ]}
          >
            Enter your full name so your AI agent knows what to call you.
          </Text>

          {/* Full Name input row */}
          <Pressable
            style={[
              styles.inputCard,
              { backgroundColor: theme.card, borderColor: theme.cardBorder },
            ]}
            onPress={() => inputRef.current?.focus()}
          >
            <TextInput
              ref={inputRef}
              style={[
                styles.nameInput,
                { color: theme.surface, fontFamily: "Inter_400Regular" },
              ]}
              value={fullName}
              onChangeText={setFullName}
              placeholder="First Last"
              placeholderTextColor={theme.muted}
              autoCapitalize="words"
              autoComplete="name"
              returnKeyType="done"
              onSubmitEditing={handleContinue}
              autoFocus
            />
          </Pressable>
        </View>

        <View style={styles.bottom}>
          <Pressable
            style={[
              styles.primaryBtn,
              {
                backgroundColor:
                  isValid && !saving ? theme.primary : theme.separator,
              },
            ]}
            onPress={handleContinue}
            disabled={!isValid || saving}
          >
            {saving ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text
                style={[
                  styles.primaryBtnText,
                  {
                    fontFamily: "Inter_600SemiBold",
                    opacity: isValid ? 1 : 0.5,
                  },
                ]}
              >
                Continue
              </Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  inner: { flex: 1 },
  content: { flex: 1, paddingHorizontal: 28, paddingTop: 8 },
  topBar: {
    height: 44,
    justifyContent: "center",
    marginLeft: -8,
    marginBottom: 12,
  },
  backBtn: { padding: 8 },
  title: { fontSize: 34, marginBottom: 10, letterSpacing: -0.5 },
  subtitle: { fontSize: 15, lineHeight: 22, marginBottom: 32 },
  inputCard: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    height: 58,
  },
  nameInput: {
    flex: 1,
    fontSize: 18,
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  bottom: { paddingHorizontal: 28, paddingBottom: 32 },
  primaryBtn: {
    height: 54,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  primaryBtnText: { color: "#FFFFFF", fontSize: 17 },
});
