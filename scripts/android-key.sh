#!/usr/bin/env bash
# One-time setup of a PERMANENT Android signing key for the Affinix app (optional).
#
# Without it every release is signed with a one-off key made during the build: the app installs fine, but a phone refuses to update it in place
# (a different key each time), so people would have to uninstall first. With one permanent key stored as repository secrets, updates just work.
#
#   bash scripts/android-key.sh            makes the key in ./affinix-release.jks and, if the GitHub CLI (gh) is installed and logged in,
#                                          sets the four repository secrets for you; otherwise it prints what to paste where.
#
# Keep affinix-release.jks and the password somewhere safe (a password manager). Do NOT commit them (*.jks is in .gitignore).
set -euo pipefail

command -v keytool >/dev/null || { echo "keytool not found: install a JDK (for example: sudo apt install default-jdk, or https://adoptium.net)"; exit 1; }
OUT="${1:-affinix-release.jks}"
[ -e "$OUT" ] && { echo "$OUT already exists: not overwriting it. Pass another file name as the first argument."; exit 1; }
PW="$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')"   # 32 random hex characters

keytool -genkeypair -keystore "$OUT" -alias affinix -keyalg RSA -keysize 2048 -validity 36500 \
  -storepass "$PW" -keypass "$PW" -dname "CN=Affinix, O=Nurlan Company, C=KZ" >/dev/null 2>&1
FP="$(keytool -list -v -keystore "$OUT" -storepass "$PW" 2>/dev/null | sed -n 's/.*SHA256: //p' | head -1)"
echo "Key created: $OUT"
echo "SHA-256 fingerprint: $FP"
echo

if command -v gh >/dev/null && gh auth status >/dev/null 2>&1; then
  REPO="${AFFINIX_REPO:-NUREKE178/affinix}"
  base64 -w0 "$OUT" 2>/dev/null | gh secret set ANDROID_KEYSTORE_BASE64 --repo "$REPO" || base64 "$OUT" | tr -d '\n' | gh secret set ANDROID_KEYSTORE_BASE64 --repo "$REPO"
  printf '%s' "$PW" | gh secret set ANDROID_KEYSTORE_PASSWORD --repo "$REPO"
  printf '%s' "affinix" | gh secret set ANDROID_KEY_ALIAS --repo "$REPO"
  echo "The four secrets are set on $REPO. The next \"Release apps\" run signs with this key."
else
  echo "Add these as repository secrets (GitHub -> the repository -> Settings -> Secrets and variables -> Actions -> New repository secret):"
  echo "  ANDROID_KEYSTORE_BASE64   = the output of:  base64 -w0 $OUT"
  echo "  ANDROID_KEYSTORE_PASSWORD = $PW"
  echo "  ANDROID_KEY_ALIAS         = affinix"
fi
echo
echo "Password (save it with the .jks file): $PW"
