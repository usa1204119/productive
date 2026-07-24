import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  ExternalLink,
  FileText,
  Link2,
  Loader2,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import {
  MAX_UPLOAD_BYTES,
  type DocumentDto,
  type UserDto,
  type WorkspaceDto,
} from "@plane-and-curves/shared";
import { ApiClientError } from "../lib/api.js";
import { AUTH_ME_KEY, googleDriveConnect, googleLink } from "../lib/auth.js";
import {
  documentsKey,
  uploadDocumentFile,
  useAttachDocument,
  useDeleteDocument,
  useDocuments,
} from "../lib/documents.js";
import { useTasks } from "../lib/tasks.js";
import { ConfirmDialog } from "./ConfirmDialog.js";

type UploadState = {
  id: string;
  name: string;
  progress: number;
  phase: "uploading" | "done" | "error" | "cancelled";
  message: string;
};

export function DocumentsTab({
  workspace,
  user,
}: {
  workspace: WorkspaceDto;
  user: UserDto;
}) {
  const queryClient = useQueryClient();
  const canUseDrive = !user.isGuest && user.driveConnected;
  const documents = useDocuments(workspace.id, canUseDrive);
  const { data: tasks = [] } = useTasks(workspace.id);
  const attach = useAttachDocument(workspace.id);
  const remove = useDeleteDocument(workspace.id);
  const [uploads, setUploads] = useState<UploadState[]>([]);
  const [dragging, setDragging] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<DocumentDto | null>(null);
  const [deleteFromDrive, setDeleteFromDrive] = useState(false);
  const controllers = useRef(new Map<string, AbortController>());
  const oauthBanner = useDriveRedirectBanner();

  useEffect(() => {
    const error = documents.error;
    if (
      error instanceof ApiClientError &&
      (error.code === "DRIVE_DISCONNECTED" ||
        error.code === "DRIVE_NOT_CONNECTED")
    ) {
      queryClient.setQueryData<UserDto>(AUTH_ME_KEY, (current) =>
        current ? { ...current, driveConnected: false } : current,
      );
    }
  }, [documents.error, queryClient]);

  useEffect(
    () => () => {
      for (const controller of controllers.current.values()) controller.abort();
    },
    [],
  );

  const attachableTasks = useMemo(
    () => [...tasks].sort((a, b) => Number(a.completed) - Number(b.completed)),
    [tasks],
  );

  const updateUpload = (id: string, patch: Partial<UploadState>) => {
    setUploads((current) =>
      current.map((upload) =>
        upload.id === id ? { ...upload, ...patch } : upload,
      ),
    );
  };

  const markDisconnected = () => {
    queryClient.setQueryData<UserDto>(AUTH_ME_KEY, (current) =>
      current ? { ...current, driveConnected: false } : current,
    );
  };

  const uploadFiles = async (files: File[]) => {
    for (const file of files) {
      const id = crypto.randomUUID();
      if (file.size > MAX_UPLOAD_BYTES) {
        setUploads((current) => [
          ...current,
          {
            id,
            name: file.name,
            progress: 0,
            phase: "error",
            message: "File exceeds the 100 MB limit.",
          },
        ]);
        continue;
      }

      const controller = new AbortController();
      controllers.current.set(id, controller);
      setUploads((current) => [
        ...current,
        {
          id,
          name: file.name,
          progress: 0,
          phase: "uploading",
          message: "Uploading…",
        },
      ]);

      try {
        await uploadDocumentFile(workspace.id, file, {
          signal: controller.signal,
          onTransferProgress: (fraction) => {
            updateUpload(id, {
              progress: Math.min(Math.round(fraction * 100), 99),
              message: "Sending securely…",
            });
          },
          onDriveProgress: (event) => {
            const fraction =
              event.totalBytes === 0
                ? event.phase === "complete"
                  ? 1
                  : 0
                : event.bytesSent / event.totalBytes;
            updateUpload(id, {
              progress:
                event.phase === "complete"
                  ? 100
                  : Math.min(Math.round(fraction * 100), 99),
              message:
                event.phase === "waiting"
                  ? "Preparing Drive…"
                  : event.phase === "uploading"
                    ? "Saving to Drive…"
                    : event.phase === "complete"
                      ? "Uploaded"
                      : "Upload failed",
            });
          },
        });
        updateUpload(id, {
          progress: 100,
          phase: "done",
          message: "Uploaded",
        });
        await queryClient.invalidateQueries({
          queryKey: documentsKey(workspace.id),
        });
      } catch (error) {
        if ((error as { name?: string })?.name === "AbortError") {
          updateUpload(id, {
            phase: "cancelled",
            message: "Cancelled",
          });
        } else {
          if (
            error instanceof ApiClientError &&
            (error.code === "DRIVE_DISCONNECTED" ||
              error.code === "DRIVE_NOT_CONNECTED")
          ) {
            markDisconnected();
          }
          updateUpload(id, {
            phase: "error",
            message:
              error instanceof Error ? error.message : "Upload failed",
          });
        }
      } finally {
        controllers.current.delete(id);
      }
    }
  };

  if (user.isGuest) {
    return (
      <DriveGate
        title="Sign in to use Documents"
        description="Your whiteboards and tasks will stay exactly where they are. Sign in with Google to add Drive-backed files to this workspace."
        action="Sign in with Google"
        onAction={googleLink}
      />
    );
  }

  if (!user.driveConnected) {
    return (
      <DriveGate
        title="Connect Google Drive"
        description="Plane and Curves requests only drive.file access, so it can access files you upload here—not the rest of your Drive."
        action="Connect Google Drive"
        onAction={googleDriveConnect}
        error={oauthBanner?.kind === "error" ? oauthBanner.message : undefined}
      />
    );
  }

  return (
    <div className="h-full overflow-y-auto px-8 py-6">
      <div className="mx-auto max-w-4xl space-y-5">
        {oauthBanner && (
          <div
            className={`rounded-xl px-4 py-3 text-sm ${
              oauthBanner.kind === "ok"
                ? "bg-emerald-50 text-emerald-700"
                : "bg-rose-50 text-rose-700"
            }`}
          >
            {oauthBanner.message}
          </div>
        )}

        <label
          className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed bg-white px-6 py-10 text-center transition ${
            dragging
              ? "border-accent bg-accent/5"
              : "border-slate-300 hover:border-accent/60 hover:bg-slate-50"
          }`}
          onDragEnter={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => {
            event.preventDefault();
            if (event.currentTarget === event.target) setDragging(false);
          }}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            void uploadFiles(Array.from(event.dataTransfer.files));
          }}
        >
          <UploadCloud className="h-7 w-7 text-accent" />
          <span className="mt-3 text-sm font-medium text-slate-700">
            Drop files here, or choose files
          </span>
          <span className="mt-1 text-xs text-slate-400">
            Any file type · 100 MB maximum per file
          </span>
          <input
            type="file"
            multiple
            className="sr-only"
            onChange={(event) => {
              void uploadFiles(Array.from(event.target.files ?? []));
              event.target.value = "";
            }}
          />
        </label>

        {uploads.length > 0 && (
          <section
            aria-label="Uploads"
            aria-live="polite"
            className="space-y-2 rounded-2xl bg-white p-4 shadow-sm"
          >
            {uploads.map((upload) => (
              <div key={upload.id} className="flex items-center gap-3">
                {upload.phase === "uploading" ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent" />
                ) : upload.phase === "done" ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                ) : (
                  <AlertTriangle className="h-4 w-4 shrink-0 text-rose-500" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <span className="truncate font-medium text-slate-700">
                      {upload.name}
                    </span>
                    <span
                      className={
                        upload.phase === "error"
                          ? "text-rose-600"
                          : "text-slate-400"
                      }
                    >
                      {upload.message}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={`h-full rounded-full transition-all ${
                        upload.phase === "error"
                          ? "bg-rose-500"
                          : upload.phase === "done"
                            ? "bg-emerald-500"
                            : "bg-accent"
                      }`}
                      style={{ width: `${upload.progress}%` }}
                    />
                  </div>
                </div>
                {upload.phase === "uploading" && (
                  <button
                    type="button"
                    onClick={() => controllers.current.get(upload.id)?.abort()}
                    className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                    aria-label={`Cancel upload of ${upload.name}`}
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
          </section>
        )}

        <section className="overflow-hidden rounded-2xl bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-800">
                Workspace files
              </h2>
              <p className="mt-0.5 text-xs text-slate-400">
                Stored in your Google Drive
              </p>
            </div>
            <Cloud className="h-5 w-5 text-slate-300" />
          </div>

          {documents.isLoading ? (
            <p className="px-5 py-10 text-center text-sm text-slate-400">
              Checking Drive files…
            </p>
          ) : documents.isError ? (
            <div className="px-5 py-10 text-center">
              <p className="text-sm text-rose-600">
                {documents.error instanceof Error
                  ? documents.error.message
                  : "Could not load documents."}
              </p>
              <button
                type="button"
                onClick={() => documents.refetch()}
                className="mt-3 text-sm font-medium text-accent hover:text-accent-hover"
              >
                Try again
              </button>
            </div>
          ) : documents.data?.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-slate-400">
              No documents yet. Upload the first file for this workspace.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {documents.data?.map((document) => (
                <li
                  key={document.id}
                  className="flex flex-wrap items-center gap-3 px-5 py-4 sm:flex-nowrap"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-50">
                    {document.iconLink && !document.missing ? (
                      <img
                        src={document.iconLink}
                        alt=""
                        className="h-5 w-5"
                      />
                    ) : (
                      <FileText className="h-5 w-5 text-slate-400" />
                    )}
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-slate-700">
                        {document.name}
                      </span>
                      {document.missing && (
                        <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                          Missing from Drive
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-slate-400">
                      {formatBytes(document.sizeBytes)} ·{" "}
                      {new Date(document.createdAt).toLocaleDateString()}
                    </p>
                  </div>

                  <label className="flex items-center gap-1.5 text-xs text-slate-400">
                    <Link2 className="h-3.5 w-3.5" />
                    <span className="sr-only">Attach {document.name} to task</span>
                    <select
                      value={document.taskId ?? ""}
                      disabled={attach.isPending}
                      onChange={(event) =>
                        attach.mutate({
                          documentId: document.id,
                          taskId: event.target.value || null,
                        })
                      }
                      className="max-w-40 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-600 outline-none focus:border-accent"
                      aria-label={`Attach ${document.name} to a task`}
                    >
                      <option value="">No task</option>
                      {attachableTasks.map((task) => (
                        <option key={task.id} value={task.id}>
                          {task.title}{task.completed ? " (Done)" : ""}
                        </option>
                      ))}
                    </select>
                  </label>

                  {!document.missing && (
                    <a
                      href={document.webViewLink}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-accent"
                      aria-label={`Open ${document.name} in Google Drive`}
                      title="Open in Google Drive"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setDeleteFromDrive(false);
                      setRemoveTarget(document);
                    }}
                    className="rounded p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                    aria-label={`Remove ${document.name}`}
                    title="Remove"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {removeTarget && (
        <ConfirmDialog
          title={`Remove “${removeTarget.name}”?`}
          body={
            <div className="space-y-3">
              <p>
                This removes the document from Plane and Curves. The Google Drive
                file is kept by default.
              </p>
              {!removeTarget.missing && (
                <label className="flex items-start gap-2 rounded-lg bg-slate-50 p-3">
                  <input
                    type="checkbox"
                    checked={deleteFromDrive}
                    onChange={(event) =>
                      setDeleteFromDrive(event.target.checked)
                    }
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-accent focus:ring-accent"
                  />
                  <span>
                    Also delete the file from Google Drive
                    <span className="mt-0.5 block text-xs text-slate-400">
                      This cannot be undone from Plane and Curves.
                    </span>
                  </span>
                </label>
              )}
            </div>
          }
          confirmLabel="Remove"
          destructive
          busy={remove.isPending}
          onCancel={() => setRemoveTarget(null)}
          onConfirm={() =>
            remove.mutate(
              {
                documentId: removeTarget.id,
                deleteFromDrive:
                  !removeTarget.missing && deleteFromDrive,
              },
              {
                onSuccess: () => {
                  setRemoveTarget(null);
                  setDeleteFromDrive(false);
                },
                onError: (error) => {
                  if (
                    error instanceof ApiClientError &&
                    error.code === "DRIVE_DISCONNECTED"
                  ) {
                    markDisconnected();
                  }
                },
              },
            )
          }
        />
      )}
    </div>
  );
}

function DriveGate({
  title,
  description,
  action,
  onAction,
  error,
}: {
  title: string;
  description: string;
  action: string;
  onAction: () => void;
  error?: string;
}) {
  return (
    <div className="flex h-full items-center justify-center overflow-y-auto p-8">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-sm">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/10">
          <Cloud className="h-6 w-6 text-accent" />
        </span>
        <h2 className="mt-4 text-lg font-semibold text-slate-800">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-slate-500">{description}</p>
        {error && (
          <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </p>
        )}
        <button
          type="button"
          onClick={onAction}
          className="mt-6 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white transition hover:bg-accent-hover"
        >
          {action}
        </button>
        <p className="mt-4 text-xs leading-5 text-slate-400">
          Plane and Curves never stores file bytes and never requests access to
          your whole Drive.
        </p>
      </div>
    </div>
  );
}

function useDriveRedirectBanner() {
  const [banner, setBanner] = useState<{
    kind: "ok" | "error";
    message: string;
  } | null>(null);

  useEffect(() => {
    const url = new URL(window.location.href);
    const drive = url.searchParams.get("drive");
    if (!drive) return;

    if (drive === "connected") {
      setBanner({
        kind: "ok",
        message: "Google Drive connected. Your first upload will create the workspace folder.",
      });
    } else {
      setBanner({
        kind: "error",
        message:
          url.searchParams.get("code") === "OAUTH_DENIED"
            ? "Drive access was not granted. The rest of the app is unchanged."
            : "Google Drive could not be connected. Please try again.",
      });
    }
    url.searchParams.delete("drive");
    url.searchParams.delete("code");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);

  return banner;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
