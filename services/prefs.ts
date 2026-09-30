import { File, Paths } from "expo-file-system";

export type ThemePreference = "light" | "dark" | "system";

function prefsFile() {
  return new File(Paths.document, "synced_prefs.json");
}

interface Prefs {
  theme: ThemePreference;
}

async function read(): Promise<Prefs> {
  try {
    const f = prefsFile();
    if (!f.exists) return { theme: "system" };
    return JSON.parse(await f.text());
  } catch {
    return { theme: "system" };
  }
}

async function write(prefs: Prefs): Promise<void> {
  prefsFile().write(JSON.stringify(prefs));
}

export async function getThemePreference(): Promise<ThemePreference> {
  return (await read()).theme;
}

export async function setThemePreference(
  theme: ThemePreference,
): Promise<void> {
  await write({ ...(await read()), theme });
}
