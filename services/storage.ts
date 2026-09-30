import { File, Paths } from "expo-file-system";
import {
  collection,
  doc,
  setDoc,
  query,
  where,
  onSnapshot,
  deleteDoc,
  Timestamp,
  getDocs,
  getDoc,
  deleteField,
  arrayUnion,
  arrayRemove,
  runTransaction,
} from "firebase/firestore";
import { ref as storageRef, getDownloadURL } from "firebase/storage";
import { db, storage, subscribeToAuth, getAppUser, getAppIdToken, STORAGE_BUCKET } from "./firebase";

// First + last name initials (e.g. "Aum Dhruv" -> "AD") for the avatar
// fallback circle — shared by every client-side profile-creation path
// (app/_layout.tsx, app/index.tsx, app/receive-message.tsx) so a contact
// with no real photo shows two initials, not just one. Mirrors the
// identically-named helper in functions/src/index.ts for the same field
// set server-side. Single-word names fall back to just the one initial.
export function deriveInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

const GOOGLE_DEFAULT_AVATAR_PATH = "/a/default-user";

/** Google returns this URL for accounts without a real profile photo. */
export function isDefaultProfileAvatar(uri?: string | null): boolean {
  if (!uri) return true;
  return uri.toLowerCase().includes(GOOGLE_DEFAULT_AVATAR_PATH);
}

/** First usable image in priority order, excluding provider placeholders. */
export function resolveProfileAvatarUri(
  ...uris: (string | null | undefined)[]
): string | undefined {
  return uris.find((uri): uri is string => !!uri && !isDefaultProfileAvatar(uri));
}

/**
 * Exactly two characters for avatar fallbacks. Multi-word names use first
 * and last initials; single-word names use their first two characters.
 */
export function deriveAvatarInitials(name?: string, storedInitials?: string): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
  }
  const candidate = (parts[0] || storedInitials || "?")
    .replace(/\s/g, "")
    .toUpperCase();
  if (candidate.length >= 2) return candidate.slice(0, 2);
  return candidate.repeat(2).slice(0, 2);
}

/**
 * Joins a group's member names into a short header display, iMessage-style
 * ("Alice & Bob", "Alice, Bob & Carol") — first names only, matching
 * iMessage's own convention for keeping a multi-person header short. Falls
 * back to the raw identifier when a member has no name on file.
 */
export function deriveGroupDisplayName(members: Profile[]): string {
  const firstNames = members.map((p) => (p.name || p.platformIdentifier).split(/\s+/)[0]);
  if (firstNames.length === 0) return "Group";
  if (firstNames.length === 1) return firstNames[0];
  if (firstNames.length === 2) return `${firstNames[0]} & ${firstNames[1]}`;
  return `${firstNames.slice(0, -1).join(", ")} & ${firstNames[firstNames.length - 1]}`;
}

