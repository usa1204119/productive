import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ApiResponse,
  DocumentDto,
  UploadProgressEvent,
} from "@plane-and-curves/shared";
import { api, ApiClientError } from "./api.js";

export const documentsKey = (workspaceId: string) =>
  ["documents", workspaceId] as const;

export function useDocuments(workspaceId: string, enabled = true) {
  return useQuery<DocumentDto[]>({
    queryKey: documentsKey(workspaceId),
    queryFn: () =>
      api<DocumentDto[]>(`/workspaces/${workspaceId}/documents`),
    enabled,
  });
}

export function useAttachDocument(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      documentId,
      taskId,
    }: {
      documentId: string;
      taskId: string | null;
    }) =>
      api<DocumentDto>(
        `/workspaces/${workspaceId}/documents/${documentId}`,
        {
          method: "PATCH",
          body: JSON.stringify({ taskId }),
        },
      ),
    onSuccess: (updated) => {
      queryClient.setQueryData<DocumentDto[]>(
        documentsKey(workspaceId),
        (current = []) =>
          current.map((document) =>
            document.id === updated.id ? updated : document,
          ),
      );
    },
  });
}

export function useDeleteDocument(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      documentId,
      deleteFromDrive,
    }: {
      documentId: string;
      deleteFromDrive: boolean;
    }) =>
      api<{ deleted: boolean }>(
        `/workspaces/${workspaceId}/documents/${documentId}?deleteFromDrive=${deleteFromDrive}`,
        { method: "DELETE" },
      ),
    onSuccess: (_result, variables) => {
      queryClient.setQueryData<DocumentDto[]>(
        documentsKey(workspaceId),
        (current = []) =>
          current.filter(
            (document) => document.id !== variables.documentId,
          ),
      );
    },
  });
}

export interface DocumentUploadCallbacks {
  signal?: AbortSignal;
  onTransferProgress?: (fraction: number) => void;
  onDriveProgress?: (event: UploadProgressEvent) => void;
}

/**
 * Upload one raw file with XHR (for browser→server progress) while listening to
 * an SSE channel for ordered server→Drive progress.
 */
export function uploadDocumentFile(
  workspaceId: string,
  file: File,
  callbacks: DocumentUploadCallbacks = {},
): Promise<DocumentDto> {
  return new Promise<DocumentDto>((resolve, reject) => {
    if (callbacks.signal?.aborted) {
      reject(new DOMException("Upload cancelled", "AbortError"));
      return;
    }

    const uploadId = crypto.randomUUID();
    const events = new EventSource(
      `/workspaces/${workspaceId}/documents/uploads/${uploadId}/events`,
      { withCredentials: true },
    );
    const xhr = new XMLHttpRequest();
    let settled = false;
    let lastSequence = 0;

    const cleanup = () => {
      events.close();
      callbacks.signal?.removeEventListener("abort", onAbort);
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const succeed = (document: DocumentDto) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(document);
    };
    const onAbort = () => {
      xhr.abort();
      fail(new DOMException("Upload cancelled", "AbortError"));
    };

    events.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as UploadProgressEvent;
        if (event.sequence <= lastSequence) return;
        lastSequence = event.sequence;
        callbacks.onDriveProgress?.(event);
        if (event.phase === "complete" || event.phase === "error") {
          events.close();
        }
      } catch {
        // A malformed progress event must not fail the upload itself.
      }
    };
    events.onerror = () => {
      // Progress is best-effort; the upload response remains authoritative.
    };

    xhr.open("POST", `/workspaces/${workspaceId}/documents`);
    xhr.withCredentials = true;
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.setRequestHeader("X-File-Name", encodeURIComponent(file.name));
    xhr.setRequestHeader(
      "X-File-Type",
      file.type || "application/octet-stream",
    );
    xhr.setRequestHeader("X-File-Size", String(file.size));
    xhr.setRequestHeader("X-Upload-Id", uploadId);

    xhr.upload.onprogress = (event) => {
      const total = event.lengthComputable ? event.total : file.size;
      callbacks.onTransferProgress?.(
        total > 0 ? Math.min(event.loaded / total, 1) : 0,
      );
    };
    xhr.onerror = () =>
      fail(new ApiClientError("NETWORK_ERROR", "Could not reach the server"));
    xhr.onabort = () =>
      fail(new DOMException("Upload cancelled", "AbortError"));
    xhr.onload = () => {
      let body: ApiResponse<DocumentDto> | null = null;
      try {
        body = JSON.parse(xhr.responseText) as ApiResponse<DocumentDto>;
      } catch {
        // Handled below as a malformed response.
      }
      if (!body) {
        fail(new ApiClientError("INTERNAL_ERROR", "Malformed server response"));
      } else if (!body.success) {
        fail(new ApiClientError(body.error.code, body.error.message));
      } else {
        succeed(body.data);
      }
    };

    callbacks.signal?.addEventListener("abort", onAbort, { once: true });
    xhr.send(file);
  });
}
