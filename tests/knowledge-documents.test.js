import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildDocumentKnowledgeContext,
  createKnowledgeDocument,
  findDuplicateDocument,
  normalizeKnowledgeDocument,
  resolveDocumentStoragePath,
  sanitizeDocumentFileName,
  searchKnowledgeDocuments
} from "../services/knowledge-documents.js";

const now = "2026-11-03T10:00:00.000Z";

test("document filenames cannot escape the managed storage directory", () => {
  assert.equal(sanitizeDocumentFileName("../../unsafe/name.txt"), "unsafe_name.txt");
  assert.equal(sanitizeDocumentFileName("  ..\\evil\\file.md  "), "evil_file.md");
});

test("text document upload validates MIME, extension, UTF-8 and creates an unreviewed record", () => {
  const bytes = Buffer.from("# Motion\nVelocity is displacement divided by time.", "utf8");
  const item = createKnowledgeDocument({
    fileName: "motion.md",
    mimeType: "text/markdown",
    title: "Motion notes",
    collection: "JEE Physics",
    tags: "motion, kinematics, motion"
  }, bytes, now);

  assert.equal(item.title, "Motion notes");
  assert.equal(item.collection, "JEE Physics");
  assert.deepEqual(item.tags, ["motion", "kinematics"]);
  assert.equal(item.reviewStatus, "unreviewed");
  assert.equal(item.indexingMode, "text");
  assert.match(item.extractedText, /Velocity is displacement/);
  assert.equal(item.byteSize, bytes.length);
  assert.match(item.sha256, /^[a-f0-9]{64}$/);
});

test("binary document types are stored as metadata-only and do not pretend to extract content", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const item = createKnowledgeDocument({ fileName: "chart.png", mimeType: "image/png" }, png, now);
  assert.equal(item.indexingMode, "metadata-only");
  assert.equal(item.extractedText, "");
});

test("file extension, MIME and file signature must agree", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.throws(() => createKnowledgeDocument({ fileName: "chart.jpg", mimeType: "image/png" }, png));
  assert.throws(() => createKnowledgeDocument({ fileName: "note.txt", mimeType: "text/plain" }, Buffer.from("%PDF-1.4")));
  assert.throws(() => createKnowledgeDocument({ fileName: "script.html", mimeType: "text/html" }, Buffer.from("<script>")));
});

test("text ingestion rejects invalid UTF-8, invalid JSON and secret-bearing files", () => {
  assert.throws(() => createKnowledgeDocument({ fileName: "bad.txt", mimeType: "text/plain" }, Buffer.from([0xff, 0xfe])));
  assert.throws(() => createKnowledgeDocument({ fileName: "bad.json", mimeType: "application/json" }, Buffer.from("{nope}")));
  assert.throws(() => createKnowledgeDocument({ fileName: "secrets.txt", mimeType: "text/plain" }, Buffer.from("API_KEY=abc123")));
});

test("same file bytes are deduplicated by SHA-256", () => {
  const bytes = Buffer.from("One mole contains 6.022e23 entities.", "utf8");
  const first = createKnowledgeDocument({ fileName: "mole.txt", mimeType: "text/plain" }, bytes, now);
  const same = createKnowledgeDocument({ fileName: "mole-copy.txt", mimeType: "text/plain" }, bytes, now);
  assert.equal(findDuplicateDocument([first], same).id, first.id);
});

test("only user-reviewed text or described documents enter retrieval context", () => {
  const textBytes = Buffer.from("Average speed equals total distance divided by total time.", "utf8");
  const textDoc = createKnowledgeDocument({ fileName: "speed.txt", mimeType: "text/plain" }, textBytes, now);
  const imageBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const imageDoc = createKnowledgeDocument({
    fileName: "diagram.png",
    mimeType: "image/png",
    description: "A diagram showing a distance-time graph."
  }, imageBytes, now);
  const reviewed = [
    normalizeKnowledgeDocument({ ...textDoc, reviewStatus: "user-reviewed", reviewedAt: now }),
    normalizeKnowledgeDocument({ ...imageDoc, reviewStatus: "user-reviewed", reviewedAt: now })
  ];

  assert.equal(buildDocumentKnowledgeContext([textDoc], "average speed").length, 0);
  const context = buildDocumentKnowledgeContext(reviewed, "average speed");
  assert.equal(context.length, 1);
  assert.match(context[0].content, /total distance divided by total time/);
  assert.equal(context[0].sourceKind, "user-document");
});

test("document filtering can search tags, descriptions and collections", () => {
  const bytes = Buffer.from("Newton's laws describe motion.", "utf8");
  const doc = createKnowledgeDocument({
    fileName: "laws.md", mimeType: "text/markdown",
    collection: "Physics", tags: ["Newton", "mechanics"]
  }, bytes, now);
  assert.equal(searchKnowledgeDocuments([doc], "mechanics", "Physics").length, 1);
  assert.equal(searchKnowledgeDocuments([doc], "mechanics", "Chemistry").length, 0);
});

test("document storage key resolves only directly under its configured directory", () => {
  const bytes = Buffer.from("A safe note.", "utf8");
  const doc = createKnowledgeDocument({ fileName: "note.txt", mimeType: "text/plain" }, bytes, now);
  assert.match(resolveDocumentStoragePath("/tmp/jarvis-docs", doc), /^\/tmp\/jarvis-docs\//);
  assert.throws(() => resolveDocumentStoragePath("/tmp/jarvis-docs", { storageKey: "../escape" }));
});