export function generateRandomId(
  prefix: "profile" | "task" | "profiles" | "tasks" | "msg" | "messages",
): string {
  const collectionName = prefix === "msg" ? "messages" : prefix.endsWith("s") ? prefix : `${prefix}s`;
  if (db) {
    return doc(collection(db, collectionName)).id;
  }
  const chars =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 0; i < 20; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Turns an arbitrary identifier (email address, Slack team+user id, Teams
 * user id) into a safe id-fragment — mirrors the identically-named helper
 * in functions/src/tools/helpers.ts, kept in lockstep since both sides
 * derive the same accountId from the same input (see OAuthAccount.accountId).
 */
export function slugify(key: string): string {
  return key.replace(/[^a-z0-9]/gi, "_").toLowerCase().substring(0, 30);
}

function storageFile(key: string): File {
  return new File(Paths.document, `synced_${key}.json`);
}

async function read(key: string): Promise<string | null> {
  try {
    const file = storageFile(key);
    if (!file.exists) return null;
    return file.text();
  } catch {
    return null;
  }
}

async function write(key: string, value: string): Promise<void> {
  const file = storageFile(key);
  file.write(value);
}

export interface Connector {
  id: "imessage" | "gmail" | "drive" | "calendar" | "whatsapp" | "slack" | "teams" | "reddit" | "x" | "telegram" | "outlook" | "onedrive" | "dropbox" | "notion" | "github" | "zoom";
  connected: boolean;
  // Once accountCount>=1, this is the DEFAULT account's email — kept for
  // back-compat with the single-account display everywhere that only ever
  // showed one identity per provider row (see accountCount's own comment
  // for when multiple accounts are involved instead).
  email?: string;
  // Number of ACTIVE accounts connected for this provider — 0 when
  // disconnected, 1 for the common case (renders identically to before
  // multi-account support existed), >1 triggers the "N accounts connected"
  // subtitle and unlocks per-account management on connector-settings/[id].
  accountCount: number;
}

export interface OAuthAccount {
  // Stable identifier for THIS specific connected account, derived from the
  // provider's own resolved identity (email for Gmail/Outlook/Drive/
  // OneDrive, teamsUserId for Teams, `${teamId}_${slackUserId}` for Slack —
  // see slugify above) — NOT the array index, which shifts as accounts are
  // added/removed. Two connect attempts that resolve to the SAME underlying
  // account collide on this id, which is what the connect flow (Stage C)
  // uses to reject a duplicate-account reconnect rather than silently
  // merging it.
  accountId: string;
  // Exactly one entry per provider array has this true — the account used
  // for a brand-new outbound task with no triggering inbound message to
  // inherit an account from (see functions/src/index.ts's onTaskCreated).
  // The first account ever connected for a provider is isDefault:true by
  // construction; every later connect defaults to false unless the user
  // explicitly changes it via connector-settings/[id]'s "Set as Default".
  isDefault: boolean;
  provider: "google" | "microsoft" | "slack" | string;
  email?: string;
  accessToken: string;
  refreshToken?: string;
  expiryDate?: string;
  scopes: string[];
  status: "active" | "expired" | "revoked";
  connectedAt: string;
  updatedAt: string;
  meta?: Record<string, any>;
}

// Kept importable under the old name — ~20+ existing call sites (mostly
// services/oauth.ts) import OAuthIntegration and constructing an
// OAuthAccount is a strict superset of that shape, so no call site needs to
// change just because of this rename.
export type OAuthIntegration = OAuthAccount;

// Human-readable label for one account — email for most providers, falling
// back to whatever identity Slack/Teams actually saved (Slack rarely grants
// users:read.email — see completeSlackOAuth in functions/src/index.ts — so
// its accounts usually only have a workspace/display name in `meta`, not
// `email`). Shared by app/connector-settings/[id].tsx's account rows and
// components/HitlApproveMode.tsx's/HitlApproveCalendarMode.tsx's From
// dropdowns, so all three render the exact same label for a given account.
export function accountLabel(account: OAuthAccount): string {
  return (
    account.email ||
    [account.meta?.displayName, account.meta?.teamName].filter(Boolean).join(" · ") ||
    account.accountId
  );
}

export interface UserDocument {
  uid: string;
  email?: string;
  phoneNumber?: string;
  fullName?: string;
  createdAt: string;
  updatedAt: string;
  integrations: {
    [providerId: string]: OAuthAccount[];
  };
  // Denormalized "does this provider have at least one active account"
  // flags — maintained by saveOAuthIntegration/removeOAuthIntegration
  // (Stage C) alongside the integrations array write. Exist purely so the
  // webhook-subscription renewal crons (functions/src/index.ts's
  // renewGmailWatch/renewOutlookSubscriptions/renewTeamsSubscriptions) can
  // keep querying efficiently — Firestore has no way to query "array
  // contains an element whose status field equals X" the way the old
  // single-object integrations.gmail.status dot-path query could. Slack
  // has no renewal cron (its subscriptions don't expire), so no
  // hasActiveSlack field exists.
  hasActiveGmail?: boolean;
  hasActiveOutlook?: boolean;
  hasActiveTeams?: boolean;
  brandSettings?: BrandSettings;
  // Developer Beta toggle (Settings > Developer Beta) — when true, the agent
  // still runs its full normal reasoning/drafting/HITL flow for every task,
  // but send_email/create_calendar_event/modify_calendar_event/
  // send_slack_message/send_teams_message skip the real external API call
  // and return a realistic fake success response instead (see
  // ToolContext.sandboxMode in functions/src/tools/types.ts). Lets a user
  // safely run/test the agent end-to-end without anything actually being
  // sent to a real contact.
  sandboxMode?: boolean;
  // Gmail/Outlook intake filter — see functions/src/pipeline.ts's
  // buildTriagePrompt Rule 1. "personalAndDirected" (default, also the
  // implicit behavior when this field is missing) only admits direct
  // human-to-human messages; "loosened" also admits group threads and
  // automated-but-directed notices (e.g. "verify your account") that still
  // require the user to act. Teams/Slack are unaffected — hardcoded.
  emailFilterMode?: "personalAndDirected" | "loosened";
  // Expo push tokens for every device this user has granted notification
  // permission on (see services/notifications.ts's registerForPushNotifications-
  // Async, called on login from contexts/UserContext.tsx). An array, not a
  // single string — a user logging in on a second device should keep
  // receiving notifications on the first, not silently lose them. Deduped
  // on write; the backend (functions/src/langchain/deep-agent-loop.ts's
  // task-completion write) sends to every token in this array.
  pushTokens?: string[];
  // RevenueCat entitlement state — written ONLY by the revenueCatWebhook
  // Firebase Function (functions/src/index.ts), never by the client. This is
  // the single source of truth the backend enforces against (weekly Action
  // Plan cap in functions/src/pipeline.ts's writeTriageTasks) and the app
  // reads for gating — never trust react-native-purchases' local CustomerInfo
  // for enforcement, only for optimistic UI. Absent entirely == free plan
  // (covers every user who existed before this shipped).
  subscription?: {
    plan: "free" | "pro";
    entitlementActive: boolean;
    productId?: string;
    willRenew?: boolean;
    periodEnd?: string; // ISO — RevenueCat's expires_date
    store?: "app_store" | "play_store";
    updatedAt: string;
  };
}

// Document-creation branding: which fonts/color the agent should use when
// generating docx/pptx/xlsx/pdf deliverables. Font ids reference
// constants/brandFonts.ts's curated list (the id, not the raw font name, is
// stored so the picker UI stays in sync — see getBrandFontOption).
// primaryColor is a plain hex string (#RRGGBB), matching @expo/ui's
// ColorPicker output format directly with no conversion needed. This is the
// ONLY stored color — background/surface/secondary/accent are never
// persisted, they're always derived fresh from primaryColor via
// deriveBrandPalette (services/colorMath.ts) wherever needed, so a derived
// value can never drift out of sync with its source.
export interface BrandSettings {
  headerFontId: string;
  bodyFontId: string;
  primaryColor: string;
}

export interface Profile {
  id: string;
  userId: string;
  name: string;
  senderInitial: string;
  avatarUri?: string;
  // User-uploaded override, set by tapping the avatar on the conversation
  // page (see saveCustomAvatar below) — always wins over avatarUri
  // wherever a profile's picture is rendered. Kept as a SEPARATE field
  // rather than overwriting avatarUri because avatarUri is periodically
  // re-derived server-side from the source (Gmail/Outlook contact photo,
  // Slack profile image, Gravatar — see functions/src/index.ts) and would
  // silently clobber a user's custom photo on the next sync otherwise.
  customAvatarUri?: string;
  source: "imessage" | "gmail" | "outlook" | "drive" | "calendar" | "whatsapp" | "slack" | "teams" | "synced";
  // The person's stable identity key for this source (email address / Slack
  // user id / Teams user id) — a Profile represents exactly ONE PERSON,
  // reused across every thread/topic they're ever part of with the
  // connected user, deduped by this field (see resolveSoloProfile in
  // functions/src/tools/helpers.ts). A multi-person conversation is a
  // GroupThread (see below), which REFERENCES the solo Profile ids of its
  // members rather than embedding participant data — this is what lets
  // group UI show each member's real, up-to-date photo instead of just
  // initials.
  platformIdentifier: string;
  // Which of this user's (possibly several) accounts of `source` this
  // person was observed on — see the multi-account OAuthAccount model
  // below. Part of the identity key alongside platformIdentifier: the SAME
  // external person messaging two different accounts of this user (e.g. a
  // work Gmail and a personal Gmail) resolves to TWO separate Profiles, by
  // design, since those are two genuinely separate inboxes/conversations.
  // Required going forward; absent only on pre-migration docs (backfilled —
  // see functions/scripts/migrate-multi-account-write.js).
  accountId?: string;
  // Teams only. Deliberate exception to "a solo Profile holds no
  // thread-specific data" — cached like latestMessageId (a routing hint so
  // a reply can go straight to POST /chats/{teamsChatId}/messages without a
  // lookup round-trip), not truly thread identity. Only meaningful for a
  // 1:1 Teams chat; a Teams GroupThread has its own teamsChatId instead.
  teamsChatId?: string;
  latestMessageId?: string;
  analyzed: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * A multi-person conversation (a thread with 2+ non-owner participants),
 * kept as a SEPARATE entity from Profile (which is now always exactly one
 * person) so group UI can resolve each member's real avatar/name from their
 * own Profile doc — participants[] previously embedded here had no avatar
 * field at all, which is the whole reason for this split. See
 * resolveGroupThread in functions/src/tools/helpers.ts.
 */
export interface GroupThread {
  id: string; // always "group_${userId.slice(0,8)}_${slug}" — the prefix is how every consumer (client and server) tells a GroupThread id apart from a solo Profile id without a lookup
  userId: string;
  source: "gmail" | "outlook" | "teams" | "slack"; // no imessage/drive/calendar/whatsapp/synced — those never produce true multi-party threads in this app
  // Which of this user's (possibly several) accounts of `source` this
  // thread was observed on — see Profile.accountId's doc comment for the
  // full rationale (same reasoning applies here: the "same" platform thread
  // key seen on two different accounts is two separate conversations).
  // Required going forward; absent only on pre-migration docs (backfilled).
  accountId?: string;
  // Stable platform-level thread/conversation id (Gmail threadId, Graph
  // conversationId, Teams chatId, Slack channel id) — same role
  // platformThreadKey played on the old thread-model Profile.
  platformThreadKey: string;
  // Solo Profile ids of every non-owner member ever observed on this
  // thread. Additive union — never shrinks when a later reply drops
  // someone from To/Cc (a person who was ever on the thread stays a
  // member).
  memberProfileIds: string[];
  // Optional user override of the joined-name display (e.g. renaming
  // "Bob, Carol & Dave" to "Launch Team"). Absent = always derive the
  // joined name from members' own Profile.name at render time. No avatar
  // override exists — a GroupThread's avatar is always the live cluster of
  // its members' own photos, by design.
  name?: string;
  teamsChatId?: string;
  latestMessageId?: string;
  analyzed: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * A single row in a conversation list (home screen, HITL sheets, etc.) — a
 * conversation is either a solo Profile (1:1) or a GroupThread (2+ people),
 * discriminated by `kind` so callers don't need to re-derive it from an id
 * prefix at every render site. `members` is resolved client-side by looking
 * up a GroupThread's memberProfileIds against the already-loaded `profiles`
 * array — no extra fetch needed.
 */
export type ConversationRow =
  | { kind: "solo"; profile: Profile }
  | { kind: "group"; group: GroupThread; members: Profile[] };

export interface MessageAttachment {
  name: string;
  url: string;
  type: string; // pdf, docx, xlsx, pptx, other
}

export interface Message {
  id: string;
  // Points at EITHER profiles/{id} (a 1:1 conversation) OR
  // groupThreads/{id} (a group conversation) — discriminated by whether the
  // id starts with "group_" (see GroupThread.id above), never both. Kept as
  // "profileId" rather than renamed since most consumers use it as an
  // opaque scoping key and never care which collection it resolves to.
  profileId: string;
  userId: string;
  // Which account of the parent Profile/GroupThread's provider this
  // specific message was sent/received on — optional, audit-only (the
  // authoritative value lives on the parent Profile/GroupThread doc; this
  // is a cheap denormalization for debugging/analytics, not something any
  // consumer needs to branch on today).
  accountId?: string;
  direction: "in" | "out";
  text: string;
  timestamp: string;
  platformMessageId?: string;
  subject?: string;
  taskId?: string;
  attachments?: MessageAttachment[];
  createdAt: string;
  // Optional discriminator for non-email outgoing traces (e.g. a calendar
  // event the agent created/modified). Absent/undefined means a normal
  // email message. `text` is always a human-readable summary regardless of
  // kind, so existing UI can render it unchanged without checking `kind`.
  kind?: "calendar_event";
  calendarEvent?: {
    id: string;
    htmlLink?: string;
    hangoutLink?: string;
  };
  // Who actually sent THIS message (email address / platform user id) —
  // distinct from the profile's aggregate identity, needed to attribute
  // individual messages correctly within a group-thread profile. Absent on
  // messages written before this field existed.
  senderIdentifier?: string;
}

export interface ImplementationStep {
  id: string;
  stepNumber: number;
  description: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  result?: string;
}

export interface RequiredDeliverable {
  id: string;
  type: "reply_draft" | "calendar_event" | "reminder" | "document_search";
  description: string;
  status: "pending" | "completed";
  value?: string;
}

export interface InputOption {
  id: string;
  label: string;
}

export interface HumanInputQuestion {
  id: string;
  prompt: string;
  // Optional quick-pick choices shown as buttons alongside a "Something
  // else..." option that reveals free text. Omit for open-ended questions —
  // the UI goes straight to a text box. `mode` is legacy (pre quick-pick
  // redesign) and only read as a fallback for in-flight tasks created before
  // this field was removed from new requests.
  options?: InputOption[];
  mode?: "text" | "pick";
}

// Mirrors the calendar tool's argument shape (functions/src/tools/calendar.ts,
// create_calendar_event/modify_calendar_event) plus an optional eventId when
// editing an existing event. Used both as the agent's PROPOSED draft
// (HumanInputRequest.calendarDraft) and as the human's EDITED result
// (HumanInputAnswer.editedEvent) — same shape both directions so the agent
// can tell what the human changed.
export interface CalendarEventDraft {
  eventId?: string; // set only when modifying an existing event
  summary: string;
  allDay?: boolean;
  startDateTime?: string; // ISO with offset; omit if allDay
  endDateTime?: string;
  startDate?: string; // YYYY-MM-DD; required if allDay
  endDate?: string; // YYYY-MM-DD, EXCLUSIVE end date; required if allDay
  timeZone?: string; // IANA tz name, e.g. "America/New_York"
  location?: string;
  description?: string;
  attendees?: string[]; // email addresses
  recurrence?: string[]; // RFC5545 RRULE lines, e.g. ["RRULE:FREQ=WEEKLY;COUNT=5"]
  reminders?: {
    useDefault: boolean;
    overrides?: { method: "popup" | "email"; minutes: number }[];
  };
  addGoogleMeet?: boolean;
  // Which connected calendar account owns this event — a "provider:
  // accountId" composite key (see components/useHitlAnswerState.ts's
  // accountKeyFor/parseAccountKey), since the From dropdown lists BOTH
  // Gmail and Outlook accounts together and a bare OAuthAccount.accountId
  // no longer says which provider it belongs to. Proposed by the agent as
  // whichever account ToolContext.calendarAccountId actually resolved to
  // (see functions/src/langchain/deep-agent-loop.ts), editable by the human
  // via HitlApproveCalendarMode's From dropdown before approving — picking
  // an account from the OTHER provider than the task's own mailbox switches
  // which API actually creates the event, not just which account. Absent on
  // drafts predating this field, or when only one calendar account total is
  // connected (nothing to choose between).
  fromAccountId?: string;
}

export interface HumanInputRequest {
  id: string;
  // "questions"       — multi-step Q&A (one or more questions answered before agent resumes)
  // "approve_calendar" — review/edit a proposed calendar event before it is created/modified
  // "approve"          — review a fully-written draft email and send or decline
  mode: "questions" | "approve_calendar" | "approve";
  // Firestore messages/{id} doc id of the inbound message that triggered
  // this pause (see functions/src/index.ts's triggeringMessageId). Not
  // present on HITL requests created before this field existed.
  messageId?: string;
  // For mode="questions"
  questions?: HumanInputQuestion[];
  // For mode="approve_calendar"
  calendarDraft?: CalendarEventDraft;
  // For mode="approve"
  draftContent?: string;
  // Untyped on the client (mirrors functions/src/langchain/tools.ts's
  // draftMetadataSchema) — known keys include medium, to, cc, bcc, subject,
  // threadId, originalMessageId, attachmentNames, and fromAccountId (the
  // agent's proposed sending account, a "provider:accountId" composite key
  // — see CalendarEventDraft.fromAccountId's identical doc comment for why
  // — used by HitlApproveMode's From dropdown and
  // HumanInputAnswer.editedFromAccountId).
  draftMetadata?: Record<string, any>;
  answer?: HumanInputAnswer;
}

export interface HumanInputAnswer {
  // For mode="questions": map of question id → answer string
  answers?: Record<string, string>;
  // For mode="approve_calendar" and mode="approve"
  approved?: boolean;
  textAnswer?: string; // edited draft body, for mode="approve"
  editedEvent?: CalendarEventDraft; // human's final edited values, for mode="approve_calendar"
  // For mode="approve": human-edited email envelope, overriding draftMetadata's proposed values
  editedTo?: string;
  editedCc?: string;
  editedBcc?: string;
  // Only ever set for a brand-new email (no threadId/originalMessageId on
  // draftMetadata) — a reply's subject is tied to the thread it's replying
  // in, so it isn't user-editable (see HitlApproveMode's isNewEmail check).
  editedSubject?: string;
  editedAttachmentNames?: string[];
  // For mode="approve": human-selected sending account — a "provider:
  // accountId" composite key (see CalendarEventDraft.fromAccountId's doc
  // comment), overriding draftMetadata.fromAccountId's proposed value. See
  // HitlApproveMode's From dropdown.
  editedFromAccountId?: string;
}

export interface HumanInputHistoryEntry {
  prompt: string;
  mode: "text" | "pick" | "approve_calendar" | "approve";
  answer: HumanInputAnswer;
}

export interface Task {
  id: string;
  // Points at EITHER profiles/{id} (1:1) OR groupThreads/{id} (group) — see
  // the identical doc comment on Message.profileId above for why the field
  // keeps this name rather than being renamed/split.
  profileId: string;
  userId: string;
  threadId?: string;
  title: string;
  assignee: "human" | "agent";
  // "inactive" — manually resolved (see the profile long-press "Resolve"
  // action) or automatically superseded by a later message the triage LLM
  // determined invalidated this task (see taskStatusUpdates in
  // functions/src/pipeline.ts). A dead end like "completed"/"failed": never
  // auto-resumed, never re-surfaced to triage as an existing task to update.
  status: "pending" | "in_progress" | "completed" | "failed" | "awaiting_human_input" | "inactive";
  // One-word present-participle label (e.g. "Searching", "Designing") set by
  // the agent loop for whichever tool it's currently executing — shown in
  // the UI right below the task title while running. Absent/cleared once
  // the task pauses for human input, completes, or fails.
  activityIndicator?: string;
  implementationPlan: ImplementationStep[];
  requiredDeliverables: RequiredDeliverable[];
  humanInputRequest?: HumanInputRequest;
  humanInputHistory?: HumanInputHistoryEntry[];
  dueDate?: string | null;
  dueDatePrecision?: "datetime" | "date" | "month" | null;
  createdAt: string;
  updatedAt: string;
  seen?: boolean;
  source?: string;
  // Which messaging medium this task's own reply goes through — backend-only
  // significance (see functions/src/langchain/prompt.ts's MediumSource /
  // MEDIUM_CONVENTIONS). The client only ever sets this to "synced" when
  // creating a self-issued agent task via the Add Agent Task sheet; every
  // other task leaves it unset and the backend defaults/derives it from the
  // task's profile itself.
  mediumSource?: "synced";
}

export interface Deliverable {
  id: string;
  userId: string;
  taskId: string;
  profileId?: string | null;
  name: string;
  type: "pdf" | "docx" | "xlsx" | "pptx" | "other";
  mimeType: string;
  url: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Groups a flat deliverables list by taskId, newest-first, deduped by
 * (taskId, name) — the same result 3 independent call sites used to compute
 * from scratch: MessageCard.tsx's useTaskDeliverablesMap (called once per
 * rendered card AND again inside its own expanded ActionTimeline — i.e.
 * potentially twice per card), and app/conversation/[profileId].tsx's own
 * copy-pasted inline version. Extracted here so the EXPENSIVE part (sort +
 * dedup over the full deliverables array) happens ONCE per screen — the
 * caller wraps this in its own useMemo keyed on `deliverables` and threads
 * the resulting Map down as a prop, instead of every card/row rebuilding it
 * independently on every deliverables update.
 */
export function groupDeliverablesByTask(deliverables: Deliverable[]): Map<string, Deliverable[]> {
  const map = new Map<string, Deliverable[]>();
  const sorted = [...deliverables].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const seen = new Set<string>();
  sorted.forEach((d) => {
    const key = `${d.taskId}_${d.name}`;
    if (!seen.has(key)) {
      seen.add(key);
      const list = map.get(d.taskId) || [];
      list.push(d);
      map.set(d.taskId, list);
    }
  });
  return map;
}

function firestoreDeliverableToDeliverable(id: string, data: any): Deliverable {
  return {
    id,
    userId: data.userId,
    taskId: data.taskId,
    profileId: data.profileId,
    name: data.name,
    type: data.type,
    mimeType: data.mimeType,
    url: data.url,
    createdAt:
      data.createdAt instanceof Timestamp
        ? data.createdAt.toDate().toISOString()
        : data.createdAt,
    updatedAt:
      data.updatedAt instanceof Timestamp
        ? data.updatedAt.toDate().toISOString()
        : data.updatedAt,
  };
}

/**
 * Fetches deliverables for a specific, known set of task ids — for screens
 * that need to resolve deliverables belonging to potentially-old tasks
 * (e.g. app/(main)/tasks.tsx's My Tasks screen, whose "N Tasks Completed"
 * section can include tasks from well before UserContext's bounded
 * `deliverables` array — see that field's own doc comment) without
 * depending on the account's ENTIRE deliverables history being loaded.
 * Firestore's `in` operator caps at 30 values per query, so taskIds is
 * chunked and the results merged; empty input returns immediately with no
 * network call.
 */
export async function getDeliverablesForTaskIds(taskIds: string[]): Promise<Deliverable[]> {
  if (!db || taskIds.length === 0) return [];
  const uniqueIds = Array.from(new Set(taskIds));
  const CHUNK_SIZE = 30;
  const chunks: string[][] = [];
  for (let i = 0; i < uniqueIds.length; i += CHUNK_SIZE) {
    chunks.push(uniqueIds.slice(i, i + CHUNK_SIZE));
  }
  try {
    const results = await Promise.all(
      chunks.map((chunk) => getDocs(query(collection(db!, "deliverables"), where("taskId", "in", chunk)))),
    );
    return results.flatMap((snap) => snap.docs.map((d) => firestoreDeliverableToDeliverable(d.id, d.data())));
  } catch (e) {
    console.error("[Storage] Firestore getDeliverablesForTaskIds error:", e);
    return [];
  }
}

/**
 * Fetches every deliverable for one profile/conversation — for
 * components/useHitlAnswerState.ts's draft-attachment picker, which needs
 * to offer a file generated by an EARLIER, already-completed task on the
 * same thread (see that hook's own comment), not just recent deliverables.
 */
export async function getDeliverablesForProfile(profileId: string): Promise<Deliverable[]> {
  if (!db || !profileId) return [];
  try {
    const snap = await getDocs(query(collection(db, "deliverables"), where("profileId", "==", profileId)));
    return snap.docs.map((d) => firestoreDeliverableToDeliverable(d.id, d.data()));
  } catch (e) {
    console.error("[Storage] Firestore getDeliverablesForProfile error:", e);
    return [];
  }
}

function firestoreTaskDocToTask(id: string, data: any): Task {
  return {
    id,
    profileId: data.profileId,
    userId: data.userId,
    threadId: data.threadId,
    title: data.title,
    assignee: data.assignee,
    status: data.status,
    activityIndicator: data.activityIndicator,
    implementationPlan: data.implementationPlan || [],
    requiredDeliverables: data.requiredDeliverables || [],
    humanInputRequest: data.humanInputRequest,
    humanInputHistory: data.humanInputHistory,
    dueDate:
      data.dueDate instanceof Timestamp
        ? data.dueDate.toDate().toISOString()
        : data.dueDate,
    dueDatePrecision: data.dueDatePrecision,
    createdAt:
      data.createdAt instanceof Timestamp
        ? data.createdAt.toDate().toISOString()
        : data.createdAt,
    updatedAt:
      data.updatedAt instanceof Timestamp
        ? data.updatedAt.toDate().toISOString()
        : data.updatedAt,
    seen: data.seen,
    source: data.source,
    mediumSource: data.mediumSource,
  };
}

function firestoreProfileDocToProfile(id: string, data: any): Profile {
  return {
    id,
    userId: data.userId,
    name: data.name,
    senderInitial: data.senderInitial,
    avatarUri: data.avatarUri,
    customAvatarUri: data.customAvatarUri,
    source: data.source,
    platformIdentifier: data.platformIdentifier,
    accountId: data.accountId,
    teamsChatId: data.teamsChatId,
    latestMessageId: data.latestMessageId,
    analyzed: data.analyzed,
    createdAt:
      data.createdAt instanceof Timestamp
        ? data.createdAt.toDate().toISOString()
        : data.createdAt,
    updatedAt:
      data.updatedAt instanceof Timestamp
        ? data.updatedAt.toDate().toISOString()
        : data.updatedAt,
  };
}

/**
 * Fetches specific tasks by id, chunked for Firestore's 30-item `in` cap —
 * for app/deliverables.tsx's own independently-paginated deliverables list,
 * whose taskId/profileId can reference a task/profile OLDER than what
 * UserContext's own separately-paginated `tasks`/`profiles` arrays
 * currently have loaded (a genuine mismatch between two independent
 * pagination cursors — the deliverables list's own page has no relation to
 * which page of tasks/profiles happens to be loaded), which used to show up
 * as a deliverable card missing its task title / source icon. Mirrors
 * getDeliverablesForTaskIds's chunking.
 */
export async function getTasksByIds(taskIds: string[]): Promise<Task[]> {
  if (!db || taskIds.length === 0) return [];
  const uniqueIds = Array.from(new Set(taskIds));
  const CHUNK_SIZE = 30;
  const chunks: string[][] = [];
  for (let i = 0; i < uniqueIds.length; i += CHUNK_SIZE) {
    chunks.push(uniqueIds.slice(i, i + CHUNK_SIZE));
  }
  try {
    const results = await Promise.all(
      chunks.map((chunk) => getDocs(query(collection(db!, "tasks"), where("__name__", "in", chunk)))),
    );
    return results.flatMap((snap) => snap.docs.map((d) => firestoreTaskDocToTask(d.id, d.data())));
  } catch (e) {
    console.error("[Storage] Firestore getTasksByIds error:", e);
    return [];
  }
}

/** Fetches specific profiles by id, chunked — see getTasksByIds' identical doc comment for why. */
export async function getProfilesByIds(profileIds: string[]): Promise<Profile[]> {
  if (!db || profileIds.length === 0) return [];
  const uniqueIds = Array.from(new Set(profileIds));
  const CHUNK_SIZE = 30;
  const chunks: string[][] = [];
  for (let i = 0; i < uniqueIds.length; i += CHUNK_SIZE) {
    chunks.push(uniqueIds.slice(i, i + CHUNK_SIZE));
  }
  try {
    const results = await Promise.all(
      chunks.map((chunk) => getDocs(query(collection(db!, "profiles"), where("__name__", "in", chunk)))),
    );
    return results.flatMap((snap) => snap.docs.map((d) => firestoreProfileDocToProfile(d.id, d.data())));
  } catch (e) {
    console.error("[Storage] Firestore getProfilesByIds error:", e);
    return [];
  }
}

// User Document storage API
export async function getUserDoc(userId: string): Promise<UserDocument | null> {
  if (!db) return null;
  try {
    const docRef = doc(db, "users", userId);
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      const data = snap.data();
      const integrations = data.integrations || {};
      Object.keys(data).forEach((key) => {
        if (key.startsWith("integrations.")) {
          const integrationId = key.substring("integrations.".length);
          integrations[integrationId] = data[key];
        }
      });
      return {
        uid: snap.id,
        email: data.email,
        phoneNumber: data.phoneNumber,
        fullName: data.fullName,
        createdAt:
          data.createdAt instanceof Timestamp
            ? data.createdAt.toDate().toISOString()
            : data.createdAt,
        updatedAt:
          data.updatedAt instanceof Timestamp
            ? data.updatedAt.toDate().toISOString()
            : data.updatedAt,
        integrations,
        brandSettings: data.brandSettings,
        emailFilterMode: data.emailFilterMode,
      } as UserDocument;
    }
  } catch (e) {
    console.error("[Storage] getUserDoc error:", e);
  }
  return null;
}

export async function saveBrandSettings(
  userId: string,
  brandSettings: BrandSettings,
): Promise<void> {
  if (!db) return;
  try {
    const docRef = doc(db, "users", userId);
    await setDoc(
      docRef,
      {
        brandSettings,
        updatedAt: Timestamp.now(),
      },
      { merge: true },
    );
  } catch (e) {
    console.error("[Storage] saveBrandSettings error:", e);
  }
}

export async function setSandboxMode(
  userId: string,
  sandboxMode: boolean,
): Promise<void> {
  if (!db) return;
  try {
    const docRef = doc(db, "users", userId);
    await setDoc(
      docRef,
      {
        sandboxMode,
        updatedAt: Timestamp.now(),
      },
      { merge: true },
    );
  } catch (e) {
    console.error("[Storage] setSandboxMode error:", e);
  }
}

export async function setEmailFilterMode(
  userId: string,
  mode: "personalAndDirected" | "loosened",
): Promise<void> {
  if (!db) return;
  try {
    const docRef = doc(db, "users", userId);
    await setDoc(
      docRef,
      {
        emailFilterMode: mode,
        updatedAt: Timestamp.now(),
      },
      { merge: true },
    );
  } catch (e) {
    console.error("[Storage] setEmailFilterMode error:", e);
  }
}

// Called from services/notifications.ts's registerForPushNotificationsAsync
// once a real Expo push token is obtained — arrayUnion so registering on a
// second device ADDS a token rather than overwriting the array (multiple
// devices per user should all keep receiving notifications; see
// UserDocument.pushTokens's own comment for why this isn't a single field).
export async function addPushToken(
  userId: string,
  token: string,
): Promise<void> {
  if (!db) return;
  try {
    const docRef = doc(db, "users", userId);
    await setDoc(
      docRef,
      {
        pushTokens: arrayUnion(token),
        updatedAt: Timestamp.now(),
      },
      { merge: true },
    );
  } catch (e) {
    console.error("[Storage] addPushToken error:", e);
  }
}

// Called on logout so a device stops receiving push notifications for the
// account it just signed out of — otherwise the token stays in this user's
// pushTokens array indefinitely and a *different* user logging in on the
// same device doesn't remove it (addPushToken only ever adds to the new
// user's doc), so both accounts would get pushed to the same device.
export async function removePushToken(
  userId: string,
  token: string,
): Promise<void> {
  if (!db) return;
  try {
    const docRef = doc(db, "users", userId);
    await setDoc(
      docRef,
      {
        pushTokens: arrayRemove(token),
        updatedAt: Timestamp.now(),
      },
      { merge: true },
    );
  } catch (e) {
    console.error("[Storage] removePushToken error:", e);
  }
}

export async function saveUserFullName(
  userId: string,
  fullName: string,
): Promise<void> {
  if (!db) return;
  try {
    const docRef = doc(db, "users", userId);
    await setDoc(
      docRef,
      {
        fullName,
        updatedAt: Timestamp.now(),
      },
      { merge: true },
    );
  } catch (e) {
    console.error("[Storage] saveUserFullName error:", e);
  }
}

// Max accounts of a single provider one user can connect — see
// OAuthAccount's own doc comment. Enforced here (defense-in-depth against a
// race between two concurrent connect attempts) AND client-side in each
// services/oauth.ts initiate*Connection function BEFORE opening the OAuth
// browser sheet (so a user hitting the cap doesn't waste time completing an
// auth flow that's going to be rejected anyway).
export const MAX_ACCOUNTS_PER_PROVIDER = 4;

// Providers that have a corresponding webhook (see integrationLookup and
// functions/src/index.ts's 4 webhook resolution sites) and therefore need a
// paired integrationLookup doc written/deleted alongside the account array
// entry. Drive/OneDrive have no webhook — nothing ever resolves a user by
// their Drive/OneDrive identity — so they're deliberately excluded.
const WEBHOOK_PROVIDERS = new Set(["gmail", "outlook", "teams"]);

function integrationLookupKey(providerId: string, nativeKey: string): string {
  return `${providerId}_${slugify(nativeKey)}`;
}

// The key an inbound webhook notification is resolved by — NOT the same
// thing as accountId's own identity key (see OAuthAccount.accountId's doc
// comment; accountId is computed independently in services/oauth.ts).
// Gmail's webhook payload carries the mailbox's own emailAddress, so email
// is correct there. Outlook and Teams webhook payloads carry ONLY the
// Graph subscriptionId (see outlookWebhook/teamsWebhook in
// functions/src/index.ts, both call resolveIntegrationLookup(db, provider,
// subscriptionId)) — using email/teamsUserId here would create an
// integrationLookup doc the webhook can never actually look up by,
// silently dropping every inbound Outlook/Teams message. A account with no
// subscription yet (webhook URL not configured, or subscription creation
// failed — see initiateOutlookConnection/initiateTeamsConnection) has
// nothing to key a webhook lookup by at all, hence the undefined fallback.
function providerNativeKeyFor(providerId: string, account: OAuthAccount): string | undefined {
  if (providerId === "teams" || providerId === "outlook") return account.meta?.subscriptionId;
  if (providerId === "slack") {
    const teamId = account.meta?.teamId;
    const slackUserId = account.meta?.slackUserId;
    return teamId && slackUserId ? `${teamId}_${slackUserId}` : undefined;
  }
  return account.email;
}

// Outlook's Sent Items subscription (see createGraphMailSubscription in
// services/oauth.ts) is a SEPARATE Graph subscription object from Inbox's,
// with its own independent subscriptionId — a notification for it needs its
// OWN integrationLookup doc, keyed by that id, or resolveIntegrationLookup
// in functions/src/index.ts's outlookWebhook finds nothing and silently
// drops every self-sent notification. Returns undefined for every provider
// but outlook (mirrors providerNativeKeyFor's own shape).
function sentItemsNativeKeyFor(providerId: string, account: OAuthAccount): string | undefined {
  if (providerId !== "outlook") return undefined;
  return account.meta?.sentSubscriptionId;
}

/**
 * Saves an OAuth account, upserting by `accountId` within that provider's
 * account array (was: replacing the whole `integrations.{id}` object —
 * now each provider holds an ARRAY of accounts, see UserDocument.integrations).
 * A transaction, not a plain merge-set, since appending-or-replacing-one-
 * element-by-predicate has no Firestore merge primitive — the whole array
 * must be read, modified, and written back atomically against a concurrent
 * connect of a DIFFERENT account for the same provider racing in.
 *
 * `scopes` is merged as a deduped union of old + new (preserves incremental-
 * scope re-auth — e.g. a later "Connect Drive" round-trip on an
 * ALREADY-connected account must not wipe out the earlier grant's scopes);
 * every other field takes the newest value.
 *
 * Reconnecting the SAME underlying account (same computed accountId) is
 * treated as an explicit error, not a silent merge — see
 * `OAuthAccountAlreadyConnectedError` — so a user who meant to add a
 * genuinely different account but picked the wrong one in the provider's
 * account chooser gets a clear signal instead of a silently-refreshed
 * duplicate. Pass `allowReconnect: true` for the one legitimate
 * same-account-twice case: the Gmail flow's own second call (registering
 * the watch) intentionally re-saves the SAME account it just created.
 */
export class OAuthAccountAlreadyConnectedError extends Error {
  constructor(providerId: string) {
    super(`This ${providerId} account is already connected.`);
    this.name = "OAuthAccountAlreadyConnectedError";
  }
}

export class OAuthAccountLimitError extends Error {
  constructor(providerId: string) {
    super(`You can connect up to ${MAX_ACCOUNTS_PER_PROVIDER} ${providerId} accounts. Disconnect one first.`);
    this.name = "OAuthAccountLimitError";
  }
}

export async function saveOAuthIntegration(
  userId: string,
  providerId: string,
  account: OAuthAccount,
  options: { allowReconnect?: boolean } = {},
): Promise<void> {
  if (!db) return;
  const docRef = doc(db, "users", userId);
  const nativeKey = providerNativeKeyFor(providerId, account);

  let isNewAccount = false;
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(docRef);
    const data = snap.data() || {};
    const existing: OAuthAccount[] = data.integrations?.[providerId] || [];
    const idx = existing.findIndex((a) => a.accountId === account.accountId);
    isNewAccount = idx < 0;

    if (isNewAccount && existing.length >= MAX_ACCOUNTS_PER_PROVIDER) {
      throw new OAuthAccountLimitError(providerId);
    }
    if (!isNewAccount && !options.allowReconnect) {
      throw new OAuthAccountAlreadyConnectedError(providerId);
    }

    const priorEntry = idx >= 0 ? existing[idx] : undefined;
    const mergedScopes = Array.from(
      new Set([...(priorEntry?.scopes || []), ...(account.scopes || [])]),
    );
    const merged: OAuthAccount = {
      ...priorEntry,
      ...account,
      scopes: mergedScopes,
      // First-ever account for this provider is default by construction;
      // every later connect defaults to false unless the user explicitly
      // changes it via connector-settings/[id]'s "Set as Default". An
      // in-place reconnect (allowReconnect) keeps whatever isDefault value
      // the entry already had.
      isDefault: priorEntry ? priorEntry.isDefault : existing.length === 0,
      connectedAt: priorEntry?.connectedAt || account.connectedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const newArray = idx >= 0
      ? existing.map((a, i) => (i === idx ? merged : a))
      : [...existing, merged];

    const updateData: any = {
      updatedAt: Timestamp.now(),
      [`integrations.${providerId}`]: deleteField(), // clean any legacy flat field
      integrations: { [providerId]: newArray },
    };
    if (providerId === "gmail") updateData.hasActiveGmail = newArray.some((a) => a.status === "active");
    if (providerId === "outlook") updateData.hasActiveOutlook = newArray.some((a) => a.status === "active");
    if (providerId === "teams") updateData.hasActiveTeams = newArray.some((a) => a.status === "active");

    tx.set(docRef, updateData, { merge: true });
  });

  // Lookup-collection write happens outside the transaction (a different
  // collection/doc, and this write's own security rule — see the plan's
  // Stage B — independently guards against hijacking another user's entry;
  // it doesn't need to be atomic with the account-array write above, only
  // to happen once the account is confirmed saved).
  if (WEBHOOK_PROVIDERS.has(providerId) && nativeKey) {
    const lookupKey = integrationLookupKey(providerId, nativeKey);
    await setDoc(doc(db, "integrationLookup", lookupKey), {
      userId,
      accountId: account.accountId,
      provider: providerId,
      providerNativeKey: nativeKey,
      ...(providerId === "slack" ? { teamId: account.meta?.teamId } : {}),
      createdAt: Timestamp.now(),
    });
  }

  // Second lookup doc for Outlook's separate Sent Items subscription — see
  // sentItemsNativeKeyFor's own doc comment for why this can't share the
  // lookup doc above.
  const sentNativeKey = sentItemsNativeKeyFor(providerId, account);
  if (sentNativeKey) {
    const sentLookupKey = integrationLookupKey(providerId, sentNativeKey);
    await setDoc(doc(db, "integrationLookup", sentLookupKey), {
      userId,
      accountId: account.accountId,
      provider: providerId,
      providerNativeKey: sentNativeKey,
      createdAt: Timestamp.now(),
    });
  }
}

export async function removeOAuthIntegration(
  userId: string,
  providerId: string,
  accountId: string,
): Promise<void> {
  if (!db) return;
  const docRef = doc(db, "users", userId);
  let removedNativeKey: string | undefined;
  let removedSentNativeKey: string | undefined;

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(docRef);
    const data = snap.data() || {};
    const existing: OAuthAccount[] = data.integrations?.[providerId] || [];
    const removed = existing.find((a) => a.accountId === accountId);
    if (!removed) return;
    removedNativeKey = providerNativeKeyFor(providerId, removed);
    removedSentNativeKey = sentItemsNativeKeyFor(providerId, removed);

    const remaining = existing.filter((a) => a.accountId !== accountId);
    // Disconnecting the default auto-promotes the next-oldest remaining
    // account — confirmed decision, no "pick a new default first" gate.
    if (removed.isDefault && remaining.length > 0) {
      const oldest = remaining.reduce((a, b) => (a.connectedAt < b.connectedAt ? a : b));
      oldest.isDefault = true;
    }

    const updateData: any = { updatedAt: Timestamp.now() };
    if (remaining.length === 0) {
      updateData.integrations = { [providerId]: deleteField() };
    } else {
      updateData.integrations = { [providerId]: remaining };
    }
    if (providerId === "gmail") updateData.hasActiveGmail = remaining.some((a) => a.status === "active");
    if (providerId === "outlook") updateData.hasActiveOutlook = remaining.some((a) => a.status === "active");
    if (providerId === "teams") updateData.hasActiveTeams = remaining.some((a) => a.status === "active");

    tx.set(docRef, updateData, { merge: true });
  });

  if (WEBHOOK_PROVIDERS.has(providerId) && removedNativeKey) {
    await deleteDoc(doc(db, "integrationLookup", integrationLookupKey(providerId, removedNativeKey)));
  }
  if (removedSentNativeKey) {
    await deleteDoc(doc(db, "integrationLookup", integrationLookupKey(providerId, removedSentNativeKey)));
  }
}

