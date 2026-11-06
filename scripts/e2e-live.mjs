/**
 * End-to-end check against the deployed Catalyst backend and the real Aiven database.
 *
 * Not a unit test: every call here crosses the public internet, terminates TLS at
 * Catalyst, and writes to the same Postgres the app uses. It exists to answer one
 * question the unit suite cannot — does the deployed thing actually work.
 */

const BASE = process.env.API_URL;
const WORKER_SECRET = process.env.WORKER_TRIGGER_SECRET ?? '';
const stamp = Date.now();

let passed = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function call(path, { token, method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }
  return { status: response.status, body: json, text };
}

async function signUp(label) {
  const email = `e2e-${stamp}-${label}@example.com`;
  const password = 'a-sufficiently-long-password';
  const r = await call('/auth/sign-up', {
    method: 'POST',
    body: { email, password, displayName: label, timezone: 'Asia/Kolkata' },
  });
  return { email, password, token: r.body?.accessToken, refreshToken: r.body?.refreshToken, status: r.status };
}

console.log(`\nTarget: ${BASE}\n`);

// ---------------------------------------------------------------- liveness
console.log('Liveness');
{
  const r = await call('/health');
  check('GET /health is 200', r.status === 200 && r.body?.ok === true, `status ${r.status}`);
  const missing = await call('/definitely-not-a-route');
  check('unknown route is a shaped 404', missing.status === 404 && missing.body?.error?.code === 'not_found');
}

// ---------------------------------------------------------------- accounts
console.log('\nAccounts and sessions');
const asha = await signUp('asha');
const ravi = await signUp('ravi');
const nosy = await signUp('nosy');
check('sign-up returns a token', Boolean(asha.token) && Boolean(ravi.token), `status ${asha.status}`);
check('sign-up persists to Aiven (3 distinct accounts)', new Set([asha.token, ravi.token, nosy.token]).size === 3);

{
  const dup = await call('/auth/sign-up', {
    method: 'POST',
    body: { email: asha.email, password: 'a-sufficiently-long-password', displayName: 'dupe', timezone: 'Asia/Kolkata' },
  });
  check('duplicate email is refused', dup.status === 409 || dup.status === 400, `status ${dup.status}`);

  const signIn = await call('/auth/sign-in', { method: 'POST', body: { email: asha.email, password: asha.password } });
  check('sign-in works', signIn.status === 200 && Boolean(signIn.body?.accessToken), `status ${signIn.status}`);

  const wrong = await call('/auth/sign-in', { method: 'POST', body: { email: asha.email, password: 'wrong-password-entirely' } });
  check('wrong password is rejected', wrong.status === 401, `status ${wrong.status}`);

  const me = await call('/v1/me', { token: asha.token });
  check('GET /v1/me returns the session', me.status === 200 && me.body?.session?.email === asha.email);

  const anon = await call('/v1/me');
  check('no token is 401', anon.status === 401);

  const garbage = await call('/v1/me', { token: 'not.a.real.token' });
  check('forged token is 401', garbage.status === 401);

  if (asha.refreshToken) {
    const refreshed = await call('/auth/refresh', { method: 'POST', body: { refreshToken: asha.refreshToken } });
    check('refresh token rotates', refreshed.status === 200 && Boolean(refreshed.body?.accessToken), `status ${refreshed.status}`);
    const replay = await call('/auth/refresh', { method: 'POST', body: { refreshToken: asha.refreshToken } });
    check('replaying a rotated refresh token is refused', replay.status === 401, `status ${replay.status}`);
  }
}

// ---------------------------------------------------------------- profile
console.log('\nProfile');
{
  const before = await call('/v1/profile', { token: asha.token });
  check('GET /v1/profile is 200', before.status === 200, `status ${before.status}`);
  const renamed = await call('/v1/profile', { method: 'PATCH', token: asha.token, body: { displayName: 'Asha Renamed' } });
  check('PATCH /v1/profile saves', renamed.status === 200, `status ${renamed.status}`);
  const after = await call('/v1/profile', { token: asha.token });
  check('the rename persisted', JSON.stringify(after.body).includes('Asha Renamed'));
}

// ------------------------------------------------- connections (friend request)
console.log('\nFriend requests');
let connectionId = null;
{
  const invite = await call('/v1/connections', { method: 'POST', token: asha.token, body: { email: ravi.email } });
  connectionId = invite.body?.connection?.id ?? null;
  check('A invites B', invite.status === 200 || invite.status === 201, `status ${invite.status}`);
  check('the invitation has an id', Boolean(connectionId));

  const pendingForB = await call('/v1/connections', { token: ravi.token });
  check('B sees the pending invitation', JSON.stringify(pendingForB.body).includes(connectionId ?? 'x'));

  const stranger = await call(`/v1/connections/${connectionId}`, { token: nosy.token });
  check('an unrelated user cannot read it (404, not 403)', stranger.status === 404, `status ${stranger.status}`);

  const hijack = await call(`/v1/connections/${connectionId}/respond`, { method: 'POST', token: nosy.token, body: { accept: true } });
  check('an unrelated user cannot accept it', hijack.status === 404 || hijack.status === 403, `status ${hijack.status}`);

  const accept = await call(`/v1/connections/${connectionId}/respond`, { method: 'POST', token: ravi.token, body: { accept: true } });
  check('B accepts', accept.status === 200, `status ${accept.status}`);

  const listA = await call('/v1/connections', { token: asha.token });
  check('A now sees an accepted connection', JSON.stringify(listA.body).includes('accepted'));
}

