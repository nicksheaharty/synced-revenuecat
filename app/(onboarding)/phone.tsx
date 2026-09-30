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
import { sendVerificationCode } from "../../services/firebase";

export default function PhoneScreen() {
  const router = useRouter();
  const theme = useTheme();
  const [phone, setPhone] = useState("");
  const [sending, setSending] = useState(false);
  const inputRef = useRef<TextInput>(null);

  const formatted = formatPhone(phone);
  const isValid = phone.replace(/\D/g, "").length === 10;

  const handleContinue = async () => {
    if (!isValid || sending) return;
    setSending(true);

    const rawDigits = phone.replace(/\D/g, "");
    const e164Phone = `+1${rawDigits}`;

    try {
      await sendVerificationCode(e164Phone);
      router.push({
        pathname: "/(onboarding)/verify",
        params: { phone: formatted },
      });
    } catch (error: any) {
      console.error("[PhoneScreen] sendVerificationCode error:", error);
      Alert.alert(
        "Verification Failed",
        error.message ||
          "Failed to send verification code. Please check your phone number and try again.",
      );
    } finally {
      setSending(false);
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
          <Text
            style={[
              styles.title,
              { color: theme.surface, fontFamily: "MackinacPro_700Bold" },
            ]}
          >
            Your number
          </Text>
          <Text
            style={[
              styles.subtitle,
              { color: theme.muted, fontFamily: "Inter_400Regular" },
            ]}
          >
            We'll send a verification code to confirm your identity.
          </Text>

          {/* Phone input row */}
          <Pressable
            style={[
              styles.inputCard,
              { backgroundColor: theme.card, borderColor: theme.cardBorder },
            ]}
            onPress={() => inputRef.current?.focus()}
          >
            {/* Country flag/code */}
            <View
              style={[
                styles.countryChip,
                { borderRightColor: theme.separator },
              ]}
            >
              <Text style={styles.flag}>🇺🇸</Text>
              <Text
                style={[
                  styles.dialCode,
                  { color: theme.surface, fontFamily: "Inter_500Medium" },
                ]}
              >
                +1
              </Text>
            </View>

            <TextInput
              ref={inputRef}
              style={[
                styles.phoneInput,
                { color: theme.surface, fontFamily: "Inter_400Regular" },
              ]}
              value={formatted}
              onChangeText={(t) => setPhone(t.replace(/\D/g, "").slice(0, 10))}
              placeholder="(555) 000-0000"
              placeholderTextColor={theme.muted}
              keyboardType="phone-pad"
              returnKeyType="done"
              onSubmitEditing={handleContinue}
              autoFocus
            />
          </Pressable>

          <Text
            style={[
              styles.hint,
              { color: theme.muted, fontFamily: "Inter_400Regular" },
            ]}
          >
            Standard messaging rates may apply.
          </Text>
        </View>

        <View style={styles.bottom}>
          <Pressable
            style={[
              styles.primaryBtn,
              {
                backgroundColor:
                  isValid && !sending ? theme.primary : theme.separator,
              },
            ]}
            onPress={handleContinue}
            disabled={!isValid || sending}
          >
            {sending ? (
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
                Send Code
              </Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function formatPhone(digits: string): string {
  if (digits.length === 0) return "";
  if (digits.length <= 3) return `(${digits}`;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  inner: { flex: 1 },
  content: { flex: 1, paddingHorizontal: 28, paddingTop: 28 },
  step: {
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 1.2,
    marginBottom: 8,
  },
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
  countryChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 16,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  flag: { fontSize: 20 },
  dialCode: { fontSize: 16 },
  phoneInput: {
    flex: 1,
    fontSize: 18,
    paddingHorizontal: 14,
    paddingVertical: 16,
  },
  hint: { fontSize: 12, marginTop: 12 },
  bottom: { paddingHorizontal: 28, paddingBottom: 32 },
  primaryBtn: {
    height: 54,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  primaryBtnText: { color: "#FFFFFF", fontSize: 17 },
});