/**
 * Flips `isDefault` from whichever account currently has it to `accountId`
 * — used by connector-settings/[id]'s "Set as Default" action. No-op if
 * `accountId` doesn't exist or is already the default.
 */
export async function setDefaultAccount(
  userId: string,
  providerId: string,
  accountId: string,
): Promise<void> {
  if (!db) return;
  const docRef = doc(db, "users", userId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(docRef);
    const data = snap.data() || {};
    const existing: OAuthAccount[] = data.integrations?.[providerId] || [];
    if (!existing.some((a) => a.accountId === accountId)) return;
    const updated = existing.map((a) => ({ ...a, isDefault: a.accountId === accountId }));
    tx.set(docRef, { updatedAt: Timestamp.now(), integrations: { [providerId]: updated } }, { merge: true });
  });
}

// Onboarding helpers
export async function isOnboardingComplete(): Promise<boolean> {
  const val = await read("onboarding");
  return val === '"true"';
}

export async function setOnboardingComplete(): Promise<void> {
  await write("onboarding", '"true"');
}

export async function clearOnboarding(): Promise<void> {
  await write("onboarding", '"false"');
}

export async function getConnectors(): Promise<Connector[]> {
  const localVal = await read("connectors");
  let localList: Connector[] = localVal
    ? JSON.parse(localVal)
    : defaultConnectors();

  // Ensure calendar and whatsapp are in the list (migration)
  if (!localList.some((c) => c.id === "calendar")) {
    localList.push({ id: "calendar", connected: false, accountCount: 0 });
  }
  if (!localList.some((c) => c.id === "whatsapp")) {
    localList.push({ id: "whatsapp", connected: false, accountCount: 0 });
  }
  if (!localList.some((c) => c.id === "slack")) {
    localList.push({ id: "slack", connected: false, accountCount: 0 });
  }
  if (!localList.some((c) => c.id === "teams")) {
    localList.push({ id: "teams", connected: false, accountCount: 0 });
  }
  if (!localList.some((c) => c.id === "reddit")) {
    localList.push({ id: "reddit", connected: false, accountCount: 0 });
  }
  if (!localList.some((c) => c.id === "x")) {
    localList.push({ id: "x", connected: false, accountCount: 0 });
  }
  if (!localList.some((c) => c.id === "telegram")) {
    localList.push({ id: "telegram", connected: false, accountCount: 0 });
  }
  if (!localList.some((c) => c.id === "outlook")) {
    localList.push({ id: "outlook", connected: false, accountCount: 0 });
  }
  if (!localList.some((c) => c.id === "onedrive")) {
    localList.push({ id: "onedrive", connected: false, accountCount: 0 });
  }
  if (!localList.some((c) => c.id === "dropbox")) {
    localList.push({ id: "dropbox", connected: false, accountCount: 0 });
  }
  if (!localList.some((c) => c.id === "notion")) {
    localList.push({ id: "notion", connected: false, accountCount: 0 });
  }
  if (!localList.some((c) => c.id === "github")) {
    localList.push({ id: "github", connected: false, accountCount: 0 });
  }
  if (!localList.some((c) => c.id === "zoom")) {
    localList.push({ id: "zoom", connected: false, accountCount: 0 });
  }

  // Backfill accountCount on any connector missing it — covers both the
  // migration pushes just above (none set it) and any locally-cached list
  // written before accountCount existed at all.
  localList = localList.map((c) => (c.accountCount === undefined ? { ...c, accountCount: c.connected ? 1 : 0 } : c));

  // Enforce correct order: gmail, outlook, slack, teams, whatsapp, zoom, reddit, x, telegram, imessage, drive, onedrive, dropbox, notion, github, calendar
  const order: Record<string, number> = {
    gmail: 0,
    outlook: 1,
    slack: 2,
    teams: 3,
    whatsapp: 4,
    zoom: 5,
    reddit: 6,
    x: 7,
    telegram: 8,
    imessage: 9,
    drive: 10,
    onedrive: 11,
    dropbox: 12,
    notion: 13,
    github: 14,
    calendar: 15,
  };
  localList.sort((a, b) => (order[a.id] ?? 99) - (order[b.id] ?? 99));

  const user = getAppUser();
  if (user && db) {
    try {
      const uDoc = await getUserDoc(user.uid);
      if (uDoc && uDoc.integrations) {
        // Each provider's stored value is an array of accounts — see
        // OAuthAccount/UserDocument.integrations. activeAccounts filters to
        // status:"active"; defaultAccount is whichever has isDefault:true,
        // falling back to the first active account.
        const gmailAccounts = uDoc.integrations["gmail"] || [];
        const activeGmailAccounts = gmailAccounts.filter((a) => a.status === "active");
        const defaultGmailAccount = activeGmailAccounts.find((a) => a.isDefault) || activeGmailAccounts[0];
        const isGmailActive = activeGmailAccounts.length > 0;
        const grantedScopes = defaultGmailAccount?.scopes || [];

        const hasGmailScopes = grantedScopes.some((s) => s.includes("gmail"));
        const hasCalendarScopes = grantedScopes.some((s) =>
          s.includes("calendar"),
        );

        const outlookAccounts = uDoc.integrations["outlook"] || [];
        const activeOutlookAccounts = outlookAccounts.filter((a) => a.status === "active");
        const defaultOutlookAccount = activeOutlookAccounts.find((a) => a.isDefault) || activeOutlookAccounts[0];
        const isOutlookActive = activeOutlookAccounts.length > 0;

        // Drive and OneDrive are fully independent integrations — their own
        // Firestore docs (integrations.drive / integrations.onedrive), own
        // tokens, own connect/disconnect flows, no dependency on Gmail/
        // Outlook being connected or even being the same account. See
        // initiateGoogleDriveConnection / initiateOneDriveConnection in
        // services/oauth.ts.
        const driveAccounts = uDoc.integrations["drive"] || [];
        const activeDriveAccounts = driveAccounts.filter((a) => a.status === "active");
        const defaultDriveAccount = activeDriveAccounts.find((a) => a.isDefault) || activeDriveAccounts[0];
        const isDriveActive = activeDriveAccounts.length > 0;
        const oneDriveAccounts = uDoc.integrations["onedrive"] || [];
        const activeOneDriveAccounts = oneDriveAccounts.filter((a) => a.status === "active");
        const defaultOneDriveAccount = activeOneDriveAccounts.find((a) => a.isDefault) || activeOneDriveAccounts[0];
        const isOneDriveActive = activeOneDriveAccounts.length > 0;

        // Slack is likewise a fully independent integration (own Firestore
        // doc, own token, own connect/disconnect flow via
        // initiateSlackConnection in services/oauth.ts) — previously
        // missing here, which meant connected-state never reflected
        // Firestore and stayed whatever local storage happened to have
        // (defaulting to false).
        const slackAccounts = uDoc.integrations["slack"] || [];
        const activeSlackAccounts = slackAccounts.filter((a) => a.status === "active");
        const defaultSlackAccount = activeSlackAccounts.find((a) => a.isDefault) || activeSlackAccounts[0];
        const isSlackActive = activeSlackAccounts.length > 0;

        // Teams is likewise a fully independent integration — own Firestore
        // doc, own token, own connect/disconnect flow.
        const teamsAccounts = uDoc.integrations["teams"] || [];
        const activeTeamsAccounts = teamsAccounts.filter((a) => a.status === "active");
        const defaultTeamsAccount = activeTeamsAccounts.find((a) => a.isDefault) || activeTeamsAccounts[0];
        const isTeamsActive = activeTeamsAccounts.length > 0;

        // Falling back to the cached `c.email` (from local storage, written
        // by a PRIOR call to this function) is only correct when the
        // connector is STILL actually connected but Firestore just didn't
        // return an email for some benign reason — never when it's
        // genuinely disconnected. The old version of every branch below did
        // `firestoreEmail || c.email` unconditionally, which meant a real
        // disconnect (Firestore integration removed/inactive) still showed
        // the stale pre-disconnect email forever, since `c.email` from local
        // storage is never itself cleared by this reconciliation pass — only
        // `connected` was being correctly recomputed, `email` wasn't. A real
        // production bug: the Settings row showed "Connect" (correctly
        // disconnected) with the old account's email still underneath it.
        // Now also true for `email` once accountCount>=2 — it's the
        // DEFAULT account's email, the presentation layer (settings.tsx)
        // decides whether to show that or an "N accounts" subtitle.
        return localList.map((c) => {
          if (c.id === "gmail") {
            const connected = isGmailActive && hasGmailScopes;
            return {
              ...c,
              connected,
              accountCount: activeGmailAccounts.length,
              email: defaultGmailAccount?.email || (connected ? c.email : undefined),
            };
          }
          if (c.id === "outlook") {
            return {
              ...c,
              connected: isOutlookActive,
              accountCount: activeOutlookAccounts.length,
              email: defaultOutlookAccount?.email || (isOutlookActive ? c.email : undefined),
            };
          }
          if (c.id === "drive") {
            return {
              ...c,
              connected: isDriveActive,
              accountCount: activeDriveAccounts.length,
              email: defaultDriveAccount?.email || (isDriveActive ? c.email : undefined),
            };
          }
          if (c.id === "onedrive") {
            return {
              ...c,
              connected: isOneDriveActive,
              accountCount: activeOneDriveAccounts.length,
              email: defaultOneDriveAccount?.email || (isOneDriveActive ? c.email : undefined),
            };
          }
          if (c.id === "slack") {
            // Slack rarely returns an email (users:read.email isn't
            // requested) — show "<workspace> · <display name>" instead so
            // the row identifies both which workspace and which person is
            // connected, matching Gmail/Outlook's "an actual identity under
            // the label" pattern without a bare email to use for that.
            const slackSubtitle = [defaultSlackAccount?.meta?.teamName, defaultSlackAccount?.meta?.displayName]
              .filter(Boolean)
              .join(" · ");
            return {
              ...c,
              connected: isSlackActive,
              accountCount: activeSlackAccounts.length,
              email: defaultSlackAccount?.email || slackSubtitle || (isSlackActive ? c.email : undefined),
            };
          }
          if (c.id === "teams") {
            return {
              ...c,
              connected: isTeamsActive,
              accountCount: activeTeamsAccounts.length,
              email: defaultTeamsAccount?.email || (isTeamsActive ? c.email : undefined),
            };
          }
          if (c.id === "calendar") {
            const connected = (isGmailActive && hasCalendarScopes) || isOutlookActive;
            return {
              ...c,
              // Either provider's calendar scope is enough — matches the
              // backend's getAvailableTools, which shows calendar tools if
              // either Gmail or Outlook granted calendar access. No
              // meaningful "account count" concept for this virtual
              // calendar row (it's a derived view over Gmail+Outlook, not
              // its own connection) — leave accountCount at whatever it
              // already was (always 0 from defaultConnectors, never
              // otherwise set for this id).
              connected,
              email: defaultGmailAccount?.email || defaultOutlookAccount?.email || (connected ? c.email : undefined),
            };
          }
          return c;
        });
      }
    } catch (e) {
      console.error(
        "[Storage] Failed to sync Firestore integrations with connectors:",
        e,
      );
    }
  }
  return localList;
}

