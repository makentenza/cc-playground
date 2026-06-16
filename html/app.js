// cc-playground — runs in the browser, but every byte it shows comes from
// inside the confidential guest: /info.json (workload + TEE facts written at
// container start) and /cdh/* (the in-guest Confidential Data Hub, reachable
// only because nginx is inside the TEE and proxies it same-origin).

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));

const FLOW_BY_STATE = {
  attested: ['evidence', 'kbs', 'verify', 'release'],
  'attested-missing': ['evidence', 'kbs', 'verify'],
  denied: ['evidence', 'kbs'],
  unreachable: [],
  inconclusive: ['evidence'],
};

function setText(key, val) {
  const has = val !== undefined && val !== null && String(val).trim() !== '';
  $$(`[data-k="${key}"]`).forEach((el) => {
    el.textContent = has ? val : '—';
  });
}

function setPill(kind, text) {
  const pill = $('#status-pill');
  pill.className = 'pill ' + (kind === 'ok' ? 'pill--ok' : kind === 'bad' ? 'pill--bad' : 'pill--pending');
  $('#status-text').textContent = text;
}

function lightFlow(stateKey) {
  const on = new Set(FLOW_BY_STATE[stateKey] || []);
  $$('#flow .flow__step').forEach((el) => {
    el.classList.toggle('is-on', on.has(el.dataset.step));
  });
}

function renderInfo(info) {
  [
    'pod', 'namespace', 'uid', 'podIP', 'serviceAccount', 'image', 'runtimeClass',
    'node', 'cpu', 'cores', 'memoryGiB', 'kernel', 'resourcePath',
  ].forEach((k) => setText(k, info[k]));

  setText('kbsUrl', info.kbsUrl || '(carried in the workload initdata)');

  const badge = $('#tee-badge');
  const tee = String(info.tee || '').toLowerCase();
  badge.classList.toggle('tee--unknown', !(tee.includes('tdx') || tee.includes('sev')));

  $('#foot-generated').textContent = info.generatedAt ? `snapshot ${info.generatedAt}` : '';
}

// Fetch the workload + TEE self-report the container wrote at startup, served by
// nginx from inside the guest at /info.json. Throws if it isn't reachable (then the
// caller falls back to the demo state).
async function loadInfo() {
  const res = await fetch('/info.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('info.json HTTP ' + res.status);
  return res.json();
}

// Decode a JWT (EAR token) payload without verifying — for display only.
function decodeJwt(token) {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(
      atob(b64)
        .split('')
        .map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
        .join(''),
    );
    return JSON.parse(json);
  } catch (_) {
    return null;
  }
}

function applyState(state, opts = {}) {
  lightFlow(state);
  const secretStatus = $('#secret-status');
  const secretWrap = $('#secret-value-wrap');
  const secretNote = $('#secret-note');
  const kbsReach = $('#kbs-reach');
  const explain = $('#attest-explain');
  secretWrap.classList.add('hidden');

  switch (state) {
    case 'attested':
      setPill('ok', 'Attested · secret released');
      secretStatus.innerHTML = '<span class="tag tag--ok">200 · released</span>';
      kbsReach.innerHTML = '<span class="tag tag--ok">reachable · evidence accepted</span>';
      explain.textContent =
        'This guest presented valid TEE evidence, Trustee verified it against the reference values, and the KBS released the sealed secret below. That release is cryptographic proof of attestation.';
      if (opts.secret !== undefined) {
        secretWrap.classList.remove('hidden');
        $('#secret-value').textContent = opts.secret.length > 4000 ? opts.secret.slice(0, 4000) + '…' : opts.secret || '(empty)';
      }
      break;
    case 'demo':
      // Sample data — never claim a real attestation result.
      setPill('pending', 'Demo data · not a live workload');
      secretStatus.innerHTML = '<span class="tag tag--warn">sample</span>';
      kbsReach.innerHTML = '<span class="tag tag--warn">sample</span>';
      explain.textContent =
        'These are sample values shown because no in-guest backend was reachable. Deploy on a confidential (kata-cc) node to see your live workload and a real attestation result.';
      if (opts.secret !== undefined) {
        secretWrap.classList.remove('hidden');
        $('#secret-value').textContent = '(sample) ' + opts.secret;
      }
      break;
    case 'attested-missing':
      setPill('ok', 'Attested · resource not found');
      secretStatus.innerHTML = '<span class="tag tag--warn">404 · no such resource</span>';
      kbsReach.innerHTML = '<span class="tag tag--ok">reachable · evidence accepted</span>';
      secretNote.textContent = `Attestation succeeded (the request got past the KBS auth), but no resource exists at "${opts.path}". Point CDH_RESOURCE_PATH at a real <repository>/<name>/<key>.`;
      explain.textContent =
        'Attestation succeeded — the request was authorized — but the demo resource path does not exist. KBS resources are always <repository>/<name>/<key>.';
      break;
    case 'denied':
      setPill('bad', 'Attestation failed');
      secretStatus.innerHTML = `<span class="tag tag--bad">${opts.status} · denied</span>`;
      kbsReach.innerHTML = '<span class="tag tag--bad">reachable · evidence rejected</span>';
      explain.textContent =
        'The KBS was reached but refused to release secrets: the TEE evidence was not trusted. Usually the guest measurement (e.g. the initdata PCR8) is not in the reference values, or an attestation policy rejected it.';
      break;
    case 'unreachable':
      setPill('bad', 'Confidential Data Hub unreachable');
      secretStatus.innerHTML = '<span class="tag tag--bad">no CDH</span>';
      kbsReach.innerHTML = '<span class="tag">unknown</span>';
      explain.textContent =
        'Could not reach the in-guest Confidential Data Hub at 127.0.0.1:8006. Either this pod is not a confidential (kata-cc) workload, or the CDH is not running — so there is no attestation pipeline to query.';
      break;
    default:
      setPill('pending', `Inconclusive${opts.status ? ' · HTTP ' + opts.status : ''}`);
      secretStatus.innerHTML = `<span class="tag tag--warn">${opts.status || '?'}</span>`;
      kbsReach.innerHTML = '<span class="tag tag--warn">unexpected response</span>';
      explain.textContent = 'The CDH returned an unexpected status. See the secret card for the code.';
  }
}

