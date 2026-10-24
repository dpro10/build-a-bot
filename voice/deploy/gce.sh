#!/usr/bin/env bash
# Deploys the voice server to Google Compute Engine, idempotently: the first run sets everything
# up, later runs ship a new image. Run by .github/workflows/voice.yml on main (or by hand with
# gcloud signed in). Needs, in the environment:
#   GCP_PROJECT               the Google Cloud project
#   VOICE_SERVER_SECRET       shared with the app (Vercel), 32+ characters
#   TOKEN_FACTORY_API_KEY     for the talker (Nemotron 3.5 Lightning)
# and optionally:
#   GCP_ZONE (us-central1-a)  VOICE_MACHINE_TYPE (c3-highcpu-4)  APP_URL (https://build-a-bot.site)
#   VOICE_HOST (default: <ip>.sslip.io, a hostname that needs no DNS setup)
#   IMAGE_TAG (the git commit)  SOURCE_IMAGE (an already-built local image to push; else it builds)
# `gce.sh --cpu-level` only prints the build the machine type needs (v3 or v4).
#
# What it makes, all named build-a-bot-voice*: an Artifact Registry repository, a static IP, a
# firewall rule for HTTPS, and a Container-Optimized OS VM running the server behind Caddy.
set -euo pipefail

MACHINE="${VOICE_MACHINE_TYPE:-c3-highcpu-4}"
# Intel Sapphire Rapids and newer (C3, C4, N4) get the AVX-512 + AMX build; anything else the AVX2 one.
case "$MACHINE" in
  c3-* | c4-* | n4-*) LEVEL=v4 ;;
  *) LEVEL=v3 ;;
esac
if [ "${1:-}" = --cpu-level ]; then
  echo "$LEVEL"
  exit 0
fi
# C4 and N4 boot only from Hyperdisk; C3 and older families take a balanced persistent disk.
case "$MACHINE" in
  c4-* | n4-*) DISK=hyperdisk-balanced ;;
  *) DISK=pd-balanced ;;
esac

: "${GCP_PROJECT:?set GCP_PROJECT}"
: "${VOICE_SERVER_SECRET:?set VOICE_SERVER_SECRET}"
: "${TOKEN_FACTORY_API_KEY:?set TOKEN_FACTORY_API_KEY}"
ZONE="${GCP_ZONE:-us-central1-a}"
REGION="${ZONE%-*}"
APP_URL="${APP_URL:-https://build-a-bot.site}"
NAME=build-a-bot-voice
TAG="${IMAGE_TAG:-manual-$(date +%s)}"
HERE="$(cd "$(dirname "$0")" && pwd)"
gc() { gcloud --project "$GCP_PROJECT" --quiet "$@"; }

if [ "${#VOICE_SERVER_SECRET}" -lt 32 ]; then
  echo "VOICE_SERVER_SECRET must be at least 32 characters" >&2
  exit 1
fi

echo "== APIs"
gc services enable compute.googleapis.com artifactregistry.googleapis.com

echo "== Image ($LEVEL)"
REPO="$REGION-docker.pkg.dev/$GCP_PROJECT/$NAME"
gc artifacts repositories describe "$NAME" --location "$REGION" >/dev/null 2>&1 ||
  gc artifacts repositories create "$NAME" --location "$REGION" --repository-format docker --description "Build-a-bot voice server images"
gcloud auth configure-docker "$REGION-docker.pkg.dev" --quiet
IMAGE="$REPO/voice:cpu-$LEVEL-$TAG"
if [ -n "${SOURCE_IMAGE:-}" ]; then
  BUILT="$(docker image inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$SOURCE_IMAGE" | sed -n 's/^CPU_LEVEL=//p')"
  if [ "$BUILT" != "$LEVEL" ]; then
    echo "$SOURCE_IMAGE is built for CPU level '$BUILT', but $MACHINE needs $LEVEL" >&2
    exit 1
  fi
  docker tag "$SOURCE_IMAGE" "$IMAGE"
else
  docker build -t "$IMAGE" --build-arg "CPU_LEVEL=$LEVEL" "$HERE/.."
fi
docker push "$IMAGE"
# The VM runs as the project's default compute service account, which only needs to pull this image.
VM_ACCOUNT="$(gc compute project-info describe --format 'value(defaultServiceAccount)')"
gc artifacts repositories add-iam-policy-binding "$NAME" --location "$REGION" \
  --member "serviceAccount:$VM_ACCOUNT" --role roles/artifactregistry.reader >/dev/null

echo "== Network"
gc compute addresses describe "$NAME-ip" --region "$REGION" >/dev/null 2>&1 ||
  gc compute addresses create "$NAME-ip" --region "$REGION"
IP="$(gc compute addresses describe "$NAME-ip" --region "$REGION" --format 'value(address)')"
HOST="${VOICE_HOST:-${IP//./-}.sslip.io}"
gc compute firewall-rules describe "$NAME-web" >/dev/null 2>&1 ||
  gc compute firewall-rules create "$NAME-web" --allow tcp:80,tcp:443 --target-tags "$NAME" --description "HTTPS (and the certificate challenge) for the voice server"

