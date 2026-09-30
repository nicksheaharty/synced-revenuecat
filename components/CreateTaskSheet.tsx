import { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Platform } from "react-native";
import { CalendarBlank, CaretRight, X, User } from "phosphor-react-native";
import {
  BottomSheetModal,
  BottomSheetView,
  BottomSheetTextInput,
} from "@expo/ui/community/bottom-sheet";
import { Host, Picker, Text as SwiftUIText } from "@expo/ui/swift-ui";
import { pickerStyle, tag, opacity } from "@expo/ui/swift-ui/modifiers";
// @react-native-community/datetimepicker (NOT @expo/ui's community wrapper):
// its `display="compact"` produces a real native iOS popup card when tapped —
// see the identical rationale comment in HumanInputSheet.tsx.
import RNDateTimePicker from "@react-native-community/datetimepicker";
import { useTheme } from "../hooks/useTheme";
import { useColorScheme } from "../hooks/useColorScheme";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { saveTask, Task, Profile } from "../services/storage";
import { useUser } from "../contexts/UserContext";

type Precision = "none" | "date" | "datetime" | "month";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = Array.from({ length: 6 }, (_, i) => CURRENT_YEAR + i);

const PRECISION_OPTIONS: { id: Precision; label: string }[] = [
  { id: "none", label: "No date" },
  { id: "date", label: "Day" },
  { id: "datetime", label: "Day + time" },
  { id: "month", label: "Month" },
];

