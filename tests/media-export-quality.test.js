import test from "node:test";
import assert from "node:assert/strict";
import { assessMediaExport } from "../services/media-export-quality.js";

const validExport = {
  blobSizeBytes: 2_400_000,
  mimeType: "video/webm",
  actualWidth: 720,
  actualHeight: 1280,
  actualDurationSeconds: 30.02,
  expectedWidth: 720,
  expectedHeight: 1280,
  expectedDurationSeconds: 30
};

test("verifies a rendered video when measured metadata matches the export contract", () => {
  const result = assessMediaExport(validExport);
  assert.equal(result.verified, true);
  assert.deepEqual(result.issues, []);
  assert.equal(result.actualWidth, 720);
  assert.equal(result.actualHeight, 1280);
});

test("flags an output whose dimensions differ from the requested canvas", () => {
  const result = assessMediaExport({ ...validExport, actualWidth: 640 });
  assert.equal(result.verified, false);
  assert.match(result.issues.join(" "), /640/);
});

test("flags a short or empty output instead of calling it verified", () => {
  const result = assessMediaExport({ ...validExport, blobSizeBytes: 12 });
  assert.equal(result.verified, false);
  assert.match(result.issues.join(" "), /too small/);
});

test("flags an unexpected media type", () => {
  const result = assessMediaExport({ ...validExport, mimeType: "text/plain" });
  assert.equal(result.verified, false);
  assert.match(result.issues.join(" "), /media type/);
});

test("flags duration drift outside the bounded tolerance", () => {
  const result = assessMediaExport({ ...validExport, actualDurationSeconds: 24 });
  assert.equal(result.verified, false);
  assert.match(result.issues.join(" "), /Expected about 30.0s/);
});

test("does not verify exports when the browser cannot provide valid metadata", () => {
  const result = assessMediaExport({
    ...validExport,
    actualWidth: 0,
    actualHeight: 0,
    actualDurationSeconds: Number.NaN
  });
  assert.equal(result.verified, false);
  assert.equal(result.issues.length, 2);
});
