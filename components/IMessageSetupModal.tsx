import { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  ScrollView,
  Linking,
} from "react-native";
import {
  X,
  ArrowRight,
  CheckCircle,
  ChatCircle,
  Robot,
  BellSimple,
  LinkSimple,
} from "phosphor-react-native";

interface Props {
  visible: boolean;
  theme: Record<string, string>;
  onApprove: () => void;
  onClose: () => void;
}

const STEPS = [
  {
    icon: Robot,
    title: "Open Shortcuts",
    body: "On your iPhone, open the Shortcuts app and tap the Automation tab at the bottom.",
  },
  {
    icon: BellSimple,
    title: "New Automation",
    body: 'Tap the + button in the top right, then choose "New Automation". Scroll down and tap "Message".',
  },
  {
    icon: ChatCircle,
    title: "Set the trigger",
    body: 'Make sure "When I Receive a Message" is selected. Leave Sender as "Anyone" and Message as "Any Message". Tap Next.',
  },
  {
    icon: LinkSimple,
    title: "Add the Synced action",
    body: 'Tap "Add Action", search for "Receive Message", and select it under Synced. You\'ll see two fields: Message Text and Sender Name.',
  },
  {
    icon: LinkSimple,
    title: "Wire up the variables",
    body: 'Tap the Message Text field and choose "Message Content" from the variables list. Then tap Sender Name and choose "Sender Name". These come from the trigger automatically.',
  },
  {
    icon: CheckCircle,
    title: "Turn off Ask Before Running",
    body: 'Tap Next, then toggle off "Ask Before Running" so it runs silently. Tap Done.',
  },
];

export default function IMessageSetupModal({
  visible,
  theme,
  onApprove,
  onClose,
}: Props) {
  const [step, setStep] = useState(0);
  const isLast = step === STEPS.length - 1;
  const current = STEPS[step];
  const Icon = current.icon;

  const reset = () => setStep(0);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: theme.separator }]}>
          <Text
            style={[
              styles.headerTitle,
              { color: theme.surface, fontFamily: "MackinacPro_700Bold" },
            ]}
          >
            Connect iMessage
          </Text>
          <Pressable
            onPress={() => {
              reset();
              onClose();
            }}
            hitSlop={12}
          >
            <X size={22} color={theme.muted} weight="bold" />
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={styles.body}
          showsVerticalScrollIndicator={false}
        >
          {/* Progress dots */}
          <View style={styles.dots}>
            {STEPS.map((_, i) => (
              <View
                key={i}
                style={[
                  styles.dot,
                  {
                    backgroundColor:
                      i <= step ? theme.primary : theme.separator,
                  },
                ]}
              />
            ))}
          </View>

          {/* Step card */}
          <View
            style={[
              styles.stepCard,
              { backgroundColor: theme.card, borderColor: theme.cardBorder },
            ]}
          >
            <View
              style={[
                styles.stepIconCircle,
                { backgroundColor: theme.primary + "18" },
              ]}
            >
              <Icon size={32} color={theme.primary} weight="duotone" />
            </View>
            <Text
              style={[
                styles.stepCounter,
                { color: theme.muted, fontFamily: "Inter_500Medium" },
              ]}
            >
              Step {step + 1} of {STEPS.length}
            </Text>
            <Text
              style={[
                styles.stepTitle,
                { color: theme.surface, fontFamily: "Inter_700Bold" },
              ]}
            >
              {current.title}
            </Text>
            <Text
              style={[
                styles.stepBody,
                { color: theme.muted, fontFamily: "Inter_400Regular" },
              ]}
            >
              {current.body}
            </Text>
          </View>

          {/* Open Shortcuts button on first step */}
          {step === 0 && (
            <Pressable
              style={[styles.openBtn, { borderColor: theme.primary }]}
              onPress={() => Linking.openURL("shortcuts://")}
            >
              <Text
                style={[
                  styles.openBtnText,
                  { color: theme.primary, fontFamily: "Inter_600SemiBold" },
                ]}
              >
                Open Shortcuts App
              </Text>
            </Pressable>
          )}
        </ScrollView>

        {/* Bottom actions */}
        <View style={[styles.footer, { borderTopColor: theme.separator }]}>
          {step > 0 && (
            <Pressable
              style={[styles.backBtn, { borderColor: theme.separator }]}
              onPress={() => setStep((s) => s - 1)}
            >
              <Text
                style={[
                  styles.backBtnText,
                  { color: theme.muted, fontFamily: "Inter_500Medium" },
                ]}
              >
                Back
              </Text>
            </Pressable>
          )}

          {isLast ? (
            <Pressable
              style={[
                styles.primaryBtn,
                { backgroundColor: "#30D158", flex: 1 },
              ]}
              onPress={() => {
                reset();
                onApprove();
              }}
            >
              <CheckCircle size={18} color="#FFF" weight="bold" />
              <Text
                style={[styles.primaryBtnText, { fontFamily: "Inter_700Bold" }]}
              >
                Approve &amp; Connect
              </Text>
            </Pressable>
          ) : (
            <Pressable
              style={[
                styles.primaryBtn,
                { backgroundColor: theme.primary, flex: 1 },
              ]}
              onPress={() => setStep((s) => s + 1)}
            >
              <Text
                style={[
                  styles.primaryBtnText,
                  { fontFamily: "Inter_600SemiBold" },
                ]}
              >
                Next
              </Text>
              <ArrowRight size={16} color="#FFF" weight="bold" />
            </Pressable>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 20 },
  body: { padding: 24, gap: 16 },
  dots: {
    flexDirection: "row",
    gap: 6,
    justifyContent: "center",
    marginBottom: 8,
  },
  dot: { width: 20, height: 4, borderRadius: 2 },
  stepCard: {
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 24,
    alignItems: "center",
    gap: 10,
  },
  stepIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 24,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 4,
  },
  stepCounter: { fontSize: 12, letterSpacing: 0.4 },
  stepTitle: { fontSize: 22, textAlign: "center", letterSpacing: -0.3 },
  stepBody: { fontSize: 15, lineHeight: 23, textAlign: "center" },
  openBtn: {
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
  },
  openBtnText: { fontSize: 15 },
  footer: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 36,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  backBtn: {
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  backBtnText: { fontSize: 15 },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 14,
    paddingVertical: 16,
  },
  primaryBtnText: { color: "#FFF", fontSize: 16 },
});
