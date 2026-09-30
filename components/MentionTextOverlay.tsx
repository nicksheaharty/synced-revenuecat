import { Text, StyleSheet } from "react-native";
import { useTheme } from "../hooks/useTheme";
import type { Profile } from "../services/storage";

export interface OverlayMentionRange {
  start: number;
  end: number;
  name: string;
  source: Profile["source"];
}

interface MentionTextOverlayProps {
  text: string;
  mentions: OverlayMentionRange[];
  // The real TextInput's OWN style — box sizing: flex/padding, AND font:
  // size/family/lineHeight/letterSpacing/color — applied wholesale to this
  // component's root Text so the overlay occupies the identical box. Can be
  // a style array (as AddAgentTaskSheet.tsx passes it); this component
  // flattens it via StyleSheet.flatten before reading individual fields
  // (fontStyle below) — reading e.g. `.fontSize` directly off an
  // un-flattened array returns undefined (arrays don't proxy property
  // lookups into their elements), which was a real bug here: every nested
  // mention span silently fell back to RN's own default text size/font
  // instead of matching the real input, rendering visibly oversized and
  // misaligned against the surrounding plain-text runs.
  textStyle: any;
}

// Renders `text` with each mention range shown as primary-colored "@Name"
// inline text — stacked exactly behind the real (invisible-text) TextInput
// in AddAgentTaskSheet.tsx so typing/cursor/selection keep working exactly
// like a plain input while what's visually shown is styled.
//
// Deliberately COLOR-ONLY styling (no bold, no icon): every other variant
// tried here (inline icon content, reserved-placeholder-space + icon,
// absolutely positioned icon, bolder fontFamily) either added real layout
// width the real invisible TextInput's plain "@Name" string doesn't have,
// or changed individual glyph widths via a different font weight — both
// desync the real cursor from what's visually drawn. Color is the ONLY
// style property here that doesn't affect layout metrics at all, which is
// what keeps the overlay character-for-character identical (same font,
// same weight, same size) to the real input's plain string — the actual
// requirement for the cursor to stay aligned.
export function MentionTextOverlay({ text, mentions, textStyle }: MentionTextOverlayProps) {
  const theme = useTheme();
  const sorted = [...mentions].sort((a, b) => a.start - b.start);
  const flatStyle = StyleSheet.flatten(textStyle) || {};

  // Font-only subset for nested spans — box properties (flex/padding) live
  // solely on the root Text below via the full (still un-flattened, RN
  // flattens style arrays natively on any host component) textStyle.
  const fontStyle = {
    fontSize: flatStyle.fontSize,
    color: flatStyle.color,
    fontFamily: flatStyle.fontFamily,
    lineHeight: flatStyle.lineHeight,
    letterSpacing: flatStyle.letterSpacing,
  };

  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  sorted.forEach((m, i) => {
    if (m.start > cursor) {
      nodes.push(
        <Text key={`t-${i}`} style={fontStyle}>
          {text.slice(cursor, m.start)}
        </Text>,
      );
    }
    // Color only — NOT a bolder fontFamily (there was a "Inter_600SemiBold"
    // override here before). Different weights of the same type family
    // measure different glyph widths at the same fontSize, which is the
    // same class of bug as the earlier icon/default-font mismatches: it
    // made this run visibly a different size than the surrounding text AND
    // wider than the real input's identical characters, so the real cursor
    // drifted further out of alignment. Matching weight exactly is
    // required for the overlay and real input to stay pixel-aligned — this
    // isn't a styling preference.
    nodes.push(
      <Text key={`m-${i}`} style={[fontStyle, { color: theme.primary }]}>
        {text.slice(m.start, m.end)}
      </Text>,
    );
    cursor = m.end;
  });
  if (cursor < text.length) {
    nodes.push(
      <Text key="t-last" style={fontStyle}>
        {text.slice(cursor)}
      </Text>,
    );
  }

  return (
    <Text style={textStyle} pointerEvents="none">
      {nodes}
    </Text>
  );
}