function monthStart(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

interface CreateTaskSheetProps {
  isPresented: boolean;
  onClose: () => void;
  /** When provided, the sheet edits this task instead of creating a new one. */
  task?: Task | null;
  /** The sender this task came from, if any — shown as a read-only field. */
  profile?: Profile | null;
}

function precisionFromTask(task?: Task | null): Precision {
  if (!task?.dueDate) return "none";
  return (task.dueDatePrecision as Precision) || "date";
}

function dateFromTask(task?: Task | null): Date {
  if (task?.dueDate) {
    const d = new Date(task.dueDate);
    if (!isNaN(d.getTime())) return d;
  }
  return new Date();
}

export function CreateTaskSheet({ isPresented, onClose, task, profile }: CreateTaskSheetProps) {
  const theme = useTheme();
  const scheme = useColorScheme();
  const insets = useSafeAreaInsets();
  const { user } = useUser();
  const sheetRef = useRef<any>(null);
  const isEditing = !!task;
  const [title, setTitle] = useState("");
  const [precision, setPrecision] = useState<Precision>("none");
  const [dueDate, setDueDate] = useState<Date>(new Date());
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isPresented) {
      sheetRef.current?.present();
    } else {
      sheetRef.current?.dismiss();
    }
  }, [isPresented]);

  useEffect(() => {
    if (isPresented) {
      setTitle(task?.title ?? "");
      setPrecision(precisionFromTask(task));
      setDueDate(dateFromTask(task));
      setSubmitting(false);
    }
  }, [isPresented, task]);

  const handleSave = async () => {
    if (!user || !title.trim() || submitting) return;
    setSubmitting(true);
    try {
      const now = new Date().toISOString();
      const base: Task = task ?? {
        id: `task_h_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        profileId: "",
        userId: user.uid,
        title: "",
        assignee: "human",
        status: "pending",
        implementationPlan: [],
        requiredDeliverables: [],
        createdAt: now,
        updatedAt: now,
        seen: true,
      };
      const updated: Task = {
        ...base,
        title: title.trim(),
        dueDate: precision === "none" ? null : dueDate.toISOString(),
        dueDatePrecision: precision === "none" ? null : precision,
        updatedAt: now,
      };
      await saveTask(updated);
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const canSave = title.trim().length > 0 && !submitting;

  return (
    <BottomSheetModal ref={sheetRef} enablePanDownToClose onDismiss={onClose}>
      <BottomSheetView>
        <View style={[styles.container, { paddingBottom: insets.bottom }]}>
          <View style={styles.header}>
            <Text
              style={[
                styles.headerTitle,
                { color: theme.surface, fontFamily: "Inter_600SemiBold" },
              ]}
            >
              {isEditing ? "Edit Task" : "New Task"}
            </Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <X size={20} color={theme.muted} />
            </Pressable>
          </View>

          <View style={[styles.divider, { backgroundColor: theme.separator }]} />

          <View style={styles.body}>
            {profile && (
              <View
                style={[
                  styles.senderRow,
                  { backgroundColor: theme.card, borderColor: theme.cardBorder },
                ]}
              >
                <User size={14} color={theme.muted} weight="duotone" />
                <Text
                  style={[
                    styles.senderText,
                    { color: theme.muted, fontFamily: "Inter_500Medium" },
                  ]}
                  numberOfLines={1}
                >
                  From {profile.name}
                </Text>
              </View>
            )}

            <BottomSheetTextInput
              value={title}
              onChangeText={setTitle}
              placeholder="What do you need to do?"
              placeholderTextColor={theme.muted}
              autoFocus
              style={[
                styles.textInput,
                {
                  color: theme.surface,
                  borderColor: theme.cardBorder,
                  backgroundColor: theme.card,
                },
              ]}
            />

            <View style={styles.precisionRow}>
              {PRECISION_OPTIONS.map((opt) => {
                const active = precision === opt.id;
                return (
                  <Pressable
                    key={opt.id}
                    onPress={() => {
                      setPrecision(opt.id);
                      if (opt.id === "month") setDueDate(monthStart(new Date()));
                    }}
                    style={[
                      styles.precisionChip,
                      {
                        backgroundColor: active ? theme.primary : theme.card,
                        borderColor: active ? theme.primary : theme.cardBorder,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.precisionChipText,
                        {
                          color: active ? "#FFFFFF" : theme.muted,
                          fontFamily: active ? "Inter_600SemiBold" : "Inter_500Medium",
                        },
                      ]}
                    >
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {precision !== "none" && (
              <View
                style={[
                  styles.groupCard,
                  { backgroundColor: theme.card, borderColor: theme.cardBorder },
                ]}
              >
                {precision === "month" ? (
                  <>
                    <View style={styles.groupRow}>
                      <Text
                        style={[
                          styles.groupRowLabel,
                          { color: theme.surface, fontFamily: "Inter_400Regular" },
                        ]}
                      >
                        Month
                      </Text>
                      <View style={styles.monthPickerAnchor}>
                        <View style={styles.monthPickerTrigger}>
                          <Text
                            style={[
                              styles.groupRowLabel,
                              { color: theme.primary, fontFamily: "Inter_500Medium" },
                            ]}
                          >
                            {MONTH_NAMES[dueDate.getMonth()]}
                          </Text>
                          <CaretRight size={14} color={theme.primary} weight="bold" />
                        </View>

                        {Platform.OS === "ios" && (
                          // Same invisible-overlay technique as the Calendar
                          // provider picker in settings.tsx: the RN Text+chevron
                          // above is what's visible, this Picker is transparent
                          // and only exists so a tap opens the real native menu.
                          <Host
                            colorScheme={scheme as "light" | "dark"}
                            style={StyleSheet.absoluteFill}
                          >
                            <Picker
                              modifiers={[pickerStyle("menu"), opacity(0.02)]}
                              selection={MONTH_NAMES[dueDate.getMonth()]}
                              onSelectionChange={(value) => {
                                const idx = MONTH_NAMES.indexOf(value as string);
                                if (idx === -1) return;
                                const next = new Date(dueDate);
                                next.setFullYear(dueDate.getFullYear(), idx, 1);
                                setDueDate(next);
                              }}
                            >
                              {MONTH_NAMES.map((name) => (
                                <SwiftUIText key={name} modifiers={[tag(name)]}>{name}</SwiftUIText>
                              ))}
                            </Picker>
                          </Host>
                        )}
                      </View>
                    </View>

                    <View style={[styles.groupDivider, { backgroundColor: theme.separator }]} />

                    <View style={styles.groupRow}>
                      <Text
                        style={[
                          styles.groupRowLabel,
                          { color: theme.surface, fontFamily: "Inter_400Regular" },
                        ]}
                      >
                        Year
                      </Text>
                      <View style={styles.monthPickerAnchor}>
                        <View style={styles.monthPickerTrigger}>
                          <Text
                            style={[
                              styles.groupRowLabel,
                              { color: theme.primary, fontFamily: "Inter_500Medium" },
                            ]}
                          >
                            {dueDate.getFullYear()}
                          </Text>
                          <CaretRight size={14} color={theme.primary} weight="bold" />
                        </View>

                        {Platform.OS === "ios" && (
                          <Host
                            colorScheme={scheme as "light" | "dark"}
                            style={StyleSheet.absoluteFill}
                          >
                            <Picker
                              modifiers={[pickerStyle("menu"), opacity(0.02)]}
                              selection={String(dueDate.getFullYear())}
                              onSelectionChange={(value) => {
                                const year = parseInt(value as string, 10);
                                if (isNaN(year)) return;
                                const next = new Date(dueDate);
                                next.setFullYear(year);
                                setDueDate(next);
                              }}
                            >
                              {YEAR_OPTIONS.map((year) => (
                                <SwiftUIText key={year} modifiers={[tag(String(year))]}>
                                  {String(year)}
                                </SwiftUIText>
                              ))}
                            </Picker>
                          </Host>
                        )}
                      </View>
                    </View>
                  </>
                ) : (
                  <>
                    <View style={styles.groupRow}>
                      <Text
                        style={[
                          styles.groupRowLabel,
                          { color: theme.surface, fontFamily: "Inter_400Regular" },
                        ]}
                      >
                        Date
                      </Text>
                      <RNDateTimePicker
                        mode="date"
                        display="compact"
                        value={dueDate}
                        onChange={(_e, date) => {
                          if (!date) return;
                          const next = new Date(dueDate);
                          next.setFullYear(date.getFullYear(), date.getMonth(), date.getDate());
                          setDueDate(next);
                        }}
                      />
                    </View>
                    {precision === "datetime" && (
                      <>
                        <View
                          style={[styles.groupDivider, { backgroundColor: theme.separator }]}
                        />
                        <View style={styles.groupRow}>
                          <Text
                            style={[
                              styles.groupRowLabel,
                              { color: theme.surface, fontFamily: "Inter_400Regular" },
                            ]}
                          >
                            Time
                          </Text>
                          <RNDateTimePicker
                            mode="time"
                            display="compact"
                            value={dueDate}
                            onChange={(_e, date) => {
                              if (!date) return;
                              const next = new Date(dueDate);
                              next.setHours(date.getHours(), date.getMinutes(), 0, 0);
                              setDueDate(next);
                            }}
                          />
                        </View>
                      </>
                    )}
                  </>
                )}
              </View>
            )}

            {precision !== "none" && (
              <View style={styles.previewRow}>
                <CalendarBlank size={13} color={theme.muted} weight="bold" />
                <Text
                  style={[
                    styles.previewText,
                    { color: theme.muted, fontFamily: "Inter_500Medium" },
                  ]}
                >
                  Due{" "}
                  {precision === "month"
                    ? MONTH_NAMES[dueDate.getMonth()]
                    : precision === "datetime"
                      ? `${dueDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${dueDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`
                      : dueDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </Text>
              </View>
            )}
          </View>

          <View
            style={[
              styles.footer,
              { borderTopColor: theme.separator, paddingBottom: Math.max(insets.bottom, 16) },
            ]}
          >
            <Pressable
              style={({ pressed }) => [
                styles.btnPrimary,
                { backgroundColor: theme.primary, opacity: pressed || !canSave ? 0.4 : 1 },
              ]}
              onPress={handleSave}
              disabled={!canSave}
            >
              {submitting ? (
                <ActivityIndicator color="#FFF" size="small" />
              ) : (
                <Text style={[styles.btnPrimaryText, { fontFamily: "Inter_600SemiBold" }]}>
                  {isEditing ? "Save" : "Create Task"}
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      </BottomSheetView>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  container: {},
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
  },
  headerTitle: { fontSize: 17 },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 14,
  },
  body: {
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 8,
  },
  senderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 10,
  },
  senderText: { fontSize: 12 },
  textInput: {
    minHeight: 48,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 14,
    fontSize: 15,
  },
  precisionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 14,
  },
  precisionChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  precisionChipText: { fontSize: 13 },
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
    height: 55,
  },
  groupRowLabel: { fontSize: 15 },
  groupDivider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 14,
  },
  monthPickerAnchor: {
    position: "relative",
  },
  monthPickerTrigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  previewRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 10,
    paddingHorizontal: 2,
  },
  previewText: { fontSize: 12 },
  footer: {
    paddingHorizontal: 14,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 8,
  },
  btnPrimary: {
    height: 50,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  btnPrimaryText: { color: "#FFF", fontSize: 15 },
});
