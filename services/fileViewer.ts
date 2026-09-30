import { File, Directory, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { viewDocument } from "@react-native-documents/viewer";

const EXTENSION_MIME_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  doc: "application/msword",
  ppt: "application/vnd.ms-powerpoint",
  xls: "application/vnd.ms-excel",
  csv: "text/csv",
  txt: "text/plain",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
};

function guessMimeType(name: string): string | undefined {
  const ext = name.split(".").pop()?.toLowerCase();
  return ext ? EXTENSION_MIME_TYPES[ext] : undefined;
}

/**
 * Downloads a deliverable/attachment once into a stable, name-keyed cache
 * directory, then hands the local file:// URI to @react-native-documents/
 * viewer's native in-app preview (iOS: QuickLook, presented as a page
 * sheet; Android: the OS document-viewer intent) — this reads as an in-app
 * bottom sheet rather than punting to Safari/a separate app the way
 * Linking.openURL on a remote URL did. Repeat opens of the same file are
 * instant (skip re-downloading) since the cache path is keyed by filename,
 * not by timestamp.
 *
 * Falls back to the iOS share sheet (which also renders a live document
 * preview panel, just with share options attached) if the native preview
 * fails to present — some file types/OS versions don't have a registered
 * viewer for the given extension, and the share sheet is a strictly more
 * capable fallback than nothing.
 */
export async function viewFile(url: string, name: string): Promise<void> {
  if (!url) return;

  const dir = new Directory(Paths.cache, "viewed-files");
  if (!dir.exists) dir.create({ intermediates: true });
  const destination = new File(dir, name);

  try {
    if (!destination.exists) {
      const downloaded = await File.downloadFileAsync(url, dir);
      if (downloaded.uri !== destination.uri) {
        if (destination.exists) destination.delete();
        await downloaded.move(destination);
      }
    }
    await viewDocument({
      uri: destination.uri,
      mimeType: guessMimeType(name),
      headerTitle: name,
      presentationStyle: "pageSheet",
    });
  } catch (err) {
    console.warn("[FileViewer] In-app preview failed, falling back to share sheet:", err);
    try {
      const isAvailable = await Sharing.isAvailableAsync();
      if (isAvailable && destination.exists) {
        await Sharing.shareAsync(destination.uri, { dialogTitle: name, mimeType: guessMimeType(name) });
        return;
      }
    } catch (shareErr) {
      console.error("[FileViewer] Share-sheet fallback also failed:", shareErr);
    }
    throw err;
  }
}
