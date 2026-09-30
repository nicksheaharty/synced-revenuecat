import { useEffect, useRef, useState } from "react";
import { Platform, View, Text, StyleSheet, Pressable, ActivityIndicator, ScrollView, Keyboard } from "react-native";
import {
  PaperPlaneTilt, X, FilePdf, FileText, FileCsv, File,
  MicrosoftExcelLogo, MicrosoftWordLogo, MicrosoftPowerpointLogo, Paperclip,
  PencilSimple, Check, ArrowLeft, ArrowUp, CaretDown, Microphone,
} from "phosphor-react-native";
import { BottomSheetTextInput } from "@expo/ui/community/bottom-sheet";
import { Host, Picker, Text as SwiftUIText } from "@expo/ui/swift-ui";
import { pickerStyle, tag, opacity } from "@expo/ui/swift-ui/modifiers";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
} from "react-native-reanimated";
import Svg, { Defs, RadialGradient, Stop, Rect } from "react-native-svg";
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "expo-speech-recognition";
import { useTheme } from "../hooks/useTheme";
import { useColorScheme } from "../hooks/useColorScheme";
import { viewFile } from "../services/fileViewer";
import { HitlAnswerState, accountKeyFor } from "./useHitlAnswerState";
import { accountLabel } from "../services/storage";
// Same gmail/outlook icon+color source as the @mention suggestion list
// (MentionAutocomplete.tsx) — reused directly (not re-declared) so the From
// row's platform icon always matches what the human already sees when
// mentioning that same provider elsewhere in the app.
import { MENTION_SOURCE_ICON, MENTION_SOURCE_COLOR } from "./MentionAutocomplete";

let GlassView: React.ComponentType<any> | null = null;
try { GlassView = require("expo-glass-effect").GlassView; } catch { }

const MIN_DRAFT_INPUT_HEIGHT = 90;
const DEFAULT_MAX_DRAFT_INPUT_HEIGHT = 260;

const FILE_TYPE: Record<string, { bg: string; text: string; icon: React.ComponentType<any> }> = {
  pdf:  { bg: "rgba(255,59,48,0.12)",   text: "#FF3B30", icon: FilePdf },
  docx: { bg: "rgba(0,122,255,0.12)",   text: "#007AFF", icon: MicrosoftWordLogo },
  xlsx: { bg: "rgba(52,199,89,0.12)",   text: "#34C759", icon: MicrosoftExcelLogo },
  pptx: { bg: "rgba(255,149,0,0.12)",   text: "#FF9500", icon: MicrosoftPowerpointLogo },
  other:{ bg: "rgba(142,142,147,0.12)", text: "#8E8E93", icon: File },
};

/**
 * The mode="approve" body — editable To/Cc recipient chips, draft body text
 * box, deliverable/attachment chip row. Pure presentational component
 * driven by useHitlAnswerState.
 *
 * Deliberately excludes the approve/decline buttons — see
 * HitlApproveModeFooter. Split so HumanInputSheet can render this part
 * inside its scrollable region while pinning the footer outside/below it
 * (so the buttons never scroll off-screen as the draft grows). LightningCard
 * doesn't scroll at all, so it renders both back-to-back as one block.
 */
