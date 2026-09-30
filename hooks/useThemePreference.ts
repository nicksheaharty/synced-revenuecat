import { useState, useEffect, createContext, useContext } from "react";
import {
  getThemePreference,
  setThemePreference,
  ThemePreference,
} from "../services/prefs";
import { Appearance } from "react-native";

export const ThemePreferenceContext = createContext<{
  preference: ThemePreference;
  setPreference: (p: ThemePreference) => void;
}>({ preference: "system", setPreference: () => {} });

export function useThemePreference() {
  return useContext(ThemePreferenceContext);
}

export function useThemePreferenceState() {
  const [preference, setPreferenceState] = useState<ThemePreference>("system");

  const applyAppearance = (p: ThemePreference) => {
    if (p === "system") {
      // React Native 0.85 uses "unspecified" to remove an app-level
      // override and resume following the OS. Passing null was the old
      // behavior and is no longer part of the SDK 56 API contract.
      Appearance.setColorScheme("unspecified");
    } else {
      Appearance.setColorScheme(p);
    }
  };

  useEffect(() => {
    getThemePreference().then((p) => {
      setPreferenceState(p);
      applyAppearance(p);
    });
  }, []);

  const setPreference = (p: ThemePreference) => {
    setPreferenceState(p);
    setThemePreference(p);
    applyAppearance(p);
  };

  return { preference, setPreference };
}
