// Single source of truth for each connector's display label, brand icon, and
// brand color — shared between app/(main)/settings.tsx (the connectors list)
// and components/ConnectPermissionsSheet.tsx (the pre-connect permissions
// sheet), so a connector's icon/color can never drift between the two.
// Lives in constants/ rather than being exported from settings.tsx to avoid
// a circular import (settings.tsx already imports ConnectPermissionsSheet).
import type { ComponentType } from "react";
import type { useColorScheme } from "../hooks/useColorScheme";
import {
  ChatCircle,
  MicrosoftOutlookLogo,
  MicrosoftTeamsLogo,
  GoogleDriveLogo,
  DropboxLogo,
  GithubLogo,
  SlackLogo,
  Calendar,
  WhatsappLogo,
  Cloud,
} from "phosphor-react-native";
import { GmailIcon, NotionIcon, ZoomIcon } from "../components/SimpleIcons";

export const CONNECTOR_META: Record<
  string,
  {
    label: string;
    Icon: ComponentType<any>;
    // Either a fixed brand color, or a function of the current color scheme
    // — needed for monochrome brand marks like Notion/GitHub's black
    // wordmark, which is invisible against a dark background and needs to
    // flip to white in dark mode (same as those apps' own icon treatment).
    color: string | ((scheme: ReturnType<typeof useColorScheme>) => string);
    type: "input" | "output";
  }
> = {
  gmail: { label: "Gmail", Icon: GmailIcon, color: "#EA4335", type: "input" },
  outlook: {
    label: "Outlook",
    Icon: MicrosoftOutlookLogo,
    color: "#0078D4",
    type: "input",
  },
  slack: {
    label: "Slack",
    Icon: SlackLogo,
    color: "#E01E5A",
    type: "input",
  },
  teams: {
    label: "Microsoft Teams",
    Icon: MicrosoftTeamsLogo,
    color: "#6264A7",
    type: "input",
  },
  whatsapp: {
    label: "WhatsApp Business",
    Icon: WhatsappLogo,
    color: "#25D366",
    type: "input",
  },
  zoom: {
    label: "Zoom",
    Icon: ZoomIcon,
    color: "#2D8CFF",
    type: "input",
  },
  imessage: {
    label: "iMessage",
    Icon: ChatCircle,
    color: "#30D158",
    type: "input",
  },
  drive: {
    label: "Drive",
    Icon: GoogleDriveLogo,
    color: "#34A853",
    type: "output",
  },
  onedrive: {
    label: "OneDrive",
    Icon: Cloud,
    color: "#0078D4",
    type: "output",
  },
  dropbox: {
    label: "Dropbox",
    Icon: DropboxLogo,
    color: "#0061FF",
    type: "output",
  },
  notion: {
    label: "Notion",
    Icon: NotionIcon,
    color: (scheme) => (scheme === "dark" ? "#FFFFFF" : "#000000"),
    type: "output",
  },
  github: {
    label: "GitHub",
    Icon: GithubLogo,
    color: (scheme) => (scheme === "dark" ? "#FFFFFF" : "#000000"),
    type: "output",
  },
  calendar: {
    label: "Calendar",
    Icon: Calendar,
    color: "#4285F4",
    type: "output",
  },
};

// Connector ids that exist in CONNECTOR_META but aren't actually
// connectable yet — shown dimmed/"Coming Soon" wherever a connector list
// renders (Settings' Signals/Connectors sections AND onboarding's Signals
// screen, both driven off this same set so neither can drift from the
// other — see app/(main)/settings.tsx and app/(onboarding)/connectors.tsx).
export const COMING_SOON_IDS = new Set([
  "imessage",
  "whatsapp",
  "zoom",
  "dropbox",
  "notion",
  "github",
]);