export function HitlApproveMode({
  state, maxDraftInputHeight = DEFAULT_MAX_DRAFT_INPUT_HEIGHT, recipientNames, isSynced = false,
  threadParticipants, threadType,
}: {
  state: HitlAnswerState; maxDraftInputHeight?: number; recipientNames?: Record<string, string>; isSynced?: boolean;
  // Full thread context (see resolveProfileForThread in
  // functions/src/tools/helpers.ts) — used only to power the "Reply All"
  // quick-action below, a safety net for when the agent's automatic
  // recipient scoping (see prompt.ts's RECIPIENT SCOPE guidance) picks too
  // narrow an audience. Only rendered on an actual group thread.
  threadParticipants?: { identifier: string; name?: string }[];
  threadType?: "oneOnOne" | "group";
}) {
  const theme = useTheme();
  const scheme = useColorScheme();
  const toScrollRef = useRef<ScrollView>(null);
  const ccScrollRef = useRef<ScrollView>(null);
  const bccScrollRef = useRef<ScrollView>(null);
  // Cc/Bcc start collapsed behind a "Cc/Bcc" toggle on the To row, same as
  // the Gmail mobile app — most drafts have neither, so keeping both rows
  // permanently visible wasted two rows of vertical space on every single
  // approval card. Manual expand is sticky for the rest of this card's
  // lifetime (no auto-re-collapse), and either list already having content
  // (e.g. Cc pre-filled by the agent's own recipient scoping, or by "Reply
  // All") forces both rows visible regardless of this toggle — an existing
  // recipient must never be hidden from the human reviewing the send.
  const [ccBccExpanded, setCcBccExpanded] = useState(false);

  const {
    isSlack,
    draftToList, draftCcList, draftBccList, toInput, setToInput, ccInput, setCcInput, bccInput, setBccInput,
    subjectInput, setSubjectInput, isNewEmail,
    commitRecipient, removeRecipient, applyReplyAll, draftText, setDraftText,
    visibleDeliverables, pickedAttachments, attachedNames, uploadingAttachment,
    toggleDeliverable, removeAttachedName, pickAndUploadAttachment, taskDeliverables,
    accountsForProvider, draftFromAccountId, setDraftFromAccountId,
  } = state;
  // Only worth showing a From row when there's actually more than one
  // account to choose between — a single connected account has nothing to
  // switch to, so the row would just be dead chrome. Deliberately NOT gated
  // on isSynced — isSynced reflects the CONTACT's own medium (this task's
  // profile.source), but a synced task's draft can still cross over to a
  // real email send (draftMetadata.medium="email", e.g. "email this to
  // Aum"), in which case the envelope card already renders real To/Cc/Bcc
  // fields (isSynced only hides the envelope entirely when there's no real
  // recipient at all — see the `!isSynced &&` wrapper around this whole
  // card). isSlack is the correct signal here: false whenever this draft is
  // genuinely email-shaped, synced-crossed-to-email included.
  const showFromPicker = !isSlack && accountsForProvider.length > 1;
  // A REPLY is only ever sent from the mailbox that actually received the
  // original thread (see sendEmailTool's originalMessageId/createReply
  // handling in tools/email.ts, which threads the reply via that SAME
  // account's API) — switching "From" on a reply doesn't send it from a
  // different mailbox, it just breaks the thread association (a
  // wrong/mismatched provider's originalMessageId rejected by that
  // provider's API, or a reply that silently starts a new unthreaded
  // conversation instead). So the row still shows (which account this is
  // replying from is useful information), but only a brand-new send
  // (isNewEmail) gets the interactive chevron/tap-to-change behavior.
  const fromPickerEditable = isNewEmail;
  const selectedFromEntry =
    accountsForProvider.find(e => accountKeyFor(e.provider, e.account.accountId) === draftFromAccountId)
    ?? accountsForProvider[0];

  const showCcBcc = ccBccExpanded || draftCcList.length > 0 || draftBccList.length > 0;


  return (
    <View style={styles.approvalWrap}>
      {/* A "synced" self-request deliverable has no real recipient — the
          agent is just reporting a finished result back to this task's own
          conversation, not sending anything anywhere. The To/Cc envelope
          only makes sense when there's an actual destination, so it's
          dropped entirely for this medium rather than showing a fixed
          non-removable "To: Synced" chip the human can't do anything with. */}
      {!isSynced && (
      <>
      {/* Only a brand-new email (no threadId/originalMessageId — see
          isNewEmail's own doc comment) gets an editable subject. A reply's
          subject is tied to the thread it's replying in ("Re: <original
          subject>"), so it isn't something the human can meaningfully
          change here — Slack/Teams never have one either. Its own separate
          card (not folded into the To/Cc envelope below) since it's a
          plain single value, not part of that row-group's chip-list
          pattern. */}
      {isNewEmail && (
        <View style={[styles.groupCard, styles.envelopeCard, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
          <View style={styles.envelopeRow}>
            <Text style={[styles.groupRowLabel, { color: theme.muted, fontFamily: "Inter_400Regular" }]}>Subject</Text>
            <BottomSheetTextInput
              style={[styles.envelopeInlineInput, styles.subjectInput, { color: theme.surface, fontFamily: "Inter_400Regular" }]}
              value={subjectInput}
              onChangeText={setSubjectInput}
              placeholder="Subject"
              placeholderTextColor={theme.muted}
              returnKeyType="done"
            />
          </View>
        </View>
      )}
      <View style={[styles.groupCard, styles.envelopeCard, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
        {showFromPicker && (
          <>
            <View style={[styles.envelopeRow, styles.fromRow]}>
              <Text style={[styles.groupRowLabel, { color: theme.muted, fontFamily: "Inter_400Regular" }]}>From</Text>
              <View style={styles.fromValueWrap}>
                <View style={styles.fromValueLabelGroup}>
                  {/* Same provider icon/color as the @mention suggestion list
                      (MentionAutocomplete.tsx) — lets the human recognize
                      Gmail vs Outlook at a glance here too, not just by name. */}
                  {selectedFromEntry && (() => {
                    const FromSourceIcon = MENTION_SOURCE_ICON[selectedFromEntry.provider];
                    return FromSourceIcon ? (
                      <FromSourceIcon size={14} color={MENTION_SOURCE_COLOR[selectedFromEntry.provider]} weight="fill" />
                    ) : null;
                  })()}
                  <Text numberOfLines={1} style={[styles.fromValueText, { color: theme.surface, fontFamily: "Inter_400Regular" }]}>
                    {selectedFromEntry ? accountLabel(selectedFromEntry.account) : ""}
                  </Text>
                </View>
                {/* A reply's From is fixed to whichever mailbox actually
                    received the original thread (see fromPickerEditable's
                    doc comment above) — no chevron, no tappable picker, just
                    the plain label so the human can still see which account
                    it's sending from without being able to change it. */}
                {fromPickerEditable && (
                  <>
                    <CaretDown size={12} color={theme.muted} weight="bold" />
                    {/* SwiftUI's menu-style Picker draws its own trigger label
                        internally, so it can't be styled to match this row — the
                        Text+chevron above is what's actually visible, and this
                        Picker is invisibly overlaid purely so a tap opens the
                        real native iOS picker menu. Same pattern as
                        app/(main)/settings.tsx's primary-calendar-provider picker. */}
                    {Platform.OS === "ios" && (
                      <Host colorScheme={scheme} style={StyleSheet.absoluteFill}>
                        <Picker
                          modifiers={[pickerStyle("menu"), opacity(0.02)]}
                          selection={selectedFromEntry ? accountKeyFor(selectedFromEntry.provider, selectedFromEntry.account.accountId) : undefined}
                          onSelectionChange={(value) => setDraftFromAccountId(value as string)}
                        >
                          {accountsForProvider.map(({ account, provider }) => {
                            const key = accountKeyFor(provider, account.accountId);
                            return (
                              <SwiftUIText key={key} modifiers={[tag(key)]}>
                                {`${accountLabel(account)} (${provider === "gmail" ? "Gmail" : "Outlook"})`}
                              </SwiftUIText>
                            );
                          })}
                        </Picker>
                      </Host>
                    )}
                  </>
                )}
              </View>
            </View>
            <View style={[styles.groupDivider, { backgroundColor: theme.separator }]} />
          </>
        )}
        <View style={styles.envelopeRow}>
          <Text style={[styles.groupRowLabel, styles.recipientRowLabel, { color: theme.muted, fontFamily: "Inter_400Regular" }]}>To</Text>
          <ScrollView
            ref={toScrollRef}
            horizontal
            style={styles.envelopeChipScroll}
            contentContainerStyle={styles.envelopeChipRow}
            showsHorizontalScrollIndicator={false}
            onContentSizeChange={() => toScrollRef.current?.scrollToEnd({ animated: false })}
          >
            {draftToList.map(recipient => (
              <View key={recipient} style={[styles.recipientChip, { backgroundColor: theme.searchBg }]}>
                <Text style={[styles.recipientChipText, { color: theme.surface, fontFamily: "Inter_500Medium" }]} numberOfLines={1}>{recipientNames?.[recipient] ?? recipient}</Text>
                {/* DM recipients (Slack/Teams) can't be removed here — a DM's
                    recipient is fixed to the platform user this task is for,
                    unlike an email's To list. Cc is already hidden entirely
                    for isSlack above; this keeps To consistent with that. */}
                {!isSlack && (
                  <Pressable onPress={() => removeRecipient("to", recipient)} hitSlop={8}>
                    <X size={10} color={theme.muted} weight="bold" />
                  </Pressable>
                )}
              </View>
            ))}
            <BottomSheetTextInput
              style={[styles.envelopeInlineInput, { color: theme.surface, fontFamily: "Inter_400Regular" }]}
              value={toInput}
              onChangeText={(v) => {
                setToInput(v);
                if (v.endsWith(",") || v.endsWith(";")) commitRecipient("to", v);
              }}
              onSubmitEditing={() => commitRecipient("to")}
              onBlur={() => commitRecipient("to")}
              placeholder={draftToList.length === 0 ? (isSlack ? "Recipient" : "Recipient email") : ""}
              placeholderTextColor={theme.muted}
              autoCapitalize="none"
              keyboardType={isSlack ? "default" : "email-address"}
              returnKeyType="done"
              blurOnSubmit={false}
            />
          </ScrollView>
        </View>
        {!isSlack && showCcBcc && (
          <>
            <View style={[styles.groupDivider, { backgroundColor: theme.separator }]} />
            <View style={styles.envelopeRow}>
              <Text style={[styles.groupRowLabel, styles.recipientRowLabel, { color: theme.muted, fontFamily: "Inter_400Regular" }]}>Cc</Text>
              <ScrollView
                ref={ccScrollRef}
                horizontal
                style={styles.envelopeChipScroll}
                contentContainerStyle={styles.envelopeChipRow}
                showsHorizontalScrollIndicator={false}
                onContentSizeChange={() => ccScrollRef.current?.scrollToEnd({ animated: false })}
              >
                {draftCcList.map(email => (
                  <View key={email} style={[styles.recipientChip, { backgroundColor: theme.searchBg }]}>
                    <Text style={[styles.recipientChipText, { color: theme.surface, fontFamily: "Inter_500Medium" }]} numberOfLines={1}>{email}</Text>
                    <Pressable onPress={() => removeRecipient("cc", email)} hitSlop={8}>
                      <X size={10} color={theme.muted} weight="bold" />
                    </Pressable>
                  </View>
                ))}
                <BottomSheetTextInput
                  style={[styles.envelopeInlineInput, { color: theme.surface, fontFamily: "Inter_400Regular" }]}
                  value={ccInput}
                  onChangeText={(v) => {
                    setCcInput(v);
                    if (v.endsWith(",") || v.endsWith(";")) commitRecipient("cc", v);
                  }}
                  onSubmitEditing={() => commitRecipient("cc")}
                  onBlur={() => commitRecipient("cc")}
                  placeholder={draftCcList.length === 0 ? "Optional" : ""}
                  placeholderTextColor={theme.muted}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  returnKeyType="done"
                  blurOnSubmit={false}
                />
              </ScrollView>
            </View>
            <View style={[styles.groupDivider, { backgroundColor: theme.separator }]} />
            <View style={styles.envelopeRow}>
              <Text style={[styles.groupRowLabel, styles.recipientRowLabel, { color: theme.muted, fontFamily: "Inter_400Regular" }]}>Bcc</Text>
              <ScrollView
                ref={bccScrollRef}
                horizontal
                style={styles.envelopeChipScroll}
                contentContainerStyle={styles.envelopeChipRow}
                showsHorizontalScrollIndicator={false}
                onContentSizeChange={() => bccScrollRef.current?.scrollToEnd({ animated: false })}
              >
                {draftBccList.map(email => (
                  <View key={email} style={[styles.recipientChip, { backgroundColor: theme.searchBg }]}>
                    <Text style={[styles.recipientChipText, { color: theme.surface, fontFamily: "Inter_500Medium" }]} numberOfLines={1}>{email}</Text>
                    <Pressable onPress={() => removeRecipient("bcc", email)} hitSlop={8}>
                      <X size={10} color={theme.muted} weight="bold" />
                    </Pressable>
                  </View>
                ))}
                <BottomSheetTextInput
                  style={[styles.envelopeInlineInput, { color: theme.surface, fontFamily: "Inter_400Regular" }]}
                  value={bccInput}
                  onChangeText={(v) => {
                    setBccInput(v);
                    if (v.endsWith(",") || v.endsWith(";")) commitRecipient("bcc", v);
                  }}
                  onSubmitEditing={() => commitRecipient("bcc")}
                  onBlur={() => commitRecipient("bcc")}
                  placeholder={draftBccList.length === 0 ? "Optional" : ""}
                  placeholderTextColor={theme.muted}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  returnKeyType="done"
                  blurOnSubmit={false}
                />
              </ScrollView>
            </View>
          </>
        )}
      </View>
      {!isSlack && (
        (threadType === "group" && threadParticipants && threadParticipants.length > 0) || !showCcBcc
      ) && (
        <View style={styles.envelopeActionsRow}>
          {/* Safety net for when the agent's automatic recipient scoping
              (see prompt.ts's RECIPIENT SCOPE guidance) picks too narrow an
              audience — one tap adds every thread participant not already
              in To/Cc, instead of the human typing each address by hand.
              Only shown on an actual group thread — no ambiguity to fix on
              a 1:1. */}
          {threadType === "group" && threadParticipants && threadParticipants.length > 0 && (
            <Pressable onPress={() => applyReplyAll(threadParticipants)} hitSlop={8} style={styles.replyAllLink}>
              <Text style={[styles.replyAllText, { color: theme.primary, fontFamily: "Inter_600SemiBold" }]}>Reply All</Text>
            </Pressable>
          )}
          {!showCcBcc && (
            <Pressable onPress={() => setCcBccExpanded(true)} hitSlop={8} style={styles.ccBccToggle}>
              <Text style={[styles.ccBccToggleText, { color: theme.primary, fontFamily: "Inter_600SemiBold" }]}>Cc/Bcc</Text>
            </Pressable>
          )}
        </View>
      )}
      </>
      )}
      {/* "synced" reads as a delivered result, not a message to send — the
          finished file leads (large, tappable-to-preview), with the agent's
          summary as plain descriptive text underneath rather than inside a
          chat bubble. Every other medium keeps the bubble-first layout
          below, where the ATTACHMENT is secondary to the message being sent. */}
      {isSynced ? (
        <View style={styles.deliveredWrap}>
          {visibleDeliverables.length > 0 && (
            <Text style={[styles.deliveredLabel, { color: theme.muted, fontFamily: "Inter_500Medium" }]}>
              DELIVERED
            </Text>
          )}
          {visibleDeliverables.map(d => {
            const ext = (d.type ?? d.name?.split('.').pop() ?? 'other').toLowerCase();
            const ft = FILE_TYPE[ext] ?? FILE_TYPE.other;
            const Icon = ft.icon;
            return (
              <Pressable
                key={d.id}
                onPress={() => d.url && viewFile(d.url, d.name).catch((err) => console.error("[HitlApproveMode] Failed to view file:", err))}
                style={({ pressed }) => [
                  styles.deliveredFileCard,
                  { backgroundColor: theme.card, borderColor: theme.cardBorder, opacity: pressed ? 0.7 : 1 },
                ]}
              >
                <View style={[styles.deliveredFileIcon, { backgroundColor: ft.bg }]}>
                  <Icon size={22} color={ft.text} weight="duotone" />
                </View>
                <Text style={[styles.deliveredFileName, { color: theme.surface, fontFamily: "Inter_600SemiBold" }]} numberOfLines={1}>
                  {d.name}
                </Text>
                <Text style={[styles.deliveredFileTap, { color: theme.muted, fontFamily: "Inter_400Regular" }]}>
                  Tap to view
                </Text>
              </Pressable>
            );
          })}
          <View style={[styles.deliveredSummaryWrap, { maxHeight: maxDraftInputHeight }]}>
            <BottomSheetTextInput
              style={[
                styles.deliveredSummary,
                { color: theme.surface, fontFamily: "Inter_400Regular" },
              ]}
              multiline
              value={draftText}
              onChangeText={setDraftText}
              scrollEnabled
              textAlignVertical="top"
            />
          </View>
        </View>
      ) : (
      <View style={styles.replyBubbleRow}>
        <View
          style={[
            styles.replyBubble,
            { backgroundColor: scheme === "dark" ? "#2C2C2E" : "#FFFFFF" },
            { minHeight: MIN_DRAFT_INPUT_HEIGHT, maxHeight: maxDraftInputHeight, overflow: "hidden" },
          ]}
        >
          <BottomSheetTextInput
            style={[
              styles.draftInput,
              { color: scheme === "dark" ? "#FFFFFF" : "#000000", fontFamily: "Inter_400Regular" },
            ]}
            multiline
            value={draftText}
            onChangeText={setDraftText}
            scrollEnabled
            textAlignVertical="top"
          />
        </View>
      </View>
      )}
      {!isSynced && (visibleDeliverables.length > 0 || pickedAttachments.length > 0) && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.attachRow} contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}>
          {visibleDeliverables.map(d => {
            const ext = (d.type ?? d.name?.split('.').pop() ?? 'other').toLowerCase();
            const ft = FILE_TYPE[ext] ?? FILE_TYPE.other;
            const Icon = ft.icon;
            const attached = attachedNames.includes(d.name);
            return (
              <View
                key={d.id}
                style={[styles.attachCard, { backgroundColor: theme.card, borderColor: theme.cardBorder, opacity: attached ? 1 : 0.5 }]}
              >
                <Pressable style={styles.attachCardMain} onPress={() => d.url && viewFile(d.url, d.name).catch((err) => console.error("[HitlApproveMode] Failed to view file:", err))}>
                  <View style={[styles.attachIcon, { backgroundColor: ft.bg }]}>
                    <Icon size={14} color={ft.text} weight="duotone" />
                  </View>
                  <Text style={[styles.attachName, { color: theme.surface, fontFamily: "Inter_500Medium" }]} numberOfLines={1}>
                    {d.name}
                  </Text>
                </Pressable>
                <Pressable onPress={() => toggleDeliverable(d.name)} hitSlop={8}>
                  {attached
                    ? <X size={12} color={theme.muted} weight="bold" />
                    : <Text style={{ fontSize: 11, color: theme.primary, fontFamily: "Inter_600SemiBold" }}>Add</Text>}
                </Pressable>
              </View>
            );
          })}
          {pickedAttachments.map(a => (
            <View key={a.name} style={[styles.attachCard, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
              <View style={styles.attachCardMain}>
                <View style={[styles.attachIcon, { backgroundColor: FILE_TYPE.other.bg }]}>
                  <File size={14} color={FILE_TYPE.other.text} weight="duotone" />
                </View>
                <Text style={[styles.attachName, { color: theme.surface, fontFamily: "Inter_500Medium" }]} numberOfLines={1}>
                  {a.name}
                </Text>
              </View>
              <Pressable onPress={() => removeAttachedName(a.name)} hitSlop={8}>
                <X size={12} color={theme.muted} weight="bold" />
              </Pressable>
            </View>
          ))}
          <Pressable
            onPress={pickAndUploadAttachment}
            disabled={uploadingAttachment}
            style={({ pressed }) => [styles.addAttachmentChip, { borderColor: theme.cardBorder, opacity: pressed || uploadingAttachment ? 0.6 : 1 }]}
          >
            {uploadingAttachment
              ? <ActivityIndicator size="small" color={theme.muted} />
              : <Paperclip size={14} color={theme.muted} weight="bold" />}
            <Text style={[styles.addAttachmentText, { color: theme.muted, fontFamily: "Inter_500Medium" }]}>
              {uploadingAttachment ? "Uploading..." : "Add"}
            </Text>
          </Pressable>
        </ScrollView>
      )}
      {!isSynced && taskDeliverables.length === 0 && pickedAttachments.length === 0 && (
        <Pressable
          onPress={pickAndUploadAttachment}
          disabled={uploadingAttachment}
          style={({ pressed }) => [styles.addAttachmentRow, { opacity: pressed || uploadingAttachment ? 0.6 : 1 }]}
        >
          {uploadingAttachment
            ? <ActivityIndicator size="small" color={theme.muted} />
            : <Paperclip size={14} color={theme.muted} weight="bold" />}
          <Text style={[styles.addAttachmentText, { color: theme.muted, fontFamily: "Inter_500Medium" }]}>
            {uploadingAttachment ? "Uploading..." : "Add attachment"}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

// continuous:false stops listening after just ~3s of silence on iOS 17 and
// below — same constant/rationale as AddAgentTaskSheet.tsx's identical
// speech-recognition options (kept as its own copy here rather than a
// shared import, matching how this file already keeps its own local copies
// of things like SOURCE_ICON/SOURCE_COLORS rather than centralizing them).
const REPROMPT_SPEECH_RECOGNITION_OPTIONS = {
  lang: "en-US",
  interimResults: true,
  continuous: true,
} as const;

/**
 * The full-page "Reprompt" screen — replaces the ENTIRE approve-mode card
 * (header, draft body, footer) while state.repromptOpen is true, rather than
 * swapping just the footer's buttons for an inline input. Deliberately
 * matches AddAgentTaskSheet.tsx's own input styling (transparent/borderless
 * text field, ambient listening glow, round glass mic+send buttons) so a
 * reprompt reads as the same kind of "tell the agent what you want" input
 * as the Add Agent Task sheet, rather than a boxed form field. Rendered by
 * both HumanInputSheet and LightningCard in place of their normal
 * header+body+footer stack — see each shell's own mode dispatch.
 */
export function HitlRepromptMode({ state, bottomInset }: { state: HitlAnswerState; bottomInset: number }) {
  const theme = useTheme();
  const scheme = useColorScheme();
  const { repromptText, setRepromptText, submitting, cancelReprompt, submitReprompt } = state;
  const [recognizing, setRecognizing] = useState(false);
  const glowOpacity = useSharedValue(0);
  const textArrivalPulse = useSharedValue(0);

  // Recording starts automatically the moment this screen opens — same
  // "no need to tap the mic first" behavior as AddAgentTaskSheet.tsx.
  // Permission is requested here since this is the first thing that
  // happens on open, not a user-initiated tap; a denial just leaves the
  // mic idle and the human can still type. Stops on unmount (leaving the
  // reprompt screen, e.g. tapping back) same as that sheet closing.
  useEffect(() => {
    (async () => {
      const result = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!result.granted) return;
      ExpoSpeechRecognitionModule.start(REPROMPT_SPEECH_RECOGNITION_OPTIONS);
    })();
    return () => { ExpoSpeechRecognitionModule.stop(); };
  }, []);

  useEffect(() => {
    if (recognizing) {
      glowOpacity.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.ease) }),
          withTiming(0.4, { duration: 1200, easing: Easing.inOut(Easing.ease) }),
        ),
        -1,
        true,
      );
    } else {
      glowOpacity.value = withTiming(0, { duration: 300 });
    }
  }, [recognizing, glowOpacity]);

  useSpeechRecognitionEvent("start", () => setRecognizing(true));
  useSpeechRecognitionEvent("end", () => setRecognizing(false));
  useSpeechRecognitionEvent("result", (event) => {
    const transcript = event.results[0]?.transcript;
    if (transcript) {
      setRepromptText(transcript);
      textArrivalPulse.value = 1;
      textArrivalPulse.value = withTiming(0, { duration: 500, easing: Easing.out(Easing.ease) });
    }
  });
  useSpeechRecognitionEvent("error", (event) => {
    console.warn("[HitlRepromptMode] Speech recognition error:", event.error, event.message);
    setRecognizing(false);
  });

  const toggleDictation = async () => {
    if (recognizing) {
      ExpoSpeechRecognitionModule.stop();
      return;
    }
    Keyboard.dismiss();
    const result = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!result.granted) return;
    ExpoSpeechRecognitionModule.start(REPROMPT_SPEECH_RECOGNITION_OPTIONS);
  };

  const glowStyle = useAnimatedStyle(() => ({ opacity: glowOpacity.value }));
  const textArrivalStyle = useAnimatedStyle(() => ({ opacity: textArrivalPulse.value }));
  const canUseGlass = Platform.OS === "ios" && !!GlassView;
  const glassBg = scheme === "dark" ? "rgba(40,40,44,0.92)" : "rgba(235,235,240,0.92)";

  return (
    <View style={styles.repromptPage}>
      <View style={styles.repromptPageHeader}>
        <Pressable onPress={cancelReprompt} disabled={submitting} hitSlop={8} style={({ pressed }) => [styles.repromptBackBtn, { opacity: pressed || submitting ? 0.5 : 1 }]}>
          <ArrowLeft size={20} color={theme.surface} weight="bold" />
        </Pressable>
        <Text style={[styles.repromptPageTitle, { color: theme.surface, fontFamily: "Inter_600SemiBold" }]}>Reprompt</Text>
        <View style={styles.repromptBackBtn} />
      </View>
      <View style={styles.repromptPageBody}>
        {/* Ambient glow while actively listening — identical treatment to
            AddAgentTaskSheet.tsx's own glow (radial gradient, since RN's
            shadow props on a plain View don't blur). */}
        <Animated.View pointerEvents="none" style={[styles.repromptGlow, glowStyle]}>
          <Svg width="100%" height="100%">
            <Defs>
              <RadialGradient id="repromptGlowGradient" cx="50%" cy="100%" r="75%">
                <Stop offset="0%" stopColor={theme.primary} stopOpacity={0.55} />
                <Stop offset="60%" stopColor={theme.primary} stopOpacity={0.18} />
                <Stop offset="100%" stopColor={theme.primary} stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill="url(#repromptGlowGradient)" />
          </Svg>
        </Animated.View>
        <View style={styles.repromptPageInputWrap}>
          <BottomSheetTextInput
            style={[styles.repromptPageInput, { color: theme.surface, fontFamily: "Inter_400Regular" }]}
            multiline
            placeholder={recognizing ? "Listening..." : "What should change?"}
            placeholderTextColor={theme.muted}
            value={repromptText}
            onChangeText={setRepromptText}
            onFocus={() => { if (recognizing) ExpoSpeechRecognitionModule.stop(); }}
            autoFocus
          />
          <Animated.View pointerEvents="none" style={[styles.repromptTextArrivalBar, { backgroundColor: theme.primary }, textArrivalStyle]} />
        </View>
      </View>
      <View style={[styles.repromptPageFooter, { paddingBottom: Math.max(bottomInset, 16) }]}>
        {/* Mic on the left, send on the right — same round glass-button
            treatment (60x60, borderRadius 30) as AddAgentTaskSheet.tsx's
            own footer and this file's own approve-mode glassBtn. */}
        <Pressable onPress={toggleDictation} style={styles.glassBtn}>
          {canUseGlass && GlassView
            ? <GlassView style={StyleSheet.absoluteFill} colorScheme={scheme} glassEffectStyle="regular" />
            : <View style={[StyleSheet.absoluteFill, styles.glassFallback, { backgroundColor: glassBg }]} />}
          <Microphone
            size={22}
            color={recognizing ? "#FF3B30" : theme.surface}
            weight={recognizing ? "fill" : "regular"}
          />
        </Pressable>
        <Pressable
          onPress={submitReprompt}
          disabled={submitting}
          style={({ pressed }) => [styles.glassBtn, { opacity: pressed || submitting ? 0.6 : 1 }]}
        >
          {canUseGlass && GlassView
            ? <GlassView style={StyleSheet.absoluteFill} colorScheme={scheme} glassEffectStyle="regular" />
            : <View style={[StyleSheet.absoluteFill, styles.glassFallback, { backgroundColor: glassBg }]} />}
          {submitting
            ? <ActivityIndicator color={theme.primary} size="small" />
            : <ArrowUp size={22} color={theme.primary} weight="bold" />}
        </Pressable>
      </View>
    </View>
  );
}

