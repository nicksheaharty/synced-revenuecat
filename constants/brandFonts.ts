// Curated set of Google Fonts available for document branding. `label` is a
// DISPLAY-ONLY name shown in the settings UI — deliberately NOT the real
// font's name, because the real name is not a reliable promise across every
// output format this app generates. `googleName` is the exact font name
// passed to PDF generation (WeasyPrint, via the bundled TTFs in
// functions-py/fonts/ + an explicit @font-face rule — see prompt.ts's
// BRAND STYLE section) — genuinely accurate there, since those exact font
// files are bundled and registered. It is NOT what gets used for
// .docx/.pptx/.xlsx generation: those libraries just emit a font NAME
// string and trust whatever's installed in the headless LibreOffice
// container that renders/converts them (functions-py/Dockerfile), which has
// none of these 8 fonts installed — only Liberation Sans/Serif (see
// OFFICE_FONT_NAMES in prompt.ts for the real substitute each one resolves
// to there). Showing the real Google Fonts name in Settings implied a
// promise ("your document will look like Playfair Display") that was never
// true for 3 of the 4 document formats this app produces — the made-up
// `label` here avoids making that promise in the UI at all.
// `family`/`familyBold` are the @expo-google-fonts/* PACKAGE EXPORT NAMES
// (e.g. "Inter_400Regular"), registered in app/_layout.tsx's useFonts call —
// this is the alias React Native's OWN font system (expo-font, JS-side)
// resolves by, so it's the correct string for a plain RN <Text
// style={{fontFamily}}>, like the live preview card in app/brand.tsx.
//
// `postscriptFamily` is a DIFFERENT string, used ONLY by the native SwiftUI
// font picker menu (also in app/brand.tsx) — SwiftUI's Font.custom(_:)
// resolves fonts by the PostScript name baked into the font file's own
// `name` table (nameID 6), NOT by whatever alias string expo-font's
// CTFontManagerRegisterFontsForURL call happened to register it under. Confirmed
// per-font by extracting nameID 6 directly from each bundled
// @expo-google-fonts/*.ttf file — every one of these follows the pattern
// "FamilyName-Weight" (hyphenated, no underscore, no size prefix), which is
// NOT derivable from the `family`/`familyBold` alias strings by any
// mechanical transform, so it's listed explicitly rather than computed.
// Passing the wrong string to Font.custom() fails SILENTLY (falls back to
// the system font, no error) — this was a real, confirmed bug: the font
// picker menu rendered every option in the same system font despite the
// (wrong) family alias being passed to font({ family: ... }).
export interface BrandFontOption {
  id: string;
  label: string;
  googleName: string;
  family: string;
  familyBold: string;
  postscriptFamily: string;
}

export const BRAND_FONT_OPTIONS: BrandFontOption[] = [
  { id: "inter", label: "Modern Sans", googleName: "Inter", family: "Inter_400Regular", familyBold: "Inter_700Bold", postscriptFamily: "Inter-Regular" },
  { id: "poppins", label: "Rounded Sans", googleName: "Poppins", family: "Poppins_400Regular", familyBold: "Poppins_700Bold", postscriptFamily: "Poppins-Regular" },
  { id: "playfair", label: "Elegant Serif", googleName: "Playfair Display", family: "PlayfairDisplay_400Regular", familyBold: "PlayfairDisplay_700Bold", postscriptFamily: "PlayfairDisplay-Regular" },
  { id: "montserrat", label: "Geometric Sans", googleName: "Montserrat", family: "Montserrat_400Regular", familyBold: "Montserrat_700Bold", postscriptFamily: "Montserrat-Regular" },
  { id: "merriweather", label: "Classic Serif", googleName: "Merriweather", family: "Merriweather_400Regular", familyBold: "Merriweather_700Bold", postscriptFamily: "Merriweather-Regular" },
  { id: "lora", label: "Literary Serif", googleName: "Lora", family: "Lora_400Regular", familyBold: "Lora_700Bold", postscriptFamily: "Lora-Regular" },
  { id: "roboto", label: "Clean Sans", googleName: "Roboto", family: "Roboto_400Regular", familyBold: "Roboto_700Bold", postscriptFamily: "Roboto-Regular" },
  { id: "worksans", label: "Neutral Sans", googleName: "Work Sans", family: "WorkSans_400Regular", familyBold: "WorkSans_700Bold", postscriptFamily: "WorkSans-Regular" },
];

export function getBrandFontOption(id: string | undefined): BrandFontOption {
  return BRAND_FONT_OPTIONS.find((f) => f.id === id) ?? BRAND_FONT_OPTIONS[0];
}
