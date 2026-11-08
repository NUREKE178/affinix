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

import { workspaceNameFor } from "../src/lib/firstRun.js";

test("the silent workspace is named after the person, else after their email", () => {
  assert.equal(workspaceNameFor({ fullName: "  Нурлан   Жайлау ", email: "x@y.kz" }), "Нурлан Жайлау");
  assert.equal(workspaceNameFor({ fullName: "", email: "roma2002@gmail.com" }), "roma2002");
  assert.equal(workspaceNameFor({}), "Workspace");
  assert.equal(workspaceNameFor({ fullName: null, email: "@x.kz" }), "Workspace");
});

test("a long or emoji name is cut by characters, never in the middle of one", () => {
  const long = "Айгерим".repeat(20);
  assert.equal(Array.from(workspaceNameFor({ fullName: long })).length, 60);
  const emoji = "😀".repeat(70);
  const cut = workspaceNameFor({ fullName: emoji });
  assert.equal(Array.from(cut).length, 60);
  assert.ok(!/[\ud800-\udbff]$/.test(cut), "no lone surrogate at the end");
});

import { firstLookDue } from "../src/lib/firstRun.js";

test("the welcome is for a person with no answers who has not seen it", () => {
  assert.equal(firstLookDue({ votes: 0, seen: false }), true);
  assert.equal(firstLookDue({ votes: 0, seen: true }), false);
  assert.equal(firstLookDue({ votes: 3, seen: false }), false);
});