export async function hasAnyConnections(): Promise<boolean> {
  const list = await getConnectors();
  return list.some((c) => c.connected);
}

export async function saveConnectors(connectors: Connector[]): Promise<void> {
  await write("connectors", JSON.stringify(connectors));
}

// Profiles storage API
export async function getProfiles(): Promise<Profile[]> {
  const user = getAppUser();
  if (user && db) {
    try {
      const q = query(
        collection(db, "profiles"),
        where("userId", "==", user.uid),
      );
      const snap = await getDocs(q);
      const list: Profile[] = [];
      snap.forEach((d) => {
        const data = d.data();
        list.push({
          id: d.id,
          userId: data.userId,
          name: data.name,
          senderInitial: data.senderInitial,
          avatarUri: data.avatarUri,
          customAvatarUri: data.customAvatarUri,
          source: data.source,
          platformIdentifier: data.platformIdentifier,
          teamsChatId: data.teamsChatId,
          latestMessageId: data.latestMessageId,
          analyzed: data.analyzed,
          createdAt:
            data.createdAt instanceof Timestamp
              ? data.createdAt.toDate().toISOString()
              : data.createdAt,
          updatedAt:
            data.updatedAt instanceof Timestamp
              ? data.updatedAt.toDate().toISOString()
              : data.updatedAt,
        });
      });
      if (list.length > 0) return list;
    } catch (e) {
      console.error("[Storage] getProfiles Firestore query failed:", e);
    }
  }
  return [];
}

