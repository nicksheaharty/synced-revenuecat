import { Platform } from "react-native";
import Purchases, { LOG_LEVEL } from "react-native-purchases";

const RC_API_KEY = Platform.select({
  ios: process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY || "",
  android: process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY || "",
});

let configured = false;

// Called once per auth resolution (see contexts/UserContext.tsx's
// subscribeToAuth callback) — idempotent, so re-running on every auth-state
// change is safe. Uses the Firebase uid directly as RevenueCat's appUserID:
// the app requires phone verification before any paywall is reachable, so
// there's no anonymous-user flow to reconcile.
export function configurePurchases(uid: string) {
  if (!RC_API_KEY) return;
  if (!configured) {
    Purchases.configure({ apiKey: RC_API_KEY, appUserID: uid });
    configured = true;
    if (__DEV__) Purchases.setLogLevel(LOG_LEVEL.WARN);
  } else {
    void Purchases.logIn(uid);
  }
}

export function resetPurchases() {
  if (configured) void Purchases.logOut();
}
