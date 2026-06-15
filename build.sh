#!/usr/bin/env bash
# Build the cc-playground image in-cluster (binary build — no Git remote needed)
# and push it to the OpenShift internal registry. Run against the cluster that
# has your confidential (TEE) node.
set -euo pipefail

NS=cc-playground
NAME=cc-playground
cd "$(dirname "$0")"

echo "Cluster: $(oc whoami --show-server)"
oc get ns "$NS" >/dev/null 2>&1 || oc create namespace "$NS"

# Create the BuildConfig + ImageStream once (Docker strategy, binary source).
if ! oc get bc "$NAME" -n "$NS" >/dev/null 2>&1; then
  oc new-build --name "$NAME" --binary --strategy docker -n "$NS"
fi

# Upload this directory (Dockerfile + html/ + nginx/ + entrypoint) and build.
oc start-build "$NAME" -n "$NS" --from-dir=. --follow

echo
echo "Built: image-registry.openshift-image-registry.svc:5000/$NS/$NAME:latest"
echo "Next:  ./deploy.sh"