/**
 * The mode="approve" footer — decline (X) / send buttons. Split out of
 * HitlApproveMode so HumanInputSheet can pin it outside the scrollable body
 * (see that component's doc comment for why).
 */
export function HitlApproveModeFooter({ state, bottomInset, isSynced = false }: { state: HitlAnswerState; bottomInset: number; isSynced?: boolean }) {
  const theme = useTheme();
  const scheme = useColorScheme();
  const glassBg = scheme === "dark" ? "rgba(40,40,44,0.92)" : "rgba(235,235,240,0.92)";
  const canUseGlass = Platform.OS === "ios" && !!GlassView;
  const GV = GlassView;

  const {
    isSlack,
    draftToList, draftCcList, draftBccList, toInput, ccInput, bccInput, draftText,
    subjectInput, isNewEmail,
    attachedNames, submitting, submit,
    startReprompt, draftFromAccountId,
  } = state;

  // A "synced" self-request has no recipient to validate/attach at all (see
  // the identical carve-out in HitlApproveMode above) — "approving" here
  // just means "log this result", so the send button is never blocked on a
  // recipient the way email/Slack/Teams drafts are.
  const toInputValid = isSlack ? toInput.trim().length > 0 : toInput.trim().includes("@");
  const canSubmit = isSynced || draftToList.length > 0 || toInputValid;

  return (
    <View style={[styles.approvalBtns, { paddingBottom: Math.max(bottomInset, 16) }]}>
      <Pressable
        onPress={startReprompt}
        disabled={submitting}
        style={({ pressed }) => [styles.repromptBtn, { opacity: pressed || submitting ? 0.6 : 1 }]}
      >
        {canUseGlass && GV
          ? <GV style={[StyleSheet.absoluteFill, styles.repromptGlassRadius]} colorScheme={scheme} glassEffectStyle="regular" />
          : <View style={[StyleSheet.absoluteFill, styles.repromptGlassRadius, { backgroundColor: glassBg }]} />}
        <PencilSimple size={18} color={theme.surface} weight="bold" />
        <Text numberOfLines={1} style={[styles.repromptText, { color: theme.surface, fontFamily: "Inter_600SemiBold" }]}>Reprompt</Text>
      </Pressable>
      <Pressable
        onPress={() => {
          if (isSynced) {
            submit({ approved: true, textAnswer: draftText, editedAttachmentNames: attachedNames });
            return;
          }
          const finalTo = toInputValid ? [...draftToList, toInput.trim()] : draftToList;
          const finalCc = !isSlack && ccInput.trim().includes("@") ? [...draftCcList, ccInput.trim()] : draftCcList;
          const finalBcc = !isSlack && bccInput.trim().includes("@") ? [...draftBccList, bccInput.trim()] : draftBccList;
          submit({
            approved: true,
            textAnswer: draftText,
            editedTo: finalTo.join(", "),
            ...(isSlack ? {} : { editedCc: finalCc.join(", "), editedBcc: finalBcc.join(", ") }),
            ...(isNewEmail ? { editedSubject: subjectInput.trim() } : {}),
            editedAttachmentNames: attachedNames,
            ...(draftFromAccountId ? { editedFromAccountId: draftFromAccountId } : {}),
          });
        }}
        disabled={submitting || !canSubmit}
        style={isSynced
          ? ({ pressed }) => [styles.markCompleteBtn, { backgroundColor: theme.primary, opacity: pressed || submitting ? 0.6 : 1 }]
          : ({ pressed }) => [styles.glassBtn, { opacity: pressed || submitting || !canSubmit ? 0.6 : 1 }]}
      >
        {isSynced ? (
          submitting
            ? <ActivityIndicator color="#FFFFFF" size="small" />
            : (
              <>
                <Check size={18} color="#FFFFFF" weight="bold" />
                <Text numberOfLines={1} style={[styles.markCompleteText, { fontFamily: "Inter_600SemiBold" }]}>Mark as Complete</Text>
              </>
            )
        ) : (
          <>
            {canUseGlass && GV
              ? <GV style={StyleSheet.absoluteFill} colorScheme={scheme} glassEffectStyle="regular" />
              : <View style={[StyleSheet.absoluteFill, styles.glassFallback, { backgroundColor: glassBg }]} />}
            {submitting
              ? <ActivityIndicator color={theme.primary} size="small" />
              : <PaperPlaneTilt size={22} color={theme.primary} weight="bold" />}
          </>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  approvalWrap: { paddingTop: 12 },
  deliveredWrap: { paddingHorizontal: 16, gap: 10 },
  deliveredLabel: { fontSize: 11, letterSpacing: 0.5 },
  deliveredFileCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  deliveredFileIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  deliveredFileName: { fontSize: 15, flex: 1 },
  deliveredFileTap: { fontSize: 12 },
  deliveredSummaryWrap: { minHeight: 40, overflow: "hidden" },
  deliveredSummary: { fontSize: 14, lineHeight: 20 },
  envelopeCard: { marginHorizontal: 16, marginTop: 0, marginBottom: 4 },
  envelopeActionsRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 16,
    marginHorizontal: 16,
    marginBottom: 12,
    paddingHorizontal: 2,
  },
  envelopeRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 8,
    minHeight: 40,
  },
  // The From row's own layout — a single selected-account label + chevron
  // (not a scrolling chip list like To/Cc/Bcc, since only one account can
  // ever be selected at once) with the real native Picker invisibly
  // overlaid on top (see the JSX above).
  fromRow: { justifyContent: "space-between" },
  // flex:1 lets this take up all remaining row width after the "From" label
  // (instead of being capped to a fixed % that clipped a longer email mid-
  // domain) — space-between then pins the chevron to the row's far right
  // edge regardless of how long the text is, with the text itself left-
  // aligned and free to fill the space in between.
  fromValueWrap: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 6, marginLeft: 12 },
  // Groups the provider icon + account label as one flexible unit so
  // fromValueWrap's space-between still pins just the chevron/picker to the
  // row's far right, exactly as it did with a single Text child before the
  // icon was added — without this wrapper, the icon would count as its own
  // space-between child and get shoved to the row's far left instead.
  fromValueLabelGroup: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1, minWidth: 0 },
  fromValueText: { fontSize: 15, textAlign: "left", flexShrink: 1 },
  // Single line, horizontally scrolling — chips never wrap or grow the row
  // taller, no matter how many recipients get added; the row's height is
  // always exactly one line.
  envelopeChipScroll: { flex: 1, flexShrink: 1, minWidth: 0, marginLeft: 12 },
  envelopeChipRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexGrow: 1,
  },
  recipientChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 13,
    maxWidth: 200,
    flexShrink: 0,
  },
  recipientChipText: { fontSize: 13, flexShrink: 1 },
  envelopeInlineInput: {
    minWidth: 80,
    fontSize: 15,
    paddingVertical: 4,
  },
  subjectInput: { flex: 1, marginLeft: 12 },
  replyBubbleRow: { marginHorizontal: 16, marginTop: 12 },
  replyBubble: {
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 14,
  },
  draftInput: { fontSize: 15, lineHeight: 22 },
  attachRow: { marginTop: 10 },
  attachCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    minWidth: 140,
    maxWidth: 220,
  },
  attachCardMain: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
    flexShrink: 1,
  },
  attachIcon: {
    width: 28,
    height: 28,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  attachName: { fontSize: 12, flexShrink: 1 },
  addAttachmentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 10,
    marginHorizontal: 16,
    alignSelf: "flex-start",
  },
  addAttachmentChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: "dashed",
  },
  addAttachmentText: { fontSize: 12 },
  approvalBtns: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginHorizontal: 16,
    paddingTop: 14,
  },
  // The full-page Reprompt screen (HitlRepromptMode) — replaces the entire
  // card while state.repromptOpen is true. Matches AddAgentTaskSheet.tsx's
  // own body/footer layout (transparent borderless input, ambient glow,
  // round glass mic+send buttons) rather than HitlQuestionsMode's boxed
  // prompt/textInput chrome that this used to mirror.
  // Given a fixed height by its callers (minHeight below) rather than
  // relying on flex:1 — in HumanInputSheet's BottomSheetView this sizes to
  // content regardless, but in LightningCard, `card` has no parent-
  // provided height at all (it deliberately sizes to ITS content's natural
  // height — see LightningCard.tsx's StackCard/contentWrap comments), so a
  // flex:1 root here had nothing bounded to fill and collapsed toward zero
  // height — the reprompt page rendered but was squashed invisible/
  // untappable in Lightning mode specifically.
  repromptPage: { minHeight: 340 },
  repromptPageHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
  },
  repromptBackBtn: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  repromptPageTitle: { fontSize: 16 },
  // flex:1 (not a fixed height) so the glow/input-wrap below can fill
  // whatever's left of repromptPage's own minHeight — same relationship as
  // AddAgentTaskSheet.tsx's body/inputWrapper.
  repromptPageBody: { flex: 1, paddingHorizontal: 14, position: "relative" },
  prompt: { fontSize: 15, lineHeight: 22 },
  // Container for the real SVG radial-gradient glow — same treatment as
  // AddAgentTaskSheet.tsx's own `glow` style.
  repromptGlow: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: -60,
    height: 220,
    opacity: 0,
  },
  repromptPageInputWrap: { flex: 1, position: "relative" },
  // No border/background box anymore — plain transparent input matching
  // AddAgentTaskSheet.tsx's own textInput exactly (same font, same
  // borderless treatment).
  repromptPageInput: {
    flex: 1,
    paddingHorizontal: 2,
    paddingTop: 6,
    fontSize: 20,
    fontFamily: "Inter_400Regular",
    textAlignVertical: "top",
  },
  // Same "text arriving" flash cue as AddAgentTaskSheet.tsx's
  // textArrivalBar.
  repromptTextArrivalBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 2,
    borderRadius: 1,
  },
  // Row layout, buttons pushed to opposite ends — mic on the left, send on
  // the right, matching AddAgentTaskSheet.tsx's own footer exactly.
  repromptPageFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  btnPrimary: {
    height: 50,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  btnPrimaryText: { color: "#FFF", fontSize: 16 },
  glassBtn: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  repromptBtn: {
    height: 60,
    borderRadius: 30,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    overflow: "hidden",
    // flexShrink + minWidth:0 let this button (and its text) give up width
    // to markCompleteBtn on narrow screens instead of pushing the row past
    // its 16pt margins — a plain intrinsic-width row here overflowed.
    flexShrink: 1,
    minWidth: 0,
  },
  repromptGlassRadius: { borderRadius: 30 },
  repromptText: { fontSize: 15, flexShrink: 1 },
  glassFallback: { borderRadius: 30 },
  markCompleteBtn: {
    height: 60,
    borderRadius: 30,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    flexShrink: 1,
    minWidth: 0,
  },
  markCompleteText: { fontSize: 15, color: "#FFFFFF", flexShrink: 1 },
  groupCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    marginTop: 14,
    overflow: "hidden",
  },
  groupRowLabel: { fontSize: 15 },
  recipientRowLabel: {
    width: 30,
    flexShrink: 0,
    lineHeight: 20,
    includeFontPadding: false,
  },
  groupDivider: { height: StyleSheet.hairlineWidth, marginLeft: 14 },
  replyAllLink: {},
  replyAllText: { fontSize: 12 },
  ccBccToggle: {},
  ccBccToggleText: { fontSize: 12 },
});
