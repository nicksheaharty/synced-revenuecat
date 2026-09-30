import { Platform, View, Text, StyleSheet, Pressable, ActivityIndicator, ScrollView, Switch, Modal } from "react-native";
import {
  Check, X, Calendar, Clock, MapPin, Users, VideoCamera, CaretRight, CaretDown, PencilSimple,
} from "phosphor-react-native";
import { BottomSheetTextInput } from "@expo/ui/community/bottom-sheet";
import { Host, Picker, Text as SwiftUIText } from "@expo/ui/swift-ui";
import { pickerStyle, tag, opacity } from "@expo/ui/swift-ui/modifiers";
import RNDateTimePicker from "@react-native-community/datetimepicker";
import { useTheme } from "../hooks/useTheme";
import { useColorScheme } from "../hooks/useColorScheme";
import { accountLabel } from "../services/storage";
import {
  HitlAnswerState, REMINDER_PRESETS, RECURRENCE_PRESETS, getTimeZoneOptions,
  toDate, toDateOnlyString, addOneDay, formatEventWhen, accountKeyFor,
} from "./useHitlAnswerState";

let GlassView: React.ComponentType<any> | null = null;
try { GlassView = require("expo-glass-effect").GlassView; } catch { }

/**
 * The mode="approve_calendar" body — collapsed Calendar-app-style summary
 * card by default, tap to expand into the full editable event form. Pure
 * presentational component driven by useHitlAnswerState.
 */