ENV_FILE="$(mktemp)"
trap 'rm -f "$ENV_FILE"' EXIT
chmod 600 "$ENV_FILE"
CORES="$(gc compute machine-types describe "$MACHINE" --zone "$ZONE" --format 'value(guestCpus)')"
# Magpie and its codec run at the same time, and the codec needs more of the CPU (measured on 4
# vCPUs: 2 + 2 is best). One call at a time by default: the engine speaks for one call at once, so
# a second caller would wait on the first (a second phone call gets the simpler line instead).
if [ "$CORES" -ge 8 ]; then TTS=3; elif [ "$CORES" -ge 4 ]; then TTS=2; else TTS=1; fi
CODEC=$(( CORES - TTS > 0 ? CORES - TTS : 1 ))
{
  echo "APP_URL=$APP_URL"
  echo "VOICE_SERVER_SECRET=$VOICE_SERVER_SECRET"
  echo "TOKEN_FACTORY_API_KEY=$TOKEN_FACTORY_API_KEY"
  echo "MAX_CALLS=${VOICE_MAX_CALLS:-1}"
  echo "TTS_THREADS=$TTS"
  echo "CODEC_THREADS=$CODEC"
} > "$ENV_FILE"

echo "== VM ($MACHINE in $ZONE)"
# The VM keeps nothing worth keeping (Caddy just gets a new certificate), so a new machine type
# replaces it.
VM="$(gc compute instances describe "$NAME" --zone "$ZONE" --format 'value(machineType.basename(),status)' 2>/dev/null || true)"
CURRENT="$(printf '%s' "$VM" | cut -f1)"
STATUS="$(printf '%s' "$VM" | cut -f2)"
if [ -n "$CURRENT" ] && [ "$CURRENT" != "$MACHINE" ]; then
  echo "Replacing the $CURRENT VM"
  gc compute instances delete "$NAME" --zone "$ZONE"
  CURRENT=""
fi
if [ -n "$CURRENT" ]; then
  gc compute instances add-metadata "$NAME" --zone "$ZONE" \
    --metadata "voice-image=$IMAGE,voice-host=$HOST" --metadata-from-file "voice-env=$ENV_FILE,user-data=$HERE/cloud-init.yaml"
  case "$STATUS" in
    TERMINATED | STOPPED | SUSPENDED)
      echo "The VM is stopped, so it stays stopped; it starts with this version next time:"
      echo "  gcloud compute instances start $NAME --zone $ZONE --project $GCP_PROJECT"
      exit 0
      ;;
  esac
  # A restart picks up the new image and settings (the app answers on its simpler line meanwhile).
  # Stop, then start: stopping shuts the VM down cleanly, so the server gets SIGTERM and ends each
  # call properly (a short goodbye, then its transcript and bill sent to the app). A reset would cut
  # every call off mid-word and leave it "active" in the app.
  gc compute instances stop "$NAME" --zone "$ZONE"
  gc compute instances start "$NAME" --zone "$ZONE"
else
  # Default access scopes: enough to pull the image and write logs, and nothing else in the project.
  if ! OUT="$(gc compute instances create "$NAME" --zone "$ZONE" --machine-type "$MACHINE" \
    --image-family cos-stable --image-project cos-cloud --boot-disk-size 30GB --boot-disk-type "$DISK" \
    --address "$IP" --tags "$NAME" \
    --metadata "voice-image=$IMAGE,voice-host=$HOST,google-logging-enabled=true" --metadata-from-file "voice-env=$ENV_FILE,user-data=$HERE/cloud-init.yaml" 2>&1)"; then
    echo "$OUT" >&2
    if grep -qi "quota" <<<"$OUT"; then
      echo "Not enough CPU quota for a $MACHINE ($CORES vCPUs). Google Cloud's free trial allows 8 vCPUs running at once across the account: stop another VM, or set VOICE_MACHINE_TYPE to a smaller machine." >&2
    fi
    exit 1
  fi
  echo "$OUT"
fi

echo "== Waiting for https://$HOST/health"
for i in $(seq 1 90); do
  if HEALTH="$(curl -sf "https://$HOST/health" 2>/dev/null)"; then
    echo "$HEALTH"
    echo "Voice server is up at https://$HOST"
    echo "In Vercel, set VOICE_SERVER_URL=https://$HOST (and VOICE_SERVER_SECRET to the same secret)."
    # In GitHub Actions, the live call check (live-call.yml) runs next.
    if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "up=true" >> "$GITHUB_OUTPUT"; fi
    # How fast this machine makes speech (seconds of audio a second). Under 1, each sentence waits a
    # little before it plays so it doesn't stutter, and answers start later.
    RATE="$(sed -n 's/.*"speechRate":\([0-9.]*\).*/\1/p' <<<"$HEALTH")"
    if [ -n "$RATE" ] && awk "BEGIN { exit !($RATE < 0.95) }"; then
      echo "::warning::This $MACHINE makes speech at ${RATE}x real time, so answers start late. An 8-vCPU machine (VOICE_MACHINE_TYPE=c3-highcpu-8) is about twice as fast."
    fi
    exit 0
  fi
  sleep 10
done
echo "The voice server didn't answer at https://$HOST/health within 15 minutes." >&2
echo "Its log: gcloud compute ssh $NAME --zone $ZONE --project $GCP_PROJECT -- sudo journalctl -u voice -u caddy -n 200" >&2
exit 1
