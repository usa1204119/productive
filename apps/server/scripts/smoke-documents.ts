/**
 * Drive/Documents lifecycle smoke test against in-process Postgres and a fake
 * Drive port. No Google credentials or network calls are required.
 *
 * Run: npm run smoke:documents --workspace apps/server
 */
import { Readable } from "node:stream";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { PrismaPGlite } from "pglite-prisma-adapter";
import { PrismaClient } from "@prisma/client";
import type { OAuth2Client } from "google-auth-library";
import type {
  DriveClient,
  FileMeta,
  UploadParams,
  UploadResult,
} from "../src/lib/driveClient.js";

process.env.NODE_ENV ||= "test";
process.env.SERVER_URL ||= "http://localhost:4000";
process.env.WEB_URL ||= "http://localhost:5173";
process.env.DATABASE_URL ||= "postgresql://smoke:smoke@localhost:5432/smoke";
process.env.GOOGLE_CLIENT_ID ||= "smoke-client-id";
process.env.GOOGLE_CLIENT_SECRET ||= "smoke-secret";
process.env.GOOGLE_OAUTH_REDIRECT_URI ||=
  "http://localhost:4000/auth/google/callback";
process.env.GOOGLE_DRIVE_REDIRECT_URI ||=
  "http://localhost:4000/auth/google/drive/callback";
process.env.ENCRYPTION_KEY ||= "1".repeat(64);

const here = dirname(fileURLToPath(import.meta.url));
let passed = 0;
let failed = 0;

function check(name: string, condition: boolean): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${name}`);
  }
}

async function expectCode(
  name: string,
  code: string,
  operation: () => Promise<unknown>,
): Promise<void> {
  try {
    await operation();
    check(`${name} (threw ${code})`, false);
  } catch (error) {
    const actual = (error as { code?: string }).code;
    check(`${name} (threw ${code})`, actual === code);
    if (actual !== code) console.error(`      got: ${actual ?? String(error)}`);
  }
}

type FakeFolder = {
  parentId: string | null;
  properties: Record<string, string>;
  exists: boolean;
};

class FakeDrive implements DriveClient {
  readonly folders = new Map<string, FakeFolder>();
  readonly files = new Map<string, FileMeta | null>();
  readonly progress: number[] = [];
  folderCreates = 0;
  uploadCalls = 0;
  deleteCalls = 0;
  failNextUpload = false;

  async createFolder(
    _name: string,
    parentId: string | null,
    appProperties: Record<string, string>,
  ): Promise<string> {
    this.folderCreates += 1;
    const id = `folder-${this.folderCreates}`;
    this.folders.set(id, { parentId, properties: appProperties, exists: true });
    return id;
  }

  async findFolder(
    appProperty: { key: string; value: string },
    parentId: string | null,
  ): Promise<string | null> {
    for (const [id, folder] of this.folders) {
      if (
        folder.exists &&
        folder.parentId === parentId &&
        folder.properties[appProperty.key] === appProperty.value
      ) {
        return id;
      }
    }
    return null;
  }

  async folderExists(folderId: string): Promise<boolean> {
    return this.folders.get(folderId)?.exists === true;
  }

  async uploadFile(params: UploadParams): Promise<UploadResult> {
    this.uploadCalls += 1;
    let bytes = 0;
    for await (const raw of params.body) {
      const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as Uint8Array);
      bytes += chunk.length;
      params.onProgress?.(bytes);
      this.progress.push(bytes);
      if (this.failNextUpload) {
        this.failNextUpload = false;
        throw new Error("simulated cancellation");
      }
    }
    const fileId = `file-${this.uploadCalls}`;
    const metadata = {
      webViewLink: `https://drive.example/${fileId}`,
      iconLink: null,
    };
    this.files.set(fileId, metadata);
    return { fileId, ...metadata };
  }

  async getFileMeta(fileId: string): Promise<FileMeta | null> {
    return this.files.get(fileId) ?? null;
  }

  async deleteFile(fileId: string): Promise<void> {
    this.deleteCalls += 1;
    this.files.delete(fileId);
  }
}

