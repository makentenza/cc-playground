#!/bin/sh
# ---------------------------------------------------------------------------
# cc-playground — gather what the workload can see about its own confidential
# context, at container start, and write it as JSON for the frontend.
#
# The stock nginx image's entrypoint sources every /docker-entrypoint.d/*.sh
# before launching nginx, so this runs once per pod start. Output goes to /tmp
# (always writable, even under OpenShift's arbitrary UID) and nginx serves it
# at /info.json.
# ---------------------------------------------------------------------------
set -eu

OUT=/tmp/cc-info.json

# Detect the hardware TEE from inside the guest. The TDX guest exposes the
# `tdx_guest` CPU flag; SEV-SNP exposes the /dev/sev-guest device. We avoid
# needing privileged device access by reading /proc/cpuinfo first.
detect_tee() {
  if grep -qw tdx_guest /proc/cpuinfo 2>/dev/null || [ -e /dev/tdx_guest ] || [ -e /sys/firmware/tdx ]; then
    echo "Intel TDX"; return
  fi
  if [ -e /dev/sev-guest ] || grep -qiw sev_snp /proc/cpuinfo 2>/dev/null; then
    echo "AMD SEV-SNP"; return
  fi
  echo "none detected"
}

CPU=$(grep -m1 'model name' /proc/cpuinfo 2>/dev/null | cut -d: -f2- | sed 's/^[[:space:]]*//')
CORES=$(grep -c '^processor' /proc/cpuinfo 2>/dev/null || echo "?")
KERNEL=$(uname -r 2>/dev/null || echo "unknown")
TEE=$(detect_tee)
MEMG=$(awk '/MemTotal/ {printf "%.1f", $2/1024/1024}' /proc/meminfo 2>/dev/null || echo "?")

# JSON-escape a value (backslashes and double quotes).
esc() { printf '%s' "${1:-}" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }

cat > "$OUT" <<EOF
{
  "pod": "$(esc "${POD_NAME:-}")",
  "namespace": "$(esc "${POD_NAMESPACE:-}")",
  "uid": "$(esc "${POD_UID:-}")",
  "node": "$(esc "${NODE_NAME:-}")",
  "podIP": "$(esc "${POD_IP:-}")",
  "serviceAccount": "$(esc "${SERVICE_ACCOUNT:-}")",
  "image": "$(esc "${WORKLOAD_IMAGE:-}")",
  "runtimeClass": "$(esc "${RUNTIME_CLASS:-}")",
  "tee": "$(esc "$TEE")",
  "cpu": "$(esc "$CPU")",
  "cores": "$(esc "$CORES")",
  "kernel": "$(esc "$KERNEL")",
  "memoryGiB": "$(esc "$MEMG")",
  "kbsUrl": "$(esc "${KBS_URL:-}")",
  "resourcePath": "$(esc "${CDH_RESOURCE_PATH:-default/kbsres1/key1}")",
  "generatedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo "")"
}
EOF

echo "cc-playground: wrote $OUT (tee=${TEE})"
