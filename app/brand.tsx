import { useState, useEffect, useRef, useCallback } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { CaretLeft, CaretRight, ArrowCounterClockwise, Check } from "phosphor-react-native";
import { Host, ColorPicker } from "@expo/ui/swift-ui";
import { BottomSheetModal, BottomSheetView } from "@expo/ui/community/bottom-sheet";
import { useTheme } from "../hooks/useTheme";
import { useColorScheme } from "../hooks/useColorScheme";
import { useUser } from "../contexts/UserContext";
import { getAppUser } from "../services/firebase";
import { saveBrandSettings, BrandSettings } from "../services/storage";
import { BRAND_FONT_OPTIONS, getBrandFontOption } from "../constants/brandFonts";
import { deriveBrandPalette } from "../services/colorMath";

const DEFAULT_BRAND: BrandSettings = {
  headerFontId: "inter",
  bodyFontId: "inter",
  primaryColor: "#4F46E5",
};

// Replaces an earlier native SwiftUI pickerStyle("menu") Picker — that
// component bridges to a UIKit UIMenu internally, and UIMenu/UIAction's
// public API only accepts a plain-text title with NO way to set a per-row
// font (confirmed: no attributedTitle-equivalent is exposed on iOS, unlike
// AppKit's NSMenuItem). A .font()/font({family}) modifier on the SwiftUI
// Text passed into the Picker's content closure is silently ignored once
// SwiftUI hands the row off to UIMenu for rendering — every row rendered in
// the system font regardless of what family was requested, with no error.
// A custom BottomSheetModal list is the only way to actually render each
// font option in its own real typeface, since it's plain RN Text under our
// own control rather than native UIKit menu chrome. Matches the
// BottomSheetModal pattern already used elsewhere in this app (e.g.
// HumanInputSheet.tsx) rather than inventing a new modal mechanism.
function FontPickerSheet({
  isPresented,
  selectedId,
  onSelect,
  onClose,
}: {
  isPresented: boolean;
  selectedId: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const sheetRef = useRef<any>(null);

  useEffect(() => {
    if (isPresented) {
      sheetRef.current?.present();
    } else {
      sheetRef.current?.dismiss();
    }
  }, [isPresented]);

  return (
    <BottomSheetModal ref={sheetRef} enablePanDownToClose onDismiss={onClose}>
      <BottomSheetView>
        <View style={styles.fontSheetContainer}>
          {BRAND_FONT_OPTIONS.map((opt, i) => {
            const isSelected = opt.id === selectedId;
            const isLast = i === BRAND_FONT_OPTIONS.length - 1;
            return (
              <Pressable
                key={opt.id}
                onPress={() => {
                  onSelect(opt.id);
                  onClose();
                }}
                style={({ pressed }) => [
                  isLast ? styles.rowNoBorder : styles.row,
                  !isLast && { borderBottomColor: theme.separator },
                  { opacity: pressed ? 0.6 : 1 },
                ]}
              >
                {/* Rendered in the font it actually represents — plain RN
                    Text with a real fontFamily, unlike the native menu this
                    replaces, which could only ever show system-font labels. */}
                <Text style={[styles.rowLabel, { color: theme.surface, fontFamily: opt.family }]}>
                  {opt.label}
                </Text>
                {isSelected && <Check size={18} color={theme.primary} weight="bold" />}
              </Pressable>
            );
          })}
        </View>
      </BottomSheetView>
    </BottomSheetModal>
  );
}

function FontPickerRow({
  label,
  selectedId,
  onSelect,
  isLast,
}: {
  label: string;
  selectedId: string;
  onSelect: (id: string) => void;
  isLast?: boolean;
}) {
  const theme = useTheme();
  const selected = getBrandFontOption(selectedId);
  const [sheetOpen, setSheetOpen] = useState(false);
  return (
    <>
      <Pressable
        onPress={() => setSheetOpen(true)}
        style={({ pressed }) => [
          isLast ? styles.rowNoBorder : styles.row,
          !isLast && { borderBottomColor: theme.separator },
          { opacity: pressed ? 0.6 : 1 },
        ]}
      >
        <View style={styles.rowLeft}>
          <Text style={[styles.rowLabel, { color: theme.surface, fontFamily: "Inter_400Regular" }]}>
            {label}
          </Text>
        </View>

        <View style={styles.statusRow}>
          <Text style={[styles.statusText, { color: theme.primary, fontFamily: "Inter_500Medium" }]}>
            {selected.label}
          </Text>
          <CaretRight size={14} color={theme.primary} weight="bold" />
        </View>
      </Pressable>

      <FontPickerSheet
        isPresented={sheetOpen}
        selectedId={selectedId}
        onSelect={onSelect}
        onClose={() => setSheetOpen(false)}
      />
    </>
  );
}

function ColorSwatchRow({
  label,
  color,
  onChange,
  scheme,
  isLast,
  disabled,
}: {
  label: string;
  color: string;
  onChange?: (hex: string) => void;
  scheme: string;
  isLast?: boolean;
  // Derived colors (Background/Surface/Secondary/Accent) are shown for
  // transparency only — no picker on either platform, just a swatch + hex,
  // dimmed to read as non-interactive since they're computed from Primary,
  // never independently editable.
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <View style={[isLast ? styles.rowNoBorder : styles.row, !isLast && { borderBottomColor: theme.separator }, disabled && { opacity: 0.55 }]}>
      <View style={styles.rowLeft}>
        <View style={[styles.swatch, { backgroundColor: color, borderColor: theme.cardBorder }]} />
        <Text style={[styles.rowLabel, { color: theme.surface, fontFamily: "Inter_400Regular" }]}>
          {label}
        </Text>
      </View>
      {!disabled && Platform.OS === "ios" ? (
        <Host colorScheme={scheme as "light" | "dark"} style={styles.colorPickerHost}>
          <ColorPicker selection={color} onSelectionChange={onChange!} />
        </Host>
      ) : (
        <Text style={[styles.rowLabel, { color: theme.muted, fontFamily: "Inter_400Regular" }]}>
          {color}
        </Text>
      )}
    </View>
  );
}

export default function BrandScreen() {
  const theme = useTheme();
  const scheme = useColorScheme();
  const router = useRouter();
  const { userDoc } = useUser();

  const [brand, setBrand] = useState<BrandSettings>(DEFAULT_BRAND);
  const brandRef = useRef(brand);
  brandRef.current = brand;
  const loadedFromDocRef = useRef(false);

  useEffect(() => {
    if (userDoc?.brandSettings && !loadedFromDocRef.current) {
      setBrand(userDoc.brandSettings);
      loadedFromDocRef.current = true;
    }
  }, [userDoc?.brandSettings]);

  // Auto-save on unmount (i.e. navigating back), no explicit Save button.
  useEffect(() => {
    return () => {
      const user = getAppUser();
      if (user) saveBrandSettings(user.uid, brandRef.current);
    };
  }, []);

  const headerFont = getBrandFontOption(brand.headerFontId);
  const bodyFont = getBrandFontOption(brand.bodyFontId);
  // Recomputed on every render as brand.primaryColor changes, so the wheel
  // drag preview and the derived swatch rows below update live.
  const palette = deriveBrandPalette(brand.primaryColor);

  const handleBack = useCallback(() => {
    router.canGoBack() ? router.back() : router.replace("/(main)/settings");
  }, [router]);

  const handleReset = () => setBrand(DEFAULT_BRAND);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={["top"]}>
      <View style={[styles.navBar, { borderBottomColor: theme.separator }]}>
        <Pressable onPress={handleBack} style={styles.backBtn} hitSlop={12}>
          <CaretLeft size={20} color={theme.primary} weight="bold" />
          <Text style={[styles.backLabel, { color: theme.primary, fontFamily: "Inter_400Regular" }]}>
            Settings
          </Text>
        </Pressable>
        <Text style={[styles.navTitle, { color: theme.surface, fontFamily: "Inter_600SemiBold" }]}>
          Document Branding
        </Text>
        <Pressable onPress={handleReset} hitSlop={12} style={styles.resetBtn}>
          <ArrowCounterClockwise size={16} color={theme.muted} weight="bold" />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={[styles.previewCard, { backgroundColor: palette.background, borderColor: theme.cardBorder }]}>
          <View style={[styles.previewAccentBar, { backgroundColor: brand.primaryColor }]} />
          <Text
            style={[styles.previewHeader, { color: palette.surface, fontFamily: headerFont.familyBold }]}
            numberOfLines={1}
          >
            Heading
          </Text>
          <View style={styles.previewRow}>
            <Text
              style={[styles.previewSubheader, { color: palette.surface, fontFamily: bodyFont.familyBold }]}
              numberOfLines={1}
            >
              Text
            </Text>
            <View style={[styles.previewAccentPill, { backgroundColor: palette.accent }]}>
              <Text style={[styles.previewAccentPillText, { color: palette.background, fontFamily: bodyFont.familyBold }]}>Accent</Text>
            </View>
          </View>
        </View>

        <Text style={[styles.sectionLabel, { color: theme.muted, fontFamily: "Inter_600SemiBold" }]}>
          FONTS
        </Text>
        <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
          <FontPickerRow
            label="Header Font"
            selectedId={brand.headerFontId}
            onSelect={(id) => setBrand((b) => ({ ...b, headerFontId: id }))}
          />
          <FontPickerRow
            label="Body Font"
            selectedId={brand.bodyFontId}
            isLast
            onSelect={(id) => setBrand((b) => ({ ...b, bodyFontId: id }))}
          />
        </View>

        <Text style={[styles.sectionLabel, { color: theme.muted, fontFamily: "Inter_600SemiBold" }]}>
          COLOR PALETTE
        </Text>
        <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
          <ColorSwatchRow
            label="Primary"
            color={brand.primaryColor}
            scheme={scheme}
            onChange={(hex) => setBrand((b) => ({ ...b, primaryColor: hex }))}
          />
          <ColorSwatchRow label="Background" color={palette.background} scheme={scheme} disabled />
          <ColorSwatchRow label="Surface" color={palette.surface} scheme={scheme} disabled />
          <ColorSwatchRow label="Secondary" color={palette.secondary} scheme={scheme} disabled />
          <ColorSwatchRow label="Accent" color={palette.accent} scheme={scheme} isLast disabled />
        </View>

        <Text style={[styles.footnote, { color: theme.muted, fontFamily: "Inter_400Regular" }]}>
          Background, Surface, Secondary, and Accent are derived automatically from Primary — pick Primary and the rest follow. Applied to every document (Word, PowerPoint, Excel, PDF) the agent creates for you.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  navBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { flexDirection: "row", alignItems: "center", gap: 4, minWidth: 80 },
  backLabel: { fontSize: 16 },
  navTitle: { fontSize: 16 },
  resetBtn: { minWidth: 80, alignItems: "flex-end" },
  scrollContent: { padding: 20, paddingBottom: 60, gap: 4 },
  sectionLabel: { fontSize: 11, letterSpacing: 0.8, marginTop: 20, marginBottom: 10 },
  card: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowNoBorder: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  rowLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
  rowLabel: { fontSize: 15 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  statusText: { fontSize: 13 },
  fontSheetContainer: { paddingBottom: 24 },
  swatch: { width: 24, height: 24, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth },
  colorPickerHost: { width: 44, height: 30 },
  previewCard: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    padding: 14,
    gap: 4,
  },
  previewAccentBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 4,
  },
  previewHeader: { fontSize: 17, marginTop: 6 },
  previewRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  previewSubheader: { fontSize: 13, flexShrink: 1 },
  previewAccentPill: {
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  previewAccentPillText: { fontSize: 11 },
  footnote: { fontSize: 12, lineHeight: 17, marginTop: 20, textAlign: "center" },
});
