import test from "node:test";
import assert from "node:assert/strict";
import {
  filterMediaAssets,
  formatMediaAssetSize,
  MEDIA_ASSET_LIMITS,
  normalizeMediaAssetKind,
  normalizeMediaAssetMetadata,
  normalizeMediaAssetTags
} from "../public/media-asset-library.js";

test("normalizes image, video and audio media kinds", () => {
  assert.equal(normalizeMediaAssetKind("image/png"), "image");
  assert.equal(normalizeMediaAssetKind("video/mp4"), "video");
  assert.equal(normalizeMediaAssetKind("audio/mpeg"), "audio");
  assert.equal(normalizeMediaAssetKind("application/pdf"), "");
});

test("normalizes names, MIME types, tags and bounded asset metadata", () => {
  const asset = normalizeMediaAssetMetadata({
    name: "  My\u0000 logo.png  ",
    mimeType: "IMAGE/PNG",
    size: 2048,
    tags: ["Logo", " brand ", "logo", "intro"]
  });
  assert.equal(asset.name, "My logo.png");
  assert.equal(asset.mimeType, "image/png");
  assert.equal(asset.kind, "image");
  assert.deepEqual(asset.tags, ["logo", "brand", "intro"]);
});

test("limits tags and rejects unsupported, empty and oversized assets", () => {
  const tags = normalizeMediaAssetTags(Array.from({ length: 20 }, (_, i) => "tag-" + i));
  assert.equal(tags.length, MEDIA_ASSET_LIMITS.maxTags);
  assert.throws(() => normalizeMediaAssetMetadata({
    name: "unknown.bin", mimeType: "application/octet-stream", size: 10
  }), /image, video and audio/i);
  assert.throws(() => normalizeMediaAssetMetadata({
    name: "empty.png", mimeType: "image/png", size: 0
  }), /empty/i);
  assert.throws(() => normalizeMediaAssetMetadata({
    name: "large.mp4", mimeType: "video/mp4", size: MEDIA_ASSET_LIMITS.maxBytes + 1
  }), /100 MiB/i);
});

test("filters assets by name, tag and type without mutating the source list", () => {
  const records = [
    { id: "one", name: "Intro logo.png", kind: "image", mimeType: "image/png", tags: ["intro", "brand"], createdAt: "2026-01-01" },
    { id: "two", name: "Voiceover.mp3", kind: "audio", mimeType: "audio/mpeg", tags: ["voice"], createdAt: "2026-01-02" },
    { id: "three", name: "Background video.mp4", kind: "video", mimeType: "video/mp4", tags: ["background"], createdAt: "2026-01-03" }
  ];
  assert.deepEqual(filterMediaAssets(records, { kind: "image" }).map((item) => item.id), ["one"]);
  assert.deepEqual(filterMediaAssets(records, { tag: "VOICE" }).map((item) => item.id), ["two"]);
  assert.deepEqual(filterMediaAssets(records, { query: "background" }).map((item) => item.id), ["three"]);
  assert.equal(records.length, 3);
});

test("formats browser storage sizes for the asset list", () => {
  assert.equal(formatMediaAssetSize(512), "512 B");
  assert.equal(formatMediaAssetSize(1024), "1.0 KB");
  assert.equal(formatMediaAssetSize(1024 * 1024), "1.0 MB");
});
