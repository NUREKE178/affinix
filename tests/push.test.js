// The browser side of push notifications: the status rules, the key decoding, and the service worker's push / click handlers (run in a stub of the worker scope).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { statusFrom, urlBase64ToBytes } from "../src/lib/pushUtil.js";

test("status: what the page may offer on each device", () => {
  const base = { capable: true, platform: "android", standalone: false, permission: "default", subscribed: false };
  assert.equal(statusFrom(base), "off");
  assert.equal(statusFrom({ ...base, permission: "granted", subscribed: true }), "on");
  assert.equal(statusFrom({ ...base, permission: "granted", subscribed: false }), "off", "allowed but not saved yet -> the switch is off");
  assert.equal(statusFrom({ ...base, permission: "denied" }), "denied");
  assert.equal(statusFrom({ ...base, capable: false, platform: "ios" }), "install", "iPhone in Safari: add to the Home Screen first");
  assert.equal(statusFrom({ ...base, capable: false, platform: "ios", standalone: true }), "unsupported");
  assert.equal(statusFrom({ ...base, capable: false, platform: "windows" }), "unsupported");
});

test("the VAPID key (base64url) decodes to the bytes the browser wants", () => {
  const bytes = urlBase64ToBytes("AQID_-4"); // 01 02 03 ff ee
  assert.deepEqual([...bytes], [1, 2, 3, 255, 238]);
});

function loadWorker(windows) {
  const handlers = {}; const shown = []; const opened = []; let closed = 0;
  const self = {
    addEventListener: (type, fn) => { handlers[type] = fn; },
    skipWaiting() {}, caches: {},
    clients: { matchAll: async () => windows, claim: async () => {}, openWindow: async (u) => { opened.push(u); } },
    registration: { scope: "https://affinix.space/", showNotification: async (title, opts) => { shown.push({ title, opts }); } },
  };
  vm.runInNewContext(fs.readFileSync(new URL("../sw.js", import.meta.url), "utf8"), { self, URL, Response, fetch: () => {}, console, caches: { open: async () => ({ addAll: async () => {} }), keys: async () => [], match: async () => undefined } });
  const run = async (type, event) => { let p; handlers[type]({ ...event, waitUntil: (x) => { p = x; } }); await p; };
  return { run, shown, opened, closedCount: () => closed };
}
const pushEvent = (data) => ({ data: { json: () => data, text: () => JSON.stringify(data) } });

test("worker: a push shows a notification with the sender, the text and the chat link", async () => {
  const w = loadWorker([]);
  await w.run("push", pushEvent({ title: "Amina", body: "Привет!", tag: "dm:1", url: "./#/app/messages?c=1" }));
  assert.equal(w.shown.length, 1);
  assert.equal(w.shown[0].title, "Amina");
  assert.equal(w.shown[0].opts.body, "Привет!");
  assert.equal(w.shown[0].opts.tag, "dm:1");
  assert.equal(w.shown[0].opts.data.url, "./#/app/messages?c=1");
});

test("worker: stays quiet while a window of the site is in front (the page shows its own toast)", async () => {
  const w = loadWorker([{ visibilityState: "visible", focused: true, url: "https://affinix.space/" }]);
  await w.run("push", pushEvent({ title: "Amina", body: "hi" }));
  assert.equal(w.shown.length, 0);
  const hidden = loadWorker([{ visibilityState: "hidden", focused: false, url: "https://affinix.space/" }]);
  await hidden.run("push", pushEvent({ title: "Amina", body: "hi" }));
  assert.equal(hidden.shown.length, 1, "a background tab still gets the notification");
});

test("worker: tapping the notification focuses the open window and goes to the chat, or opens one", async () => {
  const calls = [];
  const win = { visibilityState: "hidden", url: "https://affinix.space/#/app/arena", focus: async () => calls.push("focus"), navigate: async (u) => calls.push(`navigate ${u}`) };
  const w = loadWorker([win]);
  await w.run("notificationclick", { notification: { close() { calls.push("close"); }, data: { url: "./#/app/messages?c=9" } } });
  assert.deepEqual(calls, ["close", "focus", "navigate https://affinix.space/#/app/messages?c=9"]);
  const none = loadWorker([]);
  await none.run("notificationclick", { notification: { close() {}, data: { url: "./#/app/messages?c=9" } } });
  assert.deepEqual(none.opened, ["https://affinix.space/#/app/messages?c=9"]);
});
