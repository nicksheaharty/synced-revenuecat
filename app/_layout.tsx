import { useEffect, useRef } from "react";
import {
  AppState,
  AppStateStatus,
  NativeModules,
  NativeEventEmitter,
} from "react-native";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useColorScheme } from "../hooks/useColorScheme";
import { ThemePreferenceContext } from "../hooks/useThemePreference";
import { useThemePreferenceState } from "../hooks/useThemePreference";
import { subscribeToAuth } from "../services/firebase";
import { UserProvider } from "../contexts/UserContext";
import { useFonts } from "expo-font";
import { Inter_400Regular } from "@expo-google-fonts/inter/400Regular";
import { Inter_500Medium } from "@expo-google-fonts/inter/500Medium";
import { Inter_600SemiBold } from "@expo-google-fonts/inter/600SemiBold";
import { Inter_700Bold } from "@expo-google-fonts/inter/700Bold";
// Curated Google Fonts for the Brand (document creation) settings screen —
// see brandFonts.ts for the list surfaced in the picker. Only Regular/Bold
// weights are loaded, enough for the header/body preview.
import { Poppins_400Regular } from "@expo-google-fonts/poppins/400Regular";
import { Poppins_700Bold } from "@expo-google-fonts/poppins/700Bold";
import { PlayfairDisplay_400Regular } from "@expo-google-fonts/playfair-display/400Regular";
import { PlayfairDisplay_700Bold } from "@expo-google-fonts/playfair-display/700Bold";
import { Montserrat_400Regular } from "@expo-google-fonts/montserrat/400Regular";
import { Montserrat_700Bold } from "@expo-google-fonts/montserrat/700Bold";
import { Merriweather_400Regular } from "@expo-google-fonts/merriweather/400Regular";
import { Merriweather_700Bold } from "@expo-google-fonts/merriweather/700Bold";
import { Lora_400Regular } from "@expo-google-fonts/lora/400Regular";
import { Lora_700Bold } from "@expo-google-fonts/lora/700Bold";
import { Roboto_400Regular } from "@expo-google-fonts/roboto/400Regular";
import { Roboto_700Bold } from "@expo-google-fonts/roboto/700Bold";
import { WorkSans_400Regular } from "@expo-google-fonts/work-sans/400Regular";
import { WorkSans_700Bold } from "@expo-google-fonts/work-sans/700Bold";
import * as SplashScreen from "expo-splash-screen";
import {
  isOnboardingComplete,
  getProfiles,
  saveProfile,
  saveTask,
  saveMessage,
  Profile,
  generateRandomId,
  deriveInitials,
} from "../services/storage";
import {
  requestAndCacheContacts,
  hasContactPermission,
  lookupContactByPhone,
} from "../services/contacts";

SplashScreen.preventAutoHideAsync().catch(() => {});

const { SharedDefaults } = NativeModules;

async function consumePendingMessage(): Promise<{
  text: string;
  sender: string;
  source: string;
} | null> {
  try {
    const result = await SharedDefaults?.consumePendingMessage();
    if (result?.text && result?.sender) return result;
  } catch {}
  return null;
}


