import { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  TextInput,
  ActivityIndicator,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import {
  X,
  Shield,
  Check,
  User,
  CaretRight,
  ShieldWarning,
} from "phosphor-react-native";
import { saveSimulatedGmailConnection } from "../services/oauth";
import { GmailIcon } from "./SimpleIcons";

interface Props {
  visible: boolean;
  theme: Record<string, string>;
  onApprove: (email: string) => void;
  onClose: () => void;
}

const MOCK_ACCOUNTS = [
  { name: "Alex Developer", email: "alex.developer@example.com" },
  { name: "Alex Work", email: "alex.work@example.com" },
];

export default function GmailSetupModal({
  visible,
  theme,
  onApprove,
  onClose,
}: Props) {
  const [screen, setScreen] = useState<"choose_account" | "consent">(
    "choose_account",
  );
  const [selectedEmail, setSelectedEmail] = useState("");
  const [customEmail, setCustomEmail] = useState("");
  const [isCustom, setIsCustom] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSelectAccount = (email: string) => {
    setSelectedEmail(email);
    setScreen("consent");
    setError("");
  };

  const handleCustomSubmit = () => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(customEmail)) {
      setError("Please enter a valid email address.");
      return;
    }
    setSelectedEmail(customEmail.toLowerCase());
    setScreen("consent");
    setError("");
  };

  const handleAllow = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await saveSimulatedGmailConnection(selectedEmail);
      if (res.success && res.email) {
        onApprove(res.email);
        reset();
      } else {
        setError(res.error || "Failed to save integration.");
      }
    } catch (e: any) {
      setError(e.message || "An error occurred during authentication.");
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setScreen("choose_account");
    setSelectedEmail("");
    setCustomEmail("");
    setIsCustom(false);
    setError("");
    setLoading(false);
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => {
        reset();
        onClose();
      }}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View style={[styles.container, { backgroundColor: theme.background }]}>
          {/* Header */}
          <View style={[styles.header, { borderBottomColor: theme.separator }]}>
            <View style={styles.headerLeft}>
              <View style={styles.googleG}>
                <Text style={styles.googleGText}>G</Text>
              </View>
              <Text
                style={[
                  styles.headerTitle,
                  { color: theme.surface, fontFamily: "Inter_600SemiBold" },
                ]}
              >
                Google Account
              </Text>
            </View>
            <Pressable
              onPress={() => {
                reset();
                onClose();
              }}
              hitSlop={12}
            >
              <X size={20} color={theme.muted} weight="bold" />
            </Pressable>
          </View>

          {error ? (
            <View
              style={[
                styles.errorBar,
                { backgroundColor: "#FF3B3015", borderColor: "#FF3B3030" },
              ]}
            >
              <ShieldWarning size={18} color="#FF3B30" weight="duotone" />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {screen === "choose_account" ? (
            <ScrollView
              contentContainerStyle={styles.body}
              keyboardShouldPersistTaps="handled"
            >
              <Text
                style={[
                  styles.title,
                  { color: theme.surface, fontFamily: "Inter_700Bold" },
                ]}
              >
                Sign in with Google
              </Text>
              <Text
                style={[
                  styles.subtitle,
                  { color: theme.muted, fontFamily: "Inter_400Regular" },
                ]}
              >
                to continue to{" "}
                <Text
                  style={{
                    fontFamily: "Inter_600SemiBold",
                    color: theme.primary,
                  }}
                >
                  Synced
                </Text>
              </Text>

              <View style={styles.accountList}>
                {MOCK_ACCOUNTS.map((acc) => (
                  <Pressable
                    key={acc.email}
                    style={[
                      styles.accountRow,
                      {
                        backgroundColor: theme.card,
                        borderColor: theme.cardBorder,
                      },
                    ]}
                    onPress={() => handleSelectAccount(acc.email)}
                  >
                    <View
                      style={[
                        styles.avatar,
                        { backgroundColor: theme.primary + "20" },
                      ]}
                    >
                      <User size={18} color={theme.primary} weight="duotone" />
                    </View>
                    <View style={styles.accountInfo}>
                      <Text
                        style={[
                          styles.accountName,
                          {
                            color: theme.surface,
                            fontFamily: "Inter_600SemiBold",
                          },
                        ]}
                      >
                        {acc.name}
                      </Text>
                      <Text
                        style={[
                          styles.accountEmail,
                          {
                            color: theme.muted,
                            fontFamily: "Inter_400Regular",
                          },
                        ]}
                      >
                        {acc.email}
                      </Text>
                    </View>
                    <CaretRight size={16} color={theme.muted} />
                  </Pressable>
                ))}

                {isCustom ? (
                  <View
                    style={[
                      styles.customInputCard,
                      {
                        backgroundColor: theme.card,
                        borderColor: theme.cardBorder,
                      },
                    ]}
                  >
                    <TextInput
                      style={[
                        styles.input,
                        { color: theme.surface, borderColor: theme.cardBorder },
                      ]}
                      placeholder="Enter your Gmail address"
                      placeholderTextColor={theme.muted}
                      value={customEmail}
                      onChangeText={setCustomEmail}
                      keyboardType="email-address"
                      autoCapitalize="none"
                      autoFocus
                    />
                    <View style={styles.customButtons}>
                      <Pressable
                        style={[
                          styles.smallBtn,
                          { borderColor: theme.separator },
                        ]}
                        onPress={() => setIsCustom(false)}
                      >
                        <Text
                          style={[styles.smallBtnText, { color: theme.muted }]}
                        >
                          Cancel
                        </Text>
                      </Pressable>
                      <Pressable
                        style={[
                          styles.smallBtnPrimary,
                          { backgroundColor: "#1a73e8" },
                        ]}
                        onPress={handleCustomSubmit}
                      >
                        <Text style={[styles.smallBtnTextPrimary]}>Next</Text>
                      </Pressable>
                    </View>
                  </View>
                ) : (
                  <Pressable
                    style={[
                      styles.accountRow,
                      {
                        backgroundColor: theme.card,
                        borderColor: theme.cardBorder,
                      },
                    ]}
                    onPress={() => setIsCustom(true)}
                  >
                    <View
                      style={[
                        styles.avatar,
                        { backgroundColor: theme.separator },
                      ]}
                    >
                      <GmailIcon
                        size={18}
                        color={theme.muted}
                      />
                    </View>
                    <View style={styles.accountInfo}>
                      <Text
                        style={[
                          styles.accountName,
                          {
                            color: theme.surface,
                            fontFamily: "Inter_500Medium",
                          },
                        ]}
                      >
                        Use another account
                      </Text>
                    </View>
                    <CaretRight size={16} color={theme.muted} />
                  </Pressable>
                )}
              </View>
            </ScrollView>
          ) : (
            <View style={{ flex: 1 }}>
              <ScrollView contentContainerStyle={styles.body}>
                <Text
                  style={[
                    styles.title,
                    { color: theme.surface, fontFamily: "Inter_700Bold" },
                  ]}
                >
                  Synced wants to access your Google Account
                </Text>

                <View
                  style={[
                    styles.selectedEmailBadge,
                    {
                      backgroundColor: theme.card,
                      borderColor: theme.cardBorder,
                    },
                  ]}
                >
                  <User size={16} color={theme.primary} weight="duotone" />
                  <Text
                    style={[
                      styles.selectedEmailText,
                      { color: theme.surface, fontFamily: "Inter_500Medium" },
                    ]}
                  >
                    {selectedEmail}
                  </Text>
                </View>

                <Text
                  style={[
                    styles.consentIntro,
                    { color: theme.muted, fontFamily: "Inter_400Regular" },
                  ]}
                >
                  This will allow the Synced AI agent to:
                </Text>

                <View style={styles.scopeList}>
                  <View style={styles.scopeRow}>
                    <View style={styles.checkboxSelected}>
                      <Check size={12} color="#FFF" weight="bold" />
                    </View>
                    <View style={styles.scopeTextContent}>
                      <Text
                        style={[
                          styles.scopeTitle,
                          {
                            color: theme.surface,
                            fontFamily: "Inter_600SemiBold",
                          },
                        ]}
                      >
                        Read email messages and settings
                      </Text>
                      <Text
                        style={[
                          styles.scopeDesc,
                          {
                            color: theme.muted,
                            fontFamily: "Inter_400Regular",
                          },
                        ]}
                      >
                        Allows the agent to scan incoming emails to extract
                        tasks.
                      </Text>
                    </View>
                  </View>

                  <View style={styles.scopeRow}>
                    <View style={styles.checkboxSelected}>
                      <Check size={12} color="#FFF" weight="bold" />
                    </View>
                    <View style={styles.scopeTextContent}>
                      <Text
                        style={[
                          styles.scopeTitle,
                          {
                            color: theme.surface,
                            fontFamily: "Inter_600SemiBold",
                          },
                        ]}
                      >
                        Manage email messages and drafts
                      </Text>
                      <Text
                        style={[
                          styles.scopeDesc,
                          {
                            color: theme.muted,
                            fontFamily: "Inter_400Regular",
                          },
                        ]}
                      >
                        Allows the agent to draft context-aware responses or
                        mark parsed emails.
                      </Text>
                    </View>
                  </View>

                  <View style={styles.scopeRow}>
                    <View style={styles.checkboxSelected}>
                      <Check size={12} color="#FFF" weight="bold" />
                    </View>
                    <View style={styles.scopeTextContent}>
                      <Text
                        style={[
                          styles.scopeTitle,
                          {
                            color: theme.surface,
                            fontFamily: "Inter_600SemiBold",
                          },
                        ]}
                      >
                        View your primary email address
                      </Text>
                      <Text
                        style={[
                          styles.scopeDesc,
                          {
                            color: theme.muted,
                            fontFamily: "Inter_400Regular",
                          },
                        ]}
                      >
                        Associates the credentials with the correct email
                        account.
                      </Text>
                    </View>
                  </View>
                </View>

                <Text
                  style={[
                    styles.finePrint,
                    { color: theme.muted, fontFamily: "Inter_400Regular" },
                  ]}
                >
                  Make sure you trust Synced. You can review or remove these
                  permissions at any time in your Google Account settings.
                </Text>
              </ScrollView>

              {/* Footer Actions */}
              <View
                style={[styles.footer, { borderTopColor: theme.separator }]}
              >
                <Pressable
                  style={[
                    styles.btnSecondary,
                    { borderColor: theme.separator },
                  ]}
                  onPress={() => setScreen("choose_account")}
                  disabled={loading}
                >
                  <Text
                    style={[
                      styles.btnSecondaryText,
                      { color: theme.muted, fontFamily: "Inter_600SemiBold" },
                    ]}
                  >
                    Cancel
                  </Text>
                </Pressable>

                <Pressable
                  style={[styles.btnPrimary, { backgroundColor: "#1a73e8" }]}
                  onPress={handleAllow}
                  disabled={loading}
                >
                  {loading ? (
                    <ActivityIndicator size="small" color="#FFF" />
                  ) : (
                    <Text
                      style={[
                        styles.btnPrimaryText,
                        { fontFamily: "Inter_600SemiBold" },
                      ]}
                    >
                      Allow
                    </Text>
                  )}
                </Pressable>
              </View>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
  googleG: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#1a73e8",
    alignItems: "center",
    justifyContent: "center",
  },
  googleGText: {
    color: "#FFF",
    fontSize: 14,
    fontWeight: "900",
    fontFamily: "System",
  },
  headerTitle: { fontSize: 16 },
  errorBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 20,
    marginTop: 12,
    padding: 10,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  errorText: { color: "#FF3B30", fontSize: 13, flex: 1, fontFamily: "System" },
  body: { padding: 24, paddingBottom: 40 },
  title: { fontSize: 22, letterSpacing: -0.4, marginBottom: 6 },
  subtitle: { fontSize: 15, marginBottom: 28 },
  accountList: { gap: 10 },
  accountRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  accountInfo: { flex: 1 },
  accountName: { fontSize: 14, marginBottom: 2 },
  accountEmail: { fontSize: 12 },
  customInputCard: {
    padding: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  input: {
    height: 48,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 14,
  },
  customButtons: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
  },
  smallBtn: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
  },
  smallBtnText: { fontSize: 13, fontWeight: "600" },
  smallBtnPrimary: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 6,
  },
  smallBtnTextPrimary: { color: "#FFF", fontSize: 13, fontWeight: "600" },
  selectedEmailBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    alignSelf: "flex-start",
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 10,
    marginBottom: 20,
  },
  selectedEmailText: { fontSize: 13 },
  consentIntro: { fontSize: 15, marginBottom: 16 },
  scopeList: { gap: 16, marginBottom: 24 },
  scopeRow: { flexDirection: "row", gap: 12 },
  checkboxSelected: {
    width: 18,
    height: 18,
    borderRadius: 4,
    backgroundColor: "#1a73e8",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  scopeTextContent: { flex: 1 },
  scopeTitle: { fontSize: 14, marginBottom: 4 },
  scopeDesc: { fontSize: 12, lineHeight: 16 },
  finePrint: { fontSize: 12, lineHeight: 18 },
  footer: {
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: Platform.OS === "ios" ? 36 : 20,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  btnSecondary: {
    flex: 1,
    height: 48,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: "center",
    alignItems: "center",
  },
  btnSecondaryText: { fontSize: 15 },
  btnPrimary: {
    flex: 1,
    height: 48,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  btnPrimaryText: { color: "#FFF", fontSize: 15 },
});