export async function getGroupThreads(): Promise<GroupThread[]> {
  const user = getAppUser();
  if (user && db) {
    try {
      const q = query(
        collection(db, "groupThreads"),
        where("userId", "==", user.uid),
      );
      const snap = await getDocs(q);
      const list: GroupThread[] = [];
      snap.forEach((d) => {
        const data = d.data();
        list.push({
          id: d.id,
          userId: data.userId,
          source: data.source,
          platformThreadKey: data.platformThreadKey,
          memberProfileIds: data.memberProfileIds || [],
          name: data.name,
          teamsChatId: data.teamsChatId,
          latestMessageId: data.latestMessageId,
          analyzed: data.analyzed,
          createdAt:
            data.createdAt instanceof Timestamp
              ? data.createdAt.toDate().toISOString()
              : data.createdAt,
          updatedAt:
            data.updatedAt instanceof Timestamp
              ? data.updatedAt.toDate().toISOString()
              : data.updatedAt,
        });
      });
      return list;
    } catch (e) {
      console.error("[Storage] getGroupThreads Firestore query failed:", e);
    }
  }
  return [];
}

export async function saveGroupThread(group: GroupThread): Promise<void> {
  const user = getAppUser();
  if (user && db) {
    try {
      const docRef = doc(db, "groupThreads", group.id);
      const { id, ...data } = group;
      await setDoc(
        docRef,
        {
          ...data,
          userId: user.uid,
          createdAt: Timestamp.fromDate(new Date(group.createdAt)),
          updatedAt: Timestamp.now(),
        },
        { merge: true },
      );
    } catch (e) {
      console.error("[Storage] Firestore saveGroupThread error:", e);
    }
  }
}

