#!/usr/bin/env bash
# Deploy cc-playground (Deployment + Service + Route) to the cc-playground
# namespace. Build the image first with ./build.sh.
set -euo pipefail

NS=cc-playground
cd "$(dirname "$0")"

oc get ns "$NS" >/dev/null 2>&1 || oc create namespace "$NS"
oc apply -f k8s/

HOST=$(oc get route cc-playground -n "$NS" -o jsonpath='{.spec.host}' 2>/dev/null || true)

cat <<EOF

Deployed to namespace '$NS'.

1) Set the initdata your Trustee admin shared (Confidential Attestation →
   TrusteeConfig → Initdata → Share), then it rolls out automatically:

   oc -n $NS patch deploy/cc-playground --type=json \\
     -p='[{"op":"replace","path":"/spec/template/metadata/annotations/io.katacontainers.config.hypervisor.cc_init_data","value":"PASTE_INITDATA_HERE"}]'

2) Open the page:

   https://${HOST:-<route not ready yet: oc get route cc-playground -n $NS>}
EOF