async function probeAttestation(info) {
  const path = info.resourcePath || 'default/kbsres1/key1';
  let res;
  try {
    res = await fetch('/cdh/resource/' + path, { cache: 'no-store' });
  } catch (e) {
    applyState('unreachable', { detail: String(e) });
    return;
  }
  if (res.ok) {
    applyState('attested', { secret: await res.text(), path });
  } else if (res.status === 404) {
    applyState('attested-missing', { path });
  } else if (res.status === 401 || res.status === 403) {
    applyState('denied', { status: res.status });
  } else if (res.status === 502 || res.status === 503 || res.status === 504) {
    applyState('unreachable', { status: res.status });
  } else {
    applyState('inconclusive', { status: res.status });
  }
}

// Best-effort: some CDH builds expose the raw attestation (EAR) token. If one
// does, decode and show its claims; otherwise explain that secret release is
// the proof and the token lives with the in-guest attestation agent.
async function loadReport() {
  const note = $('#report-note');
  for (const url of ['/cdh/token', '/cdh/attestation-token', '/aa/token']) {
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) continue;
      const body = (await r.text()).trim();
      const claims = decodeJwt(body) || (body.startsWith('{') ? JSON.parse(body) : null);
      if (claims) {
        note.classList.add('hidden');
        $('#report-claims').classList.remove('hidden');
        $('#report-json').textContent = JSON.stringify(claims, null, 2);
        return;
      }
    } catch (_) {
      /* try next */
    }
  }
  note.textContent =
    'No attestation-token endpoint is exposed by this CDH build. The raw EAR token is held by the in-guest attestation agent; in this demo the successful secret release (above) is the verifiable proof that attestation passed.';
}

// Sample values used only when no in-guest backend is reachable (static preview
// or local dev) — clearly flagged with the demo banner so it's never mistaken
// for a live workload.
const DEMO_INFO = {
  pod: 'cc-playground-7d9f8c6b5-x2k4p',
  namespace: 'cc-playground',
  uid: 'dd77f9bd-5065-4dde-a2e1-f2366f57f574',
  podIP: '10.130.2.55',
  serviceAccount: 'default',
  image: 'cc-playground',
  runtimeClass: 'kata-cc',
  node: 'mentenza-kata-cc-cc-tdx-metal-b-dlfjr',
  tee: 'Intel TDX',
  cpu: 'Intel(R) Xeon(R) Platinum 8592+ (TDX)',
  cores: '8',
  memoryGiB: '15.3',
  kernel: '5.14.0-427.el9.x86_64',
  resourcePath: 'default/kbsres1/key1',
  kbsUrl: 'https://kbs-route-trustee-operator-system.apps.example.gcp.devcluster.openshift.com',
  generatedAt: '(demo)',
};

const DEMO_CLAIMS = {
  eat_profile: 'tag:github.com,2024:veraison/ear',
  'ear.verifier-id': { developer: 'https://confidentialcontainers.org', build: 'trustee' },
  'submods.cpu.ear.status': 'affirming',
  'submods.cpu.ear.trustworthiness-vector': { 'instance-identity': 2, executables: 2, hardware: 2 },
  'submods.cpu.ear.veraison.annotated-evidence': {
    tee: 'tdx',
    'tdx.mrtd': 'b9b6e1…3f7a (firmware measurement)',
    'tdx.rtmr3': '4c5f0140…2952c12e (initdata, PCR8)',
  },
};

function enterDemoMode() {
  $('#demo-banner').classList.remove('hidden');
  renderInfo(DEMO_INFO);
  // Honest demo state — do NOT show a green "Attested · secret released" badge.
  applyState('demo', { secret: 'super-secret-value-for-key1', path: DEMO_INFO.resourcePath });
  $('#report-note').classList.add('hidden');
  $('#report-claims').classList.remove('hidden');
  $('#report-json').textContent = JSON.stringify(DEMO_CLAIMS, null, 2);
}

async function refresh() {
  setPill('pending', 'Checking attestation…');
  $('#demo-banner').classList.add('hidden');
  // Retry /info.json before falling back to demo, so a transient blip (pod
  // reschedule, node reboot) doesn't masquerade as "not a confidential workload".
  let info;
  for (let attempt = 0; attempt < 4 && !info; attempt++) {
    try {
      info = await loadInfo();
    } catch (_) {
      if (attempt < 3) await new Promise((r) => setTimeout(r, 800));
    }
  }
  if (!info) {
    // No /info.json after retries — not inside the guest (static preview / blip).
    enterDemoMode();
    return;
  }
  renderInfo(info);
  await probeAttestation(info);
  loadReport();
}

$('#refresh').addEventListener('click', refresh);
refresh();
