import { test } from "node:test";
import assert from "node:assert/strict";
import { gateFor } from "../src/lib/firstRun.js";

const ready = { configured: true, sessionLoading: false, hasSession: true, orgChecked: true, orgError: false, hasOrg: true };

test("a person with a workspace goes straight to the app", () => {
  assert.equal(gateFor(ready), "app");
});

// The bug: sign-up sent everyone without a workspace to a ten-screen company wizard, and the Arena sits behind that gate,
// so a person who came to play had to name a "workspace" first. A new person must get a workspace made for them, silently.
test("a signed-in person with no workspace gets one made for them, never a wizard", () => {
  assert.equal(gateFor({ ...ready, hasOrg: false }), "provision");
});

test("the waiting states keep their order", () => {
  assert.equal(gateFor({ ...ready, configured: false }), "notConfigured");
  assert.equal(gateFor({ ...ready, sessionLoading: true }), "loadingSession");
  assert.equal(gateFor({ ...ready, hasSession: false }), "login");
  assert.equal(gateFor({ ...ready, orgChecked: false, hasOrg: false }), "loadingWorkspace");
  assert.equal(gateFor({ ...ready, orgError: true, hasOrg: false }), "error");
});
