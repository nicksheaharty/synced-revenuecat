import { useColorScheme as useNativeColorScheme } from "react-native";
import { useContext } from "react";
import { ThemePreferenceContext } from "./useThemePreference";

export function useColorScheme(): "light" | "dark" {
  // React Native's hook owns the native subscription and reads Appearance on
  // every render. Keeping a second cached copy here made a temporary value
  // from an app-level Light/Dark override look like the last known OS value.
  const system = useNativeColorScheme();
  const { preference } = useContext(ThemePreferenceContext);
  if (preference === "system") return system === "dark" ? "dark" : "light";
  return preference;
}
