// PC·휴대폰 동기화
// - 로그인: Firebase Authentication (이메일·비밀번호). 가입은 Firebase에서 막아 두고 내 계정만 쓴다.
// - 보관: Cloud Firestore의 users/{내 uid}/blobs/ 아래에 'core'(일지 말고 나머지 전부)와
//   'entries-YYYY-MM'(그달 일지) 문서로 나눠 저장한다.
// - 암호화: 로그인 비밀번호로 만든 열쇠(PBKDF2 → AES-GCM)로 이 기기에서 잠근 뒤에만 올린다.
//   보관소에는 알아볼 수 없는 글자만 남고, 비밀번호 자체는 어디에도 저장하지 않는다.
// - 합치기: 일지·스탯·스킬·뽑기는 id 단위로 합치고, 이름·방·집중 목표처럼 값이 하나뿐인 것은
//   나중에 바꾼 쪽을 따른다. 지운 것은 '지운 표시(tombstone)'로 다른 기기에도 전한다.

window.LM = window.LM || {};

(function (LM) {
  class SyncError extends Error {
    constructor(kind, message) {
      super(message);
      this.kind = kind; // offline | auth | relogin | crypto | crypto-mismatch | conflict | denied | nodb | other
    }
  }
  LM.SyncError = SyncError;

  const clone = (x) => JSON.parse(JSON.stringify(x));
  const byCreated = (a, b) => a.createdAt.localeCompare(b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const TOMB_KINDS = ['entries', 'stats', 'skills'];

  // ---------- 동기화용 표시 ----------

  LM.ensureSyncMeta = (s) => {
    s.stamps = s.stamps || {};
    s.tombstones = s.tombstones || {};
    TOMB_KINDS.forEach((k) => { s.tombstones[k] = s.tombstones[k] || {}; });
    return s;
  };

  // 지운 것을 다른 기기에도 알리기 위한 표시
  LM.tomb = (s, kind, id) => {
    LM.ensureSyncMeta(s);
    s.tombstones[kind][id] = Date.now();
  };

  // 값이 하나뿐인 항목은 언제 바뀌었는지 기록해 두고, 합칠 때 더 나중 것을 쓴다.
  const SECTIONS = {
    character: (s) => s.character,
    room: (s) => s.room,
    focus: (s) => s.quests.focus,
    prefs: (s) => s.settings.dayStartHour,
  };
  const periodSig = (p) => JSON.stringify([p.active.map((q) => q.id), p.spare.map((q) => q.id), !!p.received]);
  const takeSnap = (s) => ({
    sec: Object.fromEntries(Object.entries(SECTIONS).map(([k, f]) => [k, JSON.stringify(f(s))])),
    per: Object.fromEntries(Object.entries(s.quests.periods).map(([id, p]) => [id, periodSig(p)])),
  });
  let snap = null;

  LM.syncSnap = (s) => { snap = s ? takeSnap(s) : null; };

  LM.syncTrack = (s) => {
    LM.ensureSyncMeta(s);
    const cur = takeSnap(s);
    const now = Date.now();
    if (snap) {
      Object.keys(SECTIONS).forEach((k) => { if (cur.sec[k] !== snap.sec[k]) s.stamps[k] = now; });
      Object.entries(cur.per).forEach(([id, sig]) => { if (sig !== snap.per[id]) s.quests.periods[id].updatedAt = now; });
    }
    snap = cur;
  };

  // ---------- 나누기·모으기 ----------

  const monthId = (e) => `entries-${e.gameDate.slice(0, 7)}`;

  // 상태를 보관소 문서 단위로 나눈다. knownIds에 있는 달은 일지가 없어도 빈 문서로 둔다.
  LM.splitState = (s, knownIds) => {
    const parts = {
      core: {
        version: s.version,
        createdAt: s.createdAt,
        character: s.character,
        stats: s.stats,
        skills: s.skills,
        quests: s.quests,
        gacha: s.gacha,
        room: s.room,
        settings: { dayStartHour: s.settings.dayStartHour, lastBackupAt: s.settings.lastBackupAt },
        stamps: s.stamps || {},
        tombstones: s.tombstones || {},
      },
    };
    (knownIds || []).forEach((id) => { if (id.startsWith('entries-')) parts[id] = { entries: [] }; });
    s.entries.forEach((e) => {
      const id = monthId(e);
      (parts[id] = parts[id] || { entries: [] }).entries.push(e);
    });
    return parts;
  };

  // 보관소 문서들로 상태를 다시 만든다. (AI 설정은 기기마다 따로라 들어 있지 않다.)
  LM.assembleState = (parts) => {
    const core = clone(parts.core);
    LM.ensureSyncMeta(core);
    const entries = Object.entries(parts)
      .filter(([id]) => id !== 'core')
      .flatMap(([, p]) => clone(p.entries || []))
      .filter((e) => !core.tombstones.entries[e.id])
      .sort(byCreated);
    return { ...core, settings: { ...core.settings }, entries };
  };

  // ---------- 합치기 ----------

  const judgedRank = (e) => (e.status === 'judged' ? 1 : 0);
  function newerEntry(a, b) {
    if (judgedRank(a) !== judgedRank(b)) return judgedRank(b) > judgedRank(a) ? b : a;
    return (b.judgedAt || b.createdAt) > (a.judgedAt || a.createdAt) ? b : a;
  }

  function unionById(a, b, tomb) {
    const map = new Map();
    [...(a || []), ...(b || [])].forEach((x) => { if (!map.has(x.id)) map.set(x.id, x); });
    return [...map.values()].filter((x) => !(tomb && tomb[x.id]));
  }

  // 뽑기 기록은 순서(천장 계산)가 중요하다. 합친 뒤 시각 순으로 안정 정렬한다.
  function mergeOrdered(a, b) {
    const seen = new Set((a || []).map((x) => x.id));
    const all = [...(a || []), ...(b || []).filter((x) => !seen.has(x.id))];
    return all.map((x, i) => [x, i]).sort((p, q) => (p[0].at < q[0].at ? -1 : p[0].at > q[0].at ? 1 : p[1] - q[1])).map((p) => p[0]);
  }

  const logKey = (l) => `${l.at}|${l.amount}|${l.by}|${l.entryId}`;
  function mergeQuest(q, other) {
    if (!other) return q;
    const map = new Map();
    [...q.log, ...other.log].forEach((l) => map.set(logKey(l), l));
    q.log = [...map.values()].sort((x, y) => (x.at < y.at ? -1 : 1));
    q.progress = LM.clamp(q.log.reduce((sum, l) => sum + l.amount, 0), 0, q.target);
    q.doneAt = q.progress >= q.target ? (q.doneAt || other.doneAt || (q.log.length ? q.log[q.log.length - 1].at : null)) : null;
    return q;
  }

  function mergePeriods(a, b) {
    const out = {};
    new Set([...Object.keys(a || {}), ...Object.keys(b || {})]).forEach((id) => {
      const pa = a && a[id];
      const pb = b && b[id];
      if (!pa || !pb) { out[id] = clone(pa || pb); return; }
      const bWins = (pb.updatedAt || 0) > (pa.updatedAt || 0);
      const win = clone(bWins ? pb : pa);
      const lose = bWins ? pa : pb;
      const loseQuests = new Map([...lose.active, ...lose.spare].map((q) => [q.id, q]));
      [...win.active, ...win.spare].forEach((q) => mergeQuest(q, loseQuests.get(q.id)));
      // 진 쪽에만 있던 퀘스트라도 이미 진행한 것은 버리지 않는다(포인트를 지키기 위해).
      const winIds = new Set([...win.active, ...win.spare].map((q) => q.id));
      lose.active.forEach((q) => { if (q.log.length && !winIds.has(q.id)) win.active.push(clone(q)); });
      win.received = !!(pa.received || pb.received);
      win.updatedAt = Math.max(pa.updatedAt || 0, pb.updatedAt || 0);
      out[id] = win;
    });
    return out;
  }

  function mergeTombs(a, b) {
    const out = {};
    TOMB_KINDS.forEach((k) => {
      out[k] = { ...((a && a[k]) || {}) };
      Object.entries((b && b[k]) || {}).forEach(([id, t]) => { out[k][id] = Math.max(out[k][id] || 0, t); });
    });
    return out;
  }

  // s(이 기기, 복사본)에 c(보관소의 core)를 합친다.
  function mergeCore(s, c) {
    LM.ensureSyncMeta(s);
    const theirs = c.stamps || {};
    const pick = (k) => (theirs[k] || 0) > (s.stamps[k] || 0);
    const tomb = mergeTombs(s.tombstones, c.tombstones);

    if (pick('character')) s.character = clone(c.character);
    if (pick('room')) s.room = clone(c.room);
    if (pick('focus')) s.quests.focus = clone(c.quests.focus);
    if (pick('prefs')) s.settings.dayStartHour = c.settings.dayStartHour;
    const backups = [s.settings.lastBackupAt, c.settings && c.settings.lastBackupAt].filter(Boolean).sort();
    s.settings.lastBackupAt = backups.length ? backups[backups.length - 1] : null;

    s.stats = unionById(s.stats, c.stats, tomb.stats);
    s.skills = unionById(s.skills, c.skills, tomb.skills);
    s.quests.periods = mergePeriods(s.quests.periods, c.quests && c.quests.periods);
    s.gacha.pulls = mergeOrdered(s.gacha.pulls, c.gacha && c.gacha.pulls);
    s.gacha.exchanges = mergeOrdered(s.gacha.exchanges, c.gacha && c.gacha.exchanges);
    if (c.createdAt && c.createdAt < s.createdAt) s.createdAt = c.createdAt;
    s.version = Math.max(s.version || 1, c.version || 1);
    Object.entries(theirs).forEach(([k, t]) => { s.stamps[k] = Math.max(s.stamps[k] || 0, t); });
    s.tombstones = tomb;
    s.entries = s.entries.filter((e) => !tomb.entries[e.id]);
    return s;
  }

  // 보관소에서 받은 문서들(parts)을 이 기기 상태에 합친 새 상태를 돌려준다.
  LM.mergeParts = (local, parts) => {
    let s = clone(local);
    if (parts.core) s = mergeCore(s, parts.core);
    const tomb = LM.ensureSyncMeta(s).tombstones.entries;
    const map = new Map(s.entries.map((e) => [e.id, e]));
    Object.entries(parts).forEach(([id, p]) => {
      if (id === 'core') return;
      (p.entries || []).forEach((e) => {
        if (tomb[e.id]) return;
        const mine = map.get(e.id);
        map.set(e.id, mine ? newerEntry(mine, e) : clone(e));
      });
    });
    s.entries = [...map.values()].filter((e) => !tomb[e.id]).sort(byCreated);
    return s;
  };

  // 따로 시작한 두 기록을 처음 합칠 때: 이름이 같은 스탯·스킬은 base 쪽 id로 맞추고,
  // 이름·방처럼 하나뿐인 값은 base(이미 쓰던 쪽)를 따른다.
  LM.firstLinkMerge = (other, base) => {
    const o = clone(other);
    LM.ensureSyncMeta(o);
    const norm = (n) => String(n).trim().toLowerCase();
    const mapIds = (mine, theirs) => {
      const m = {};
      mine.forEach((x) => {
        const hit = theirs.find((y) => norm(y.name) === norm(x.name));
        if (hit) m[x.id] = hit.id;
      });
      return m;
    };
    const statMap = mapIds(o.stats, base.stats);
    const skillMap = mapIds(o.skills, base.skills);
    o.stats = o.stats.map((x) => ({ ...x, id: statMap[x.id] || x.id }));
    o.skills = o.skills.map((x) => ({ ...x, id: skillMap[x.id] || x.id }));
    o.entries.forEach((e) => (e.activities || []).forEach((a) => {
      a.primary = statMap[a.primary] || a.primary;
      a.secondary = (a.secondary || []).map((id) => statMap[id] || id);
      (a.skills || []).forEach((k) => { k.id = skillMap[k.id] || k.id; });
    }));
    o.stamps = {};
    Object.values(o.quests.periods).forEach((p) => { p.updatedAt = 0; });

    const parts = LM.splitState(o);
    const merged = LM.mergeParts(base, parts);
    if (!merged.room.items.length && o.room.items.length) merged.room = o.room;
    if (!merged.character.avatar && o.character.avatar) merged.character.avatar = o.character.avatar;
    if (!merged.character.title && o.character.title) merged.character.title = o.character.title;
    return merged;
  };

  // ---------- 암호화 ----------

  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const PBKDF2_ROUNDS = 310000;
  const CHECK_TEXT = 'life-maker-ok';

  function toB64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function fromB64(str) {
    const s = atob(str);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i);
    return out;
  }
  const pipe = async (bytes, transform) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(transform)).arrayBuffer());
  const canZip = typeof CompressionStream === 'function';

  async function deriveKey(password, salt) {
    const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: PBKDF2_ROUNDS, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'],
    );
  }

  async function seal(key, text) {
    let bytes = enc.encode(text);
    if (canZip) bytes = await pipe(bytes, new CompressionStream('gzip'));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
    return { iv: toB64(iv), data: toB64(data), z: canZip };
  }

  async function open(key, sealed) {
    let bytes = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(sealed.iv) }, key, fromB64(sealed.data)));
    if (sealed.z) bytes = await pipe(bytes, new DecompressionStream('gzip'));
    return dec.decode(bytes);
  }

  async function sha(text) {
    return toB64(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text))));
  }

  async function checkKey(key, f) {
    try {
      return (await open(key, { iv: f.checkIv, data: f.checkData, z: false })) === CHECK_TEXT;
    } catch (err) {
      return false;
    }
  }

  LM.syncCrypto = { deriveKey, seal, open, sha, toB64, fromB64 }; // 확인용

  // ---------- 동기화 엔진 (보관소 방식과 무관) ----------
  // transport: { list() → {문서id: 바뀐시각}, read(id) → {payload, updateTime}, write(id, json, 알던시각) → 새 시각 }
  // hooks: { getState(), apply(새상태), isBusy() }

  LM.createSyncEngine = ({ transport, hooks, docs, saveDocs, setStatus }) => {
    let running = null;
    let again = false;
    let timer = null;
    let stopped = false;

    async function run() {
      if (!hooks.getState()) { setStatus('idle'); return; }
      setStatus('syncing');
      try {
        for (let round = 0; round < 4 && !stopped; round += 1) {
          // 1) 다른 기기에서 바뀐 문서 받아 합치기
          const remote = await transport.list();
          const fresh = {};
          for (const id of Object.keys(remote)) {
            if (docs[id] && docs[id].updateTime === remote[id]) continue;
            const r = await transport.read(id);
            if (r) fresh[id] = { payload: r.payload, updateTime: r.updateTime, hash: await sha(JSON.stringify(r.payload)) };
          }
          if (stopped) return;
          if (Object.keys(fresh).length) {
            if (hooks.isBusy()) { again = true; setStatus('idle'); return; } // 판정 중에는 바꾸지 않고 나중에
            const parts = Object.fromEntries(Object.entries(fresh).map(([id, f]) => [id, f.payload]));
            hooks.apply(LM.mergeParts(hooks.getState(), parts));
            Object.entries(fresh).forEach(([id, f]) => { docs[id] = { updateTime: f.updateTime, hash: f.hash }; });
          }

          // 2) 이 기기에서 바뀐 문서 올리기
          const local = LM.splitState(hooks.getState(), Object.keys(docs));
          let conflict = false;
          for (const [id, payload] of Object.entries(local)) {
            const json = JSON.stringify(payload);
            const hash = await sha(json);
            if (docs[id] && docs[id].hash === hash) continue;
            try {
              const t = await transport.write(id, json, docs[id] && docs[id].updateTime);
              docs[id] = { updateTime: t, hash };
            } catch (err) {
              if (err.kind !== 'conflict') throw err;
              conflict = true; // 그 사이 다른 기기가 먼저 올렸다 → 다시 받아 합친다
              break;
            }
          }
          await saveDocs();
          if (!conflict) break;
        }
        setStatus('ok');
      } catch (err) {
        setStatus(err.kind === 'offline' ? 'offline' : 'error', err.message);
        throw err;
      }
    }

    const eng = {
      list: () => transport.list(),
      async pullAll() {
        const remote = await transport.list();
        const parts = {};
        for (const id of Object.keys(remote)) {
          const r = await transport.read(id);
          if (!r) continue;
          parts[id] = r.payload;
          docs[id] = { updateTime: r.updateTime, hash: await sha(JSON.stringify(r.payload)) };
        }
        await saveDocs();
        return parts;
      },
      sync() {
        if (stopped) return Promise.resolve();
        if (running) { again = true; return running; }
        running = run().finally(() => {
          running = null;
          if (again && !stopped) { again = false; eng.schedule(1500); }
        });
        return running;
      },
      schedule(ms) {
        if (stopped) return;
        clearTimeout(timer);
        timer = setTimeout(() => { eng.sync().catch(() => {}); }, ms === undefined ? 2500 : ms);
      },
      stop() { stopped = true; clearTimeout(timer); },
    };
    return eng;
  };

  // 확인용: 메모리 안에서만 쓰는 가짜 보관소 (여러 '기기'가 같은 store를 함께 쓴다)
  LM.memoryTransport = (store) => {
    store.docs = store.docs || {};
    store.clock = store.clock || 0;
    return {
      async list() { return Object.fromEntries(Object.entries(store.docs).map(([id, d]) => [id, d.updateTime])); },
      async read(id) { const d = store.docs[id]; return d ? { payload: JSON.parse(d.json), updateTime: d.updateTime } : null; },
      async write(id, json, known) {
        const cur = store.docs[id];
        if ((known && (!cur || cur.updateTime !== known)) || (!known && cur)) throw new SyncError('conflict', '충돌');
        store.clock += 1;
        store.docs[id] = { json, updateTime: `t${store.clock}` };
        return store.docs[id].updateTime;
      },
    };
  };

  // ---------- Firebase (REST) ----------

  const CFG = LM.FIREBASE;
  const AUTH_URL = 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword';
  const TOKEN_URL = 'https://securetoken.googleapis.com/v1/token';
  const FS_URL = CFG ? `https://firestore.googleapis.com/v1/projects/${CFG.projectId}/databases/(default)/documents` : '';

  let info = null; // { email, uid, refreshToken, keyJwk, docs } — 이 기기에만 저장
  let key = null;
  let session = null; // { idToken, expiresAt }
  let engine = null;
  let hooks = null;
  let pendingCrypto = null;

  function authError(data) {
    const code = (data && data.error && data.error.message) || '';
    if (/INVALID_LOGIN_CREDENTIALS|INVALID_PASSWORD|EMAIL_NOT_FOUND|INVALID_EMAIL|MISSING_PASSWORD/.test(code)) return new SyncError('auth', '이메일 또는 비밀번호가 맞지 않아요.');
    if (/TOO_MANY_ATTEMPTS/.test(code)) return new SyncError('auth', '로그인 시도가 너무 많았어요. 잠시 뒤 다시 해 주세요.');
    if (/USER_DISABLED/.test(code)) return new SyncError('auth', '사용이 중지된 계정이에요.');
    if (/TOKEN_EXPIRED|INVALID_REFRESH_TOKEN|USER_NOT_FOUND|INVALID_ID_TOKEN/.test(code)) return new SyncError('relogin', '로그인이 만료됐어요. 설정에서 다시 로그인해 주세요.');
    if (/API key not valid|API_KEY_INVALID/.test(code)) return new SyncError('other', 'Firebase 연결 정보가 올바르지 않아요.');
    return new SyncError('other', `로그인하지 못했어요 (${code || '알 수 없는 오류'}).`);
  }

  async function post(url, body, form) {
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json' },
        body: form ? new URLSearchParams(body) : JSON.stringify(body),
      });
    } catch (err) {
      throw new SyncError('offline', '인터넷에 연결되어 있지 않아요.');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw authError(data);
    return data;
  }

  async function idToken() {
    if (session && Date.now() < session.expiresAt - 60000) return session.idToken;
    if (!info || !info.refreshToken) throw new SyncError('relogin', '로그인이 필요해요.');
    const data = await post(`${TOKEN_URL}?key=${CFG.apiKey}`, { grant_type: 'refresh_token', refresh_token: info.refreshToken }, true);
    session = { idToken: data.id_token, expiresAt: Date.now() + Number(data.expires_in) * 1000 };
    if (data.refresh_token && data.refresh_token !== info.refreshToken) {
      info.refreshToken = data.refresh_token;
      await LM.db.saveKey('sync', info);
    }
    return session.idToken;
  }

  async function fsFetch(path, opts, retried) {
    const token = await idToken();
    let res;
    try {
      res = await fetch(`${FS_URL}/${path}`, {
        ...(opts || {}),
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
    } catch (err) {
      throw new SyncError('offline', '인터넷에 연결되어 있지 않아요.');
    }
    if (res.status === 401 && !retried) {
      session = null;
      return fsFetch(path, opts, true);
    }
    if (res.status === 404) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const status = data.error && data.error.status;
      if (res.status === 409 || ['FAILED_PRECONDITION', 'ALREADY_EXISTS', 'ABORTED'].includes(status)) throw new SyncError('conflict', '다른 기기에서 먼저 바뀌었어요.');
      if (res.status === 401) throw new SyncError('relogin', '로그인이 만료됐어요. 설정에서 다시 로그인해 주세요.');
      if (res.status === 403) throw new SyncError('denied', '보관소에 접근할 수 없어요. Firestore 보안 규칙을 확인해 주세요.');
      throw new SyncError('other', `동기화 오류 (${res.status}) ${(data.error && data.error.message) || ''}`.trim());
    }
    return data;
  }

  const toFields = (obj) => ({
    fields: Object.fromEntries(Object.entries(obj).map(([k, v]) => [k,
      typeof v === 'number' ? { integerValue: String(Math.round(v)) }
        : typeof v === 'boolean' ? { booleanValue: v } : { stringValue: String(v) }])),
  });
  const fromFields = (doc) => Object.fromEntries(Object.entries(doc.fields || {}).map(([k, v]) => [k,
    'stringValue' in v ? v.stringValue : 'integerValue' in v ? Number(v.integerValue) : 'booleanValue' in v ? v.booleanValue : null]));
  const lastSegment = (name) => name.split('/').pop();

  function firebaseTransport() {
    const base = () => `users/${info.uid}/blobs`;
    return {
      async list() {
        const out = {};
        let pageToken = '';
        do {
          const data = (await fsFetch(`${base()}?pageSize=300&mask.fieldPaths=updatedAt${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`)) || {};
          (data.documents || []).forEach((d) => { out[lastSegment(d.name)] = d.updateTime; });
          pageToken = data.nextPageToken || '';
        } while (pageToken);
        return out;
      },
      async read(id) {
        const d = await fsFetch(`${base()}/${id}`);
        if (!d) return null;
        let text;
        try {
          text = await open(key, fromFields(d));
        } catch (err) {
          throw new SyncError('crypto', '보관된 기록을 풀지 못했어요. 다른 비밀번호로 잠긴 기록일 수 있어요.');
        }
        return { payload: JSON.parse(text), updateTime: d.updateTime };
      },
      async write(id, json, known) {
        const sealed = await seal(key, json);
        const pre = known ? `currentDocument.updateTime=${encodeURIComponent(known)}` : 'currentDocument.exists=false';
        const d = await fsFetch(`${base()}/${id}?${pre}`, { method: 'PATCH', body: JSON.stringify(toFields({ ...sealed, updatedAt: Date.now() })) });
        if (!d) throw new SyncError('nodb', 'Firestore 데이터베이스를 찾지 못했어요. Firebase에서 데이터베이스를 만들었는지 확인해 주세요.');
        return d.updateTime;
      },
    };
  }

  // ---------- 앱에서 쓰는 동기화 창구 ----------

  const S = LM.sync = { status: 'off', message: '', lastSyncAt: null };
  S.loggedIn = () => !!(info && key && engine);
  S.email = () => (info ? info.email : '');

  function setStatus(st, msg) {
    S.status = st;
    S.message = msg || '';
    if (st === 'ok') S.lastSyncAt = Date.now();
    if (hooks && hooks.onStatus) hooks.onStatus(S);
  }

  function startEngine() {
    if (engine) engine.stop();
    info.docs = info.docs || {};
    engine = LM.createSyncEngine({
      transport: firebaseTransport(),
      hooks,
      docs: info.docs,
      saveDocs: () => LM.db.saveKey('sync', info),
      setStatus,
    });
  }

  async function finishLogin(k) {
    key = k;
    info.keyJwk = await crypto.subtle.exportKey('jwk', key);
    await LM.db.saveKey('sync', info);
    startEngine();
    setStatus('idle');
    const remote = await engine.list();
    return { cloudHas: !!remote.core };
  }

  S.init = async (h) => {
    hooks = h;
    if (!CFG) return;
    try {
      info = await LM.db.loadKey('sync');
      if (info && info.keyJwk && info.refreshToken) {
        key = await crypto.subtle.importKey('jwk', info.keyJwk, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
        startEngine();
        setStatus('idle');
      } else {
        info = null;
      }
    } catch (err) {
      console.warn('동기화 정보를 불러오지 못했어요.', err);
      info = null;
    }
  };

  // 로그인. 처음 쓰는 계정이면 기록 잠금 열쇠를 새로 만든다.
  S.login = async (email, password) => {
    if (!CFG) throw new SyncError('other', 'Firebase 연결 정보가 없어요.');
    if (engine) engine.stop();
    engine = null;
    key = null;
    const auth = await post(`${AUTH_URL}?key=${CFG.apiKey}`, { email, password, returnSecureToken: true });
    session = { idToken: auth.idToken, expiresAt: Date.now() + Number(auth.expiresIn) * 1000 };
    info = { email: auth.email || email, uid: auth.localId, refreshToken: auth.refreshToken, docs: {} };

    const cryptoPath = `users/${info.uid}/meta/crypto`;
    const doc = await fsFetch(cryptoPath);
    if (!doc) {
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const k = await deriveKey(password, salt);
      const check = await seal(k, CHECK_TEXT);
      const body = toFields({ v: 1, salt: toB64(salt), checkIv: check.iv, checkData: check.data, createdAt: Date.now() });
      const made = await fsFetch(`${cryptoPath}?currentDocument.exists=false`, { method: 'PATCH', body: JSON.stringify(body) });
      if (!made) throw new SyncError('nodb', 'Firestore 데이터베이스를 찾지 못했어요. Firebase에서 데이터베이스를 만들었는지 확인해 주세요.');
      return finishLogin(k);
    }
    const f = fromFields(doc);
    const k = await deriveKey(password, fromB64(f.salt));
    if (!(await checkKey(k, f))) {
      pendingCrypto = f;
      throw new SyncError('crypto-mismatch', '보관된 기록이 다른 비밀번호로 잠겨 있어요. 처음 동기화를 켤 때 쓴 비밀번호를 입력해 주세요.');
    }
    return finishLogin(k);
  };

  // 비밀번호를 바꾼 뒤라면, 처음 동기화할 때 쓴 비밀번호로 기록 잠금을 연다.
  S.unlock = async (oldPassword) => {
    if (!pendingCrypto || !info) throw new SyncError('relogin', '다시 로그인해 주세요.');
    const k = await deriveKey(oldPassword, fromB64(pendingCrypto.salt));
    if (!(await checkKey(k, pendingCrypto))) throw new SyncError('auth', '이 비밀번호로도 기록을 열 수 없어요.');
    pendingCrypto = null;
    return finishLogin(k);
  };

  S.logout = async () => {
    if (engine) engine.stop();
    info = null;
    key = null;
    session = null;
    engine = null;
    pendingCrypto = null;
    await LM.db.saveKey('sync', null);
    setStatus('off');
  };

  S.pullAll = () => engine.pullAll();
  S.syncNow = () => (engine ? engine.sync() : Promise.resolve());
  S.schedule = (ms) => { if (engine) engine.schedule(ms); };
})(window.LM);
