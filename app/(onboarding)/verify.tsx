import { useState, useRef, useEffect } from "react";
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
import { useRouter, useLocalSearchParams } from "expo-router";
import { useTheme } from "../../hooks/useTheme";
import { SafeAreaView } from "react-native-safe-area-context";
import { ArrowLeft } from "phosphor-react-native";
import { confirmCode, resendCode, getAppUser } from "../../services/firebase";
import {
  getUserDoc,
  hasAnyConnections,
  setOnboardingComplete,
} from "../../services/storage";

export default function VerifyScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { phone } = useLocalSearchParams<{ phone: string }>();
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [resendTimer, setResendTimer] = useState(30);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (resendTimer > 0) {
      const interval = setInterval(() => {
        setResendTimer((t) => t - 1);
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [resendTimer]);

  const handleVerify = async (val = code) => {
    if (val.length < 6 || verifying) return;
    setVerifying(true);
    try {
      await confirmCode(val);

      const appUser = getAppUser();
      let hasName = false;
      if (appUser) {
        const uDoc = await getUserDoc(appUser.uid);
        if (uDoc?.fullName) {
          hasName = true;
        }
      }

      setVerifying(false);
      if (hasName) {
        const hasConn = await hasAnyConnections();
        if (!hasConn) {
          router.push("/(onboarding)/connectors");
        } else {
          await setOnboardingComplete();
          router.replace("/(main)/home");
        }
      } else {
        router.push("/(onboarding)/name");
      }
    } catch (error: any) {
      console.error("[VerifyScreen] Verification failed:", error);
      setVerifying(false);
      setCode(""); // Reset entered code on failure
      Alert.alert(
        "Verification Failed",
        error.message ||
          "The verification code entered is invalid. Please try again.",
      );
    }
  };

  const handleChangeText = (text: string) => {
    const cleanText = text.replace(/\D/g, "").slice(0, 6);
    setCode(cleanText);
    if (cleanText.length === 6) {
      handleVerify(cleanText);
    }
  };

  const handleResend = async () => {
    if (resendTimer > 0) return;
    try {
      await resendCode();
      setResendTimer(30);
      Alert.alert("Code Sent", "A new verification code has been sent.");
    } catch (error: any) {
      console.error("[VerifyScreen] resend error:", error);
      Alert.alert(
        "Resend Failed",
        error.message ||
          "Failed to resend verification code. Please try again.",
      );
    }
  };

  const cells = Array(6).fill(0);

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
            Enter Code
          </Text>
          <Text
            style={[
              styles.subtitle,
              { color: theme.muted, fontFamily: "Inter_400Regular" },
            ]}
          >
            We've sent a 6-digit verification code to{"\n"}
            <Text
              style={{ color: theme.surface, fontFamily: "Inter_600SemiBold" }}
            >
              {phone || "your phone"}
            </Text>
            .
          </Text>

          {/* Hidden input to control keyboard entry */}
          <TextInput
            ref={inputRef}
            style={styles.hiddenInput}
            value={code}
            onChangeText={handleChangeText}
            keyboardType="number-pad"
            maxLength={6}
            autoFocus
          />

          {/* Visible Code Entry Boxes */}
          <Pressable
            style={styles.codeContainer}
            onPress={() => inputRef.current?.focus()}
          >
            {cells.map((_, index) => {
              const char = code[index] || "";
              const isFocused = code.length === index;
              return (
                <View
                  key={index}
                  style={[
                    styles.codeBox,
                    {
                      backgroundColor: theme.card,
                      borderColor: isFocused ? theme.primary : theme.cardBorder,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.codeText,
                      { color: theme.surface, fontFamily: "Inter_600SemiBold" },
                    ]}
                  >
                    {char}
                  </Text>
                  {isFocused && (
                    <View
                      style={[
                        styles.cursor,
                        { backgroundColor: theme.primary },
                      ]}
                    />
                  )}
                </View>
              );
            })}
          </Pressable>

          <View style={styles.resendContainer}>
            {resendTimer > 0 ? (
              <Text
                style={[
                  styles.resendText,
                  { color: theme.muted, fontFamily: "Inter_400Regular" },
                ]}
              >
                Resend code in {resendTimer}s
              </Text>
            ) : (
              <Pressable onPress={handleResend}>
                <Text
                  style={[
                    styles.resendLink,
                    { color: theme.primary, fontFamily: "Inter_600SemiBold" },
                  ]}
                >
                  Resend code
                </Text>
              </Pressable>
            )}
          </View>
        </View>

        <View style={styles.bottom}>
          <Pressable
            style={[
              styles.primaryBtn,
              {
                backgroundColor:
                  code.length === 6 ? theme.primary : theme.separator,
              },
            ]}
            onPress={() => handleVerify()}
            disabled={code.length < 6 || verifying}
          >
            {verifying ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text
                style={[
                  styles.primaryBtnText,
                  {
                    fontFamily: "Inter_600SemiBold",
                    opacity: code.length === 6 ? 1 : 0.5,
                  },
                ]}
              >
                Verify & Continue
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
  step: {
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 1.2,
    marginBottom: 8,
  },
  title: { fontSize: 34, marginBottom: 10, letterSpacing: -0.5 },
  subtitle: { fontSize: 15, lineHeight: 22, marginBottom: 32 },
  hiddenInput: {
    position: "absolute",
    width: 0,
    height: 0,
    opacity: 0,
  },
  codeContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 24,
  },
  codeBox: {
    flex: 1,
    height: 58,
    borderRadius: 12,
    borderWidth: 1.5,
    justifyContent: "center",
    alignItems: "center",
    position: "relative",
  },
  codeText: {
    fontSize: 22,
  },
  cursor: {
    position: "absolute",
    bottom: 12,
    width: 14,
    height: 2,
    borderRadius: 1,
  },
  resendContainer: {
    alignItems: "center",
    marginTop: 16,
  },
  resendText: {
    fontSize: 14,
  },
  resendLink: {
    fontSize: 14,
    textDecorationLine: "underline",
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
