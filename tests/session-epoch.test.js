import { test } from "node:test";
import assert from "node:assert/strict";
import { createSessionEpoch } from "../public/session-epoch.js";

test("late pre-login 401 cannot hide a workspace opened by a newer login", () => {
  const epoch = createSessionEpoch();
  const startupRequestEpoch = epoch.capture();
  let loginScreenShown = false;

  const authenticatedEpoch = epoch.advance();
  assert.equal(epoch.isCurrent(authenticatedEpoch), true);
  assert.equal(epoch.isCurrent(startupRequestEpoch), false);

  const applied = epoch.runIfCurrent(startupRequestEpoch, () => {
    loginScreenShown = true;
  });

  assert.equal(applied, false);
  assert.equal(loginScreenShown, false);
});

test("current session failures still apply and logout invalidates prior boot work", () => {
  const epoch = createSessionEpoch();
  const loginEpoch = epoch.advance();
  let loginScreenShown = false;

  assert.equal(epoch.runIfCurrent(loginEpoch, () => {
    loginScreenShown = true;
  }), true);
  assert.equal(loginScreenShown, true);

  const bootEpoch = epoch.capture();
  epoch.advance();
  assert.equal(epoch.isCurrent(bootEpoch), false);
});