export async function deleteGroupThreads(ids: string[]): Promise<void> {
  const user = getAppUser();
  if (user && db) {
    for (const id of ids) {
      try {
        await deleteDoc(doc(db, "groupThreads", id));
      } catch (e) {
        console.error("[Storage] Firestore deleteGroupThread error:", e);
      }
    }
  }
}

export async function saveProfile(profile: Profile): Promise<void> {
  const user = getAppUser();
  if (user && db) {
    try {
      const docRef = doc(db, "profiles", profile.id);
      const { id, ...data } = profile;
      await setDoc(
        docRef,
        {
          ...data,
          userId: user.uid,
          createdAt: Timestamp.fromDate(new Date(profile.createdAt)),
          updatedAt: Timestamp.now(),
        },
        { merge: true },
      );
    } catch (e) {
      console.error("[Storage] Firestore saveProfile error:", e);
    }
  }
}

// Writes just the customAvatarUri field (merge), so callers don't need the
// full Profile object — see app/conversation/[profileId].tsx's avatar
// upload flow, which already has the profileId and a fresh download URL
// but not necessarily the rest of the profile doc in a form worth
// round-tripping through saveProfile.
export async function saveCustomAvatar(
  profileId: string,
  url: string,
): Promise<void> {
  if (!db) return;
  try {
    const docRef = doc(db, "profiles", profileId);
    await setDoc(
      docRef,
      { customAvatarUri: url, updatedAt: Timestamp.now() },
      { merge: true },
    );
  } catch (e) {
    console.error("[Storage] saveCustomAvatar error:", e);
  }
}

