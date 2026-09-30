import { useEffect } from "react";
import { useRouter } from "expo-router";
import { View, NativeModules } from "react-native";
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
import { useTheme } from "../hooks/useTheme";
import { lookupContactByPhone } from "../services/contacts";
import { ShimmerSyncedIcon } from "../components/SkeletonMessageCard";

const { SharedDefaults } = NativeModules;

export default function IndexScreen() {
  const router = useRouter();
  const theme = useTheme();

  useEffect(() => {
    const run = async () => {
      const done = await isOnboardingComplete();
      if (!done) {
        router.replace("/(onboarding)/welcome");
        return;
      }

      try {
        const pending = await SharedDefaults?.consumePendingMessage();
        if (pending?.text && pending?.sender) {
          const isPhone = /\d{7,}/.test(pending.sender.replace(/\D/g, ""));
          let sender = pending.sender;
          if (isPhone) {
            const match = await lookupContactByPhone(pending.sender);
            if (match?.name) sender = match.name;
          }
          const source = (pending.source ?? "imessage") as Profile["source"];
          const allProfiles = await getProfiles();
          const existing = allProfiles.find(
            (p) =>
              p.name.toLowerCase() === sender.toLowerCase() &&
              p.source === source,
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
                : pending.sender,
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
            text: pending.text,
            timestamp: now,
            createdAt: now,
          });
        }
      } catch {}

      router.replace("/(main)/home");
    };
    run();
  }, []);

  return (
    <View
      style={{
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
        backgroundColor: theme.background,
      }}
    >
      <ShimmerSyncedIcon size={48} />
    </View>
  );
}
