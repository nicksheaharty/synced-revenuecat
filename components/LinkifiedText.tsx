import { Text, Linking, Alert } from "react-native";
import { parseMentionSegments } from "../services/storage";

// http(s) URLs and bare www.-prefixed domains — the common cases in a
// typed/pasted chat message. Deliberately not a full RFC 3986 URL grammar
// (e.g. no bare "example.com" with no scheme/www — too prone to false
// positives on ordinary prose like "see you at 5.30pm").
const URL_PATTERN = /(https?:\/\/[^\s]+|www\.[^\s]+\.[a-z]{2,}[^\s]*)/gi;

function LinkRun({ part, linkStyle }: { part: string; linkStyle?: any }) {
  const href = part.startsWith("www.") ? `https://${part}` : part;
  return (
    <Text
      style={linkStyle}
      onPress={() => {
        Linking.openURL(href).catch(() => {
          Alert.alert("Couldn't open link", href);
        });
      }}
    >
      {part}
    </Text>
  );
}

// URL-linkifies a single plain-text run (no mention blocks inside it —
// those were already split out by parseMentionSegments before this runs).
// disableLinks skips the tappable Text/onPress wiring entirely (renders
// plain text instead) — for contexts where a nested onPress would fight an
// outer row's own Pressable, e.g. a home-screen conversation preview row
// that navigates to the thread on tap.
function linkifyPlainRun(text: string, keyPrefix: string, linkStyle?: any, disableLinks?: boolean): React.ReactNode[] {
  if (disableLinks) return text ? [<Text key={keyPrefix}>{text}</Text>] : [];
  const parts = text.split(URL_PATTERN);
  if (parts.length <= 1) return text ? [<Text key={keyPrefix}>{text}</Text>] : [];
  return parts
    .map((part, i) => {
      if (!part) return null;
      // String.split with a capturing group interleaves matches at odd
      // indices — every even index is plain text, every odd index a URL.
      return i % 2 === 0
        ? <Text key={`${keyPrefix}-${i}`}>{part}</Text>
        : <LinkRun key={`${keyPrefix}-${i}`} part={part} linkStyle={linkStyle} />;
    })
    .filter((n): n is React.ReactElement => n !== null);
}

/**
 * Renders a Message's stored text with both @mention blocks (see
 * buildMentionContextBlock/parseMentionSegments in services/storage.ts)
 * turned into a highlighted "@Name", AND any http(s)/www. URL turned into
 * a tappable link — a single combined pass so both can coexist in one
 * message without double-processing the same characters: mention blocks
 * are split out FIRST (a well-defined, unambiguous pattern), then each
 * resulting plain-text run is separately checked for URLs.
 */
export function LinkifiedText({
  text,
  style,
  linkStyle,
  numberOfLines,
  ellipsizeMode,
  disableLinks,
}: {
  text: string;
  style?: any;
  linkStyle?: any;
  numberOfLines?: number;
  ellipsizeMode?: "head" | "middle" | "tail" | "clip";
  disableLinks?: boolean;
}) {
  const mentionSegments = parseMentionSegments(text);

  if (mentionSegments.length === 1 && mentionSegments[0].type === "text") {
    const nodes = linkifyPlainRun(text, "t", linkStyle, disableLinks);
    if (nodes.length <= 1) return <Text style={style} numberOfLines={numberOfLines} ellipsizeMode={ellipsizeMode}>{text}</Text>;
    return <Text style={style} numberOfLines={numberOfLines} ellipsizeMode={ellipsizeMode}>{nodes}</Text>;
  }

  return (
    <Text style={style} numberOfLines={numberOfLines} ellipsizeMode={ellipsizeMode}>
      {mentionSegments.map((s, i) =>
        s.type === "mention" ? (
          // Bold only, no color override — a fixed accent color (e.g.
          // theme.primary, a purple) reads muddy against a colored bubble
          // background like the app's blue outgoing bubble. Bold inherits
          // whatever color the surrounding `style` already set, so it
          // stays legible against any bubble/background this renders on.
          <Text key={i} style={{ fontFamily: "Inter_700Bold" }}>
            @{s.text}
          </Text>
        ) : (
          linkifyPlainRun(s.text, `t${i}`, linkStyle, disableLinks)
        ),
      )}
    </Text>
  );
}