// Uploads a picked image as the custom avatar for ANY profile (the page's
// own contact, or — for a group thread — one specific member picked from
// GroupMembersSheet) and writes it via saveCustomAvatar above. Extracted
// from app/conversation/[profileId].tsx's original single-contact
// handleChangeAvatar so both that page's own header avatar AND
// GroupMembersSheet's per-member rows share one upload path instead of
// duplicating this whole sequence. Takes an already-picked ImagePicker
// asset (not the picker call itself) — permission prompts and
// launchImageLibraryAsync() stay in the calling component, same split
// useHitlAnswerState.ts's pickAndUploadAttachment already uses for
// attachments (picker UI stays with the caller, only the actual
// upload+persist is shared).
export async function uploadCustomAvatarForProfile(
  profileId: string,
  asset: { uri: string; mimeType?: string | null },
): Promise<void> {
  const user = getAppUser();
  if (!user || !storage) throw new Error("Not signed in");
  const contentType = asset.mimeType || "image/jpeg";
  // One fixed path per profile (not per-upload) — re-uploading overwrites
  // the same object rather than accumulating orphaned old photos in
  // Storage every time the user changes it.
  const storagePath = `users/${user.uid}/avatars/${profileId}`;

  // Deliberately NOT firebase/storage's uploadBytes() here — on this RN/Expo
  // setup it always throws "Creating blobs from 'ArrayBuffer' and
  // 'ArrayBufferView' are not supported", no matter what data type is
  // handed to it. @firebase/storage's UploadTask internally calls its own
  // getBlob$1() helper, which does `new Blob(args)` on EVERY input before
  // sending it — and React Native's Blob polyfill can't construct a Blob
  // from an ArrayBuffer-backed source the way that helper does it. There is
  // no client input shape that avoids this; the JS SDK's upload path is
  // just broken for binary data on RN. Instead, upload straight to the
  // Storage REST endpoint using expo-file-system's native (non-Blob)
  // File.upload() — a real URLSession/OkHttp POST of the raw file bytes,
  // never touching RN's Blob implementation at all.
  const idToken = await getAppIdToken();
  if (!idToken) throw new Error("Not signed in");
  const uploadUrl = `https://firebasestorage.googleapis.com/v0/b/${STORAGE_BUCKET}/o?uploadType=media&name=${encodeURIComponent(storagePath)}`;
  const uploadResult = await new File(asset.uri).upload(uploadUrl, {
    httpMethod: "POST",
    headers: {
      Authorization: `Bearer ${idToken}`,
      "Content-Type": contentType,
    },
  });
  if (uploadResult.status < 200 || uploadResult.status >= 300) {
    throw new Error(`Storage upload failed with status ${uploadResult.status}: ${uploadResult.body}`);
  }

  // getDownloadURL is a plain metadata GET (no Blob involved) — safe to keep
  // using the JS SDK for this half.
  const url = await getDownloadURL(storageRef(storage, storagePath));
  await saveCustomAvatar(profileId, url);
}

export async function deleteProfiles(ids: string[]): Promise<void> {
  const user = getAppUser();
  if (user && db) {
    for (const id of ids) {
      try {
        await deleteDoc(doc(db, "profiles", id));
      } catch (e) {
        console.error("[Storage] Firestore deleteProfile error:", e);
      }
    }
  }
}

// Tasks storage API
export async function getTasks(): Promise<Task[]> {
  const user = getAppUser();
  if (user && db) {
    try {
      const q = query(collection(db, "tasks"), where("userId", "==", user.uid));
      const snap = await getDocs(q);
      const list: Task[] = [];
      snap.forEach((d) => {
        const data = d.data();
        list.push({
          id: d.id,
          profileId: data.profileId,
          userId: data.userId,
          title: data.title,
          assignee: data.assignee,
          status: data.status,
          implementationPlan: data.implementationPlan || [],
          requiredDeliverables: data.requiredDeliverables || [],
          humanInputRequest: data.humanInputRequest,
          dueDate:
            data.dueDate instanceof Timestamp
              ? data.dueDate.toDate().toISOString()
              : data.dueDate,
          dueDatePrecision: data.dueDatePrecision,
          createdAt:
            data.createdAt instanceof Timestamp
              ? data.createdAt.toDate().toISOString()
              : data.createdAt,
          updatedAt:
            data.updatedAt instanceof Timestamp
              ? data.updatedAt.toDate().toISOString()
              : data.updatedAt,
          seen: data.seen,
        });
      });
      if (list.length > 0) return list;
    } catch (e) {
      console.error("[Storage] getTasks Firestore query failed:", e);
    }
  }
  return [];
}

function stripUndefined(obj: any): any {
  if (Array.isArray(obj)) return obj.map(stripUndefined);
  if (obj !== null && typeof obj === "object" && !(obj?.toDate)) {
    return Object.fromEntries(
      Object.entries(obj)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, stripUndefined(v)])
    );
  }
  return obj;
}

export async function saveTask(task: Task): Promise<void> {
  const user = getAppUser();
  if (user && db) {
    try {
      const docRef = doc(db, "tasks", task.id);
      const { id, ...data } = task;
      const clean = stripUndefined({
        ...data,
        userId: user.uid,
        dueDate: task.dueDate
          ? Timestamp.fromDate(new Date(task.dueDate))
          : null,
        createdAt: Timestamp.fromDate(new Date(task.createdAt)),
        updatedAt: Timestamp.now(),
        seen: task.seen ?? false,
      });
      await setDoc(docRef, clean, { merge: true });
    } catch (e) {
      console.error("[Storage] Firestore saveTask error:", e);
      throw e;
    }
  }
}

/**
 * Fetches a single message by id — for the rare case a screen needs to
 * resolve ONE specific message (e.g. the triggering message of a pending
 * HITL request on app/(main)/answer.tsx's swipe deck) without depending on
 * UserContext's `messages` array containing it. That context array is
 * bounded to recent activity (see UserContext.tsx's own doc comment on
 * `messages`), so an old message tied to a long-pending task could
 * otherwise silently be missing from it. Returns null if the doc doesn't
 * exist or the user isn't signed in — callers should treat that as "no
 * triggering message to show," not an error.
 */
export async function getMessageById(messageId: string): Promise<Message | null> {
  if (!db) return null;
  try {
    const snap = await getDoc(doc(db, "messages", messageId));
    if (!snap.exists()) return null;
    const data = snap.data();
    return {
      id: snap.id,
      profileId: data.profileId,
      userId: data.userId,
      accountId: data.accountId,
      direction: data.direction,
      text: data.text,
      timestamp: data.timestamp,
      platformMessageId: data.platformMessageId,
      subject: data.subject,
      taskId: data.taskId,
      attachments: data.attachments,
      kind: data.kind,
      calendarEvent: data.calendarEvent,
      senderIdentifier: data.senderIdentifier,
      createdAt:
        data.createdAt instanceof Timestamp
          ? data.createdAt.toDate().toISOString()
          : data.createdAt,
    };
  } catch (e) {
    console.error("[Storage] Firestore getMessageById error:", e);
    return null;
  }
}

export async function saveMessage(message: Message): Promise<void> {
  const user = getAppUser();
  if (user && db) {
    try {
      const docRef = doc(db, "messages", message.id);
      const { id, ...data } = message;
      await setDoc(docRef, stripUndefined({
        ...data,
        userId: user.uid,
        createdAt: Timestamp.fromDate(new Date(message.createdAt)),
      }), { merge: true });
    } catch (e) {
      console.error("[Storage] Firestore saveMessage error:", e);
    }
  }
}

// AddAgentTaskSheet.tsx replaces each typed "@Name" mention INLINE, right
// at its own position in the sentence, with this machine-readable block
// (e.g. "[Referring to: Nick Harty, gmail, profile id xyz]") — so the
// triage LLM knows exactly which profile a mention refers to (never meant
// to be user-visible verbatim). The sentence is stored as-is as the
// Message's own `text` (no separate hidden-metadata field exists on
// Message), so every UI surface that renders a Message's text
// (MessageCard.tsx's preview rows, LightningCard.tsx's triggering-message
// bubble, conversation/[profileId].tsx's chat bubble) must parse these
// blocks back out via parseMentionSegments below and render them as a
// plain "@Name" instead of the raw bracketed text.
// Captures the profile's REAL identifier (email address / platform handle
// — Profile.platformIdentifier) as its own group, not just the opaque
// profileId. Without this, the triage LLM had no actual recipient address
// to work with — profileId is slugified (see resolveSoloProfile in
// functions/src/tools/helpers.ts: '@'/'.' become '_', e.g.
// "developer@example.com" becomes "developer_example_com" inside the
// id) and is meaningless as an email address. The model was silently
// HALLUCINATING a plausible-looking recipient email from surrounding
// context instead of being given the real one — a confirmed real bug (a
// drafted email's To: field showed a real-issue, truncated
// email address that was never anywhere in the actual data).
const MENTION_CONTEXT_PATTERN = /\[Referring to: ([^,]+) <([^>]+)>, ([a-z]+), profile id ([^\]]+)\]/g;

/** Builds the inline block AddAgentTaskSheet.tsx substitutes for a mention — see MENTION_CONTEXT_PATTERN above. */
export function buildMentionContextBlock(name: string, identifier: string, source: string, profileId: string): string {
  return `[Referring to: ${name} <${identifier}>, ${source}, profile id ${profileId}]`;
}

export interface MentionTextSegment {
  type: "text" | "mention";
  text: string; // For type "mention", this is the display name (no "@").
  source?: string;
  profileId?: string;
}

/**
 * Parses a Message's stored text into plain-text and mention segments for
 * display — the inverse of buildMentionContextBlock above. A message with
 * no mention blocks at all returns a single `[{type:"text", text}]`
 * segment (the common case, cheap to check via `segments.length === 1 &&
 * segments[0].type === "text"`).
 */