// ---------------------------------------------------------------- chat
console.log('\nChat');
let threadId = null;
{
  const threads = await call('/v1/chat/threads', { token: asha.token });
  threadId = threads.body?.threads?.[0]?.id ?? null;
  check('accepting a connection created a thread', Boolean(threadId), `status ${threads.status}`);

  if (threadId) {
    const sent = await call(`/v1/chat/threads/${threadId}/messages`, {
      method: 'POST', token: asha.token, body: { body: 'Are you up?' },
    });
    check('A sends a message', sent.status === 201, `status ${sent.status}`);

    const readByB = await call(`/v1/chat/threads/${threadId}/messages`, { token: ravi.token });
    check('B reads it', JSON.stringify(readByB.body).includes('Are you up?'));

    const snoop = await call(`/v1/chat/threads/${threadId}/messages`, { token: nosy.token });
    check('an outsider cannot read the thread', snoop.status === 404, `status ${snoop.status}`);
  }
}

// ---------------------------------------------------------------- commitments
console.log('\nCommitments');
let commitmentId = null;
{
  const created = await call('/v1/commitments', {
    method: 'POST', token: asha.token,
    body: { title: 'Morning lecture', startsAt: new Date(Date.now() + 86_400_000).toISOString() },
  });
  commitmentId = created.body?.commitment?.id ?? null;
  check('create a commitment', created.status === 201 || created.status === 200, `status ${created.status}`);

  const list = await call('/v1/commitments', { token: asha.token });
  check('it appears in the list', JSON.stringify(list.body).includes('Morning lecture'));

  const foreign = await call(`/v1/commitments/${commitmentId}`, { token: nosy.token });
  check("another user cannot read it", foreign.status === 404, `status ${foreign.status}`);
}

// ---------------------------------------------------------------- alarms
console.log('\nWake plans (the alarm itself)');
let planId = null;
{
  const plan = await call('/v1/wake-plans', {
    method: 'POST', token: asha.token,
    body: { scheduleType: 'daily', localTime: '07:00', timezone: 'Asia/Kolkata', difficulty: 'medium', graceMinutes: 15 },
  });
  planId = plan.body?.plan?.id ?? plan.body?.wakePlan?.id ?? null;
  check('create a daily 07:00 alarm', plan.status === 201 || plan.status === 200, `status ${plan.status}`);

  const list = await call('/v1/wake-plans', { token: asha.token });
  check('the alarm is listed', JSON.stringify(list.body).includes('07:00'), `status ${list.status}`);

  if (planId) {
    const paused = await call(`/v1/wake-plans/${planId}/active`, { method: 'POST', token: asha.token, body: { active: false } });
    check('the alarm can be switched off', paused.status === 200, `status ${paused.status}`);
    const resumed = await call(`/v1/wake-plans/${planId}/active`, { method: 'POST', token: asha.token, body: { active: true } });
    check('and back on', resumed.status === 200, `status ${resumed.status}`);

    const badTime = await call('/v1/wake-plans', {
      method: 'POST', token: asha.token,
      body: { scheduleType: 'daily', localTime: '25:99', timezone: 'Asia/Kolkata' },
    });
    check('an impossible time is rejected', badTime.status === 400, `status ${badTime.status}`);

    const foreign = await call(`/v1/wake-plans/${planId}`, { method: 'PATCH', token: nosy.token, body: { localTime: '03:00' } });
    check('another user cannot edit your alarm', foreign.status === 404, `status ${foreign.status}`);
  }

  const occurrences = await call('/v1/wake-occurrences', { token: asha.token });
  check('wake occurrences endpoint responds', occurrences.status === 200, `status ${occurrences.status}`);
}

// ---------------------------------------------------------------- devices
console.log('\nDevice registration');
{
  const reg = await call('/v1/device-tokens', {
    method: 'POST', token: asha.token, body: { token: `e2e-token-${stamp}`, platform: 'android' },
  });
  check('a device token can still be registered', reg.status === 200 || reg.status === 201, `status ${reg.status}`);
}

// ---------------------------------------------------------------- uploads
console.log('\nMedia (known gap)');
{
  const presign = await call('/v1/uploads', {
    method: 'POST', token: asha.token, body: { kind: 'profile-photo', contentType: 'image/jpeg' },
  });
  check('uploads answer 503, not a vendor crash', presign.status === 503, `status ${presign.status}`);
}

// ---------------------------------------------------------------- worker
console.log('\nScheduled worker');
{
  const noSecret = await call('/internal/run-worker', { method: 'POST' });
  check('worker route hidden without the secret', noSecret.status === 404, `status ${noSecret.status}`);

  const wrong = await call('/internal/run-worker', { method: 'POST', headers: { 'X-Worker-Secret': 'wrong' } });
  check('a wrong secret gets the same 404', wrong.status === 404, `status ${wrong.status}`);

  if (WORKER_SECRET) {
    const run = await call('/internal/run-worker', { method: 'POST', headers: { 'X-Worker-Secret': WORKER_SECRET } });
    check('the worker runs with the right secret', run.status === 200 && run.body?.ok === true, `status ${run.status}`);
    if (run.body) console.log(`        report: ${JSON.stringify(run.body)}`);
  } else {
    console.log('  SKIP  worker run (no WORKER_TRIGGER_SECRET in env)');
  }
}

console.log(`\n${'='.repeat(60)}`);
console.log(`${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
