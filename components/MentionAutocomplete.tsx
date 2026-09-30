import { FlatList, Image, Pressable, StyleSheet, Text, View } from "react-native";
import { Envelope, ChatCircle, GoogleDriveLogo, MicrosoftOutlookLogo, MicrosoftTeamsLogo, SlackLogo } from "phosphor-react-native";
import { type Profile, deriveAvatarInitials, resolveProfileAvatarUri } from "../services/storage";
import { useTheme } from "../hooks/useTheme";
import { GmailIcon } from "./SimpleIcons";

export interface MentionSuggestion {
  profileId: string;
  name: string;
  // Two-letter fallback (see deriveAvatarInitials) and real photo URI, if
  // any — kept alongside the raw name/profileId so the suggestion row and
  // the eventual inline mention render with the SAME avatar treatment used
  // everywhere else in the app (see MessageCard.tsx's solo-profile avatar:
  // theme.avatarGradient background, real Image when available, two-letter
  // initials otherwise — not a flat color circle with a single letter).
  avatarInitials: string;
  avatarUri: string | undefined;
  source: Profile["source"];
  // Email address / platform handle (Profile.platformIdentifier) — shown
  // as a second, muted line under the name in the suggestion row so two
  // profiles that share a display name are still distinguishable before
  // selecting one.
  identifier: string;
}

// Same source -> icon/color mapping as HumanInputSheet.tsx/LightningCard.tsx/
// MessageCard.tsx (kept as a local const here rather than factored into a
// shared module, matching how those three already each keep their own copy
// rather than sharing one — no "synced"/"email" entries needed here since
// mentionable profiles are always a real non-synced source, see
// rankMentionSuggestions' filter below).
export const MENTION_SOURCE_ICON: Record<string, React.ComponentType<any>> = {
  gmail: GmailIcon,
  outlook: MicrosoftOutlookLogo,
  imessage: ChatCircle,
  drive: GoogleDriveLogo,
  slack: SlackLogo,
  teams: MicrosoftTeamsLogo,
  whatsapp: ChatCircle,
  email: Envelope,
};

export const MENTION_SOURCE_COLOR: Record<string, string> = {
  gmail: "#EA4335",
  outlook: "#0078D4",
  imessage: "#30D158",
  drive: "#34A853",
  slack: "#E01E5A",
  teams: "#6264A7",
  whatsapp: "#25D366",
  email: "#8E8E93",
};

interface MentionAutocompleteProps {
  suggestions: MentionSuggestion[];
  onSelect: (suggestion: MentionSuggestion) => void;
}

// Ranked purely by Profile.updatedAt descending — see rankMentionSuggestions
// below for why that already captures both recency and frequency without a
// new backend counter field. Capped at 4 (not 6) by default so the dropdown
// more often fits fully within the space actually available above the
// input without needing to scroll — see MentionAutocomplete's container
// maxHeight below.
export function rankMentionSuggestions(profiles: Profile[], query: string, limit = 4): MentionSuggestion[] {
  const q = query.trim().toLowerCase();
  return profiles
    // Never suggest the reserved synced self-chat profile — @mentioning
    // "yourself" is meaningless, the no-mention path already covers it.
    .filter((p) => p.source !== "synced")
    .filter((p) => !q || p.name.toLowerCase().includes(q))
    // profiles from UserContext is already ordered by updatedAt desc, but
    // don't depend on caller ordering — sort explicitly here too.
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
    .slice(0, limit)
    .map((p) => ({
      profileId: p.id,
      name: p.name,
      avatarInitials: deriveAvatarInitials(p.name, p.senderInitial),
      avatarUri: resolveProfileAvatarUri(p.customAvatarUri, p.avatarUri),
      source: p.source,
      identifier: p.platformIdentifier,
    }));
}

// Overlay list shown above the input while an active "@query" is being
// typed — a plain absolutely-positioned sibling inside AddAgentTaskSheet's
// own view tree (see that file's usage), not a portal/modal, since
// BottomSheetView already hosts a normal RN view tree (see the technical
// note in AddAgentTaskSheet.tsx on BottomSheetTextInput being a bare
// TextInput re-export).
export function MentionAutocomplete({ suggestions, onSelect }: MentionAutocompleteProps) {
  const theme = useTheme();

  if (suggestions.length === 0) return null;

  return (
    <View style={[styles.container, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
      <FlatList
        data={suggestions}
        keyExtractor={(item) => item.profileId}
        keyboardShouldPersistTaps="always"
        renderItem={({ item }) => {
          const SourceIcon = MENTION_SOURCE_ICON[item.source];
          return (
          <Pressable
            onPress={() => onSelect(item)}
            style={({ pressed }) => [styles.row, { opacity: pressed ? 0.6 : 1 }]}
          >
            {/* Same avatar treatment as MessageCard.tsx's solo-profile
                header: neutral gradient background, real photo when
                available, two-letter initials otherwise — not a flat
                primary-colored circle with a single letter. */}
            <View style={[styles.avatar, { backgroundColor: theme.muted, experimental_backgroundImage: theme.avatarGradient }]}>
              {item.avatarUri ? (
                <Image source={{ uri: item.avatarUri }} style={styles.avatarImage} />
              ) : (
                <Text style={[styles.avatarText, { fontFamily: "Inter_700Bold" }]}>{item.avatarInitials}</Text>
              )}
            </View>
            <View style={styles.nameColumn}>
              <Text style={[styles.name, { color: theme.surface }]} numberOfLines={1}>
                {item.name}
              </Text>
              {!!item.identifier && (
                <Text style={[styles.identifier, { color: theme.muted }]} numberOfLines={1}>
                  {item.identifier}
                </Text>
              )}
            </View>
            {SourceIcon && (
              <SourceIcon size={16} color={MENTION_SOURCE_COLOR[item.source]} weight="fill" />
            )}
          </Pressable>
          );
        }}
      />
    </View>
  );
}

// Two-line row now (name + identifier) — taller than the old single-line
// 48px row. Used to cap the list to whole rows.
const ROW_HEIGHT = 56;

const styles = StyleSheet.create({
  // Normal flow (NOT position:absolute) — see AddAgentTaskSheet.tsx's usage
  // comment: this renders as a real sibling between `body` and `footer`, so
  // it always sits fully below the input's current content regardless of
  // how many lines have been typed, rather than floating over a guessed
  // pixel offset that only holds for a single line of text.
  container: {
    marginHorizontal: 14,
    marginTop: 8,
    maxHeight: ROW_HEIGHT * 3,
    borderRadius: 13,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: ROW_HEIGHT,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 10,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
  },
  avatarImage: { width: 32, height: 32, borderRadius: 16 },
  avatarText: {
    color: "#FFF",
    fontSize: 13,
  },
  nameColumn: {
    flex: 1,
    flexShrink: 1,
    gap: 1,
  },
  name: {
    fontSize: 15,
  },
  identifier: {
    fontSize: 12,
  },
});
