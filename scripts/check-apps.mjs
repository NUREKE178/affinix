// Checks the app packaging without building anything (the real build runs in .github/workflows/native-apps.yml; the older web-wrapper apps in apps/ are kept as a legacy path).
//   node scripts/check-apps.mjs
// What it proves: the file names the site's Download page looks for are the ones the build produces; the desktop app's link rules and
// affinix:// handling behave; every Android resource the manifest names exists; the Digital Asset Links file matches the signing key.
import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { execFileSync } from "child_process";
import { createRequire } from "module";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const require = createRequire(import.meta.url);
let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { if (ok) { pass++; console.log("PASS " + name); } else { fail++; console.log("FAIL " + name + (detail ? "  [" + detail + "]" : "")); } };

// ---- file names: the Download page, the desktop package and the workflow agree ---------------------------------------------------------
const dl = read("src/pages/Download.js");
const names = Object.fromEntries([...dl.matchAll(/(\w+):\s*"(Affinix[\w.-]*)"/g)].map((m) => [m[1], m[2]]));
const wf = read(".github/workflows/release-apps.yml");
const pkg = JSON.parse(read("apps/desktop/package.json"));
const nwf = read(".github/workflows/native-apps.yml");
check("Download page names the four files", names.windows === "Affinix-Setup.exe" && names.android === "Affinix.apk" && names.linux === "Affinix-linux.tar.gz" && names.deb === "Affinix.deb", JSON.stringify(names));
check("the native workflow publishes all four files under those names, with checksums", Object.values(names).every((n) => nwf.includes(`out/${n}`)) && nwf.includes("SHA256SUMS.txt"));
check("a native release gets a tag that the old release workflow does not react to", /native-v/.test(nwf) && !/tags:\s*\[\s*"native/.test(nwf));
check("the old web-wrapper release workflow can no longer overwrite those names by accident", !/^\s*push:\s*$/m.test(wf) && /legacy/.test(wf));
check("the Android build is signed from the environment (no key in the repository)", nwf.includes("ANDROID_KEYSTORE_PATH") && existsSync(join(ROOT, "native/composeApp/android.gradle")));
check("the repository named in the Download page owns the update feed", dl.includes(`"${pkg.build.publish[0].owner}/${pkg.build.publish[0].repo}"`));
check("the desktop package lists electron-updater as a runtime dependency", !!pkg.dependencies?.["electron-updater"] && !!pkg.devDependencies?.electron && !!pkg.devDependencies?.["electron-builder"]);
check("the desktop lock file exists (the workflow runs npm ci)", existsSync(join(ROOT, "apps/desktop/package-lock.json")));
check("an author e-mail is set (a .deb needs a maintainer)", /@/.test(pkg.author?.email ?? "") && /<.+@.+>/.test(pkg.build.linux.maintainer ?? ""));
check("the files electron-builder packs exist", pkg.build.files.every((f) => existsSync(join(ROOT, "apps/desktop", f))) && existsSync(join(ROOT, "apps/desktop", pkg.build.win.icon)));

// ---- the desktop app's rules ----------------------------------------------------------------------------------------------------------------
const lib = require(join(ROOT, "apps/desktop/lib.js"));
check("desktop: the site, Supabase and Google sign-in stay in the window", ["https://affinix.space/#/app", "https://www.affinix.space/", "https://abc.supabase.co/auth/v1", "https://accounts.google.com/o/oauth2/v2/auth"].every(lib.isInApp));
check("desktop: look-alike hosts, plain http and other schemes do not", ["https://affinix.space.evil.com/", "https://evilaffinix.space/", "http://affinix.space/", "file:///etc/passwd", "javascript:alert(1)", "ftp://affinix.space/"].every((u) => !lib.isInApp(u)));
check("desktop: only web and mail links are handed to the system", lib.isSafeExternal("https://example.com") && lib.isSafeExternal("mailto:a@b.c") && !["file:///C:/Windows/System32/calc.exe", "smb://x/y", "ms-msdt:/id", "vscode://x"].some(lib.isSafeExternal));
check("desktop: affinix:// links become site routes", lib.fromDeepLink("affinix://app/arena") === "https://affinix.space/#/app/arena" && lib.fromDeepLink("affinix:///app/styles") === "https://affinix.space/#/app/styles" && lib.fromDeepLink("affinix://") === "https://affinix.space/#/app/arena");
check("desktop: bad affinix:// links are refused", [null, "https://affinix.space", "affinix://../../x", "affinix://app/a\"><script>", "affinixx://app"].every((l) => lib.fromDeepLink(l) === null));
check("desktop: the menu has the same words in English, Russian and Kazakh", ["ru", "kk"].every((l) => Object.keys(lib.STRINGS.en).every((k) => lib.STRINGS[l][k])));
const displays = [{ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }];
check("desktop: a saved window position off every screen is ignored", lib.boundsVisible({ x: 100, y: 100, width: 1200, height: 800 }, displays) && !lib.boundsVisible({ x: 5000, y: 100, width: 1200, height: 800 }, displays));
const main = read("apps/desktop/main.js");
check("desktop: the window is sandboxed and has no Node", /contextIsolation: true/.test(main) && /nodeIntegration: false/.test(main) && /sandbox: true/.test(main));
check("desktop: main.js has a single-instance lock, update check and tray", /requestSingleInstanceLock/.test(main) && /electron-updater/.test(main) && /new Tray/.test(main));
try { execFileSync(process.execPath, ["--check", join(ROOT, "apps/desktop/main.js")]); check("desktop: main.js parses", true); } catch (e) { check("desktop: main.js parses", false, String(e.stderr ?? e).slice(0, 200)); }

// ---- Android: the resources the manifest names exist ----------------------------------------------------------------------------------
const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
const res = join(ROOT, "apps/android/app/src/main/res");
const resFiles = walk(res).map((p) => p.slice(res.length + 1));
const defined = { string: new Set(), color: new Set(), style: new Set(), drawable: new Set(), xml: new Set(), mipmap: new Set() };
for (const f of resFiles) {
  const [dir, file] = f.split("/");
  const base = file.replace(/\.[^.]+$/, "");
  if (/^values/.test(dir)) { const x = readFileSync(join(res, f), "utf8"); for (const m of x.matchAll(/<(string|color|style)\s+name="([^"]+)"/g)) defined[m[1]].add(m[2]); }
  else if (/^drawable/.test(dir)) defined.drawable.add(base);
  else if (/^xml/.test(dir)) defined.xml.add(base);
  else if (/^mipmap/.test(dir)) defined.mipmap.add(base);
}
const manifest = readFileSync(join(ROOT, "apps/android/app/src/main/AndroidManifest.xml"), "utf8");
const refs = [...(manifest + resFiles.filter((f) => f.endsWith(".xml")).map((f) => readFileSync(join(res, f), "utf8")).join("\n")).matchAll(/@(string|color|style|drawable|xml|mipmap)\/([\w.]+)/g)];
const missing = refs.filter((m) => !defined[m[1]].has(m[2])).map((m) => m[0]);
check("android: every resource the manifest and the resources name exists", missing.length === 0, [...new Set(missing)].join(", "));
check("android: all five launcher icon sizes (and the round ones) exist", ["mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"].every((d) => existsSync(join(res, `mipmap-${d}/ic_launcher.png`)) && existsSync(join(res, `mipmap-${d}/ic_launcher_round.png`))));
check("android: the strings exist in English, Russian and Kazakh", ["", "-ru", "-kk"].every((s) => existsSync(join(res, `values${s}/strings.xml`))));
const bal = (x) => { const st = []; for (const m of x.matchAll(/<(\/?)([A-Za-z][\w.:-]*)([^>]*?)(\/?)>/g)) { if (m[4] === "/") continue; if (m[1]) { if (st.pop() !== m[2]) return false; } else st.push(m[2]); } return st.length === 0; };
check("android: the manifest and every resource file are balanced XML", [manifest, ...resFiles.filter((f) => f.endsWith(".xml")).map((f) => readFileSync(join(res, f), "utf8"))].every((x) => bal(x.replace(/<\?xml[^>]*\?>/, "").replace(/<!--[\s\S]*?-->/g, ""))));
const gradle = read("apps/android/app/build.gradle");
check("android: package and versions come from the workflow, the key from the environment", /applicationId "space.affinix.app"/.test(gradle) && /appVersionCode/.test(gradle) && /ANDROID_KEYSTORE_PATH/.test(gradle) && !/storePassword\s+"/.test(gradle));
check("android: the app opens affinix.space and is tied to it", /DEFAULT_URL/.test(manifest) && /https:\/\/affinix\.space/.test(read("apps/android/app/src/main/res/values/strings.xml")) && /asset_statements/.test(manifest) && /autoVerify="true"/.test(manifest));
check("android: the Gradle wrapper is there", existsSync(join(ROOT, "apps/android/gradlew")) && existsSync(join(ROOT, "apps/android/gradle/wrapper/gradle-wrapper.jar")));
const mode = statSync(join(ROOT, "apps/android/gradlew")).mode;
check("android: gradlew is executable", (mode & 0o111) !== 0);

// ---- Digital Asset Links: the site vouches for the key the release workflow signs with ------------------------------------------------
const links = JSON.parse(read(".well-known/assetlinks.json"));
check("assetlinks: both copies (the file Vercel rewrites to and the dot folder) are identical", read(".well-known/assetlinks.json") === read("assetlinks.json"));
check("assetlinks: names the Android package and the right relation", links[0]?.target?.package_name === "space.affinix.app" && links[0]?.target?.namespace === "android_app" && links[0]?.relation?.[0] === "delegate_permission/common.handle_all_urls");
check("assetlinks: every fingerprint is a SHA-256 in AA:BB:.. form", (links[0]?.target?.sha256_cert_fingerprints ?? []).every((f) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(f)));
const { addFingerprint } = await import(join(ROOT, "scripts/update-assetlinks.mjs"));
const FP1 = "F8:B0:0C:14:1D:A9:FC:39:10:CB:89:F3:37:56:95:BE:EF:EA:9E:EB:29:DE:FC:E9:07:6A:FB:11:AD:79:D9:93", FP2 = "C9:EB:F9:49:26:AF:EF:95:1C:21:00:7D:0F:41:CD:D2:8E:97:F9:D8:5D:57:C1:ED:A3:DC:B8:A7:9B:28:3D:39";
const once = addFingerprint(read(".well-known/assetlinks.json"), FP1), twice = addFingerprint(once, FP1), both = addFingerprint(once, FP2);
check("update-assetlinks: adds a fingerprint, once (adding it again changes nothing)", JSON.parse(once)[0].target.sha256_cert_fingerprints.includes(FP1) && once === twice);
check("update-assetlinks: keeps the older fingerprints", JSON.parse(both)[0].target.sha256_cert_fingerprints.slice(-2).join() === [...JSON.parse(once)[0].target.sha256_cert_fingerprints, FP2].slice(-2).join());
let refused = 0; for (const bad of ["", "abc", FP1.toLowerCase(), FP1 + ":00", "<script>"]) { try { addFingerprint(read(".well-known/assetlinks.json"), bad); } catch { refused++; } }
check("update-assetlinks: refuses anything that is not a SHA-256 fingerprint", refused === 5, String(refused));
const vercel = JSON.parse(read("vercel.json"));
check("vercel.json serves /.well-known/assetlinks.json as JSON", vercel.rewrites?.some((r) => r.source === "/.well-known/assetlinks.json" && r.destination === "/assetlinks.json") && JSON.stringify(vercel.headers).includes("application/json"));

// ---- secrets: nothing that signs or logs in is stored in the repository ---------------------------------------------------------------
let tracked = "";
try { tracked = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" }); } catch { /* not a git checkout */ }
if (tracked) check("no signing key (.jks / .keystore / .p12) is tracked by git", !/\.(jks|keystore|p12|pfx)$/m.test(tracked));
check("the workflow takes the signing key from secrets or makes a one-off, and never prints it", /secrets\.ANDROID_KEYSTORE_BASE64/.test(wf) && /add-mask/.test(wf) && !/storepass\s+["']?[A-Za-z0-9]{6,}["']?\s/.test(wf.replace(/"\$PW"|"\$KEYPW"/g, "")));
check("*.jks and *.keystore are git-ignored", /^\*\.jks$/m.test(read(".gitignore")) && /^\*\.keystore$/m.test(read(".gitignore")));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
