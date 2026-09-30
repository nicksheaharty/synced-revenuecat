import { Colors } from "../constants/colors";
import { useColorScheme } from "./useColorScheme";

export function useTheme() {
  const scheme = useColorScheme();
  return scheme === "dark" ? Colors.dark : Colors.light;
}
