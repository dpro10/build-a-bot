#!/usr/bin/env bash
# Hands GitHub Actions what it needs to sign and notarize the Mac app (.github/workflows/desktop.yml
# › Mac app), straight from this Mac: the Developer ID Application certificate in your Keychain and
# an App Store Connect API key. Run it yourself, in Terminal, from the repository:
#
#   bash desktop/scripts/set-mac-signing-secrets.sh <issuer-id> [path/to/AuthKey_XXXXXXXXXX.p8]
#
# The issuer ID is at the top of App Store Connect → Users and Access → Integrations → App Store
# Connect API. The key defaults to the one in ~/.appstoreconnect/private_keys.
# macOS asks you to allow exporting your keys (your Mac password, then Allow). Nothing secret is
# printed, and nothing is left on disk: only the Developer ID certificate goes to GitHub, never
# your other certificates.
set -euo pipefail

die() { echo "✗ $*" >&2; exit 1; }

ISSUER="${1:-}"
[[ "$ISSUER" =~ ^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$ ]] || die "Usage: $0 <issuer-id> [AuthKey.p8]. The issuer ID looks like 69a6de7e-…; it's at the top of App Store Connect → Users and Access → Integrations → App Store Connect API."
P8="${2:-$(ls "$HOME"/.appstoreconnect/private_keys/AuthKey_*.p8 2>/dev/null | head -1)}"
[ -f "$P8" ] || die "No App Store Connect API key (AuthKey_….p8) found. Pass its path."
KEY_ID="$(basename "$P8" .p8)"
KEY_ID="${KEY_ID#AuthKey_}"
REPO="${REPO:-dpro10/build-a-bot}"
OPENSSL=/usr/bin/openssl # macOS's own: its .p12 files are the kind `security import` reads everywhere

command -v gh >/dev/null || die "Install GitHub's CLI first: brew install gh, then gh auth login."
gh auth status >/dev/null 2>&1 || die "Sign in to GitHub's CLI first: gh auth login."

IDENTITY="$(security find-identity -v -p codesigning | sed -n 's/.*"\(Developer ID Application: .*\)"$/\1/p' | head -1)"
[ -n "$IDENTITY" ] || die "No Developer ID Application certificate in your Keychain. Make one at developer.apple.com → Certificates → + → Developer ID Application (docs/DEPLOY.md §9)."
echo "Certificate: $IDENTITY"
echo "API key:     $KEY_ID"
echo "Repository:  $REPO"

echo "→ Checking the API key with Apple's notary service…"
xcrun notarytool history --key "$P8" --key-id "$KEY_ID" --issuer "$ISSUER" >/dev/null 2>&1 ||
  die "Apple didn't accept that key with that issuer ID. Check both (the key needs the Developer role or higher, and must be a Team key)."
echo "  ok"

TMP="$(mktemp -d)"
CHECK_KC="$TMP/check.keychain-db"
cleanup() {
  security delete-keychain "$CHECK_KC" >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT
chmod 700 "$TMP"

export EXPORT_PW P12_PW
EXPORT_PW="$($OPENSSL rand -hex 24)"
P12_PW="$($OPENSSL rand -hex 24)"

echo "→ Exporting from your Keychain (allow it in the macOS dialogs)…"
security export -k "$HOME/Library/Keychains/login.keychain-db" -t identities -f pkcs12 -P "$EXPORT_PW" -o "$TMP/all.p12" >/dev/null
security find-certificate -c "$IDENTITY" -p > "$TMP/cert.pem"
$OPENSSL pkcs12 -in "$TMP/all.p12" -passin env:EXPORT_PW -nocerts -nodes 2>/dev/null |
  awk -v dir="$TMP" '/-----BEGIN .*PRIVATE KEY-----/ { n++; f = dir "/key" n ".pem" } f { print > f } /-----END .*PRIVATE KEY-----/ { f = "" }'

# The key that belongs to the Developer ID certificate: the one with the same public key.
want="$($OPENSSL x509 -in "$TMP/cert.pem" -noout -pubkey | $OPENSSL sha256)"
KEY=""
for k in "$TMP"/key*.pem; do
  [ -f "$k" ] || continue
  if [ "$($OPENSSL pkey -in "$k" -pubout 2>/dev/null | $OPENSSL sha256)" = "$want" ]; then KEY="$k"; break; fi
done
[ -n "$KEY" ] || die "Couldn't find the Developer ID certificate's private key in the export (was it made on another Mac?)."

# Apple's intermediate certificate goes along, so the build machine can complete the chain.
security find-certificate -a -c "Developer ID Certification Authority" -p /Library/Keychains/System.keychain "$HOME/Library/Keychains/login.keychain-db" > "$TMP/chain.pem" 2>/dev/null || true
chain=()
[ -s "$TMP/chain.pem" ] && chain=(-certfile "$TMP/chain.pem")
$OPENSSL pkcs12 -export -in "$TMP/cert.pem" -inkey "$KEY" "${chain[@]}" -name "$IDENTITY" \
  -keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -passout env:P12_PW -out "$TMP/devid.p12"

echo "→ Checking the certificate file opens and signs…"
security create-keychain -p "" "$CHECK_KC" >/dev/null
security import "$TMP/devid.p12" -k "$CHECK_KC" -P "$P12_PW" -T /usr/bin/codesign >/dev/null
security find-identity -p codesigning "$CHECK_KC" | grep -q "Developer ID Application" ||
  die "The exported certificate file didn't open as a signing identity."
echo "  ok"

echo "→ Saving the secrets in GitHub…"
base64 -i "$TMP/devid.p12" | gh secret set MAC_CERTIFICATE_P12 -R "$REPO"
printf '%s' "$P12_PW" | gh secret set MAC_CERTIFICATE_PASSWORD -R "$REPO"
gh secret set APPLE_API_KEY_P8 -R "$REPO" < "$P8"
printf '%s' "$KEY_ID" | gh secret set APPLE_API_KEY_ID -R "$REPO"
printf '%s' "$ISSUER" | gh secret set APPLE_API_ISSUER -R "$REPO"

echo "✓ Done. The next Desktop app build on main signs and notarizes the Mac app:"
echo "  gh workflow run desktop.yml -R $REPO --ref main"