async function processIncomingMessage(raw: {
  text: string;
  sender: string;
  source: string;
}) {
  try {
    const isPhone = /\d{7,}/.test(raw.sender.replace(/\D/g, ""));
    let sender = raw.sender;
    if (isPhone) {
      const match = await lookupContactByPhone(raw.sender);
      if (match?.name) sender = match.name;
    }
    const source = raw.source as Profile["source"];
    const allProfiles = await getProfiles();
    const existing = allProfiles.find(
      (p) =>
        p.name.toLowerCase() === sender.toLowerCase() && p.source === source,
    );

    const profileId = existing?.id ?? generateRandomId("profile");
    const now = new Date().toISOString();
    const profile: Profile = {
      id: profileId,
      userId: existing?.userId ?? "dev_user",
      name: sender,
      senderInitial: deriveInitials(sender),
      source,
      platformIdentifier:
        source === "gmail"
          ? `${sender.toLowerCase().replace(/\s+/g, "")}@gmail.com`
          : raw.sender,
      analyzed: false,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    await saveProfile(profile);
    await saveMessage({
      id: generateRandomId("msg"),
      profileId,
      userId: profile.userId,
      direction: "in",
      text: raw.text,
      timestamp: now,
      createdAt: now,
    });
  } catch (error) {
    console.error("[RootLayout] Error processing incoming app message:", error);
  }
}

function RootLayoutInner() {
  const scheme = useColorScheme();
  const router = useRouter();
  const segments = useSegments();
  const appState = useRef(AppState.currentState);
  const [fontsLoaded] = useFonts({
    MackinacPro_400Regular: Inter_400Regular,
    MackinacPro_400Regular_Italic: Inter_400Regular,
    MackinacPro_700Bold: Inter_700Bold,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Poppins_400Regular,
    Poppins_700Bold,
    PlayfairDisplay_400Regular,
    PlayfairDisplay_700Bold,
    Montserrat_400Regular,
    Montserrat_700Bold,
    Merriweather_400Regular,
    Merriweather_700Bold,
    Lora_400Regular,
    Lora_700Bold,
    Roboto_400Regular,
    Roboto_700Bold,
    WorkSans_400Regular,
    WorkSans_700Bold,
  });

  // Authentication Route Guard
  useEffect(() => {
    if (!fontsLoaded) return;

    const unsubAuth = subscribeToAuth((user) => {
      const inOnboardingGroup = segments[0] === "(onboarding)";

      if (!user && !inOnboardingGroup) {
        console.log(
          "[Auth Guard] User is logged out, redirecting to onboarding screen",
        );
        router.replace("/(onboarding)/welcome");
      }
    });

    return () => unsubAuth();
  }, [router, fontsLoaded, segments]);

  useEffect(() => {
    if (fontsLoaded) {
      SplashScreen.hideAsync().catch(() => {});
      hasContactPermission()
        .then((granted) => {
          if (granted) requestAndCacheContacts().catch(() => {});
        })
        .catch(() => {});
    }
  }, [fontsLoaded]);

  useEffect(() => {
    if (!fontsLoaded) return;

    const handleAppStateChange = async (nextState: AppStateStatus) => {
      if (
        appState.current.match(/inactive|background/) &&
        nextState === "active"
      ) {
        const done = await isOnboardingComplete();
        if (!done) return;
        const pending = await consumePendingMessage();
        if (pending) {
          await processIncomingMessage(pending);
          router.replace("/(main)/home");
        }
      }
      appState.current = nextState;
    };

    const sub = AppState.addEventListener("change", handleAppStateChange);

    let msgSub: any = null;
    if (NativeModules.SharedDefaults) {
      const emitter = new NativeEventEmitter(NativeModules.SharedDefaults);
      msgSub = emitter.addListener("pendingMessage", async (payload) => {
        if (payload?.text && payload?.sender) {
          await processIncomingMessage(payload);
          router.replace("/(main)/home");
        }
      });
    }

    return () => {
      sub.remove();
      if (msgSub) {
        msgSub.remove();
      }
    };
  }, [router, fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    <>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <Stack screenOptions={{ headerShown: false, animation: "fade" }}>
        {/* No fade — expo-router's router.navigate has no per-call
            animation override, so this is the only lever available.
            AddAgentTaskSheet.handleSend navigates back to home after
            sending a Synced task (see that file's own comment); an
            instant jump reads better there than a fade, and every other
            path into home (sign-in, coming back from settings, etc)
            benefits from the same instant transition rather than fading
            in on every visit. */}
        <Stack.Screen name="(main)" options={{ animation: "none" }} />
        <Stack.Screen name="conversation/[profileId]" options={{ animation: "slide_from_right", headerShown: false }} />
        <Stack.Screen name="deliverables" options={{ animation: "slide_from_right", headerShown: false }} />
        <Stack.Screen name="brand" options={{ animation: "slide_from_right", headerShown: false }} />
        <Stack.Screen name="connector-settings/[id]" options={{ animation: "slide_from_right", headerShown: false }} />
        <Stack.Screen name="chat-with-us" options={{ animation: "slide_from_right", headerShown: false }} />
        <Stack.Screen name="paywall" options={{ presentation: "modal", animation: "slide_from_bottom", headerShown: false }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  const themeState = useThemePreferenceState();

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemePreferenceContext.Provider value={themeState}>
        <UserProvider>
          <RootLayoutInner />
        </UserProvider>
      </ThemePreferenceContext.Provider>
    </GestureHandlerRootView>
  );
}
