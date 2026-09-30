import { useRef, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, Image, ActivityIndicator, Alert } from "react-native";
import { BottomSheetModal, BottomSheetView, BottomSheetScrollView } from "@expo/ui/community/bottom-sheet";
import * as ImagePicker from "expo-image-picker";
import { Camera } from "phosphor-react-native";
import { useTheme } from "../hooks/useTheme";
import {
  Profile,
  deriveAvatarInitials,
  resolveProfileAvatarUri,
  uploadCustomAvatarForProfile,
} from "../services/storage";

/**
 * Bottom sheet listing every member of a group thread — tapping the group
 * avatar cluster on app/conversation/[profileId].tsx's nav header opens
 * this, so "who's actually in this conversation" is a real, inspectable
 * roster instead of just a handful of overlapping circles. Each row shows
 * the member's real name + email/platform identifier (the reason someone
 * taps in: "who is this and what's their email") and lets the user tap
 * that member's own avatar to set a custom photo for THEM specifically —
 * same upload flow as a solo conversation's header avatar
 * (uploadCustomAvatarForProfile), just scoped to one member's own profile
 * id instead of the page's own profileId. This is the one place a group
 * thread's members are individually editable — the cluster on the header
 * itself stays derive-only/no tap-to-edit, per the existing "no custom
 * group photo" decision.
 */
export function GroupMembersSheet({
  members,
  isPresented,
  onClose,
}: {
  members: Profile[];
  isPresented: boolean;
  onClose: () => void;
}) {
  const theme = useTheme();
  const sheetRef = useRef<any>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);

  useEffect(() => {
    if (isPresented) {
      sheetRef.current?.present();
    } else {
      sheetRef.current?.dismiss();
    }
  }, [isPresented]);

  const handleChangeMemberAvatar = async (member: Profile) => {
    if (uploadingId) return;
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Photo Access Needed", "Enable photo library access in Settings to set a custom photo.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: "images",
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.[0]) return;

    setUploadingId(member.id);
    try {
      const asset = result.assets[0];
      await uploadCustomAvatarForProfile(member.id, { uri: asset.uri, mimeType: asset.mimeType });
    } catch (e) {
      console.error("[GroupMembersSheet] Failed to upload custom avatar:", e);
      Alert.alert("Couldn't update photo", "Please try again.");
    } finally {
      setUploadingId(null);
    }
  };

  return (
    <BottomSheetModal ref={sheetRef} enablePanDownToClose onDismiss={onClose}>
      <BottomSheetView>
        <View style={styles.container}>
          <Text style={[styles.title, { color: theme.surface, fontFamily: "Inter_600SemiBold" }]}>
            {members.length} {members.length === 1 ? "Person" : "People"}
          </Text>
          <BottomSheetScrollView style={styles.scrollBody} showsVerticalScrollIndicator={false}>
            {members.map((member) => {
              const avatarUri = resolveProfileAvatarUri(member.customAvatarUri, member.avatarUri);
              const isUploading = uploadingId === member.id;
              return (
                <View key={member.id} style={styles.row}>
                  <Pressable
                    onPress={() => handleChangeMemberAvatar(member)}
                    disabled={!!uploadingId}
                    hitSlop={8}
                    style={styles.avatarWrap}
                  >
                    {avatarUri ? (
                      <Image
                        source={{ uri: avatarUri }}
                        style={[styles.avatar, { backgroundColor: theme.muted, opacity: isUploading ? 0.5 : 1 }]}
                      />
                    ) : (
                      <View style={[styles.avatar, { backgroundColor: theme.muted, experimental_backgroundImage: theme.avatarGradient, opacity: isUploading ? 0.5 : 1 }]}>
                        <Text style={[styles.avatarText, { fontFamily: "Inter_700Bold" }]}>
                          {deriveAvatarInitials(member.name, member.senderInitial)}
                        </Text>
                      </View>
                    )}
                    {isUploading ? (
                      <ActivityIndicator size="small" color="#FFF" style={styles.avatarSpinner} />
                    ) : (
                      <View style={[styles.avatarEditBadge, { backgroundColor: "#FFFFFF", borderColor: theme.background }]}>
                        <Camera size={10} color={theme.primary} weight="fill" />
                      </View>
                    )}
                  </Pressable>
                  <View style={styles.rowText}>
                    <Text style={[styles.name, { color: theme.surface, fontFamily: "Inter_500Medium" }]} numberOfLines={1}>
                      {member.name}
                    </Text>
                    <Text style={[styles.identifier, { color: theme.muted, fontFamily: "Inter_400Regular" }]} numberOfLines={1}>
                      {member.platformIdentifier}
                    </Text>
                  </View>
                </View>
              );
            })}
          </BottomSheetScrollView>
        </View>
      </BottomSheetView>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8 },
  title: { fontSize: 17, marginBottom: 12 },
  scrollBody: { maxHeight: 420 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
  },
  avatarWrap: { width: 48, height: 48 },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
  },
  avatarText: { color: "#FFF", fontSize: 18 },
  avatarSpinner: { position: "absolute", top: 0, left: 0, right: 0, height: 48 },
  avatarEditBadge: {
    position: "absolute",
    bottom: -2,
    right: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.25,
    shadowRadius: 2,
    elevation: 3,
  },
  rowText: { flex: 1 },
  name: { fontSize: 15, marginBottom: 2 },
  identifier: { fontSize: 13 },
});