export function HitlApproveCalendarMode({ state, bottomInset }: { state: HitlAnswerState; bottomInset: number }) {
  const theme = useTheme();
  const scheme = useColorScheme();
  const glassBg = scheme === "dark" ? "rgba(40,40,44,0.92)" : "rgba(235,235,240,0.92)";
  const canUseGlass = Platform.OS === "ios" && !!GlassView;
  const GV = GlassView;

  const {
    eventDraft, eventFormExpanded, setEventFormExpanded, canApproveCalendar, submitting, submit,
    newAttendeeEmail, setNewAttendeeEmail, addAttendee, removeAttendee, updateEventDraft, toggleAllDay,
    showTimeZonePicker, setShowTimeZonePicker,
    showCustomReminder, customReminderMinutes, reminderPresetId, selectReminderPreset, applyCustomReminder,
    showCustomRecurrence, customRrule, recurrencePresetId, selectRecurrencePreset, applyCustomRrule,
    startReprompt,
    accountsForProvider,
  } = state;

  if (!eventDraft) return null;

  // Only worth showing a Calendar picker when there's actually more than one
  // account to choose between — same reasoning as HitlApproveMode's From
  // dropdown.
  const showFromPicker = accountsForProvider.length > 1;
  const selectedFromEntry =
    accountsForProvider.find(e => accountKeyFor(e.provider, e.account.accountId) === eventDraft.fromAccountId)
    ?? accountsForProvider[0];

  // Own small card ABOVE the collapsed event summary (not folded into the
  // eventCard Pressable below, which is a single tap target that opens the
  // expanded form — this needs its own separate tap target for the native
  // Picker overlay) — rendered once here, reused for the collapsed view.
  const calendarPickerRow = showFromPicker && (
    <View style={[styles.groupCard, styles.calendarPickerCard, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
      <View style={styles.groupRow}>
        <Text style={[styles.groupRowLabel, { color: theme.muted, fontFamily: "Inter_400Regular" }]}>Calendar</Text>
        <View style={styles.fromValueWrap}>
          <Text numberOfLines={1} style={[styles.fromValueText, { color: theme.surface, fontFamily: "Inter_400Regular" }]}>
            {selectedFromEntry ? accountLabel(selectedFromEntry.account) : ""}
          </Text>
          <CaretDown size={12} color={theme.muted} weight="bold" />
          {/* Same invisible-Picker-overlay pattern as HitlApproveMode's From
              dropdown and app/(main)/settings.tsx's primary-calendar-provider
              picker — see either's comment. */}
          {Platform.OS === "ios" && (
            <Host colorScheme={scheme} style={StyleSheet.absoluteFill}>
              <Picker
                modifiers={[pickerStyle("menu"), opacity(0.02)]}
                selection={selectedFromEntry ? accountKeyFor(selectedFromEntry.provider, selectedFromEntry.account.accountId) : undefined}
                onSelectionChange={(value) => updateEventDraft({ fromAccountId: value as string })}
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
        </View>
      </View>
    </View>
  );

  return (
    <>
      {!eventFormExpanded && (
        <View style={styles.calendarCollapsedWrap}>
          {calendarPickerRow}
          <Pressable
            style={[styles.eventCard, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}
            onPress={() => setEventFormExpanded(true)}
          >
            <View style={styles.eventCardTop}>
              <Text style={[styles.eventCardTitle, { color: theme.surface, fontFamily: "Inter_600SemiBold" }]} numberOfLines={1}>
                {eventDraft.summary || "Untitled event"}
              </Text>
              <View style={styles.eventCardEditHint}>
                <PencilSimple size={12} color={theme.muted} weight="bold" />
                <CaretRight size={14} color={theme.muted} weight="bold" />
              </View>
            </View>
            <View style={styles.eventCardRow}>
              <Calendar size={14} color={theme.muted} weight="duotone" />
              <Text style={[styles.eventCardRowText, { color: theme.muted, fontFamily: "Inter_400Regular" }]}>
                {formatEventWhen(eventDraft)}
              </Text>
            </View>
            {!eventDraft.allDay && !!eventDraft.timeZone && (
              <View style={styles.eventCardRow}>
                <Clock size={14} color={theme.muted} weight="duotone" />
                <Text style={[styles.eventCardRowText, { color: theme.muted, fontFamily: "Inter_400Regular" }]}>{eventDraft.timeZone}</Text>
              </View>
            )}
            {!!eventDraft.location && (
              <View style={styles.eventCardRow}>
                <MapPin size={14} color={theme.muted} weight="duotone" />
                <Text style={[styles.eventCardRowText, { color: theme.muted, fontFamily: "Inter_400Regular" }]} numberOfLines={1}>{eventDraft.location}</Text>
              </View>
            )}
            {(eventDraft.attendees ?? []).length > 0 && (
              <View style={styles.eventCardRow}>
                <Users size={14} color={theme.muted} weight="duotone" />
                <Text style={[styles.eventCardRowText, { color: theme.muted, fontFamily: "Inter_400Regular" }]} numberOfLines={1}>
                  {(eventDraft.attendees ?? []).join(", ")}
                </Text>
              </View>
            )}
            {!!eventDraft.addGoogleMeet && (
              <View style={styles.eventCardRow}>
                <VideoCamera size={14} color={theme.muted} weight="duotone" />
                <Text style={[styles.eventCardRowText, { color: theme.muted, fontFamily: "Inter_400Regular" }]}>Google Meet</Text>
              </View>
            )}
          </Pressable>

          <View style={[styles.approvalBtns, { paddingBottom: Math.max(bottomInset, 16), marginTop: 8 }]}>
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
              onPress={() => submit({ approved: true, editedEvent: eventDraft })}
              disabled={submitting || !canApproveCalendar}
              style={({ pressed }) => [styles.glassBtn, { opacity: pressed || submitting || !canApproveCalendar ? 0.4 : 1 }]}
            >
              {canUseGlass && GV
                ? <GV style={StyleSheet.absoluteFill} colorScheme={scheme} glassEffectStyle="regular" />
                : <View style={[StyleSheet.absoluteFill, styles.glassFallback, { backgroundColor: glassBg }]} />}
              {submitting
                ? <ActivityIndicator color={theme.primary} size="small" />
                : <Check size={22} color={theme.primary} weight="bold" />}
            </Pressable>
          </View>
        </View>
      )}

      {eventFormExpanded && (
        <ScrollView style={styles.calendarScroll} contentContainerStyle={styles.calendarScrollContent}>
          <Pressable style={styles.backToOptionsRow} onPress={() => setEventFormExpanded(false)}>
            <Text style={[styles.backToOptionsText, { color: theme.primary, fontFamily: "Inter_500Medium" }]}>
              ‹ Back to summary
            </Text>
          </Pressable>

          <BottomSheetTextInput
            style={[styles.titleInput, { color: theme.surface, fontFamily: "Inter_600SemiBold" }]}
            value={eventDraft.summary}
            onChangeText={(v) => updateEventDraft({ summary: v })}
            placeholder="Event title"
            placeholderTextColor={theme.muted}
          />

          {calendarPickerRow}

          <View style={[styles.groupCard, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
            <View style={styles.groupRow}>
              <Text style={[styles.groupRowLabel, { color: theme.surface, fontFamily: "Inter_400Regular" }]}>All-day</Text>
              <Switch value={!!eventDraft.allDay} onValueChange={toggleAllDay} />
            </View>

            {eventDraft.allDay ? (
              <>
                <View style={[styles.groupDivider, { backgroundColor: theme.separator }]} />
                <View style={styles.groupRow}>
                  <Text style={[styles.groupRowLabel, { color: theme.surface, fontFamily: "Inter_400Regular" }]}>Start</Text>
                  <RNDateTimePicker
                    mode="date"
                    display="compact"
                    value={toDate(eventDraft.startDate)}
                    onChange={(_e, date) => {
                      if (!date) return;
                      const startDate = toDateOnlyString(date);
                      const currentEnd = eventDraft.endDate;
                      updateEventDraft({
                        startDate,
                        endDate: currentEnd && currentEnd > startDate ? currentEnd : addOneDay(startDate),
                      });
                    }}
                  />
                </View>

                <View style={[styles.groupDivider, { backgroundColor: theme.separator }]} />
                <View style={styles.groupRow}>
                  <Text style={[styles.groupRowLabel, { color: theme.surface, fontFamily: "Inter_400Regular" }]}>End</Text>
                  <RNDateTimePicker
                    mode="date"
                    display="compact"
                    value={toDate(eventDraft.endDate)}
                    minimumDate={eventDraft.startDate ? toDate(eventDraft.startDate) : undefined}
                    onChange={(_e, date) => {
                      if (!date) return;
                      updateEventDraft({ endDate: toDateOnlyString(date) });
                    }}
                  />
                </View>
              </>
            ) : (
              <>
                <View style={[styles.groupDivider, { backgroundColor: theme.separator }]} />
                <View style={styles.groupRow}>
                  <Text style={[styles.groupRowLabel, { color: theme.surface, fontFamily: "Inter_400Regular" }]}>Date</Text>
                  <RNDateTimePicker
                    mode="date"
                    display="compact"
                    value={toDate(eventDraft.startDateTime)}
                    onChange={(_e, date) => {
                      if (!date) return;
                      const start = toDate(eventDraft.startDateTime);
                      const end = toDate(eventDraft.endDateTime);
                      const durationMs = end.getTime() - start.getTime();
                      const newStart = new Date(date);
                      newStart.setHours(start.getHours(), start.getMinutes(), 0, 0);
                      const newEnd = new Date(newStart.getTime() + (durationMs > 0 ? durationMs : 60 * 60 * 1000));
                      updateEventDraft({ startDateTime: newStart.toISOString(), endDateTime: newEnd.toISOString() });
                    }}
                  />
                </View>

                <View style={[styles.groupDivider, { backgroundColor: theme.separator }]} />
                <View style={styles.groupRow}>
                  <Text style={[styles.groupRowLabel, { color: theme.surface, fontFamily: "Inter_400Regular" }]}>Starts</Text>
                  <RNDateTimePicker
                    mode="time"
                    display="compact"
                    value={toDate(eventDraft.startDateTime)}
                    onChange={(_e, date) => {
                      if (!date) return;
                      const end = toDate(eventDraft.endDateTime);
                      const start = toDate(eventDraft.startDateTime);
                      const durationMs = Math.max(end.getTime() - start.getTime(), 15 * 60 * 1000);
                      updateEventDraft({
                        startDateTime: date.toISOString(),
                        endDateTime: new Date(date.getTime() + durationMs).toISOString(),
                      });
                    }}
                  />
                </View>

                <View style={[styles.groupDivider, { backgroundColor: theme.separator }]} />
                <View style={styles.groupRow}>
                  <Text style={[styles.groupRowLabel, { color: theme.surface, fontFamily: "Inter_400Regular" }]}>Ends</Text>
                  <RNDateTimePicker
                    mode="time"
                    display="compact"
                    value={toDate(eventDraft.endDateTime)}
                    onChange={(_e, date) => {
                      if (!date) return;
                      updateEventDraft({ endDateTime: date.toISOString() });
                    }}
                  />
                </View>
              </>
            )}

            <View style={[styles.groupDivider, { backgroundColor: theme.separator }]} />
            <Pressable style={styles.groupRow} onPress={() => setShowTimeZonePicker(true)}>
              <Text style={[styles.groupRowLabel, { color: theme.surface, fontFamily: "Inter_400Regular" }]}>Time Zone</Text>
              <Text style={[styles.groupRowValue, { color: theme.primary, fontFamily: "Inter_500Medium" }]} numberOfLines={1}>
                {eventDraft.timeZone || getTimeZoneOptions()[0]}
              </Text>
            </Pressable>
            {eventDraft.allDay && (
              <Text style={[styles.fieldHint, { color: theme.muted, fontFamily: "Inter_400Regular", marginHorizontal: 14 }]}>
                End date is exclusive — the day after the event's last day.
              </Text>
            )}
          </View>

          <View style={[styles.groupCard, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
            <BottomSheetTextInput
              style={[styles.groupTextInput, { color: theme.surface, fontFamily: "Inter_400Regular" }]}
              value={eventDraft.location ?? ""}
              onChangeText={(v) => updateEventDraft({ location: v })}
              placeholder="Location"
              placeholderTextColor={theme.muted}
            />
            <View style={[styles.groupDivider, { backgroundColor: theme.separator }]} />
            <BottomSheetTextInput
              style={[styles.groupTextInput, styles.groupTextInputMultiline, { color: theme.surface, fontFamily: "Inter_400Regular" }]}
              value={eventDraft.description ?? ""}
              onChangeText={(v) => updateEventDraft({ description: v })}
              placeholder="Description"
              placeholderTextColor={theme.muted}
              multiline
            />
          </View>

          <Text style={[styles.fieldLabel, { color: theme.muted, fontFamily: "Inter_500Medium" }]}>Attendees</Text>
          {(eventDraft.attendees ?? []).length > 0 && (
            <View style={styles.attendeeChips}>
              {(eventDraft.attendees ?? []).map((email) => (
                <View key={email} style={[styles.attendeeChip, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
                  <Text style={[styles.attendeeChipText, { color: theme.surface, fontFamily: "Inter_500Medium" }]} numberOfLines={1}>{email}</Text>
                  <Pressable onPress={() => removeAttendee(email)} hitSlop={8}>
                    <X size={12} color={theme.muted} weight="bold" />
                  </Pressable>
                </View>
              ))}
            </View>
          )}
          <View style={styles.attendeeAddRow}>
            <BottomSheetTextInput
              style={[styles.fieldInput, { flex: 1, color: theme.surface, borderColor: theme.cardBorder, backgroundColor: theme.searchBg, fontFamily: "Inter_400Regular" }]}
              value={newAttendeeEmail}
              onChangeText={setNewAttendeeEmail}
              placeholder="Add attendee email"
              placeholderTextColor={theme.muted}
              autoCapitalize="none"
              keyboardType="email-address"
              onSubmitEditing={addAttendee}
            />
            <Pressable style={[styles.addAttendeeBtn, { backgroundColor: theme.primary }]} onPress={addAttendee}>
              <Text style={[styles.addAttendeeBtnText, { fontFamily: "Inter_600SemiBold" }]}>Add</Text>
            </Pressable>
          </View>

          <Text style={[styles.fieldLabel, { color: theme.muted, fontFamily: "Inter_500Medium" }]}>Reminder</Text>
          <View style={styles.presetRow}>
            {REMINDER_PRESETS.map((p) => {
              const selected = !showCustomReminder && reminderPresetId === p.id;
              return (
                <Pressable
                  key={p.id}
                  style={[styles.presetChip, { borderColor: selected ? theme.primary : theme.cardBorder, backgroundColor: selected ? theme.actionBg : theme.card }]}
                  onPress={() => selectReminderPreset(p.id)}
                >
                  <Text style={[styles.presetChipText, { color: theme.surface, fontFamily: selected ? "Inter_600SemiBold" : "Inter_400Regular" }]}>{p.label}</Text>
                </Pressable>
              );
            })}
            <Pressable
              style={[styles.presetChip, styles.customOptionRow, { borderColor: showCustomReminder ? theme.primary : theme.cardBorder, backgroundColor: showCustomReminder ? theme.actionBg : theme.card }]}
              onPress={() => selectReminderPreset("custom")}
            >
              <Text style={[styles.presetChipText, { color: theme.surface, fontFamily: showCustomReminder ? "Inter_600SemiBold" : "Inter_400Regular" }]}>Custom...</Text>
            </Pressable>
          </View>
          {showCustomReminder && (
            <BottomSheetTextInput
              style={[styles.fieldInput, { color: theme.surface, borderColor: theme.cardBorder, backgroundColor: theme.searchBg, fontFamily: "Inter_400Regular" }]}
              value={customReminderMinutes}
              onChangeText={applyCustomReminder}
              placeholder="Minutes before event"
              placeholderTextColor={theme.muted}
              keyboardType="number-pad"
            />
          )}

          <Text style={[styles.fieldLabel, { color: theme.muted, fontFamily: "Inter_500Medium" }]}>Repeat</Text>
          <View style={styles.presetRow}>
            {RECURRENCE_PRESETS.map((p) => {
              const selected = !showCustomRecurrence && recurrencePresetId === p.id;
              return (
                <Pressable
                  key={p.id}
                  style={[styles.presetChip, { borderColor: selected ? theme.primary : theme.cardBorder, backgroundColor: selected ? theme.actionBg : theme.card }]}
                  onPress={() => selectRecurrencePreset(p.id)}
                >
                  <Text style={[styles.presetChipText, { color: theme.surface, fontFamily: selected ? "Inter_600SemiBold" : "Inter_400Regular" }]}>{p.label}</Text>
                </Pressable>
              );
            })}
            <Pressable
              style={[styles.presetChip, styles.customOptionRow, { borderColor: showCustomRecurrence ? theme.primary : theme.cardBorder, backgroundColor: showCustomRecurrence ? theme.actionBg : theme.card }]}
              onPress={() => selectRecurrencePreset("custom")}
            >
              <Text style={[styles.presetChipText, { color: theme.surface, fontFamily: showCustomRecurrence ? "Inter_600SemiBold" : "Inter_400Regular" }]}>Custom...</Text>
            </Pressable>
          </View>
          {showCustomRecurrence && (
            <BottomSheetTextInput
              style={[styles.fieldInput, { color: theme.surface, borderColor: theme.cardBorder, backgroundColor: theme.searchBg, fontFamily: "Inter_400Regular" }]}
              value={customRrule}
              onChangeText={applyCustomRrule}
              placeholder='e.g. RRULE:FREQ=WEEKLY;BYDAY=TU,TH;COUNT=10'
              placeholderTextColor={theme.muted}
              autoCapitalize="none"
            />
          )}

          <View style={[styles.groupCard, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
            <View style={styles.groupRow}>
              <Text style={[styles.groupRowLabel, { color: theme.surface, fontFamily: "Inter_400Regular" }]}>Add Google Meet</Text>
              <Switch value={!!eventDraft.addGoogleMeet} onValueChange={(v) => updateEventDraft({ addGoogleMeet: v })} />
            </View>
          </View>

          <View style={[styles.approvalBtns, { paddingBottom: Math.max(bottomInset, 16), marginTop: 8 }]}>
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
              onPress={() => submit({ approved: true, editedEvent: eventDraft })}
              disabled={submitting || !canApproveCalendar}
              style={({ pressed }) => [styles.glassBtn, { opacity: pressed || submitting || !canApproveCalendar ? 0.4 : 1 }]}
            >
              {canUseGlass && GV
                ? <GV style={StyleSheet.absoluteFill} colorScheme={scheme} glassEffectStyle="regular" />
                : <View style={[StyleSheet.absoluteFill, styles.glassFallback, { backgroundColor: glassBg }]} />}
              {submitting
                ? <ActivityIndicator color={theme.primary} size="small" />
                : <Check size={22} color={theme.primary} weight="bold" />}
            </Pressable>
          </View>
        </ScrollView>
      )}

      {/* Timezone picker — a true native modal dropdown (RN's Modal,
          presentationStyle="pageSheet" on iOS) rather than an inline
          expanding list. */}
      <Modal
        visible={showTimeZonePicker}
        animationType="slide"
        presentationStyle={Platform.OS === "ios" ? "pageSheet" : undefined}
        onRequestClose={() => setShowTimeZonePicker(false)}
      >
        <View style={[styles.tzModalContainer, { backgroundColor: theme.background }]}>
          <View style={styles.tzModalHeader}>
            <Text style={[styles.tzModalTitle, { color: theme.surface, fontFamily: "Inter_600SemiBold" }]}>Time Zone</Text>
            <Pressable onPress={() => setShowTimeZonePicker(false)} hitSlop={12}>
              <Text style={[styles.tzModalDone, { color: theme.primary, fontFamily: "Inter_600SemiBold" }]}>Done</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.tzModalList}>
            {getTimeZoneOptions().map((tz) => {
              const selected = (eventDraft.timeZone || getTimeZoneOptions()[0]) === tz;
              return (
                <Pressable
                  key={tz}
                  style={[styles.optionRow, { borderColor: selected ? theme.primary : theme.cardBorder, backgroundColor: selected ? theme.actionBg : theme.card, marginBottom: 6 }]}
                  onPress={() => { updateEventDraft({ timeZone: tz }); setShowTimeZonePicker(false); }}
                >
                  <Text style={[styles.optionLabel, { color: theme.surface, fontFamily: selected ? "Inter_600SemiBold" : "Inter_400Regular" }]}>{tz}</Text>
                  {selected && <Check size={14} color={theme.primary} weight="bold" />}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  calendarCollapsedWrap: { paddingHorizontal: 16, paddingTop: 4 },
  // Sits directly above eventCard on the collapsed summary view — its own
  // separate card/tap-target (not folded into eventCard's single Pressable,
  // which opens the expanded form on any tap).
  calendarPickerCard: { marginTop: 0, marginBottom: 10 },
  eventCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 14,
  },
  eventCardTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  eventCardTitle: { fontSize: 16, flex: 1, marginRight: 8 },
  eventCardEditHint: { flexDirection: "row", alignItems: "center", gap: 4 },
  eventCardRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 5,
  },
  eventCardRowText: { fontSize: 13, flexShrink: 1 },
  // No horizontal margin here — this renders inside calendarCollapsedWrap,
  // which already has paddingHorizontal:16 (see below); adding another 16
  // on top of that doubled the inset and misaligned these buttons from the
  // event card's edges above them.
  approvalBtns: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 14,
  },
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
    // flexShrink + minWidth:0 so the label can give up width instead of
    // pushing the row past its 16pt margins on narrow screens.
    flexShrink: 1,
    minWidth: 0,
  },
  repromptGlassRadius: { borderRadius: 30 },
  repromptText: { fontSize: 15, flexShrink: 1 },
  glassFallback: { borderRadius: 30 },
  calendarScroll: { maxHeight: 480 },
  calendarScrollContent: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 8 },
  backToOptionsRow: { paddingVertical: 6, marginBottom: 8 },
  backToOptionsText: { fontSize: 13 },
  titleInput: {
    fontSize: 20,
    marginTop: 8,
    marginBottom: 16,
    padding: 0,
  },
  groupCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    marginTop: 14,
    overflow: "hidden",
  },
  groupRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 44,
  },
  groupRowLabel: { fontSize: 15 },
  groupRowValue: { fontSize: 15, flexShrink: 1, maxWidth: "55%", textAlign: "right" },
  // Calendar-account row's label+chevron wrap, with the invisible native
  // Picker overlaid on top — see the JSX above. flex:1 + space-between lets
  // the text fill the remaining row width (left-aligned) while the chevron
  // stays pinned to the row's far right edge, instead of both being capped
  // into a fixed % that clipped a longer email mid-domain.
  fromValueWrap: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 6, marginLeft: 12 },
  fromValueText: { fontSize: 15, textAlign: "left", flexShrink: 1 },
  groupDivider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 14,
  },
  groupTextInput: {
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 44,
  },
  groupTextInputMultiline: { minHeight: 70, textAlignVertical: "top" },
  fieldLabel: { fontSize: 12, marginTop: 14, marginBottom: 6 },
  fieldHint: { fontSize: 11, marginTop: 6 },
  fieldInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  attendeeChips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8 },
  attendeeChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: 220,
  },
  attendeeChipText: { fontSize: 12, flexShrink: 1 },
  attendeeAddRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  addAttendeeBtn: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10 },
  addAttendeeBtnText: { color: "#FFF", fontSize: 14 },
  presetRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  presetChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
  customOptionRow: { borderStyle: "dashed" },
  presetChipText: { fontSize: 13 },
  tzModalContainer: { flex: 1 },
  tzModalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
  },
  tzModalTitle: { fontSize: 17 },
  tzModalDone: { fontSize: 16 },
  tzModalList: { paddingHorizontal: 16, paddingBottom: 24 },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
  optionLabel: { fontSize: 15, flex: 1 },
});
