# cc-playground

A tiny **confidential-computing self-introspection dashboard**. It runs *inside*
a confidential container (OpenShift sandboxed containers / CoCo, `kata-cc`
runtime) and serves — via **nginx** — a page that shows what the workload can
prove about its own protected execution and attestation.

It answers, from the workload's own point of view:

| Card | Shows | Where it comes from |
| --- | --- | --- |
| **Workload** | pod, namespace, UID, image, service account, runtime class | Kubernetes downward API (env) |
| **Node & TEE** | node, **Intel TDX / AMD SEV-SNP**, CPU, vCPUs, encrypted memory, guest kernel | `/proc/cpuinfo` + downward API, read at container start |
| **How it's attested** | the evidence → KBS → verify → release flow, lit up to your actual state | live probe of the in-guest CDH |
| **Secret released by attestation** | a KBS resource and its released value | in-guest Confidential Data Hub (`127.0.0.1:8006`) |
| **Attestation service** | the Trustee / KBS endpoint and reachability | initdata + live probe |
| **Attestation report** | decoded EAR token claims, when the CDH exposes them | in-guest CDH (best-effort) |

## How it works

```
   browser ──TLS──► Route ──► Service ──► ┌─────────── confidential guest (TEE) ───────────┐
                                          │  nginx :8080                                    │
                                          │   ├─ /            static dashboard (html/)       │
                                          │   ├─ /info.json   workload+TEE facts (entrypoint)│
                                          │   └─ /cdh/  ─proxy─► 127.0.0.1:8006  (CDH)        │
                                          │                         │                        │
                                          │            attestation-agent ──► Trustee / KBS   │
                                          └─────────────────────────────────────────────────┘
```

The trick: a browser can't reach the guest's `127.0.0.1:8006`, but **nginx runs
inside the TEE guest**, so it proxies the Confidential Data Hub same-origin. The
CDH only returns a resource after the KBS has verified the guest's TEE evidence —
so a successful fetch is **cryptographic proof that this workload attested**. The
dashboard maps the CDH's response to a verdict:

- **200** → attested, secret released (shown).
- **404** → attested (request was authorized) but no resource at that path.
- **401 / 403** → evidence rejected — measurement not in the reference values, or a policy denied it.
- **no response** → not a confidential pod, or the CDH isn't running.

Two facts are gathered at container start by [`docker-entrypoint.d/40-cc-info.sh`](docker-entrypoint.d/40-cc-info.sh)
and written to `/tmp/cc-info.json` (TEE is detected from the `tdx_guest` CPU flag
/ `sev-guest` device — no privileged access needed).

## Prerequisites

- An OpenShift cluster with a **confidential node** and the `kata-cc` RuntimeClass
  (OpenShift sandboxed containers + CoCo operator).
- **Trustee** reachable (co-located or hub-and-spoke), with a demo resource —
  this repo defaults to `default/kbsres1/key1` (a secret named `kbsres1` with a
  `key1` data key, listed in the KbsConfig `kbsSecretResources`).
- **Initdata** for the workload, generated and shared from the Trustee plugin
  (Confidential Attestation → TrusteeConfig → **Initdata** → *Add to reference
  values* + *Share*). Its PCR8 must be in the reference values or attestation will
  be denied.

## Build & deploy

Run against the cluster with your TEE node:

```bash
./build.sh     # in-cluster binary build → internal registry (no Git remote needed)
./deploy.sh    # Deployment + Service + Route in the cc-playground namespace
```

Then paste the initdata and open the route (both commands are printed by
`deploy.sh`):

```bash
oc -n cc-playground patch deploy/cc-playground --type=json \
  -p='[{"op":"replace","path":"/spec/template/metadata/annotations/io.katacontainers.config.hypervisor.cc_init_data","value":"PASTE_INITDATA"}]'

oc get route cc-playground -n cc-playground -o jsonpath='{.spec.host}'
```

## Configure

Set on the container (see [`k8s/deployment.yaml`](k8s/deployment.yaml)):

- `CDH_RESOURCE_PATH` — the KBS resource to fetch as proof. Always
  `<repository>/<name>/<key>` (three segments). Default `default/kbsres1/key1`.
- `KBS_URL` — informational only (the real endpoint lives in the initdata).

## Notes

- The image is `nginx-unprivileged` (non-root, port 8080) — ~20 MB, so it fits a
  confidential micro-VM and runs unmodified under OpenShift's restricted SCC.
- TEE detection reads `/proc/cpuinfo`; if your guest doesn't surface the flag the
  badge falls back to "none detected" while everything else still works.
- The raw EAR attestation token is held by the in-guest attestation agent and is
  not exposed by every CDH build; when it isn't, the **secret release is the
  proof**. A backend that calls the attestation agent directly is a natural next
  step.

## Layout

```
html/                     static dashboard (index.html, styles.css, app.js)
nginx/default.conf        serve frontend + /info.json + reverse-proxy /cdh/
docker-entrypoint.d/      40-cc-info.sh — detect TEE, emit /tmp/cc-info.json
Dockerfile                nginx-unprivileged + the above
k8s/                      deployment.yaml (confidential), service.yaml, route.yaml
build.sh / deploy.sh      in-cluster build + apply
```