export function parseMentionSegments(text: string): MentionTextSegment[] {
  const segments: MentionTextSegment[] = [];
  let cursor = 0;
  for (const match of text.matchAll(MENTION_CONTEXT_PATTERN)) {
    const index = match.index ?? 0;
    if (index > cursor) segments.push({ type: "text", text: text.slice(cursor, index) });
    // match[2] (the real identifier) is display-irrelevant here — this
    // parse is only ever used to render "@Name" back for a human, never to
    // resend/reconstruct the block.
    segments.push({ type: "mention", text: match[1], source: match[3], profileId: match[4] });
    cursor = index + match[0].length;
  }
  if (cursor < text.length) segments.push({ type: "text", text: text.slice(cursor) });
  if (segments.length === 0) segments.push({ type: "text", text });
  return segments;
}

/** Plain-text-only rendering (drops mention blocks entirely) — for contexts that can't render styled segments, e.g. notification bodies. */
export function stripMentionContext(text: string): string {
  return parseMentionSegments(text)
    .map((s) => (s.type === "mention" ? `@${s.text}` : s.text))
    .join("")
    .trim();
}

/**
 * Creates a self-issued agent task from the Add Agent Task sheet — the
 * mobile equivalent of an inbound email/Slack/Teams message triaged into a
 * task, except the "sender" is the user themselves (no external message to
 * triage, no ambiguity about intent) and the platform is "synced" rather
 * than a real integration. Always reuses the SAME single "synced" profile
 * per user (deterministic id, mirroring the backend's
 * `profile_${userId.slice(0,8)}_${slug}` convention for other sources — see
 * functions/src/index.ts's processGmailMessage) so every self-issued task
 * threads into one conversation, not a new profile per request.
 *
 * Writes only the profile (if new) and the incoming message doc — the task
 * itself is NOT written here. functions/src/index.ts's onSyncedMessageCreated
 * (a Firestore onDocumentCreated trigger on messages/{id}) reacts to this
 * message write, runs the same Gemini triage pipeline every other channel
 * uses (functions/src/pipeline.ts's runTriage + writeTriageTasks), and
 * writes the resulting task doc itself — giving synced tasks a real
 * generated title (not the raw sentence truncated to 80 chars) and the same
 * thread-consolidation/task-invalidation handling every other medium gets.
 * That task-doc write is in turn what triggers onTaskCreated (a separate
 * Firestore onDocumentWritten trigger), which resolves mediumSource:"synced"
 * from this profile's source field and runs the normal deep-agent loop.
 */
export async function createSyncedAgentTask(sentence: string): Promise<void> {
  const user = getAppUser();
  if (!user || !db) return;
  const trimmed = sentence.trim();
  if (!trimmed) return;

  const profileId = `profile_${user.uid.slice(0, 8)}_synced`;
  const profileRef = doc(db, "profiles", profileId);
  const now = new Date().toISOString();
  const existingSnap = await getDoc(profileRef);
  const existingData = existingSnap.data();
  // Always re-save (not just on first creation) — saveProfile's merge:true +
  // its own Timestamp.now() write ALWAYS bumps updatedAt regardless of the
  // value passed here, which is exactly what's needed: the synced profile's
  // updatedAt otherwise never advances past its original creation time, and
  // every OTHER profile's updatedAt DOES advance on every new message (see
  // resolveSoloProfile's direct writes in functions/src/index.ts). Once every
  // other active profile has a newer updatedAt than a synced profile stuck
  // months in the past, that profile silently falls off the paginated
  // orderBy("updatedAt","desc") page in contexts/UserContext.tsx's listener
  // — a confirmed real production bug (the "Synced" self-conversation
  // disappearing from the home screen after enough OTHER activity, even
  // though the profile/messages themselves were never touched).
  //
  // createdAt is preserved from the existing doc when present (saveProfile
  // always writes whatever createdAt string it's given, so passing `now`
  // unconditionally here would silently overwrite the TRUE original creation
  // time on every single message) — only a genuinely new profile falls back
  // to `now`.
  const existingCreatedAt = existingData?.createdAt;
  const preservedCreatedAt = existingCreatedAt instanceof Timestamp
    ? existingCreatedAt.toDate().toISOString()
    : (typeof existingCreatedAt === "string" ? existingCreatedAt : now);
  await saveProfile({
    id: profileId,
    userId: user.uid,
    name: "Synced",
    senderInitial: "S",
    source: "synced",
    platformIdentifier: user.uid,
    analyzed: true,
    createdAt: preservedCreatedAt,
    updatedAt: now,
  });

  const messageId = generateRandomId("msg");
  await saveMessage({
    id: messageId,
    profileId,
    userId: user.uid,
    direction: "in",
    text: trimmed,
    timestamp: now,
    createdAt: now,
  });
  // Task creation happens server-side — see onSyncedMessageCreated in
  // functions/src/index.ts, triggered by the message write above.
}

export async function deleteTasks(ids: string[]): Promise<void> {
  const user = getAppUser();
  if (user && db) {
    for (const id of ids) {
      try {
        await deleteDoc(doc(db, "tasks", id));
      } catch (e) {
        console.error("[Storage] Firestore deleteTask error:", e);
      }
    }
  }
}

// Bulk-flips a set of tasks to "inactive" — the profile long-press "Resolve"
// action's write. Uses setDoc(..., {merge: true}) with a partial object
// (matching every other write in this file) rather than the full Task shape
// saveTask expects, since only status/activityIndicator/updatedAt change.
export async function markTasksInactive(ids: string[]): Promise<void> {
  const user = getAppUser();
  if (user && db) {
    for (const id of ids) {
      try {
        await setDoc(
          doc(db, "tasks", id),
          { status: "inactive", activityIndicator: deleteField(), updatedAt: Timestamp.now() },
          { merge: true },
        );
      } catch (e) {
        console.error("[Storage] Firestore markTasksInactive error:", e);
      }
    }
  }
}

export async function deleteDeliverables(ids: string[]): Promise<void> {
  const user = getAppUser();
  if (user && db) {
    for (const id of ids) {
      try {
        await deleteDoc(doc(db, "deliverables", id));
      } catch (e) {
        console.error("[Storage] Firestore deleteDeliverable error:", e);
      }
    }
  }
}

// Realtime Firestore synchronization listener
export function setupSync(
  onProfilesUpdate: (profiles: Profile[]) => void,
  onTasksUpdate: (tasks: Task[]) => void,
) {
  let unsubProfiles: (() => void) | null = null;
  let unsubTasks: (() => void) | null = null;

  const unsubAuth = subscribeToAuth((user: any) => {
    // Clean up any existing listeners
    if (unsubProfiles) {
      unsubProfiles();
      unsubProfiles = null;
    }
    if (unsubTasks) {
      unsubTasks();
      unsubTasks = null;
    }

    console.log(
      "[Storage Sync] Auth State Resolved:",
      user ? `UID: ${user.uid}` : "Logged Out (null)",
    );

    if (!user || !db) {
      onProfilesUpdate([]);
      onTasksUpdate([]);
      return;
    }

    // Real-time listener for profiles
    const qProfiles = query(
      collection(db, "profiles"),
      where("userId", "==", user.uid),
    );
    unsubProfiles = onSnapshot(
      qProfiles,
      (snapshot) => {
        const list: Profile[] = [];
        snapshot.forEach((d) => {
          const data = d.data();
          list.push({
            id: d.id,
            userId: data.userId,
            name: data.name,
            senderInitial: data.senderInitial,
            avatarUri: data.avatarUri,
            customAvatarUri: data.customAvatarUri,
            source: data.source,
            platformIdentifier: data.platformIdentifier,
            teamsChatId: data.teamsChatId,
            latestMessageId: data.latestMessageId,
            analyzed: data.analyzed,
            createdAt:
              data.createdAt instanceof Timestamp
                ? data.createdAt.toDate().toISOString()
                : data.createdAt,
            updatedAt:
              data.updatedAt instanceof Timestamp
                ? data.updatedAt.toDate().toISOString()
                : data.updatedAt,
          });
        });
        onProfilesUpdate(list);
      },
      () => {
        onProfilesUpdate([]);
      },
    );

    // Real-time listener for tasks
    const qTasks = query(
      collection(db, "tasks"),
      where("userId", "==", user.uid),
    );
    unsubTasks = onSnapshot(
      qTasks,
      (snapshot) => {
        const list: Task[] = [];
        snapshot.forEach((d) => {
          const data = d.data();
          list.push({
            id: d.id,
            profileId: data.profileId,
            userId: data.userId,
            title: data.title,
            assignee: data.assignee,
            status: data.status,
            implementationPlan: data.implementationPlan || [],
            requiredDeliverables: data.requiredDeliverables || [],
            humanInputRequest: data.humanInputRequest,
            dueDate:
              data.dueDate instanceof Timestamp
                ? data.dueDate.toDate().toISOString()
                : data.dueDate,
            dueDatePrecision: data.dueDatePrecision,
            createdAt:
              data.createdAt instanceof Timestamp
                ? data.createdAt.toDate().toISOString()
                : data.createdAt,
            updatedAt:
              data.updatedAt instanceof Timestamp
                ? data.updatedAt.toDate().toISOString()
                : data.updatedAt,
            seen: data.seen,
          });
        });
        onTasksUpdate(list);
      },
      () => {
        onTasksUpdate([]);
      },
    );
  });

  return () => {
    unsubAuth();
    if (unsubProfiles) unsubProfiles();
    if (unsubTasks) unsubTasks();
  };
}

function defaultConnectors(): Connector[] {
  return [
    { id: "gmail", connected: false, accountCount: 0 },
    { id: "outlook", connected: false, accountCount: 0 },
    { id: "slack", connected: false, accountCount: 0 },
    { id: "whatsapp", connected: false, accountCount: 0 },
    { id: "zoom", connected: false, accountCount: 0 },
    { id: "reddit", connected: false, accountCount: 0 },
    { id: "x", connected: false, accountCount: 0 },
    { id: "telegram", connected: false, accountCount: 0 },
    { id: "imessage", connected: false, accountCount: 0 },
    { id: "drive", connected: false, accountCount: 0 },
    { id: "onedrive", connected: false, accountCount: 0 },
    { id: "dropbox", connected: false, accountCount: 0 },
    { id: "notion", connected: false, accountCount: 0 },
    { id: "github", connected: false, accountCount: 0 },
    { id: "calendar", connected: false, accountCount: 0 },
  ];
}
