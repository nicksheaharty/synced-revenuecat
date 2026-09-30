import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { addPushToken, removePushToken } from "./storage";

// Suppress the system banner/sound while the app is in the foreground — the
// user is already looking at the app, so a system alert on top of it is
// redundant. addNotificationReceivedListener (see below) still fires with
// the payload so in-app state can react to it without a visible/audible
// system notification.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: false,
    shouldShowList: false,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

/**
 * Requests notification permission (if not already granted or denied) and,
 * on success, obtains this device's Expo push token and saves it to the
 * user's Firestore doc (see UserDocument.pushTokens). Called once per login
 * from contexts/UserContext.tsx's auth-resolution effect — safe to call
 * repeatedly (Notifications.requestPermissionsAsync is a no-op prompt-wise
 * once the user has already answered; addPushToken's arrayUnion is
 * idempotent for an unchanged token).
 *
 * Never throws — a user declining the permission prompt, or a physical-
 * device-only API call failing on a simulator, must not block sign-in or
 * any other part of the app. Silently returns without a token in that case.
 */
export async function registerForPushNotificationsAsync(userId: string): Promise<void> {
  try {
    // Push tokens are meaningless on a simulator/emulator (no real APNs/FCM
    // registration) — Notifications.getExpoPushTokenAsync throws there, so
    // skip the whole flow rather than surfacing a confusing error every
    // time a developer runs the app in Simulator.
    if (!Device.isDevice) return;

    if (Platform.OS === "android") {
      // Required before getExpoPushTokenAsync on Android 13+ — see SDK 56
      // docs. Harmless to call unconditionally on every login.
      await Notifications.setNotificationChannelAsync("default", {
        name: "default",
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== "granted") return;

    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    if (!projectId) {
      console.warn("[Notifications] No EAS projectId found in app config — cannot register push token.");
      return;
    }

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await addPushToken(userId, token);
  } catch (e) {
    // Never let a push-registration failure (permission API quirk, network
    // blip getting the token) block sign-in or crash the app — notifications
    // are a nice-to-have layered on top of the core product, not a
    // dependency of it.
    console.error("[Notifications] registerForPushNotificationsAsync error:", e);
  }
}

/**
 * Removes this device's Expo push token from the given (about-to-be-logged-
 * out) user's Firestore doc. Called from settings.tsx's handleLogOut before
 * signing out, while userId is still known — otherwise the token stays
 * active on that user's doc forever and a different user logging in on the
 * same device would NOT clear it (addPushToken only adds to the new user's
 * doc), so both accounts would keep receiving pushes on this device.
 *
 * Never throws, for the same reason as registerForPushNotificationsAsync —
 * a failure here must not block logout.
 */
export async function unregisterPushNotificationsAsync(userId: string): Promise<void> {
  try {
    if (!Device.isDevice) return;

    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    if (!projectId) return;

    const { status } = await Notifications.getPermissionsAsync();
    if (status !== "granted") return;

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await removePushToken(userId, token);
  } catch (e) {
    console.error("[Notifications] unregisterPushNotificationsAsync error:", e);
  }
}

/**
 * Read-only permission check for display purposes (e.g. Settings' About
 * section showing "Notifications: On/Off") — does NOT prompt, unlike
 * registerForPushNotificationsAsync. Returns false on a simulator/emulator
 * (Device.isDevice check) rather than throwing, since there's no real
 * permission state to report there.
 */
export async function getNotificationPermissionStatus(): Promise<boolean> {
  try {
    if (!Device.isDevice) return false;
    const { status } = await Notifications.getPermissionsAsync();
    return status === "granted";
  } catch (e) {
    console.error("[Notifications] getNotificationPermissionStatus error:", e);
    return false;
  }
}
