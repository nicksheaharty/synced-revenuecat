import { View, Text, StyleSheet, Pressable } from "react-native";
import { Check } from "phosphor-react-native";
import { BottomSheetTextInput } from "@expo/ui/community/bottom-sheet";
import { useTheme } from "../hooks/useTheme";
import { HitlAnswerState } from "./useHitlAnswerState";

/**
 * The mode="questions" body — quick-pick option buttons (if any) + an
 * always-available free-text fallback. Pure presentational component driven
 * by useHitlAnswerState; rendered identically inside HumanInputSheet's
 * bottom-sheet shell and LightningCard's card shell.
 */
export function HitlQuestionsMode({ state }: { state: HitlAnswerState }) {
  const theme = useTheme();
  const { currentQuestion, hasOptions, showCustomInput, answers, currentAnswer, currentOptions, selectOption, showCustomInputFor, hideCustomInputFor, setAnswers } = state;
  if (!currentQuestion) return null;

  return (
    <>
      <View style={styles.promptRow}>
        <Text style={[styles.prompt, { color: theme.surface, fontFamily: "Inter_500Medium" }]}>
          {currentQuestion.prompt}
        </Text>
      </View>
      <View style={[styles.divider, { backgroundColor: theme.separator }]} />
      <View style={styles.body}>
        {hasOptions && !showCustomInput && (
          <>
            {currentOptions.map((opt) => {
              const selected = answers[currentQuestion.id] === opt.id;
              return (
                <Pressable
                  key={opt.id}
                  style={[
                    styles.optionRow,
                    {
                      borderColor: selected ? theme.primary : theme.cardBorder,
                      backgroundColor: selected ? theme.actionBg : theme.card,
                      marginBottom: 8,
                    },
                  ]}
                  onPress={() => selectOption(currentQuestion.id, opt.id)}
                >
                  <Text style={[styles.optionLabel, { color: theme.surface, fontFamily: selected ? "Inter_600SemiBold" : "Inter_400Regular" }]}>
                    {opt.label}
                  </Text>
                  {selected && <Check size={14} color={theme.primary} weight="bold" />}
                </Pressable>
              );
            })}
            <Pressable
              style={[styles.optionRow, styles.customOptionRow, { borderColor: theme.cardBorder }]}
              onPress={() => showCustomInputFor(currentQuestion.id)}
            >
              <Text style={[styles.optionLabel, { color: theme.muted, fontFamily: "Inter_400Regular" }]}>
                Something else...
              </Text>
            </Pressable>
          </>
        )}

        {showCustomInput && (
          <>
            {hasOptions && (
              <Pressable
                style={styles.backToOptionsRow}
                onPress={() => hideCustomInputFor(currentQuestion.id)}
              >
                <Text style={[styles.backToOptionsText, { color: theme.primary, fontFamily: "Inter_500Medium" }]}>
                  ‹ Back to suggestions
                </Text>
              </Pressable>
            )}
            <BottomSheetTextInput
              style={[styles.textInput, {
                color: theme.surface,
                borderColor: theme.cardBorder,
                backgroundColor: theme.searchBg,
                fontFamily: "Inter_400Regular",
              }]}
              multiline
              placeholder="Type your answer..."
              placeholderTextColor={theme.muted}
              value={currentAnswer}
              onChangeText={(v) => setAnswers(prev => ({ ...prev, [currentQuestion.id]: v }))}
              autoFocus={hasOptions}
            />
          </>
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  promptRow: { paddingHorizontal: 16, paddingBottom: 12 },
  prompt: { fontSize: 15, lineHeight: 22 },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: 14 },
  body: { paddingHorizontal: 14, paddingTop: 14, paddingBottom: 8 },
  textInput: {
    minHeight: 100,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    lineHeight: 22,
    textAlignVertical: "top",
  },
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
  customOptionRow: { borderStyle: "dashed" },
  backToOptionsRow: { paddingVertical: 6, marginBottom: 8 },
  backToOptionsText: { fontSize: 13 },
});