async function main(): Promise<void> {
  const database = new PGlite();
  const ddl = readFileSync(
    join(here, "..", "prisma", "smoke-schema.sql"),
    "utf8",
  );
  await database.exec(ddl);
  const prisma = new PrismaClient({ adapter: new PrismaPGlite(database) });

  const {
    DRIVE_FILE_SCOPE,
    SIGN_IN_SCOPES,
    buildDriveConsentUrl,
  } = await import("../src/lib/google.js");
  const {
    connectDrive,
    withDriveErrors,
  } = await import("../src/lib/driveCredentials.js");
  const { makeGoogleDriveClient } = await import("../src/lib/driveClient.js");
  const { decrypt } = await import("../src/lib/crypto.js");
  const {
    attachDocument,
    deleteDocument,
    ensureRootFolder,
    ensureWorkspaceFolder,
    listDocuments,
    uploadDocument,
  } = await import("../src/lib/documents.js");
  const {
    clearUploadProgressForTests,
    publishUploadProgress,
    subscribeUploadProgress,
  } = await import("../src/lib/uploadProgress.js");

  console.log("\nOAuth scope discipline:");
  check(
    "Drive scope is exactly drive.file",
    DRIVE_FILE_SCOPE === "https://www.googleapis.com/auth/drive.file",
  );
  check(
    "identity sign-in contains no Drive scope",
    SIGN_IN_SCOPES.every((scope) => !scope.includes("drive")),
  );
  const consent = new URL(buildDriveConsentUrl("state-123"));
  check(
    "consent URL requests only drive.file",
    consent.searchParams.get("scope") === DRIVE_FILE_SCOPE,
  );
  check(
    "Drive consent requests offline access",
    consent.searchParams.get("access_type") === "offline",
  );

  const user = await prisma.user.create({
    data: {
      googleId: "google-doc-user",
      email: "documents@example.com",
      name: "Documents User",
      isGuest: false,
    },
  });
  const workspace = await prisma.workspace.create({
    data: { userId: user.id, name: "Launch" },
  });

  console.log("\nEncrypted, idempotent credential storage:");
  await connectDrive(prisma, user.id, {
    refreshToken: "first-refresh-token",
    scope: DRIVE_FILE_SCOPE,
  });
  const firstCredential = await prisma.googleCredential.findUniqueOrThrow({
    where: { userId: user.id },
  });
  check(
    "refresh token is not stored as plaintext",
    firstCredential.encryptedRefreshToken !== "first-refresh-token" &&
      !firstCredential.encryptedRefreshToken.includes("first-refresh-token"),
  );
  check(
    "encrypted token decrypts with ENCRYPTION_KEY",
    decrypt(firstCredential.encryptedRefreshToken) === "first-refresh-token",
  );
  check(
    "stored scopes contain only drive.file",
    firstCredential.scopes.length === 1 &&
      firstCredential.scopes[0] === DRIVE_FILE_SCOPE,
  );

  await connectDrive(prisma, user.id, {
    refreshToken: "rotated-refresh-token",
    scope: DRIVE_FILE_SCOPE,
  });
  check(
    "reconnect does not create duplicate credential rows",
    (await prisma.googleCredential.count({ where: { userId: user.id } })) === 1,
  );
  const rotated = await prisma.googleCredential.findUniqueOrThrow({
    where: { userId: user.id },
  });
  check(
    "reconnect updates the encrypted refresh token",
    decrypt(rotated.encryptedRefreshToken) === "rotated-refresh-token",
  );

  console.log("\nRevoked refresh-token handling:");
  const drive = new FakeDrive();
  await expectCode("invalid_grant becomes reconnect state", "DRIVE_DISCONNECTED", () =>
    withDriveErrors(prisma, user.id, drive, async () => {
      throw { response: { data: { error: "invalid_grant" } } };
    }),
  );
  const disconnectedUser = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
  });
  const revokedCredential = await prisma.googleCredential.findUniqueOrThrow({
    where: { userId: user.id },
  });
  check("user is marked disconnected", disconnectedUser.driveConnected === false);
  check("credential is marked revoked", revokedCredential.revokedAt !== null);
  await connectDrive(prisma, user.id, {
    refreshToken: "reconnected-token",
    scope: DRIVE_FILE_SCOPE,
  });

  console.log("\nLazy, idempotent Drive folders:");
  check(
    "root folder is absent before first Drive operation",
    (await prisma.user.findUniqueOrThrow({ where: { id: user.id } }))
      .driveRootFolderId === null,
  );
  const [rootA, rootB] = await Promise.all([
    ensureRootFolder(prisma, drive, user.id),
    ensureRootFolder(prisma, drive, user.id),
  ]);
  check("concurrent root initialization returns one folder", rootA === rootB);
  check("concurrent root initialization creates once", drive.folderCreates === 1);

  await prisma.user.update({
    where: { id: user.id },
    data: { driveRootFolderId: null },
  });
  const rediscoveredRoot = await ensureRootFolder(prisma, drive, user.id);
  check("appProperties rediscover an existing root", rediscoveredRoot === rootA);
  check("rediscovery does not create a duplicate root", drive.folderCreates === 1);

  const workspaceFolderA = await ensureWorkspaceFolder(
    prisma,
    drive,
    workspace.id,
    rootA,
  );
  drive.folders.get(workspaceFolderA)!.exists = false;
  const workspaceFolderB = await ensureWorkspaceFolder(
    prisma,
    drive,
    workspace.id,
    rootA,
  );
  check(
    "deleted workspace folder is recreated",
    workspaceFolderB !== workspaceFolderA,
  );
  check(
    "new workspace folder id is persisted",
    (
      await prisma.workspace.findUniqueOrThrow({
        where: { id: workspace.id },
      })
    ).driveFolderId === workspaceFolderB,
  );

  console.log("\nUpload integrity, cancellation, and progress:");
  const progress: number[] = [];
  const uploaded = await uploadDocument(prisma, drive, {
    userId: user.id,
    workspaceId: workspace.id,
    name: "plan.txt",
    mimeType: "text/plain",
    sizeBytes: 6,
    body: Readable.from([Buffer.from("ab"), Buffer.from("cd"), Buffer.from("ef")]),
    onProgress: (bytes) => progress.push(bytes),
  });
  check(
    "Drive progress reaches the caller in order",
    progress.length > 0 &&
      progress.every((value, index) => index === 0 || value >= progress[index - 1]!),
  );
  check(
    "stored size is the measured/declaration-verified size",
    uploaded.sizeBytes === 6,
  );

  const beforeCancelled = await prisma.document.count();
  drive.failNextUpload = true;
  try {
    await uploadDocument(prisma, drive, {
      userId: user.id,
      workspaceId: workspace.id,
      name: "cancelled.bin",
      mimeType: "application/octet-stream",
      sizeBytes: 4,
      body: Readable.from([Buffer.from("data")]),
    });
  } catch {
    // Expected simulated cancellation.
  }
  check(
    "cancelled upload leaves no partial database row",
    (await prisma.document.count()) === beforeCancelled,
  );

  const callsBeforeOversize = drive.uploadCalls;
  await expectCode("oversize is rejected before Drive", "FILE_TOO_LARGE", () =>
    uploadDocument(
      prisma,
      drive,
      {
        userId: user.id,
        workspaceId: workspace.id,
        name: "too-large.bin",
        mimeType: "application/octet-stream",
        sizeBytes: 11,
        body: Readable.from([Buffer.alloc(11)]),
      },
      10,
    ),
  );
  check("oversize never initiates a Drive upload", drive.uploadCalls === callsBeforeOversize);

  console.log("\nMissing files, attachment scoping, and record-only deletion:");
  const stored = await prisma.document.findUniqueOrThrow({
    where: { id: uploaded.id },
  });
  drive.files.set(stored.driveFileId, null);
  const listed = await listDocuments(prisma, drive, workspace.id);
  check("missing Drive file is surfaced, not thrown", listed[0]?.missing === true);
  check(
    "missing document record remains in the database",
    (await prisma.document.findUnique({ where: { id: uploaded.id } })) !== null,
  );

  const task = await prisma.task.create({
    data: { workspaceId: workspace.id, title: "Ship", order: 1000 },
  });
  const attached = await attachDocument(
    prisma,
    workspace.id,
    uploaded.id,
    task.id,
  );
  check("document attaches to a task", attached.taskId === task.id);

  const otherWorkspace = await prisma.workspace.create({
    data: { userId: user.id, name: "Other" },
  });
  await expectCode("cross-workspace attach is hidden", "DOCUMENT_NOT_FOUND", () =>
    attachDocument(prisma, otherWorkspace.id, uploaded.id, null),
  );

  const deletesBeforeRecordOnly = drive.deleteCalls;
  await deleteDocument(prisma, null, workspace.id, uploaded.id, false);
  check(
    "record-only delete removes the database row",
    (await prisma.document.findUnique({ where: { id: uploaded.id } })) === null,
  );
  check(
    "record-only delete never calls Drive",
    drive.deleteCalls === deletesBeforeRecordOnly,
  );

  console.log("\nOrdered progress channel:");
  clearUploadProgressForTests();
  const observed: Array<{ sequence: number; bytes: number }> = [];
  const unsubscribe = subscribeUploadProgress("test-upload", (event) =>
    observed.push({ sequence: event.sequence, bytes: event.bytesSent }),
  );
  publishUploadProgress("test-upload", {
    phase: "waiting",
    bytesSent: 0,
    totalBytes: 10,
    errorCode: null,
  });
  publishUploadProgress("test-upload", {
    phase: "uploading",
    bytesSent: 8,
    totalBytes: 10,
    errorCode: null,
  });
  publishUploadProgress("test-upload", {
    phase: "complete",
    bytesSent: 6,
    totalBytes: 10,
    errorCode: null,
  });
  unsubscribe();
  check(
    "subscriber receives strictly increasing sequence numbers",
    observed.map((event) => event.sequence).join(",") === "1,2,3",
  );
  check(
    "published byte counts never move backwards",
    observed.map((event) => event.bytes).join(",") === "0,8,8",
  );
  clearUploadProgressForTests();

  console.log("\nLarge-file resumable protocol:");
  const requests: Array<{
    method?: string;
    params?: Record<string, string>;
    headers?: Record<string, string>;
  }> = [];
  const firstChunkLastByte = 8 * 1024 * 1024 - 1;
  const fakeAuth = {
    async request(options: {
      method?: string;
      params?: Record<string, string>;
      headers?: Record<string, string>;
    }) {
      requests.push(options);
      if (options.method === "POST") {
        return {
          status: 200,
          headers: { location: "https://upload.example/session" },
          data: {},
        };
      }
      if (
        options.headers?.["Content-Range"] ===
        `bytes 0-${firstChunkLastByte}/${9 * 1024 * 1024}`
      ) {
        return {
          status: 308,
          headers: { range: `bytes=0-${firstChunkLastByte}` },
          data: {},
        };
      }
      return {
        status: 200,
        headers: {},
        data: {
          id: "resumable-file",
          webViewLink: "https://drive.example/resumable-file",
          iconLink: null,
        },
      };
    },
  } as unknown as OAuth2Client;
  const resumableDrive = makeGoogleDriveClient(fakeAuth);
  const resumableProgress: number[] = [];
  const largeBytes = 9 * 1024 * 1024;
  const resumableResult = await resumableDrive.uploadFile({
    name: "large.bin",
    mimeType: "application/octet-stream",
    sizeBytes: largeBytes,
    folderId: "folder",
    body: Readable.from([Buffer.alloc(largeBytes)]),
    onProgress: (bytes) => resumableProgress.push(bytes),
  });
  check(
    "large upload initiates uploadType=resumable",
    requests[0]?.params?.uploadType === "resumable",
  );
  const dataRequests = requests.filter(
    (request) => request.method === "PUT",
  );
  check("large upload is sent in multiple chunks", dataRequests.length === 2);
  check(
    "non-final chunk is a 256 KiB multiple",
    Number(dataRequests[0]?.headers?.["Content-Length"]) % (256 * 1024) === 0,
  );
  check(
    "resumable progress is monotonic and completes",
    resumableProgress.join(",") === `${8 * 1024 * 1024},${largeBytes}`,
  );
  check(
    "resumable response returns Drive webViewLink",
    resumableResult.webViewLink === "https://drive.example/resumable-file",
  );

  await prisma.$disconnect();
  await database.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("Documents smoke test crashed:", error);
  process.exit(1);
});
