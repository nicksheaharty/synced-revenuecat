import { Platform } from "react-native";
import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY || "",
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN || "",
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || "",
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET || "",
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "",
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID || "",
  measurementId: process.env.EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID || "",
};

// Initialize Web SDK (for Web or JS fallback)
let webApp;
let webAuth: any;
try {
  webApp = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
  if (Platform.OS === "web") {
    webAuth = getAuth(webApp);
  } else {
    try {
      webAuth = getAuth(webApp);
    } catch {
      const {
        initializeAuth,
        getReactNativePersistence,
      } = require("firebase/auth");
      const {
        createAsyncStorage,
      } = require("@react-native-async-storage/async-storage");
      const appStorage = createAsyncStorage("app");
      const persistence = getReactNativePersistence(appStorage);
      webAuth = initializeAuth(webApp, { persistence });
    }
  }
} catch (e) {
  console.error("Failed to initialize web Firebase SDK:", e);
}

export const db = webApp ? getFirestore(webApp) : undefined;
export const storage = webApp ? getStorage(webApp) : undefined;
export const STORAGE_BUCKET = firebaseConfig.storageBucket;

// Check native Firebase availability
let isNativeFirebaseAvailable = false;
let nativeAuth: any = null;

if (Platform.OS !== "web") {
  try {
    // Try to load native auth module
    const authModule = require("@react-native-firebase/auth");
    if (authModule) {
      nativeAuth = authModule.default || authModule;
      // Test if native auth is functional (will throw or be undefined if native bindings are missing, like in Expo Go)
      if (nativeAuth()) {
        isNativeFirebaseAvailable = true;
        try {
          if (__DEV__) {
            nativeAuth().settings.appVerificationDisabledForTesting = true;
            console.log(
              "[Firebase Auth] App verification disabled for testing in __DEV__ mode.",
            );
          }
        } catch (settingsError) {
          console.warn(
            "[Firebase Auth] Could not disable app verification for testing:",
            settingsError,
          );
        }
      }
    }
  } catch (e) {
    console.log(
      "Native Firebase Auth is not loaded (likely running in Expo Go). Fallback mode enabled.",
    );
  }
}

// Confirmation state variables
let confirmationResult: any = null;
let lastPhoneNumber: string = "";

export const isNativeAuthEnabled = () => isNativeFirebaseAvailable;

/**
 * Sends a 6-digit SMS verification code to the given E.164 phone number.
 * @param phoneNumber E.164 formatted phone number (e.g., +15555555555)
 */
export async function sendVerificationCode(
  phoneNumber: string,
): Promise<boolean> {
  lastPhoneNumber = phoneNumber;
  console.log(
    `[Firebase Auth] Requesting verification code for ${phoneNumber}. Native Auth: ${isNativeFirebaseAvailable}`,
  );

  if (isNativeFirebaseAvailable && nativeAuth) {
    try {
      confirmationResult =
        await nativeAuth().signInWithPhoneNumber(phoneNumber);
      return true;
    } catch (error: any) {
      console.error(
        "[Firebase Auth] Native phone authentication error:",
        error,
      );
      throw error;
    }
  } else {
    // Expo Go / Web / Fallback simulation
    console.log(
      "[Firebase Auth] Simulating SMS verification in fallback mode.",
    );
    console.log(
      '[Firebase Auth] Use verification code "123456" or "000000" to verify successfully.',
    );
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return true;
  }
}

/**
 * Verifies the 6-digit SMS code against the pending verification request.
 * @param code 6-digit SMS code
 */
export async function confirmCode(code: string): Promise<boolean> {
  console.log(
    `[Firebase Auth] Confirming code "${code}" for verification. Native Auth: ${isNativeFirebaseAvailable}`,
  );

  if (isNativeFirebaseAvailable && confirmationResult) {
    try {
      const userCredential = await confirmationResult.confirm(code);
      console.log(
        "[Firebase Auth] User successfully verified natively:",
        userCredential?.user?.uid,
      );
      return true;
    } catch (error: any) {
      console.error(
        "[Firebase Auth] Native verification code confirmation error:",
        error,
      );
      throw error;
    }
  } else {
    // Simulated verification logic for dev / Expo Go / Web
    await new Promise((resolve) => setTimeout(resolve, 1000));
    if (code === "123456" || code === "000000") {
      console.log("[Firebase Auth] Simulated verification successful!");
      return true;
    } else {
      const err = new Error("The verification code is invalid.");
      (err as any).code = "auth/invalid-verification-code";
      throw err;
    }
  }
}

/**
 * Resends the verification code to the last entered phone number.
 */
export async function resendCode(): Promise<boolean> {
  if (lastPhoneNumber) {
    return sendVerificationCode(lastPhoneNumber);
  }
  console.warn("[Firebase Auth] No phone number on file to resend code to.");
  return false;
}

/**
 * Signs the current user out of Firebase.
 */
export async function signOutUser(): Promise<void> {
  console.log(
    `[Firebase Auth] Signing out. Native Auth: ${isNativeFirebaseAvailable}`,
  );
  if (isNativeFirebaseAvailable && nativeAuth) {
    try {
      await nativeAuth().signOut();
    } catch (error) {
      console.error("[Firebase Auth] Native sign out error:", error);
      throw error;
    }
  } else {
    try {
      const { signOut } = require("firebase/auth");
      await signOut(webAuth);
    } catch (error) {
      console.error("[Firebase Auth] Web sign out error:", error);
      throw error;
    }
  }
}

export function subscribeToAuth(callback: (user: any) => void) {
  if (Platform.OS !== "web" && isNativeFirebaseAvailable && nativeAuth) {
    return nativeAuth().onAuthStateChanged((user: any) => {
      callback(
        user
          ? { uid: user.uid, email: user.email, phoneNumber: user.phoneNumber }
          : null,
      );
    });
  } else {
    return onAuthStateChanged(webAuth, (user: any) => {
      callback(
        user
          ? { uid: user.uid, email: user.email, phoneNumber: user.phoneNumber }
          : null,
      );
    });
  }
}

export function getAppUser() {
  if (Platform.OS !== "web" && isNativeFirebaseAvailable && nativeAuth) {
    const user = nativeAuth().currentUser;
    return user
      ? { uid: user.uid, email: user.email, phoneNumber: user.phoneNumber }
      : null;
  }
  const user = webAuth ? webAuth.currentUser : null;
  return user
    ? { uid: user.uid, email: user.email, phoneNumber: user.phoneNumber }
    : null;
}

// A fresh ID token for the signed-in user, needed to call Firebase Storage's
// REST upload endpoint directly (see conversation/[profileId].tsx's
// handleChangeAvatar) — client uploads via the firebase/storage JS SDK's
// uploadBytes() always internally wrap the payload in `new Blob(...)`
// (see @firebase/storage's getBlob$1), which React Native's Blob polyfill
// can't construct from an ArrayBuffer/Uint8Array, so every such upload
// throws "Creating blobs from 'ArrayBuffer' ... are not supported"
// regardless of what type of data you hand it. Going straight to the REST
// API with expo-file-system's native (non-Blob) upload() sidesteps the JS
// SDK's Blob step entirely. Mirrors getAppUser()'s same native/web split.
export async function getAppIdToken(): Promise<string | null> {
  if (Platform.OS !== "web" && isNativeFirebaseAvailable && nativeAuth) {
    const user = nativeAuth().currentUser;
    return user ? await user.getIdToken() : null;
  }
  const user = webAuth ? webAuth.currentUser : null;
  return user ? await user.getIdToken() : null;
}
