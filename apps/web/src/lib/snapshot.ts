import { exportToBlob } from "@excalidraw/excalidraw";

/** The slice of the Excalidraw API needed to snapshot the current selection. */
interface SnapshotApi {
  getAppState: () => { selectedElementIds?: Record<string, boolean> };
  getSceneElements: () => readonly { id: string }[];
  getFiles: () => Record<string, unknown>;
}

const MAX_DIM = 1568; // common vision-model input cap
const MAX_BYTES = 3_600_000; // keep the data URL under the server/image limits

/**
 * Export just the selected elements to a PNG data URL, downscaled/compressed so
 * it stays within the vision model's limits. Returns null if nothing is selected.
 */
export async function captureSelectionSnapshot(api: SnapshotApi): Promise<string | null> {
  const selected = api.getAppState().selectedElementIds ?? {};
  const elements = api.getSceneElements().filter((e) => selected[e.id]);
  if (elements.length === 0) return null;

  const blob = await exportToBlob({
    elements: elements as never,
    files: api.getFiles() as never,
    mimeType: "image/png",
    appState: { exportBackground: true, viewBackgroundColor: "#ffffff", exportPadding: 16 } as never,
  });
  return downscaleBlobToDataUrl(blob, MAX_DIM, MAX_BYTES);
}

async function downscaleBlobToDataUrl(blob: Blob, maxDim: number, maxBytes: number): Promise<string> {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close?.();
    return blobToDataUrl(blob);
  }
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();

  // PNG stays crisp for code/diagrams; fall back to JPEG only if it's too big.
  let dataUrl = canvas.toDataURL("image/png");
  if (dataUrl.length > maxBytes) dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  return dataUrl;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Could not read snapshot"));
    reader.readAsDataURL(blob);
  });
}
