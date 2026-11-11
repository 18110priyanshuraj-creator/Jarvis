import test from "node:test";
import assert from "node:assert/strict";
import {
  collectTimelineSnapPoints,
  snapTimelineEdge,
  snapTimelineMoveStart
} from "../public/media-timeline-snapping.js";

const project = {
  tracks: [
    { id: "video", clips: [
      { id: "a", start: 0, duration: 4 },
      { id: "b", start: 8, duration: 3 }
    ] },
    { id: "overlay", clips: [
      { id: "c", start: 5, duration: 1 }
    ] }
  ]
};

test("collects sorted unique clip boundaries and playhead while excluding the moving clip", () => {
  const points = collectTimelineSnapPoints(project, "a", 6.5);
  assert.deepEqual(points, [0, 5, 6, 6.5, 8, 11]);
});

test("snaps a dragged edge to the nearest boundary only within tolerance", () => {
  assert.equal(snapTimelineEdge(4.92, [0, 5, 8]), 5);
  assert.equal(snapTimelineEdge(4.7, [0, 5, 8]), 4.7);
  assert.equal(snapTimelineEdge(-1, [0, 5]), 0);
});

test("moves a clip by snapping either its leading or trailing edge", () => {
  // Leading edge lands on 8 seconds.
  assert.equal(snapTimelineMoveStart(7.91, 3, [0, 5, 8]), 8);
  // Trailing edge lands on 8 seconds, so the start becomes 5 seconds.
  assert.equal(snapTimelineMoveStart(5.08, 3, [0, 5, 8]), 5);
  // Far from any boundary, the requested position is retained.
  assert.equal(snapTimelineMoveStart(6.4, 3, [0, 5, 8]), 6.4);
});
