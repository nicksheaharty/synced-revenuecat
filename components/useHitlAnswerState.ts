import { useState, useEffect, useMemo } from "react";
import { Task, HumanInputRequest, HumanInputAnswer, CalendarEventDraft, OAuthAccount, Deliverable, getDeliverablesForProfile, getDeliverablesForTaskIds } from "../services/storage";
import { db, getAppIdToken, STORAGE_BUCKET } from "../services/firebase";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { useUser } from "../contexts/UserContext";
import * as DocumentPicker from "expo-document-picker";
import { File as ExpoFile } from "expo-file-system";

// Curated common IANA zones — the device's own zone is prepended as the
// default so most users never need to open this list at all.
export const COMMON_TIME_ZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Moscow",
  "Africa/Cairo",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Asia/Singapore",
  "Australia/Sydney",
  "Pacific/Auckland",
  "UTC",
];

export function getTimeZoneOptions(): string[] {
  let deviceZone = "";
  try {
    deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch { /* Intl unavailable — fall back to the curated list only */ }
  const rest = COMMON_TIME_ZONES.filter((z) => z !== deviceZone);
  return deviceZone ? [deviceZone, ...rest] : COMMON_TIME_ZONES;
}

export const REMINDER_PRESETS: { id: string; label: string; minutes: number | null | undefined }[] = [
  { id: "default", label: "Default", minutes: undefined },
  { id: "none", label: "None", minutes: null },
  { id: "10", label: "10 minutes before", minutes: 10 },
  { id: "30", label: "30 minutes before", minutes: 30 },
  { id: "60", label: "1 hour before", minutes: 60 },
  { id: "1440", label: "1 day before", minutes: 1440 },
];

export const RECURRENCE_PRESETS: { id: string; label: string; rrule: string | null }[] = [
  { id: "none", label: "Does not repeat", rrule: null },
  { id: "daily", label: "Daily", rrule: "RRULE:FREQ=DAILY" },
  { id: "weekly", label: "Weekly", rrule: "RRULE:FREQ=WEEKLY" },
  { id: "monthly", label: "Monthly", rrule: "RRULE:FREQ=MONTHLY" },
];

export function reminderPresetForDraft(draft: CalendarEventDraft | null): string {
  if (!draft || !draft.reminders) return "default";
  if (draft.reminders.useDefault) return "default";
  const minutes = draft.reminders.overrides?.[0]?.minutes;
  const preset = REMINDER_PRESETS.find((p) => p.minutes === minutes);
  return preset ? preset.id : "custom";
}

export function recurrencePresetForDraft(draft: CalendarEventDraft | null): string {
  const rule = draft?.recurrence?.[0];
  if (!rule) return "none";
  const preset = RECURRENCE_PRESETS.find((p) => p.rrule === rule);
  return preset ? preset.id : "custom";
}

export function toDate(value?: string): Date {
  if (!value) return new Date();
  const d = new Date(value);
  return isNaN(d.getTime()) ? new Date() : d;
}

export function toDateOnlyString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addOneDay(dateOnly: string): string {
  const d = toDate(dateOnly);
  d.setDate(d.getDate() + 1);
  return toDateOnlyString(d);
}

/** Short "Wed, Jul 14 · 2:00 – 2:30 PM" / "Wed, Jul 14 (all day)" summary line for the collapsed card. */
export function formatEventWhen(draft: CalendarEventDraft): string {
  if (draft.allDay) {
    if (!draft.startDate) return "No date set";
    const start = toDate(draft.startDate);
    const dateStr = start.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    return `${dateStr} · All day`;
  }
  if (!draft.startDateTime) return "No time set";
  const start = toDate(draft.startDateTime);
  const dateStr = start.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const startTime = start.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (!draft.endDateTime) return `${dateStr} · ${startTime}`;
  const end = toDate(draft.endDateTime);
  const endTime = end.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${dateStr} · ${startTime} – ${endTime}`;
}

/**
 * Splits a comma/semicolon-separated recipient string into a chip list,
 * dropping blanks. A Slack draft has exactly one recipient (a Slack user ID,
 * no email-style multi-recipient concept) — still run through the same
 * splitter for a single trimmed value, so the rest of the chip-list
 * machinery (draftToList, removeRecipient, etc.) works unchanged either way.
 */
function parseRecipients(value: string | undefined | null): string[] {
  return (value ?? "")
    .split(/[,;]/)
    .map(s => s.trim())
    .filter(Boolean);
}

// The From dropdown (email + calendar) now lists accounts from BOTH Gmail
// and Outlook together — a bare OAuthAccount.accountId no longer says which
// provider it belongs to once the two lists are merged, so every
// fromAccountId value carried in draftMetadata/calendarDraft/
// HumanInputAnswer is this "provider:accountId" composite key instead.
// accountId itself never contains a literal ":" (it's derived from an email
// address or teamsUserId — see OAuthAccount.accountId's own doc comment —
// none of which produce one), so a single split on the first ":" is
// unambiguous.
export function accountKeyFor(provider: "gmail" | "outlook", accountId: string): string {
  return `${provider}:${accountId}`;
}
export function parseAccountKey(key: string | undefined): { provider: "gmail" | "outlook"; accountId: string } | undefined {
  if (!key) return undefined;
  const i = key.indexOf(":");
  if (i < 0) return undefined;
  const provider = key.slice(0, i);
  const accountId = key.slice(i + 1);
  if (provider !== "gmail" && provider !== "outlook") return undefined;
  if (!accountId) return undefined;
  return { provider, accountId };
}

/**
 * All mode-agnostic state and handlers for answering a HumanInputRequest —
 * shared between HumanInputSheet (bottom sheet shell) and LightningCard
 * (swipeable card shell). Every mode-specific component (HitlQuestionsMode,
 * HitlApproveMode, HitlApproveCalendarMode) is a pure presentational
 * component driven entirely by this hook's return value, so the two shells
 * render identical behavior without duplicating any of this logic.
 */
export function useHitlAnswerState(
  task: Task | null,
  request: HumanInputRequest | null,
  onAnswered?: () => void,
  onClose?: () => void,
  // True when this draft's recipient is a platform user ID rather than an
  // email address (Slack or Teams) — relaxes the "@" validation in
  // commitRecipient/the footer's send-enabled check, and lets
  // HitlApproveMode hide the Cc row (neither medium has a CC concept) and
  // relabel the To row. Named isSlack for historical reasons (Slack shipped
  // first) but covers any non-email medium — callers pass
  // profile?.source === "slack" || profile?.source === "teams" (see
  // HumanInputSheet.tsx/LightningCard.tsx).
  isSlack: boolean = false,
  // Seeds draftToList when request.draftMetadata.to is empty — used ONLY
  // for mediumSource="synced" drafts, where send_synced_reply always replies
  // to this task's own fixed conversation and never takes a recipient
  // argument (see MEDIUM_CONVENTIONS.synced.recipientLabel and the prompt's
  // noRecipientNeeded carve-out), so the model never sets draftMetadata.to
  // for these — unlike Slack/Teams, which the prompt still requires to set
  // it. Without this, the "To" chip row would render empty and require the
  // human to type something meaningless before they could approve. Callers
  // pass profile.platformIdentifier (the synced profile's fixed id) — see
  // HumanInputSheet.tsx/LightningCard.tsx.
  fallbackRecipient?: string,
  // This task's own mailbox provider — "gmail"/"outlook" map directly to
  // UserDocument.integrations' array keys (see OAuthAccount). NOT currently
  // read by this hook (accountsForProvider below reflects every connected
  // account regardless of this task's own mailbox — see its own doc
  // comment for why gating on this here previously broke the calendar
  // picker for synced tasks). Kept as a documented call-site signal for
  // now — callers still pass profile?.source ?? groupSource (see
  // HumanInputSheet.tsx/LightningCard.tsx).
  emailProvider?: "gmail" | "outlook",
) {
  const { userDoc } = useUser();
  // Every active Gmail + Outlook account together, each tagged with its own
  // provider — the From dropdown (email drafts) and calendar account
  // dropdown (calendar drafts) both let the human pick ANY connected
  // account from EITHER provider, not just the task's own mailbox. Picking
  // a different-provider account switches which API actually sends/creates
  // the event, not just which account — see accountKeyFor below for the
  // "provider:accountId" composite key this requires, since a bare
  // accountId no longer disambiguates which provider it belongs to once
  // both lists are merged.
  //
  // Deliberately UNGATED by isSlack/emailProvider here — this is just "what
  // accounts exist", a fact independent of the current draft's messaging
  // medium. It used to early-return [] whenever isSlack was true (meant to
  // suppress the EMAIL "From" picker for a Slack/Teams DM draft), but that
  // silently broke the CALENDAR picker too: a self-issued "synced" task's
  // calendarDraft has no native mailbox (profile.source="synced", so
  // isSlack computes true — see HumanInputSheet.tsx's isPlatformIdRecipient)
  // even though the event is genuinely created on a real connected Gmail/
  // Outlook calendar, unrelated to how the task's own chat reply is sent.
  // Each consuming component now applies its OWN gate instead — see
  // HitlApproveMode's `!isSlack && accountsForProvider.length > 1` (email
  // still cares about isSlack) vs HitlApproveCalendarMode's plain
  // `accountsForProvider.length > 1` (calendar never does).
  const accountsForProvider: { account: OAuthAccount; provider: "gmail" | "outlook" }[] = useMemo(() => {
    const gmail = (userDoc?.integrations?.gmail || [])
      .filter((a: OAuthAccount) => a.status === "active")
      .map((account: OAuthAccount) => ({ account, provider: "gmail" as const }));
    const outlook = (userDoc?.integrations?.outlook || [])
      .filter((a: OAuthAccount) => a.status === "active")
      .map((account: OAuthAccount) => ({ account, provider: "outlook" as const }));
    return [...gmail, ...outlook];
  }, [userDoc?.integrations]);
  // Scoped by profileId (falling back to taskId if the deliverable predates
  // that field), not just the CURRENT task's id — a request like "forward
  // that document to X" runs as a new task referencing a deliverable an
  // EARLIER, already-completed task on the same profile/thread generated.
  // Fetched on demand (getDeliverablesForProfile/getDeliverablesForTaskIds
  // in services/storage.ts) rather than filtered out of UserContext's
  // `deliverables` — that array is bounded to recent activity now, but this
  // draft's referenced deliverable could genuinely be old (see the comment
  // above). Only one task/draft is ever active through this hook at a time,
  // so a single targeted fetch per task change is cheap.
  const [fetchedDeliverables, setFetchedDeliverables] = useState<Deliverable[]>([]);
  useEffect(() => {
    if (!task) {
      setFetchedDeliverables([]);
      return;
    }
    let cancelled = false;
    const fetchPromise = task.profileId
      ? getDeliverablesForProfile(task.profileId)
      : getDeliverablesForTaskIds([task.id]);
    fetchPromise.then((list) => {
      if (!cancelled) setFetchedDeliverables(list);
    });
    return () => { cancelled = true; };
  }, [task?.id, task?.profileId]);
  const taskDeliverables = useMemo(() => {
    if (!task) return [];
    const matching = fetchedDeliverables.filter(d => d.url && (
      (task.profileId && d.profileId === task.profileId) ||
      (!d.profileId && d.taskId === task.id)
    ));
    // De-dupe by name — keep the most recently created doc per name.
    const byName = new Map<string, typeof matching[number]>();
    for (const d of matching) {
      const existing = byName.get(d.name);
      if (!existing || d.createdAt > existing.createdAt) byName.set(d.name, d);
    }
    return Array.from(byName.values());
  }, [fetchedDeliverables, task?.id, task?.profileId]);

  const [submitting, setSubmitting] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [draftText, setDraftText] = useState("");
  const [customInputShown, setCustomInputShown] = useState<Record<string, boolean>>({});

  const [draftToList, setDraftToList] = useState<string[]>([]);
  const [draftCcList, setDraftCcList] = useState<string[]>([]);
  const [draftBccList, setDraftBccList] = useState<string[]>([]);
  // Which connected account (OAuthAccount.accountId, from accountsForProvider
  // above) this email draft sends from — seeded from the agent's own
  // server-resolved default (request.draftMetadata.fromAccountId, injected
  // by buildRequestHumanInputTool in functions/src/langchain/deep-agent-loop.ts,
  // never model-chosen), editable via HitlApproveMode's From dropdown before
  // approving. Only meaningful when accountsForProvider.length > 1 — the
  // dropdown doesn't render otherwise.
  const [draftFromAccountId, setDraftFromAccountId] = useState<string | undefined>(undefined);
  const [toInput, setToInput] = useState("");
  const [ccInput, setCcInput] = useState("");
  const [bccInput, setBccInput] = useState("");
  const [subjectInput, setSubjectInput] = useState("");
  const [attachedNames, setAttachedNames] = useState<string[]>([]);
  const [pickedAttachments, setPickedAttachments] = useState<{ name: string; uri: string; mimeType: string }[]>([]);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const proposedAttachmentNames = request?.draftMetadata?.attachmentNames ?? [];
  const visibleDeliverables = useMemo(
    () => taskDeliverables.filter(d => attachedNames.includes(d.name) || proposedAttachmentNames.includes(d.name)),
    [taskDeliverables, attachedNames, proposedAttachmentNames]
  );

  const [eventDraft, setEventDraft] = useState<CalendarEventDraft | null>(null);
  const [eventFormExpanded, setEventFormExpanded] = useState(false);
  const [newAttendeeEmail, setNewAttendeeEmail] = useState("");
  const [showTimeZonePicker, setShowTimeZonePicker] = useState(false);
  const [showCustomReminder, setShowCustomReminder] = useState(false);
  const [customReminderMinutes, setCustomReminderMinutes] = useState("");
  const [showCustomRecurrence, setShowCustomRecurrence] = useState(false);
  const [customRrule, setCustomRrule] = useState("");

  // "Reprompt" (decline mode="approve"/"approve_calendar") used to submit
  // {approved:false} with zero feedback the instant it was tapped — the
  // agent had no idea WHAT was wrong, so it had to re-investigate from
  // scratch before it could act, which read as a slow, unnecessary
  // "re-cycle" to the human. Now tapping Reprompt just reveals this inline
  // text input (repromptOpen) instead of submitting immediately — the human
  // types their actual correction, and submitReprompt() sends it as
  // textAnswer alongside approved:false in the SAME write, so the agent
  // gets real, actionable feedback the instant it resumes (see
  // REQUEST_HUMAN_INPUT_DESCRIPTION in functions/src/langchain/tools.ts,
  // which now explicitly tells the model to apply textAnswer directly
  // rather than re-investigating).
  const [repromptOpen, setRepromptOpen] = useState(false);
  const [repromptText, setRepromptText] = useState("");

  useEffect(() => {
    setStepIndex(0);
    setAnswers({});
    setCustomInputShown({});
    setDraftText(request?.draftContent ?? "");
    const parsedTo = parseRecipients(request?.draftMetadata?.to);
    setDraftToList(parsedTo.length > 0 ? parsedTo : (fallbackRecipient ? [fallbackRecipient] : []));
    setDraftCcList(parseRecipients(request?.draftMetadata?.cc));
    setDraftBccList(parseRecipients(request?.draftMetadata?.bcc));
    setDraftFromAccountId(request?.draftMetadata?.fromAccountId);
    setToInput("");
    setCcInput("");
    setBccInput("");
    setSubjectInput(request?.draftMetadata?.subject ?? "");
    setAttachedNames(Array.from(new Set(request?.draftMetadata?.attachmentNames ?? [])));
    setPickedAttachments([]);
    setEventDraft(request?.calendarDraft ? { ...request.calendarDraft } : null);
    setEventFormExpanded(false);
    setNewAttendeeEmail("");
    setShowTimeZonePicker(false);
    const reminderPreset = reminderPresetForDraft(request?.calendarDraft ?? null);
    setShowCustomReminder(reminderPreset === "custom");
    setCustomReminderMinutes(
      reminderPreset === "custom" ? String(request?.calendarDraft?.reminders?.overrides?.[0]?.minutes ?? "") : ""
    );
    const recurrencePreset = recurrencePresetForDraft(request?.calendarDraft ?? null);
    setShowCustomRecurrence(recurrencePreset === "custom");
    setCustomRrule(recurrencePreset === "custom" ? (request?.calendarDraft?.recurrence?.[0] ?? "") : "");
    setRepromptOpen(false);
    setRepromptText("");
  }, [request?.id]);

  async function submit(answer: HumanInputAnswer) {
    if (!task || !request) return;
    setSubmitting(true);
    try {
      if (db) {
        const taskRef = doc(db, "tasks", task.id);
        const cleanAnswer = Object.fromEntries(
          Object.entries(answer).filter(([, v]) => v !== undefined)
        );
        const cleanRequest = Object.fromEntries(
          Object.entries({ ...request, answer: cleanAnswer }).filter(([, v]) => v !== undefined)
        );
        await setDoc(taskRef, {
          humanInputRequest: cleanRequest,
          status: "pending",
          updatedAt: serverTimestamp(),
        }, { merge: true });
      }
      onAnswered?.();
      onClose?.();
    } catch (e) {
      console.error("[useHitlAnswerState] submit error:", e);
    } finally {
      setSubmitting(false);
    }
  }

  // Reveals the inline feedback input in place of the approve/decline
  // buttons — see repromptOpen's own doc comment above for why this
  // replaced an immediate no-feedback submit.
  function startReprompt() {
    setRepromptOpen(true);
  }

  function cancelReprompt() {
    setRepromptOpen(false);
    setRepromptText("");
  }

  // Feedback is optional — an empty submit still declines (unchanged
  // behavior for a human who genuinely has nothing more to add beyond "try
  // again"), but whenever there's real text, it goes straight to the model
  // as textAnswer in this same write, no extra round trip.
  function submitReprompt() {
    const trimmed = repromptText.trim();
    submit({ approved: false, ...(trimmed ? { textAnswer: trimmed } : {}) });
  }

  const mode = request?.mode ?? "questions";
  const questions = request?.questions ?? [];
  const currentQuestion = mode === "questions" ? questions[stepIndex] : null;
  const totalSteps = questions.length;
  const isLastQuestion = stepIndex === totalSteps - 1;
  const currentAnswer = currentQuestion ? (answers[currentQuestion.id] ?? "") : "";
  const currentOptions = currentQuestion?.options ?? [];
  const hasOptions = currentOptions.length > 0;
  const showCustomInput =
    !hasOptions ||
    !!(currentQuestion && customInputShown[currentQuestion.id]) ||
    (!!currentAnswer && !currentOptions.some(o => o.id === currentAnswer));
  const canAdvance = currentQuestion ? currentAnswer.trim().length > 0 : true;

  function selectOption(questionId: string, optionId: string) {
    setAnswers(prev => ({ ...prev, [questionId]: optionId }));
    setCustomInputShown(prev => ({ ...prev, [questionId]: false }));
  }

  function showCustomInputFor(questionId: string) {
    setCustomInputShown(prev => ({ ...prev, [questionId]: true }));
    setAnswers(prev => {
      const isStaleOptionId = currentOptions.some(o => o.id === prev[questionId]);
      return isStaleOptionId ? { ...prev, [questionId]: "" } : prev;
    });
  }

  function hideCustomInputFor(questionId: string) {
    setCustomInputShown(prev => ({ ...prev, [questionId]: false }));
  }

  function handleNext() {
    if (!canAdvance) return;
    if (isLastQuestion) {
      submit({ answers });
    } else {
      setStepIndex(i => i + 1);
    }
  }

  function commitRecipient(field: "to" | "cc" | "bcc", raw?: string) {
    const inputValue = field === "to" ? toInput : field === "cc" ? ccInput : bccInput;
    const source = (raw ?? inputValue).trim().replace(/[,;]+$/, "");
    // Slack/Teams recipients are platform user IDs, not email addresses —
    // no "@" to require. Cc/Bcc never apply to either (no Cc/Bcc concept in
    // a DM or chat), but this function isn't called for "cc"/"bcc" at all
    // when isSlack (those rows are hidden — see HitlApproveMode), so the
    // isSlack check here only ever matters for the "to" field in practice.
    if (!source || (!isSlack && !source.includes("@"))) return;
    const setList = field === "to" ? setDraftToList : field === "cc" ? setDraftCcList : setDraftBccList;
    setList(prev => prev.includes(source) ? prev : [...prev, source]);
    (field === "to" ? setToInput : field === "cc" ? setCcInput : setBccInput)("");
  }

  function removeRecipient(field: "to" | "cc" | "bcc", email: string) {
    const setList = field === "to" ? setDraftToList : field === "cc" ? setDraftCcList : setDraftBccList;
    setList(prev => prev.filter(e => e !== email));
  }

  // Safety-net for when the agent's automatic recipient scoping (see the
  // RECIPIENT SCOPE guidance in functions/src/langchain/prompt.ts) picks too
  // narrow an audience — lets the human fix it in one tap instead of typing
  // every missing address by hand. Existing To is left as the primary
  // addressee(s); everyone else from the thread's participant list who isn't
  // already in To or Cc is added to Cc — mirrors the real-world "Reply All"
  // mental model (existing To stays To, everyone else joins Cc) rather than
  // re-deciding who's primary.
  function applyReplyAll(participants: { identifier: string; name?: string }[]) {
    const currentTo = new Set(draftToList.map(s => s.toLowerCase()));
    const currentCc = new Set(draftCcList.map(s => s.toLowerCase()));
    const additions = participants
      .map(p => p.identifier)
      .filter(id => !currentTo.has(id.toLowerCase()) && !currentCc.has(id.toLowerCase()));
    if (additions.length > 0) {
      setDraftCcList(prev => [...prev, ...additions]);
    }
  }

  function updateEventDraft(patch: Partial<CalendarEventDraft>) {
    setEventDraft(prev => (prev ? { ...prev, ...patch } : { summary: "", ...patch } as CalendarEventDraft));
  }

  function addAttendee() {
    const email = newAttendeeEmail.trim();
    if (!email || !email.includes("@")) return;
    const existing = eventDraft?.attendees ?? [];
    if (existing.includes(email)) { setNewAttendeeEmail(""); return; }
    updateEventDraft({ attendees: [...existing, email] });
    setNewAttendeeEmail("");
  }

  function removeAttachedName(name: string) {
    setAttachedNames(prev => prev.filter(n => n !== name));
    setPickedAttachments(prev => prev.filter(a => a.name !== name));
  }

  function toggleDeliverable(name: string) {
    setAttachedNames(prev => prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]);
  }

  async function pickAndUploadAttachment() {
    if (!task || uploadingAttachment) return;
    try {
      const result = await DocumentPicker.getDocumentAsync({ multiple: false, copyToCacheDirectory: true });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      if (attachedNames.includes(asset.name)) return;

      setUploadingAttachment(true);
      const contentType = asset.mimeType || "application/octet-stream";
      const storagePath = `users/${task.userId}/deliverables/${task.id}_${asset.name}`;
      // Deliberately NOT firebase/storage's uploadBytes() here — see the
      // identical fix (and its full explanation) in
      // conversation/[profileId].tsx's handleChangeAvatar: on this RN/Expo
      // setup, uploadBytes always throws "Creating blobs from 'ArrayBuffer'
      // and 'ArrayBufferView' are not supported" no matter what data type
      // you give it, because @firebase/storage's UploadTask internally
      // wraps every input in `new Blob(...)`, which React Native's Blob
      // polyfill can't construct. Uploading straight to the Storage REST
      // endpoint via expo-file-system's native File.upload() avoids RN's
      // Blob implementation entirely.
      const idToken = await getAppIdToken();
      if (!idToken) throw new Error("Not signed in");
      const uploadUrl = `https://firebasestorage.googleapis.com/v0/b/${STORAGE_BUCKET}/o?uploadType=media&name=${encodeURIComponent(storagePath)}`;
      const uploadResult = await new ExpoFile(asset.uri).upload(uploadUrl, {
        httpMethod: "POST",
        headers: {
          Authorization: `Bearer ${idToken}`,
          "Content-Type": contentType,
        },
      });
      if (uploadResult.status < 200 || uploadResult.status >= 300) {
        throw new Error(`Storage upload failed with status ${uploadResult.status}: ${uploadResult.body}`);
      }

      setAttachedNames(prev => [...prev, asset.name]);
      setPickedAttachments(prev => [...prev, { name: asset.name, uri: asset.uri, mimeType: asset.mimeType || "application/octet-stream" }]);
    } catch (err) {
      console.error("[useHitlAnswerState] Failed to pick/upload attachment:", err);
    } finally {
      setUploadingAttachment(false);
    }
  }

  function removeAttendee(email: string) {
    updateEventDraft({ attendees: (eventDraft?.attendees ?? []).filter(a => a !== email) });
  }

  function selectReminderPreset(presetId: string) {
    if (presetId === "custom") {
      setShowCustomReminder(true);
      return;
    }
    setShowCustomReminder(false);
    const preset = REMINDER_PRESETS.find(p => p.id === presetId);
    if (!preset) return;
    if (preset.minutes === undefined) {
      updateEventDraft({ reminders: { useDefault: true } });
    } else if (preset.minutes === null) {
      updateEventDraft({ reminders: { useDefault: false, overrides: [] } });
    } else {
      updateEventDraft({ reminders: { useDefault: false, overrides: [{ method: "popup", minutes: preset.minutes }] } });
    }
  }

  function applyCustomReminder(text: string) {
    setCustomReminderMinutes(text);
    const n = parseInt(text, 10);
    if (!isNaN(n) && n >= 0) {
      updateEventDraft({ reminders: { useDefault: false, overrides: [{ method: "popup", minutes: n }] } });
    }
  }

  function selectRecurrencePreset(presetId: string) {
    if (presetId === "custom") {
      setShowCustomRecurrence(true);
      return;
    }
    setShowCustomRecurrence(false);
    const preset = RECURRENCE_PRESETS.find(p => p.id === presetId);
    if (!preset) return;
    updateEventDraft({ recurrence: preset.rrule ? [preset.rrule] : [] });
  }

  function applyCustomRrule(text: string) {
    setCustomRrule(text);
    updateEventDraft({ recurrence: text.trim() ? [text.trim()] : [] });
  }

  function toggleAllDay(value: boolean) {
    if (!eventDraft) return;
    if (value) {
      const startDate = eventDraft.startDateTime ? toDateOnlyString(toDate(eventDraft.startDateTime)) : toDateOnlyString(new Date());
      updateEventDraft({
        allDay: true,
        startDate,
        endDate: addOneDay(startDate),
        startDateTime: undefined,
        endDateTime: undefined,
      });
    } else {
      const base = eventDraft.startDate ? toDate(eventDraft.startDate) : new Date();
      base.setHours(9, 0, 0, 0);
      const end = new Date(base.getTime() + 60 * 60 * 1000);
      updateEventDraft({
        allDay: false,
        startDateTime: base.toISOString(),
        endDateTime: end.toISOString(),
        startDate: undefined,
        endDate: undefined,
      });
    }
  }

  // A brand-new email (not a reply) has no threadId/originalMessageId on
  // draftMetadata — those are only set when the agent is replying inside an
  // existing thread (see draftMetadataSchema's own doc comment in
  // functions/src/langchain/tools.ts). Also requires a subject to actually
  // be present — Slack/Teams drafts never have one, so this is naturally
  // false for those regardless of threading.
  const isNewEmail = !!request?.draftMetadata?.subject &&
    !request?.draftMetadata?.threadId &&
    !request?.draftMetadata?.originalMessageId;

  const reminderPresetId = eventDraft ? reminderPresetForDraft(eventDraft) : "default";
  const recurrencePresetId = eventDraft ? recurrencePresetForDraft(eventDraft) : "none";
  const canApproveCalendar = !!eventDraft && eventDraft.summary.trim().length > 0 && (
    eventDraft.allDay ? !!(eventDraft.startDate && eventDraft.endDate) : !!(eventDraft.startDateTime && eventDraft.endDateTime)
  );

  return {
    isSlack,
    mode, questions, currentQuestion, totalSteps, isLastQuestion, currentAnswer, currentOptions, hasOptions,
    showCustomInput, canAdvance, answers, stepIndex,
    selectOption, showCustomInputFor, hideCustomInputFor, handleNext, setAnswers,

    taskDeliverables, visibleDeliverables, draftText, setDraftText,
    draftToList, draftCcList, draftBccList, toInput, setToInput, ccInput, setCcInput, bccInput, setBccInput,
    subjectInput, setSubjectInput, isNewEmail,
    attachedNames, pickedAttachments, uploadingAttachment,
    commitRecipient, removeRecipient, applyReplyAll, removeAttachedName, toggleDeliverable, pickAndUploadAttachment,

    // From dropdown (email + calendar) — see accountsForProvider/
    // draftFromAccountId's own doc comments above. eventDraft.fromAccountId
    // (calendar) is set via updateEventDraft directly, no separate setter.
    accountsForProvider, draftFromAccountId, setDraftFromAccountId,

    eventDraft, eventFormExpanded, setEventFormExpanded, newAttendeeEmail, setNewAttendeeEmail,
    showTimeZonePicker, setShowTimeZonePicker, showCustomReminder, customReminderMinutes,
    showCustomRecurrence, customRrule, reminderPresetId, recurrencePresetId, canApproveCalendar,
    updateEventDraft, addAttendee, removeAttendee, selectReminderPreset, applyCustomReminder,
    selectRecurrencePreset, applyCustomRrule, toggleAllDay,

    submitting, submit,
    repromptOpen, repromptText, setRepromptText, startReprompt, cancelReprompt, submitReprompt,
  };
}

export type HitlAnswerState = ReturnType<typeof useHitlAnswerState>;
