// Adds an Android signing fingerprint (SHA-256, "AA:BB:...") to the Digital Asset Links files of the site:
//   node scripts/update-assetlinks.mjs AA:BB:CC:...
// The release workflow runs it after every Android build, so the site always vouches for the key the published APK is signed with
// (that is what lets the app open full screen, without a browser bar). Older fingerprints stay: apps installed with an older key still verify.
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const FILES = [".well-known/assetlinks.json", "assetlinks.json"];
const FP = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;
const KEEP = 20;

/** Returns the new text of an assetlinks.json with `fingerprint` added (unchanged text when it is already there). */
export function addFingerprint(text, fingerprint) {
  if (!FP.test(fingerprint)) throw new Error(`not a SHA-256 fingerprint: ${fingerprint}`);
  const list = JSON.parse(text);
  const target = list.find((s) => s?.target?.namespace === "android_app" && s.target.package_name === "space.affinix.app");
  if (!target) throw new Error("no android_app statement for space.affinix.app");
  const fps = target.target.sha256_cert_fingerprints ?? [];
  if (!fps.includes(fingerprint)) target.target.sha256_cert_fingerprints = [...fps, fingerprint].slice(-KEEP);
  return JSON.stringify(list, null, 2) + "\n";
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const fp = (process.argv[2] ?? "").trim().toUpperCase();
  for (const f of FILES) {
    const p = join(root, f);
    const before = readFileSync(p, "utf8");
    const after = addFingerprint(before, fp);
    if (after !== before) { writeFileSync(p, after); console.log(`${f}: added ${fp}`); } else console.log(`${f}: already lists ${fp}`);
  }
}
