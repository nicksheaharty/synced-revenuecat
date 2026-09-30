import { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Alert, Image } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import Purchases, { PurchasesPackage } from "react-native-purchases";
import { X, Check } from "phosphor-react-native";
import { useTheme } from "../hooks/useTheme";

const PRO_ENTITLEMENT_ID = "Synced - Inbox on Autopilot Pro";

const FREE_FEATURES = [
  "20 Action Plans a week",
  "Unlimited Signals",
  "Gmail, Drive, OneDrive, Calendar",
];

const PRO_FEATURES = [
  "100 Action Plans a week",
  "Unlimited Signals",
  "All integrations + Notion, GitHub, Slack, Teams",
];

export default function PaywallScreen() {
  const theme = useTheme();
  const router = useRouter();

  const [monthly, setMonthly] = useState<PurchasesPackage | null>(null);
  const [annual, setAnnual] = useState<PurchasesPackage | null>(null);
  const [selected, setSelected] = useState<"monthly" | "annual">("annual");
  const [loadingOfferings, setLoadingOfferings] = useState(true);
  const [purchasing, setPurchasing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Purchases.getOfferings()
      .then((offerings) => {
        if (cancelled) return;
        const current = offerings.current;
        setMonthly(current?.monthly ?? null);
        setAnnual(current?.annual ?? null);
        if (!current?.annual && current?.monthly) setSelected("monthly");
      })
      .catch((err) => {
        console.error("[Paywall] getOfferings failed:", err);
      })
      .finally(() => {
        if (!cancelled) setLoadingOfferings(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedPackage = selected === "annual" ? annual : monthly;

  const handlePurchase = async () => {
    if (!selectedPackage || purchasing) return;
    setPurchasing(true);
    try {
      const { customerInfo } = await Purchases.purchasePackage(selectedPackage);
      if (customerInfo.entitlements.active[PRO_ENTITLEMENT_ID]) {
        router.back();
      }
    } catch (err: any) {
      if (!err.userCancelled) {
        Alert.alert("Purchase Failed", err.message || "Something went wrong. Please try again.");
      }
    } finally {
      setPurchasing(false);
    }
  };

  const handleRestore = async () => {
    try {
      const customerInfo = await Purchases.restorePurchases();
      if (customerInfo.entitlements.active[PRO_ENTITLEMENT_ID]) {
        router.back();
      } else {
        Alert.alert("No Purchases Found", "We couldn't find an active Pro subscription for this account.");
      }
    } catch (err: any) {
      Alert.alert("Restore Failed", err.message || "Something went wrong. Please try again.");
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      <Pressable
        onPress={() => router.back()}
        style={[styles.close, { backgroundColor: theme.searchBg }]}
        hitSlop={12}
      >
        <X size={18} color={theme.muted} weight="bold" />
      </Pressable>

      <View style={styles.header}>
        <Image source={require("../assets/logos/logo3d.png")} style={styles.appIcon} resizeMode="contain" />
        <Text style={[styles.title, { color: theme.surface, fontFamily: "MackinacPro_700Bold" }]}>
          Synced <Text style={{ color: theme.primary }}>Pro</Text>
        </Text>
        <Text style={[styles.subtitle, { color: theme.muted, fontFamily: "Inter_400Regular" }]}>
          More Action Plans, every integration.
        </Text>
      </View>

      <View style={styles.plans}>
        <View style={[styles.planCard, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
          <Text style={[styles.planName, { color: theme.surface, fontFamily: "Inter_600SemiBold" }]}>Free</Text>
          {FREE_FEATURES.map((f) => (
            <View key={f} style={styles.featureRow}>
              <Check size={14} color={theme.muted} weight="bold" />
              <Text style={[styles.featureText, { color: theme.muted, fontFamily: "Inter_400Regular" }]}>{f}</Text>
            </View>
          ))}
        </View>

        <View style={[styles.planCard, styles.proCard, { backgroundColor: theme.card, borderColor: theme.primary }]}>
          <Text style={[styles.planName, { color: theme.surface, fontFamily: "Inter_600SemiBold" }]}>Pro</Text>
          {PRO_FEATURES.map((f) => (
            <View key={f} style={styles.featureRow}>
              <Check size={14} color={theme.primary} weight="bold" />
              <Text style={[styles.featureText, { color: theme.surface, fontFamily: "Inter_500Medium" }]}>{f}</Text>
            </View>
          ))}
        </View>
      </View>

      {loadingOfferings ? (
        <ActivityIndicator style={styles.loader} color={theme.primary} />
      ) : (
        <View style={styles.toggleRow}>
          {monthly && (
            <Pressable
              onPress={() => setSelected("monthly")}
              style={[
                styles.toggleOption,
                { borderColor: selected === "monthly" ? theme.primary : theme.cardBorder },
                selected === "monthly" && { backgroundColor: theme.actionBg },
              ]}
            >
              <Text style={[styles.toggleLabel, { color: theme.surface, fontFamily: "Inter_600SemiBold" }]}>
                Monthly
              </Text>
              <Text style={[styles.togglePrice, { color: theme.surface, fontFamily: "Inter_700Bold" }]}>
                {monthly.product.priceString}
                <Text style={[styles.toggleUnit, { color: theme.muted, fontFamily: "Inter_400Regular" }]}>/mo</Text>
              </Text>
            </Pressable>
          )}
          {annual && (
            <Pressable
              onPress={() => setSelected("annual")}
              style={[
                styles.toggleOption,
                { borderColor: selected === "annual" ? theme.primary : theme.cardBorder },
                selected === "annual" && { backgroundColor: theme.actionBg },
              ]}
            >
              {monthly && (
                <View style={[styles.saveBadge, { backgroundColor: theme.primary }]}>
                  <Text style={styles.saveBadgeText}>SAVE 17%</Text>
                </View>
              )}
              <Text style={[styles.toggleLabel, { color: theme.surface, fontFamily: "Inter_600SemiBold" }]}>
                Annual
              </Text>
              <Text style={[styles.togglePrice, { color: theme.surface, fontFamily: "Inter_700Bold" }]}>
                {annual.product.pricePerMonthString ?? annual.product.priceString}
                <Text style={[styles.toggleUnit, { color: theme.muted, fontFamily: "Inter_400Regular" }]}>/mo</Text>
              </Text>
            </Pressable>
          )}
        </View>
      )}

      <View style={styles.bottom}>
        <Pressable
          style={[
            styles.primaryBtn,
            { backgroundColor: theme.primary },
            (!selectedPackage || purchasing) && { opacity: 0.5 },
          ]}
          onPress={handlePurchase}
          disabled={!selectedPackage || purchasing}
        >
          {purchasing ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={[styles.primaryBtnText, { fontFamily: "Inter_600SemiBold" }]}>Try Synced Pro</Text>
          )}
        </Pressable>
        <Pressable onPress={handleRestore} hitSlop={8}>
          <Text style={[styles.restoreText, { color: theme.primary, fontFamily: "Inter_500Medium" }]}>
            Restore Purchases
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  close: {
    position: "absolute",
    top: 16,
    right: 20,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1,
  },
  header: { alignItems: "center", paddingHorizontal: 28, paddingTop: 40 },
  appIcon: {
    width: 88,
    height: 83,
    marginBottom: 14,
  },
  title: { fontSize: 30, letterSpacing: -0.3, marginBottom: 6 },
  subtitle: { fontSize: 15, textAlign: "center" },
  plans: { paddingHorizontal: 20, paddingTop: 24, gap: 10 },
  planCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 10,
  },
  proCard: { borderWidth: 1.5 },
  planName: { fontSize: 15, marginBottom: 2 },
  featureRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  featureText: { fontSize: 13, flex: 1 },
  toggleRow: { flexDirection: "row", gap: 10, paddingHorizontal: 20, paddingTop: 20 },
  loader: { marginTop: 24 },
  toggleOption: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1.5,
    padding: 14,
    position: "relative",
  },
  toggleLabel: { fontSize: 13, marginBottom: 4 },
  togglePrice: { fontSize: 18 },
  toggleUnit: { fontSize: 12 },
  saveBadge: {
    position: "absolute",
    top: -10,
    right: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  saveBadgeText: { color: "#FFFFFF", fontSize: 10, fontWeight: "700", letterSpacing: 0.3 },
  bottom: { paddingHorizontal: 28, paddingTop: 28, paddingBottom: 20, alignItems: "center", gap: 16 },
  primaryBtn: {
    width: "100%",
    height: 54,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtnText: { color: "#FFFFFF", fontSize: 17 },
  restoreText: { fontSize: 13 },
});
