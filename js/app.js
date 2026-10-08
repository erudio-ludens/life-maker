// 화면 그리기와 버튼 동작.

(function (LM) {
  const $app = document.getElementById('app');
  const $modal = document.getElementById('modal-root');
  const $toast = document.getElementById('toast-root');

  const DRAFT_KEY = 'life-maker-draft';
  const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
  const MAX_STATS = 20;
  const MAX_SKILLS = 30;

  let state = null;
  let progress = null;
  let wallet = null;
  let pkw = null; // 포켓몬 사탕·도감 (LM.pkWallet)
  let tab = 'today';
  let prevTab = 'today'; // 설정을 닫으면 돌아갈 탭
  let settingsPushed = false; // 설정을 열면서 뒤로 가기 기록을 쌓았는지
  let vaultView = 'honors';
  let roomEdit = false;
  let roomSel = null; // 꾸미기 중 고른 물건
  let roomDrawer = 'items';
  let drag = null;
  let onboardDraft = null;
  let draftText = '';
  let busy = false;
  let charEdit = false;
  let manual = null; // 직접 판정 중인 { entryId, rows }
  let geminiModels = [];
  let pending = null; // 확인/입력 모달의 { resolve, getValue }
  let modalLocked = false;
  let modalTimer = null;

  // ---------- 도우미 ----------

  const esc = LM.esc;
  const uid = LM.uid;
  const pct = (n, d) => (d > 0 ? Math.max(0, Math.min(100, (n / d) * 100)) : 100);
  const today = () => LM.gameDate(new Date(), state.settings.dayStartHour);
  const aiOn = () => state.settings.ai.provider !== 'none';
  const findEntry = (id) => state.entries.find((e) => e.id === id);
  const statName = (id) => (state.stats.find((s) => s.id === id) || {}).name || '(지운 스탯)';
  const skillName = (id) => (state.skills.find((s) => s.id === id) || {}).name || '(지운 스킬)';
  const honorKey = (h) => `${h.kind}:${h.entryId}`;
  const allHonors = () => [...progress.honors.medals, ...progress.honors.achievements];

  function findQuest(periodId, questId) {
    const p = state.quests.periods[periodId];
    return p ? p.active.find((q) => q.id === questId) || null : null;
  }

  const loadingHtml = (text) => `<div class="loading"><div class="spinner"></div><p>${text}</p></div>`;

  function equippedHonor() {
    const key = state.character.title;
    return key ? allHonors().find((h) => honorKey(h) === key) || null : null;
  }

  function fmtGameDate(gd, withYear) {
    const [y, m, d] = gd.split('-').map(Number);
    const w = WEEK[new Date(y, m - 1, d).getDay()];
    return `${withYear ? `${y}년 ` : ''}${m}월 ${d}일 (${w})`;
  }

  const fmtTime = (iso) => new Date(iso).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });
  const fmtDay = (iso) => new Date(iso).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });

  // 받침 유무에 따라 조사 고르기 (한글이 아니면 '은(는)'처럼 둘 다)
  function josa(word, withBatchim, without) {
    const code = word.charCodeAt(word.length - 1) - 0xac00;
    if (code < 0 || code > 11171) return `${withBatchim}(${without})`;
    return code % 28 ? withBatchim : without;
  }

  function loadDraft() {
    try { return localStorage.getItem(DRAFT_KEY) || ''; } catch (err) { return ''; }
  }

  function saveDraft(text) {
    try {
      if (text) localStorage.setItem(DRAFT_KEY, text);
      else localStorage.removeItem(DRAFT_KEY);
    } catch (err) { /* 임시 저장 실패는 무시 */ }
  }

  function toast(message) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = message;
    $toast.appendChild(el);
    setTimeout(() => el.classList.add('out'), 2600);
    setTimeout(() => el.remove(), 3000);
  }

  function recompute() {
    progress = LM.computeProgress(state);
    wallet = LM.wallet(state);
    pkw = LM.pkWallet(state);
  }

  async function commit() {
    LM.syncTrack(state);
    recompute();
    await LM.db.save(state);
    LM.sync.schedule();
  }

  // 동기화로 받은 상태를 저장할 때. 다른 기기의 변경이라 '방금 바꿈' 표시는 하지 않는다.
  async function saveSynced() {
    recompute();
    await LM.db.save(state);
    LM.syncSnap(state);
    LM.sync.schedule();
  }

  const avatarItem = () => (state.character.avatar && wallet.owned[state.character.avatar]
    ? LM.itemById(state.character.avatar) : null);

  function newState(name, statNames, skillNames) {
    const now = new Date().toISOString();
    return migrate({
      version: 1,
      createdAt: now,
      character: { name },
      stats: statNames.map((n) => ({ id: uid(), name: n })),
      skills: skillNames.map((n) => ({ id: uid(), name: n, createdAt: now })),
      entries: [],
      settings: {},
    });
  }

  // 예전 버전 데이터나 백업 파일에 빠진 설정을 채운다.
  function migrate(s) {
    s.version = s.version || 1;
    if (!('title' in s.character)) s.character.title = null;
    if (!('avatar' in s.character)) s.character.avatar = null;
    s.quests = s.quests || {};
    s.quests.focus = Object.assign({ daily: '', weekly: '', monthly: '' }, s.quests.focus);
    s.quests.periods = s.quests.periods || {};
    s.gacha = s.gacha || {};
    s.gacha.pulls = s.gacha.pulls || [];
    s.gacha.exchanges = s.gacha.exchanges || [];
    s.gacha.evolutions = s.gacha.evolutions || [];
    if (!['items', 'pokemon'].includes(s.settings.gachaMode)) s.settings.gachaMode = 'items';
    s.room = s.room || {};
    s.room.theme = LM.ROOM_THEMES[s.room.theme] ? s.room.theme : 'cream';
    s.room.items = s.room.items || [];
    LM.ensureAvatarInRoom(s);
    LM.ensureSyncMeta(s);
    s.settings = s.settings || {};
    const ai = s.settings.ai = s.settings.ai || {};
    ai.provider = ai.provider || 'none';
    if (ai.provider === 'mock' && !LM.MOCK_ENABLED) ai.provider = 'none';
    ai.keys = Object.assign({ gemini: '', claude: '' }, ai.keys);
    ai.models = Object.assign({ gemini: LM.GEMINI_DEFAULT_MODEL, claude: LM.CLAUDE_DEFAULT_MODEL }, ai.models);
    if (typeof s.settings.dayStartHour !== 'number') s.settings.dayStartHour = LM.DEFAULT_DAY_START_HOUR;
    if (!('lastBackupAt' in s.settings)) s.settings.lastBackupAt = null;
    return s;
  }

  function isValidState(s) {
    return s && s.character && typeof s.character.name === 'string'
      && Array.isArray(s.stats) && Array.isArray(s.skills) && Array.isArray(s.entries);
  }

  function nameProblem(name, list, max, kind) {
    if (!name) return `${kind} 이름을 적어 주세요.`;
    if (list.some((x) => x.trim().toLowerCase() === name.toLowerCase())) return `'${name}'${josa(name, '은', '는')} 이미 있어요.`;
    if (list.length >= max) return `${kind}${josa(kind, '은', '는')} 최대 ${max}개까지 만들 수 있어요.`;
    return null;
  }

  // ---------- 아이콘 ----------

  const svg = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  const ICONS = {
    today: svg('<path d="M2 5h6a4 4 0 0 1 4 4v11a3 3 0 0 0-3-3H2z"/><path d="M22 5h-6a4 4 0 0 0-4 4v11a3 3 0 0 1 3-3h7z"/>'),
    history: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    quests: svg('<path d="M9 6h11M9 12h11M9 18h11"/><path d="M3.5 6l1.5 1.5L7.5 5M3.5 12l1.5 1.5L7.5 11"/><circle cx="5" cy="18" r="1.5"/>'),
    vault: svg('<path d="M8 2.5l2.5 7M16 2.5l-2.5 7"/><circle cx="12" cy="15.5" r="6"/><path d="M12 12.6l.9 1.8 2 .3-1.45 1.4.35 2-1.8-.95-1.8.95.35-2-1.45-1.4 2-.3z"/>'),
    character: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6"/>'),
    settings: svg('<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>'),
  };
  const TABS = [['today', '오늘'], ['history', '기록'], ['quests', '퀘스트'], ['vault', '보관함'], ['character', '캐릭터']];

  // ---------- 모달 ----------

  function openModal(html, opts) {
    if (pending) { pending.resolve(null); pending = null; }
    clearInterval(modalTimer);
    modalTimer = null;
    modalLocked = !!(opts && opts.locked);
    $modal.innerHTML = `<div class="backdrop" data-backdrop><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`;
    document.body.classList.add('modal-open');
  }

  function closeModal() {
    if (pending) { pending.resolve(null); pending = null; }
    clearInterval(modalTimer);
    modalTimer = null;
    modalLocked = false;
    manual = null;
    $modal.innerHTML = '';
    document.body.classList.remove('modal-open');
  }

  function ask(html, getValue) {
    return new Promise((resolve) => {
      openModal(html);
      pending = { resolve, getValue };
      const input = $modal.querySelector('input');
      if (input) input.focus();
    });
  }

  function modalOk() {
    const p = pending;
    if (!p) return;
    const value = p.getValue ? p.getValue() : true;
    pending = null;
    closeModal();
    p.resolve(value);
  }

  const confirmModal = ({ title, body, okLabel, danger }) => ask(`
    <h2>${esc(title)}</h2>
    <p>${esc(body)}</p>
    <div class="modal-actions">
      <button class="btn ghost" data-action="close-modal">취소</button>
      <button class="btn ${danger ? 'danger' : 'primary'}" data-action="modal-ok">${esc(okLabel || '확인')}</button>
    </div>`);

  const promptModal = ({ title, label, value }) => ask(`
    <form data-submit="modal-ok">
      <h2>${esc(title)}</h2>
      <label class="field"><span>${esc(label)}</span><input id="prompt-input" maxlength="20" value="${esc(value)}"></label>
      <div class="modal-actions">
        <button type="button" class="btn ghost" data-action="close-modal">취소</button>
        <button class="btn primary">확인</button>
      </div>
    </form>`, () => document.getElementById('prompt-input').value.trim());

  // ---------- 첫 화면 ----------

  const freshDraft = () => ({ name: '', stats: LM.DEFAULT_STATS.slice(), skills: [] });

  function viewOnboarding() {
    const d = onboardDraft;
    const tags = (list, kind) => list.map((n, i) => `
      <span class="tag">${esc(n)}<button class="tag-x" data-action="ob-remove" data-kind="${kind}" data-i="${i}" aria-label="${esc(n)} 빼기">×</button></span>`).join('');
    return `
      <div class="onboard">
        <header class="onboard-hero">
          <img class="logo" src="icon.svg" alt="">
          <h1>인생 메이커</h1>
          <p>하루를 기록하면, 내가 성장한다.</p>
        </header>
        <section class="card">
          <label class="field" style="margin-top:0"><span>기록자 이름</span>
            <input id="ob-name" maxlength="20" value="${esc(d.name)}" placeholder="기록에 남을 이름" autocomplete="off">
          </label>
        </section>
        <section class="card">
          <h2 class="card-title">스탯</h2>
          <p class="hint">모두 10에서 시작해요. 필요 없는 건 빼고, 원하는 건 추가하세요.</p>
          <div class="tag-list">${tags(d.stats, 'stats')}</div>
          <form class="add-form" data-submit="ob-add" data-kind="stats">
            <input name="name" maxlength="20" placeholder="추가할 스탯 (예: 체력)" autocomplete="off">
            <button class="btn small">추가</button>
          </form>
        </section>
        <section class="card">
          <h2 class="card-title">키우고 싶은 스킬 <small>선택</small></h2>
          <p class="hint">숙련도를 올리고 싶은 기술이에요. 나중에 추가해도 돼요.</p>
          <div class="tag-list">${tags(d.skills, 'skills')}</div>
          <form class="add-form" data-submit="ob-add" data-kind="skills">
            <input name="name" maxlength="20" placeholder="예: 마케팅, 영어, 요리" autocomplete="off">
            <button class="btn small">추가</button>
          </form>
        </section>
        <button class="btn primary block" data-action="ob-start">기록 시작하기</button>
        ${LM.FIREBASE ? `
          <div class="onboard-restore">
            <span>다른 기기에서 쓰던 기록이 있나요?</span>
            <button class="btn small" data-action="sync-login">로그인해서 불러오기</button>
          </div>` : ''}
        <div class="onboard-restore">
          <span>백업 파일이 있나요?</span>
          <label class="btn small ghost">백업 불러오기<input type="file" accept=".json,application/json" data-change="import" hidden></label>
        </div>
      </div>`;
  }

  async function startAdventure() {
    const d = onboardDraft;
    const name = d.name.trim();
    if (!name) {
      toast('기록자 이름을 적어 주세요.');
      document.getElementById('ob-name').focus();
      return;
    }
    if (!d.stats.length) {
      toast('스탯이 하나 이상 있어야 해요.');
      return;
    }
    state = newState(name, d.stats, d.skills);
    onboardDraft = null;
    await commit();
    LM.db.requestPersist();
    goHome();
    render();
    toast(`${name}의 기록이 시작됐어요.`);
  }

  // ---------- 오늘 ----------

  function backupBanner() {
    const n = state.entries.length;
    if (!n) return '';
    const last = state.settings.lastBackupAt;
    const days = last ? Math.floor((Date.now() - Date.parse(last)) / 86400000) : null;
    if (last ? days < 7 : n < 3) return '';
    return `
      <div class="banner">
        <span>${last ? `마지막 백업이 ${days}일 전이에요.` : '아직 백업한 적이 없어요.'} 기록을 지키려면 백업 파일을 저장해 두세요.</span>
        <button class="btn small" data-action="export">지금 백업</button>
      </div>`;
  }

  function statStrip() {
    return `<section class="stat-strip" aria-label="현재 스탯">${state.stats.map((s) => {
      const p = progress.stats[s.id];
      return `
        <div class="stat-chip">
          <span class="stat-name">${esc(s.name)}</span>
          <span class="stat-val">${p.value}</span>
          <span class="bar"><i style="width:${pct(p.xp, LM.statNeed(p.value))}%"></i></span>
        </div>`;
    }).join('')}</section>`;
  }

  function modeHint() {
    const labels = { none: '직접 판정 모드', gemini: 'Gemini가 판정해요', claude: 'Claude가 판정해요', mock: '테스트 AI가 판정해요' };
    const h = state.settings.dayStartHour;
    return `${labels[state.settings.ai.provider]} · 하루 기준 ${h === 0 ? '자정' : `새벽 ${h}시`}`;
  }

  function gainChips(g) {
    const statGains = g ? g.stats.filter((r) => r.xp > 0) : [];
    const skillGains = g ? g.skills.filter((r) => r.xp > 0) : [];
    if (!statGains.length && !skillGains.length) return '<p class="hint">이번 기록으로 오른 능력치는 없어요.</p>';
    const stats = statGains.map((r) => `<span class="chip ${r.to > r.from ? 'up' : ''}">${esc(statName(r.id))} +${r.xp}${r.to > r.from ? ` · Lv ${r.to}` : ''}</span>`);
    const skills = skillGains.map((r) => `<span class="chip skill ${r.toTier !== r.fromTier ? 'up' : ''}">${esc(skillName(r.id))} +${r.xp}${r.toTier !== r.fromTier ? ` · ${r.toTier}` : ''}</span>`);
    return `<div class="chips">${stats.join('')}${skills.join('')}</div>`;
  }

  function honorRows(e) {
    const rows = [];
    if (e.medal) {
      rows.push(`
        <button class="honor-row" data-action="story" data-kind="medal" data-id="${e.id}">
          <span class="honor-emoji">${esc(e.medal.symbol)}</span>
          <span><b>${LM.MEDAL_GRADES[e.medal.grade].label} 훈장</b> ${esc(e.medal.title)}</span>
        </button>`);
    }
    if (e.achievement) {
      rows.push(`
        <button class="honor-row" data-action="story" data-kind="achievement" data-id="${e.id}">
          <span class="honor-emoji">${esc(e.achievement.symbol)}</span>
          <span><b>업적</b> ${esc(e.achievement.title)}</span>
        </button>`);
    }
    return rows.length ? `<div class="honor-rows">${rows.join('')}</div>` : '';
  }

  function entryCard(e, deletable) {
    const badge = e.status === 'pending'
      ? '<span class="badge warn">판정 대기</span>'
      : (e.mode === 'manual' ? '<span class="badge">직접 판정</span>' : '');
    const actions = e.status === 'pending'
      ? `${aiOn() ? `<button class="btn small" data-action="judge" data-id="${e.id}">AI 판정</button>` : ''}
         <button class="btn small" data-action="manual" data-id="${e.id}">직접 판정</button>`
      : `<button class="btn small ghost" data-action="show-result" data-id="${e.id}">자세히</button>`;
    return `
      <article class="entry ${e.status}">
        <header class="entry-head"><span class="entry-time">${fmtTime(e.createdAt)}</span>${badge}</header>
        <p class="entry-text" data-action="expand" title="눌러서 펼치기">${esc(e.text)}</p>
        ${e.status === 'judged' ? `<blockquote class="narration">${esc(e.narration)}</blockquote>${gainChips(progress.perEntry[e.id])}${honorRows(e)}` : ''}
        <footer class="entry-actions">
          ${actions}
          ${deletable ? `<button class="btn small ghost danger" data-action="delete-entry" data-id="${e.id}">삭제</button>` : ''}
        </footer>
      </article>`;
  }

  function viewToday() {
    const gd = today();
    const todays = state.entries.filter((e) => e.gameDate === gd).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const oldPending = state.entries.filter((e) => e.status === 'pending' && e.gameDate !== gd).length;
    return `
      ${backupBanner()}
      ${statStrip()}
      <section class="card composer">
        <h2 class="card-title">오늘의 일지</h2>
        <textarea id="diary" maxlength="5000" placeholder="오늘 무엇을 했나요? 한 일과 느낀 점을 자유롭게 적어 주세요.">${esc(draftText)}</textarea>
        <div class="composer-foot">
          <span class="hint">${modeHint()}</span>
          <button class="btn primary" data-action="submit-diary" ${busy ? 'disabled' : ''}>기록하기</button>
        </div>
      </section>
      ${questPreview()}
      ${oldPending ? `<p class="notice">판정을 기다리는 지난 기록이 ${oldPending}개 있어요. 기록 탭에서 판정할 수 있어요.</p>` : ''}
      <h2 class="section-title">오늘의 기록 <span class="count">${todays.length}</span></h2>
      ${todays.length
        ? todays.map((e) => entryCard(e, true)).join('')
        : '<p class="empty">아직 오늘의 기록이 없어요. 하루를 마치며 첫 일지를 남겨 보세요.</p>'}`;
  }

  async function submitDiary() {
    if (busy) return;
    const box = document.getElementById('diary');
    const text = box.value.trim();
    if (!text) {
      toast('일기를 먼저 적어 주세요.');
      box.focus();
      return;
    }
    const entry = {
      id: uid(),
      createdAt: new Date().toISOString(),
      gameDate: today(),
      text,
      status: 'pending',
      lucky: LM.rollAchievement(state.entries),
    };
    state.entries.push(entry);
    draftText = '';
    saveDraft('');
    await commit();
    render();
    if (aiOn()) runAiJudge(entry.id);
    else openManual(entry.id);
  }

  // ---------- 판정 적용 ----------

  // 판정 결과를 일지에 적는다. 훈장 제한과 업적은 여기서 처리한다.
  function applyJudgement(entry, result, mode) {
    let medal = result.medal || null;
    if (medal && mode === 'ai' && !LM.medalAllowed(state, entry, medal.grade)) medal = null;
    const achievement = entry.lucky ? (result.achievement || LM.fallbackAchievement(state, entry)) : null;
    Object.assign(entry, {
      status: 'judged',
      mode,
      activities: result.activities,
      narration: result.narration,
      medal,
      achievement,
      judgedAt: new Date().toISOString(),
    });
    if (result.model) entry.model = result.model;
    entry.questProgress = [];
    for (const qp of result.questProgress || []) {
      const q = findQuest(qp.periodId, qp.questId);
      if (!q) continue;
      const applied = LM.stepQuest(q, qp.amount, 'ai', entry.id);
      if (applied) entry.questProgress.push({ periodId: qp.periodId, questId: q.id, amount: applied });
    }
    // 아직 단 칭호가 없으면 처음 받은 칭호를 바로 단다.
    if ((medal || achievement) && !equippedHonor()) {
      state.character.title = `${medal ? 'medal' : 'achievement'}:${entry.id}`;
    }
  }

  // ---------- AI 판정 ----------

  const LOADING_LINES = ['기록관이 일지를 읽는 중…', '오늘 한 일을 정리하는 중…', '경험치를 계산하는 중…', '오늘의 기록을 남기는 중…'];

  async function runAiJudge(id) {
    if (busy) return;
    const entry = findEntry(id);
    if (!entry) return;
    busy = true;
    openModal(`<div class="loading"><div class="spinner"></div><p id="loading-line">${LOADING_LINES[0]}</p></div>`, { locked: true });
    let i = 0;
    modalTimer = setInterval(() => {
      const el = document.getElementById('loading-line');
      if (el) el.textContent = LOADING_LINES[++i % LOADING_LINES.length];
    }, 1800);

    try {
      const result = await LM.judgeEntry(state, entry);
      applyJudgement(entry, result, 'ai');
      await commit();
      busy = false;
      render();
      showResult(id, true);
    } catch (err) {
      console.error(err);
      busy = false;
      render();
      openModal(`
        <h2>판정하지 못했어요</h2>
        <p>${esc(err.message || '알 수 없는 오류가 났어요.')}</p>
        <p class="hint">일기는 안전하게 저장되어 있어요. 나중에 다시 판정해도 돼요.</p>
        <div class="modal-actions">
          <button class="btn ghost" data-action="close-modal">나중에</button>
          <button class="btn" data-action="manual" data-id="${id}">직접 판정</button>
          <button class="btn primary" data-action="judge" data-id="${id}">다시 시도</button>
        </div>`);
    }
  }

  function activityItem(a) {
    const lvl = LM.INTENSITY[a.intensity];
    const stats = [statName(a.primary)].concat(a.secondary.map(statName));
    const skills = (a.skills || []).map((s) => `${skillName(s.id)} ${s.minutes}분 · ${LM.NOVELTY[s.novelty].label} · ${LM.OUTPUT[s.output].label}`);
    return `
      <li class="activity">
        <div class="activity-top">
          <span class="activity-sum">${esc(a.summary || '활동')}</span>
          <span class="intensity">${'★'.repeat(a.intensity)} ${lvl.label}</span>
        </div>
        <div class="activity-meta">${esc(stats.join(' · '))}${skills.length ? `<br>${esc(skills.join(' / '))}` : ''}</div>
      </li>`;
  }

  // 판정 결과의 퀘스트 진행과 포인트
  function pointLines(e, fresh) {
    const lines = [];
    const sameDay = state.entries.filter((x) => x.status === 'judged' && x.gameDate === e.gameDate)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (fresh && sameDay[0] === e) {
      lines.push(`<div class="quest-line done"><span>✎</span><span>오늘의 첫 일지</span><b>+${LM.DIARY_POINTS}P</b></div>`);
    }
    for (const qp of e.questProgress || []) {
      const q = findQuest(qp.periodId, qp.questId);
      if (!q) continue;
      const done = LM.questDone(q);
      const reward = LM.QUEST_KINDS[qp.periodId.split(':')[0]].reward;
      lines.push(`<div class="quest-line ${done ? 'done' : ''}"><span>${done ? '✓' : '▸'}</span><span>${esc(q.text)}</span><b>${done ? `+${reward}P` : `${q.progress}/${q.target}`}</b></div>`);
    }
    if (!lines.length) return '';
    return `<h3 class="sub-title">퀘스트와 포인트</h3>${lines.join('')}${fresh ? `<p class="hint">보유 포인트 ${wallet.points.toLocaleString()}P</p>` : ''}`;
  }

  function awardBlock(e) {
    const blocks = [];
    if (e.medal) {
      const grade = LM.MEDAL_GRADES[e.medal.grade];
      blocks.push(`
        <div class="award">
          ${LM.medalSvg(e.medal, 76)}
          <div class="award-body">
            <div class="award-kicker">${grade.label} 훈장 · 업적 포인트 +${grade.points}</div>
            <div class="award-title">${esc(e.medal.title)}</div>
            ${e.medal.reason ? `<div class="award-desc">${esc(e.medal.reason)}</div>` : ''}
            <button class="btn small" data-action="story" data-kind="medal" data-id="${e.id}">이야기 카드</button>
          </div>
        </div>`);
    }
    if (e.achievement) {
      blocks.push(`
        <div class="award">
          <div class="achv-badge big">${esc(e.achievement.symbol)}</div>
          <div class="award-body">
            <div class="award-kicker">업적 달성 · 업적 포인트 +${LM.ACHIEVEMENT_POINTS}</div>
            <div class="award-title">${esc(e.achievement.title)}</div>
            ${e.achievement.description ? `<div class="award-desc">${esc(e.achievement.description)}</div>` : ''}
            <button class="btn small" data-action="story" data-kind="achievement" data-id="${e.id}">이야기 카드</button>
          </div>
        </div>`);
    }
    return blocks.join('');
  }

  // 훈장·업적을 받은 날의 이야기: 그날의 일기, 기록, 그때의 나
  function showStory(kind, entryId) {
    const e = findEntry(entryId);
    const h = allHonors().find((x) => x.kind === kind && x.entryId === entryId);
    if (!e || !h) return;
    const isMedal = kind === 'medal';
    const snap = (progress.perEntry[entryId] || {}).snapshot;
    const equipped = state.character.title === honorKey(h);
    const desc = isMedal ? h.reason : h.description;

    const snapshot = snap ? `
      <h3 class="sub-title">그때의 나</h3>
      <div class="snapshot">${snap.stats.map((s) => `<span class="snap"><small>${esc(statName(s.id))}</small><b>${s.value}</b></span>`).join('')}</div>
      ${snap.skills.filter((s) => s.xp > 0).length ? `<p class="hint">${snap.skills.filter((s) => s.xp > 0)
        .map((s) => `${esc(skillName(s.id))} ${LM.skillTier(s.xp).name}`).join(' · ')}</p>` : ''}` : '';

    openModal(`
      <div class="story">
        <div class="story-visual">${isMedal ? LM.medalSvg(h, 112) : `<div class="achv-badge huge">${esc(h.symbol)}</div>`}</div>
        <h2 class="story-title">${esc(h.title)}</h2>
        <p class="story-meta">${isMedal ? `${LM.MEDAL_GRADES[h.grade].label} 훈장` : '업적'} · ${fmtGameDate(e.gameDate, true)} · 업적 포인트 +${h.points}</p>
        ${desc ? `<p class="story-reason">${esc(desc)}</p>` : ''}
      </div>
      <h3 class="sub-title">그날의 일기</h3>
      <p class="story-diary">${esc(e.text)}</p>
      <h3 class="sub-title">${e.mode === 'ai' ? '기록관의 기록' : '남긴 기록'}</h3>
      <blockquote class="narration">${esc(e.narration)}</blockquote>
      ${snapshot}
      <div class="modal-actions">
        <button class="btn ghost" data-action="close-modal">닫기</button>
        ${isMedal && !LM.medalPlaced(state, entryId) ? `<button class="btn" data-action="room-place" data-kind="medal" data-ref="${entryId}">방에 걸기</button>` : ''}
        ${equipped
          ? '<button class="btn" data-action="unequip">칭호 떼기</button>'
          : `<button class="btn primary" data-action="equip" data-key="${honorKey(h)}">칭호로 달기</button>`}
      </div>`);
  }

  async function chooseTitle() {
    const list = allHonors().sort((a, b) => b.gameDate.localeCompare(a.gameDate));
    const current = state.character.title || '';
    const option = (value, label, sub) => `
      <label class="radio">
        <input type="radio" name="title-pick" value="${esc(value)}" ${current === value ? 'checked' : ''}>
        <span><b>${label}</b>${sub ? `<small>${sub}</small>` : ''}</span>
      </label>`;
    const value = await ask(`
      <h2>칭호 바꾸기</h2>
      <div class="radio-list title-list">
        ${option('', '칭호 없음', '')}
        ${list.map((h) => option(honorKey(h), `${esc(h.symbol)} ${esc(h.title)}`,
          `${h.kind === 'medal' ? `${LM.MEDAL_GRADES[h.grade].label} 훈장` : '업적'} · ${fmtGameDate(h.gameDate, true)}`)).join('')}
      </div>
      <div class="modal-actions">
        <button class="btn ghost" data-action="close-modal">취소</button>
        <button class="btn primary" data-action="modal-ok">달기</button>
      </div>`, () => {
      const picked = $modal.querySelector('input[name="title-pick"]:checked');
      return picked ? picked.value : null;
    });
    if (value === null || value === undefined) return;
    state.character.title = value || null;
    await commit();
    render();
    toast(value ? '칭호를 바꿨어요.' : '칭호를 뗐어요.');
  }

  function showResult(id, fresh) {
    const e = findEntry(id);
    if (!e) return;
    const g = progress.perEntry[id] || { stats: [], skills: [] };

    const statRows = g.stats.map((r) => {
      const p = progress.stats[r.id];
      const need = LM.statNeed(p.value);
      return `
        <div class="gain-row">
          <div class="gain-top">
            <span class="name">${esc(statName(r.id))} <b>${p.value}</b></span>
            ${r.to > r.from ? `<span class="levelup">레벨 업 ${r.from} → ${r.to}</span>` : ''}
            <span class="plus">+${r.xp} XP</span>
          </div>
          <div class="bar"><i data-w="${pct(p.xp, need)}" style="width:${fresh ? 0 : pct(p.xp, need)}%"></i></div>
          <div class="gain-note">다음 레벨까지 ${need - p.xp} XP${r.capped ? ' · 오늘 이 스탯은 하루 상한에 닿았어요' : ''}</div>
        </div>`;
    });

    const skillRows = g.skills.map((r) => {
      const xp = progress.skills[r.id].xp;
      const t = LM.skillTier(xp);
      const w = t.next ? pct(xp - t.floor, t.next.xp - t.floor) : 100;
      return `
        <div class="gain-row skill">
          <div class="gain-top">
            <span class="name">${esc(skillName(r.id))} <b>${t.name}</b></span>
            ${r.toTier !== r.fromTier ? `<span class="levelup">${r.fromTier} → ${r.toTier}</span>` : ''}
            <span class="plus">+${r.xp} XP</span>
          </div>
          <div class="bar skill"><i data-w="${w}" style="width:${fresh ? 0 : w}%"></i></div>
          <div class="gain-note">${t.next ? `${t.next.name}까지 ${t.next.xp - xp} XP` : '최고 단계'}${r.capped ? ' · 오늘 이 스킬은 하루 상한에 닿았어요' : ''}</div>
        </div>`;
    });

    const activities = e.activities || [];
    openModal(`
      <div class="modal-head">
        <h2>${fresh ? '오늘의 판정' : `${fmtGameDate(e.gameDate)} ${fmtTime(e.createdAt)}`}</h2>
      </div>
      ${awardBlock(e)}
      <blockquote class="narration big">${esc(e.narration)}</blockquote>
      <h3 class="sub-title">활동</h3>
      ${activities.length ? `<ul class="activity-list">${activities.map(activityItem).join('')}</ul>` : '<p class="hint">판정된 활동이 없어요.</p>'}
      <h3 class="sub-title">성장</h3>
      ${statRows.length || skillRows.length ? statRows.join('') + skillRows.join('') : '<p class="hint">이번 기록으로 오른 능력치는 없어요.</p>'}
      ${pointLines(e, fresh)}
      <div class="modal-actions"><button class="btn primary" data-action="close-modal">확인</button></div>`);

    if (fresh) {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        $modal.querySelectorAll('.bar i[data-w]').forEach((el) => { el.style.width = `${el.dataset.w}%`; });
      }));
    }
  }

  // ---------- 직접 판정 ----------

  const blankRow = () => ({
    summary: '', intensity: 2, primary: state.stats[0].id, secondary: [],
    skill: '', minutes: 60, novelty: 'familiar', output: 'practice',
  });

  function openManual(id) {
    manual = { entryId: id, rows: [blankRow()], medal: { title: '', grade: 'bronze', reason: '', symbol: '🏅' } };
    renderManual();
  }

  function manualRow(r, i) {
    const options = (list, current) => list.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(current) ? 'selected' : ''}>${esc(l)}</option>`).join('');
    const intensityOpts = Object.entries(LM.INTENSITY).map(([n, x]) => [n, `${'★'.repeat(n)} ${x.label} · ${x.example}`]);
    const statOpts = state.stats.map((s) => [s.id, s.name]);
    return `
      <fieldset class="mrow" data-i="${i}">
        <div class="mrow-head">
          <span>활동 ${i + 1}</span>
          ${manual.rows.length > 1 ? `<button type="button" class="icon-btn danger" data-action="manual-remove" data-i="${i}" aria-label="활동 ${i + 1} 지우기">×</button>` : ''}
        </div>
        <label class="field"><span>무엇을 했나요</span><input name="summary" maxlength="200" value="${esc(r.summary)}" placeholder="예: 헬스장에서 하체 운동"></label>
        <label class="field"><span>강도</span><select name="intensity">${options(intensityOpts, r.intensity)}</select></label>
        <label class="field"><span>가장 많이 오른 스탯</span><select name="primary">${options(statOpts, r.primary)}</select></label>
        <div class="field"><span>함께 오른 스탯 · 최대 2개</span>
          <div class="toggle-list">${state.stats.map((s) => `
            <label class="toggle"><input type="checkbox" name="secondary" value="${s.id}" ${r.secondary.includes(s.id) ? 'checked' : ''}><span>${esc(s.name)}</span></label>`).join('')}
          </div>
        </div>
        ${state.skills.length ? `
          <label class="field"><span>관련 스킬</span>
            <select name="skill" data-change="manual-skill"><option value="">없음</option>${options(state.skills.map((s) => [s.id, s.name]), r.skill)}</select>
          </label>
          <div class="skill-grid" ${r.skill ? '' : 'hidden'}>
            <label class="field"><span>쓴 시간 (분)</span><input type="number" name="minutes" min="0" max="1440" step="10" value="${esc(r.minutes)}"></label>
            <label class="field"><span>새로움</span><select name="novelty">${options(Object.entries(LM.NOVELTY).map(([k, v]) => [k, v.label]), r.novelty)}</select></label>
            <label class="field"><span>결과물</span><select name="output">${options(Object.entries(LM.OUTPUT).map(([k, v]) => [k, v.label]), r.output)}</select></label>
          </div>` : ''}
      </fieldset>`;
  }

  function manualMedalForm(md) {
    const grades = Object.entries(LM.MEDAL_GRADES)
      .map(([k, g]) => `<option value="${k}" ${md.grade === k ? 'selected' : ''}>${g.label} · ${g.desc}</option>`).join('');
    return `
      <details class="medal-form" ${md.title ? 'open' : ''}>
        <summary>🏅 훈장으로 기념할 일이 있었나요?</summary>
        <p class="hint">정말 기념하고 싶은 날에만 달아 주세요. 훈장 이름이 곧 칭호가 돼요.</p>
        <label class="field"><span>훈장 이름</span><input name="m-title" maxlength="20" value="${esc(md.title)}" placeholder="예: 첫 5km 완주자"></label>
        <label class="field"><span>등급</span><select name="m-grade">${grades}</select></label>
        <label class="field"><span>무엇을 기념하나요</span><input name="m-reason" maxlength="120" value="${esc(md.reason)}" placeholder="예: 처음으로 쉬지 않고 5km를 달렸다"></label>
        <label class="field"><span>상징 이모지</span><input name="m-symbol" maxlength="8" value="${esc(md.symbol)}"></label>
      </details>`;
  }

  function renderManual() {
    const e = findEntry(manual.entryId);
    const keep = manual;
    openModal(`
      <div class="modal-head">
        <h2>직접 판정</h2>
        <p class="hint">오늘 한 일을 활동별로 골라 주세요. 같은 종류의 일은 하나로 묶으면 돼요.</p>
      </div>
      <details class="diary-peek"><summary>내가 쓴 일기 보기</summary><p>${esc(e.text)}</p></details>
      <div id="manual-rows">${keep.rows.map(manualRow).join('')}</div>
      <button class="btn small" data-action="manual-add">+ 활동 추가</button>
      ${manualMedalForm(keep.medal)}
      <div class="modal-actions">
        <button class="btn ghost" data-action="close-modal">나중에</button>
        <button class="btn primary" data-action="manual-submit">판정하기</button>
      </div>`);
    manual = keep;
  }

  function readManual() {
    manual.rows = [...$modal.querySelectorAll('.mrow')].map((fs) => {
      const val = (name) => { const el = fs.querySelector(`[name="${name}"]`); return el ? el.value : ''; };
      return {
        summary: val('summary'),
        intensity: Number(val('intensity')) || 1,
        primary: val('primary'),
        secondary: [...fs.querySelectorAll('[name="secondary"]:checked')].map((el) => el.value),
        skill: val('skill'),
        minutes: Number(val('minutes')) || 0,
        novelty: val('novelty') || 'familiar',
        output: val('output') || 'practice',
      };
    });
    const field = (name) => { const el = $modal.querySelector(`[name="${name}"]`); return el ? el.value.trim() : ''; };
    manual.medal = { title: field('m-title'), grade: field('m-grade') || 'bronze', reason: field('m-reason'), symbol: field('m-symbol') };
  }

  function manualNarration(name) {
    const lines = [
      `${name}의 하루가 또박또박 기록되었다.`,
      `오늘도 ${name}${josa(name, '은', '는')} 자신만의 속도로 한 걸음 나아갔다.`,
      `기록은 쌓이고, 쌓인 기록은 ${name}의 힘이 된다.`,
    ];
    return lines[state.entries.length % lines.length];
  }

  async function submitManual() {
    readManual();
    const entry = findEntry(manual.entryId);
    const activities = manual.rows.map((r) => ({
      summary: r.summary.trim(),
      intensity: LM.clamp(Math.round(r.intensity), 1, 5),
      primary: r.primary,
      secondary: r.secondary.filter((id) => id !== r.primary).slice(0, 2),
      skills: r.skill ? [{
        id: r.skill,
        minutes: LM.clamp(Math.round(r.minutes), 0, 1440),
        novelty: r.novelty,
        output: r.output,
      }] : [],
    }));
    const md = manual.medal;
    const medal = md.title ? {
      grade: LM.MEDAL_GRADES[md.grade] ? md.grade : 'bronze',
      title: md.title.slice(0, 20),
      reason: md.reason.slice(0, 120),
      symbol: LM.firstEmoji(md.symbol, '🏅'),
      ...LM.medalDesignFor(md.title),
    } : null;
    applyJudgement(entry, { activities, narration: manualNarration(state.character.name), medal }, 'manual');
    manual = null;
    await commit();
    render();
    showResult(entry.id, true);
  }

  // ---------- 기록 ----------

  function viewHistory() {
    if (!state.entries.length) return '<p class="empty">아직 기록이 없어요. 오늘 탭에서 첫 일지를 써 보세요.</p>';
    const groups = {};
    state.entries.forEach((e) => { (groups[e.gameDate] = groups[e.gameDate] || []).push(e); });
    const days = Object.keys(groups).sort().reverse();
    const gd = today();
    return `
      <p class="summary-line">기록한 날 ${days.length}일 · 일지 ${state.entries.length}개</p>
      ${days.map((d) => `
        <h2 class="section-title">${fmtGameDate(d, true)}${d === gd ? ' · 오늘' : ''}</h2>
        ${groups[d].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((e) => entryCard(e, d === gd)).join('')}`).join('')}`;
  }

  // ---------- 퀘스트 ----------

  const KINDS = Object.keys(LM.QUEST_KINDS);
  const FOCUS_EXAMPLES = { daily: '예: 근력 운동', weekly: '예: 독서', monthly: '예: 자격증 취득' };

  // 아직 받지 않은 기간 (직접 추가만 해 둔 기간 포함)
  const unreceivedKinds = () => KINDS.filter((k) => {
    const p = state.quests.periods[LM.periodId(k, today())];
    return !p || !p.received;
  });

  function questPreview() {
    const p = state.quests.periods[LM.periodId('daily', today())];
    const text = p && p.active.length
      ? `오늘의 퀘스트 ${p.active.filter(LM.questDone).length}/${p.active.length} 완료 · 보유 ${wallet.points.toLocaleString()}P`
      : `오늘의 퀘스트를 아직 받지 않았어요 · 보유 ${wallet.points.toLocaleString()}P`;
    return `<button class="quest-preview" data-action="tab" data-tab="quests"><span>${text}</span><b>퀘스트 →</b></button>`;
  }

  function questItem(periodId, q) {
    const done = LM.questDone(q);
    const multi = q.target > 1;
    const last = q.log[q.log.length - 1];
    const meta = [
      multi ? `${q.progress}/${q.target}` : '',
      q.source === 'self' ? '직접 추가' : '',
      last && last.by === 'ai' ? '기록관이 확인함' : '',
    ].filter(Boolean).join(' · ');
    const ids = `data-period="${periodId}" data-quest="${q.id}"`;
    return `
      <li class="quest ${done ? 'done' : ''}">
        <button class="q-check" data-action="quest-check" ${ids} aria-label="${done ? '완료 취소' : multi ? '1회 더하기' : '완료로 표시'}">${done ? '✓' : multi ? '+1' : ''}</button>
        <div class="q-body">
          <div class="q-text">${esc(q.text)}</div>
          ${meta ? `<div class="q-meta">${meta}</div>` : ''}
          ${multi && !done ? `<div class="bar"><i style="width:${pct(q.progress, q.target)}%"></i></div>` : ''}
        </div>
        <div class="q-actions">
          ${multi && q.progress > 0 && !done ? `<button class="icon-btn" data-action="quest-minus" ${ids} aria-label="1회 빼기">−</button>` : ''}
          ${done ? '' : q.source === 'self'
            ? `<button class="icon-btn danger" data-action="quest-remove" ${ids} aria-label="퀘스트 지우기">×</button>`
            : `<button class="icon-btn" data-action="quest-reroll" ${ids} aria-label="다른 퀘스트로 바꾸기" title="다른 퀘스트로 바꾸기">↻</button>`}
        </div>
      </li>`;
  }

  function questSection(kind) {
    const info = LM.QUEST_KINDS[kind];
    const gd = today();
    const periodId = LM.periodId(kind, gd);
    const p = state.quests.periods[periodId];
    const focus = state.quests.focus[kind];
    const doneCount = p ? p.active.filter(LM.questDone).length : 0;
    return `
      <section class="card quest-card">
        <div class="card-head">
          <h2 class="card-title">${info.label} 퀘스트 <small>${LM.periodLabel(kind, LM.periodKey(kind, gd))} · 하나에 +${info.reward}P</small></h2>
          ${p && p.active.length ? `<span class="count">${doneCount}/${p.active.length}</span>` : ''}
        </div>
        ${focus ? `<p class="hint" style="margin-top:0">목표: ${esc(focus)}</p>` : ''}
        ${p && p.active.length
          ? `<ul class="quest-list">${p.active.map((q) => questItem(periodId, q)).join('')}</ul>`
          : '<p class="hint">아직 받지 않았어요.</p>'}
        ${!p || p.active.length < LM.MAX_ACTIVE_QUESTS ? `<button class="btn small ghost" data-action="quest-add" data-kind="${kind}">+ 직접 추가</button>` : ''}
      </section>`;
  }

  function viewQuests() {
    const focus = state.quests.focus;
    const hasFocus = KINDS.some((k) => focus[k]);
    const missing = unreceivedKinds();
    return `
      <section class="card wallet-card">
        <div class="wallet-row">
          <div><span class="hint" style="margin:0">보유 포인트${pkMode() ? ' · 사탕' : ''}</span><div class="wallet-points">${wallet.points.toLocaleString()}P${pkMode() ? ` · 🍬${pkw.candy}` : ''}</div></div>
          <button class="btn primary" data-action="gacha">${pkMode() ? '포켓몬 뽑기' : '뽑기'}</button>
        </div>
        <p class="hint">하루 첫 일지 +${LM.DIARY_POINTS}P · ${KINDS.map((k) => `${LM.QUEST_KINDS[k].label} +${LM.QUEST_KINDS[k].reward}P`).join(' · ')}</p>
      </section>
      <section class="card">
        <div class="card-head">
          <h2 class="card-title">요즘 집중하고 싶은 것</h2>
          <button class="btn small ghost" data-action="edit-focus">${hasFocus ? '바꾸기' : '정하기'}</button>
        </div>
        ${hasFocus
          ? `<div class="focus-list">${KINDS.filter((k) => focus[k]).map((k) => `<span class="focus-chip"><small>${LM.QUEST_KINDS[k].label}</small>${esc(focus[k])}</span>`).join('')}</div>`
          : '<p class="hint" style="margin-top:0">정해 두면 그 주제로 퀘스트를 만들어요. 비워 두면 최근 기록을 보고 만들어요.</p>'}
      </section>
      ${missing.length ? `
        <section class="card receive-card">
          <p style="margin:0 0 10px">${missing.map((k) => LM.QUEST_KINDS[k].label).join(' · ')} 퀘스트를 받을 수 있어요.</p>
          <button class="btn primary block" data-action="quests-receive">퀘스트 받기</button>
          <p class="hint">${aiOn() ? '기록관이 최근 기록과 집중 목표를 보고 만들어요.' : '기본 퀘스트에서 골라 드려요. AI를 연결하면 내 생활에 맞춘 퀘스트를 받을 수 있어요.'}</p>
        </section>` : ''}
      ${KINDS.map(questSection).join('')}
      <p class="footer-note">퀘스트는 부담 없이 바꿔도 돼요. ↻를 누르면 다른 퀘스트로 바뀌어요.</p>`;
  }

  async function receiveQuests(forceTemplate) {
    if (busy) return;
    const gd = today();
    const missing = unreceivedKinds();
    if (!missing.length) { closeModal(); return; }
    let generated = null;
    if (aiOn() && !forceTemplate) {
      busy = true;
      openModal(loadingHtml('기록관이 퀘스트를 고르는 중…'), { locked: true });
      try {
        generated = await LM.generateQuests(state, missing, gd);
      } catch (err) {
        console.error(err);
        busy = false;
        openModal(`
          <h2>퀘스트를 만들지 못했어요</h2>
          <p>${esc(err.message || '알 수 없는 오류가 났어요.')}</p>
          <div class="modal-actions">
            <button class="btn ghost" data-action="close-modal">닫기</button>
            <button class="btn" data-action="quests-template">기본 퀘스트로 받기</button>
            <button class="btn primary" data-action="quests-receive">다시 시도</button>
          </div>`);
        return;
      }
      busy = false;
    }
    for (const kind of missing) {
      const id = LM.periodId(kind, gd);
      const p = state.quests.periods[id]
        || (state.quests.periods[id] = { kind, key: LM.periodKey(kind, gd), active: [], spare: [], createdAt: new Date().toISOString() });
      let list = generated ? generated[kind] : [];
      if (list.length < LM.QUESTS_PER_BATCH) list = list.concat(LM.templateQuests(state, kind, LM.QUESTS_PER_BATCH - list.length));
      const room = Math.max(0, LM.MAX_ACTIVE_QUESTS - p.active.length);
      const shown = Math.min(LM.QUESTS_SHOWN, room);
      p.active = p.active.concat(list.slice(0, shown));
      p.spare = list.slice(shown);
      p.received = true;
    }
    await commit();
    closeModal();
    render();
    toast('퀘스트를 받았어요.');
  }

  async function refillSpare(p) {
    if (aiOn()) {
      busy = true;
      openModal(loadingHtml('새 퀘스트를 고르는 중…'), { locked: true });
      try {
        p.spare = (await LM.generateQuests(state, [p.kind], today()))[p.kind];
      } catch (err) {
        console.error(err);
        toast(`${err.message} 기본 퀘스트로 바꿀게요.`);
        p.spare = [];
      } finally {
        busy = false;
        closeModal();
      }
    }
    if (!p.spare.length) p.spare = LM.templateQuests(state, p.kind, LM.QUESTS_PER_BATCH);
  }

  async function rerollQuest(periodId, questId) {
    if (busy) return;
    const p = state.quests.periods[periodId];
    const idx = p ? p.active.findIndex((q) => q.id === questId) : -1;
    if (idx < 0 || LM.questDone(p.active[idx])) return;
    const shownTexts = new Set(p.active.map((q) => q.text));
    let next = null;
    for (let attempt = 0; attempt < 2 && !next; attempt += 1) {
      if (!p.spare.length) await refillSpare(p);
      while (p.spare.length && !next) {
        const candidate = p.spare.shift();
        if (!shownTexts.has(candidate.text)) next = candidate;
      }
    }
    if (!next) {
      toast('바꿀 퀘스트를 찾지 못했어요.');
      return;
    }
    p.active[idx] = next;
    await commit();
    render();
  }

  async function checkQuest(periodId, questId, delta) {
    const q = findQuest(periodId, questId);
    if (!q) return;
    const wasDone = LM.questDone(q);
    LM.stepQuest(q, delta !== undefined ? delta : (wasDone ? -1 : 1), 'self');
    await commit();
    render();
    if (!wasDone && LM.questDone(q)) toast(`퀘스트 달성! +${LM.QUEST_KINDS[periodId.split(':')[0]].reward}P`);
  }

  async function addCustomQuest(kind) {
    const info = LM.QUEST_KINDS[kind];
    const examples = { daily: '예: 영어 단어 20개 외우기', weekly: '예: 헬스장 3번 가기', monthly: '예: 자격증 교재 1회독' };
    const value = await ask(`
      <form data-submit="modal-ok">
        <h2>${info.label} 퀘스트 직접 추가</h2>
        <label class="field"><span>퀘스트</span><input id="cq-text" maxlength="60" placeholder="${examples[kind]}" autocomplete="off"></label>
        <label class="field"><span>몇 번 해야 끝나나요</span><input id="cq-target" type="number" min="1" max="99" value="1"></label>
        <div class="modal-actions">
          <button type="button" class="btn ghost" data-action="close-modal">취소</button>
          <button class="btn primary">추가</button>
        </div>
      </form>`, () => ({
      text: document.getElementById('cq-text').value.trim(),
      target: Number(document.getElementById('cq-target').value) || 1,
    }));
    if (!value) return;
    if (!value.text) { toast('퀘스트 내용을 적어 주세요.'); return; }
    const gd = today();
    const id = LM.periodId(kind, gd);
    const p = state.quests.periods[id]
      || (state.quests.periods[id] = { kind, key: LM.periodKey(kind, gd), active: [], spare: [], createdAt: new Date().toISOString() });
    if (p.active.length >= LM.MAX_ACTIVE_QUESTS) {
      toast(`${info.label} 퀘스트는 ${LM.MAX_ACTIVE_QUESTS}개까지예요.`);
      return;
    }
    p.active.push(LM.newQuest(value.text, value.target, 'self'));
    await commit();
    render();
    toast('퀘스트를 추가했어요.');
  }

  async function editFocus() {
    const f = state.quests.focus;
    const value = await ask(`
      <form data-submit="modal-ok">
        <h2>요즘 집중하고 싶은 것</h2>
        <p class="hint">기간마다 키워드를 정하면 그 주제로 퀘스트를 만들어요. 비워 두면 최근 기록을 보고 만들어요.</p>
        ${KINDS.map((k) => `
          <label class="field"><span>${LM.QUEST_KINDS[k].label}</span>
            <input id="focus-${k}" maxlength="30" value="${esc(f[k])}" placeholder="${FOCUS_EXAMPLES[k]}" autocomplete="off">
          </label>`).join('')}
        <div class="modal-actions">
          <button type="button" class="btn ghost" data-action="close-modal">취소</button>
          <button class="btn primary">저장</button>
        </div>
      </form>`, () => Object.fromEntries(KINDS.map((k) => [k, document.getElementById(`focus-${k}`).value.trim()])));
    if (!value) return;
    const gd = today();
    for (const k of KINDS) {
      // 목표가 바뀌면 예비 퀘스트를 비워 다음 ↻부터 새 목표로 만든다.
      const p = state.quests.periods[LM.periodId(k, gd)];
      if (p && value[k] !== f[k]) p.spare = [];
    }
    state.quests.focus = value;
    await commit();
    render();
    toast('집중 목표를 저장했어요. 다음에 받거나 바꾸는 퀘스트부터 반영돼요.');
  }

  // ---------- 뽑기 ----------

  const pkMode = () => state.settings.gachaMode === 'pokemon';

  // 포켓몬 도감이 필요할 때 불러온다(처음 한 번만 인터넷에서 받고 이후엔 기기에 저장된 것을 쓴다).
  async function ensureDex() {
    if (LM.pokedex()) return true;
    openModal(loadingHtml('포켓몬 도감을 불러오는 중…'), { locked: true });
    try {
      await LM.loadPokedex((n) => {
        const el = $modal.querySelector('.loading p');
        if (el) el.textContent = `포켓몬 도감을 불러오는 중… ${n}/${LM.PK_MAX}`;
      });
      closeModal();
      return true;
    } catch (err) {
      closeModal();
      toast(err.message);
      return false;
    }
  }

  // 받침에 맞춰 '으로/로'
  const roJosa = (word) => {
    const code = word.charCodeAt(word.length - 1) - 0xac00;
    if (code < 0 || code > 11171) return '(으)로';
    const batchim = code % 28;
    return batchim && batchim !== 8 ? '으로' : '로';
  };

  function pkGachaHtml(results) {
    const rates = Object.values(LM.PK_RARITIES).map((r) => `${r.label} ${r.weight}%`).join(' · ');
    const stage = results
      ? `<div class="gacha-results ${results.length > 1 ? 'many' : 'one'}">${results.map((r, i) => {
        const id = LM.pkNum(r.itemId);
        const p = LM.pk(id);
        return `
          <div class="gacha-card r-${r.rarity}" style="animation-delay:${(i * 0.12).toFixed(2)}s">
            <img class="pk-art" src="${LM.pkArt(id)}" alt="">
            <span class="item-name">${esc(p ? p.name : LM.pkNo(id))}</span>
            <span class="gacha-tag">${r.dup ? `사탕 +${r.candy}` : 'NEW'}</span>
          </div>`;
      }).join('')}</div>`
      : '<div class="gacha-stage" aria-hidden="true">🎁</div>';
    return `
      <div class="modal-head">
        <h2>포켓몬 뽑기</h2>
        <p class="hint">보유 포인트 ${wallet.points.toLocaleString()}P · 사탕 ${pkw.candy}개 · 도감 ${pkw.kinds}/${LM.PK_MAX}</p>
      </div>
      ${stage}
      <div class="gacha-buttons">
        <button class="btn" data-action="pull" data-mode="pokemon" data-times="1">1회 · ${LM.GACHA_COST}P</button>
        <button class="btn primary" data-action="pull" data-mode="pokemon" data-times="10">10회 · ${LM.GACHA_TEN_COST}P</button>
      </div>
      <p class="hint gacha-rates">${rates}<br>10회 뽑기는 고급 이상 1마리 보장 · 뽑을 때마다 사탕 1개, 겹치면 사탕을 더 받아요</p>
      <div class="modal-actions"><button class="btn ghost" data-action="close-modal">닫기</button></div>`;
  }

  async function openGacha(mode) {
    if (mode === 'pokemon') {
      if (!(await ensureDex())) return;
      openModal(pkGachaHtml(null));
    } else {
      openModal(gachaHtml(null));
    }
  }

  function gachaHtml(results) {
    const left = LM.GACHA_PITY - wallet.sinceLegend;
    const rates = Object.values(LM.RARITIES).map((r) => `${r.label} ${r.weight}%`).join(' · ');
    const stage = results
      ? `<div class="gacha-results ${results.length > 1 ? 'many' : 'one'}">${results.map((r, i) => {
        const it = LM.itemById(r.itemId);
        return `
          <div class="gacha-card r-${r.rarity}" style="animation-delay:${(i * 0.12).toFixed(2)}s">
            <span class="item-emoji">${it.emoji}</span>
            <span class="item-name">${esc(it.name)}</span>
            <span class="gacha-tag">${r.dup ? `조각 +${r.shards}` : 'NEW'}</span>
          </div>`;
      }).join('')}</div>`
      : '<div class="gacha-stage" aria-hidden="true">🎁</div>';
    return `
      <div class="modal-head">
        <h2>뽑기</h2>
        <p class="hint">보유 포인트 ${wallet.points.toLocaleString()}P · 조각 ${wallet.shards}개</p>
      </div>
      ${stage}
      <div class="gacha-buttons">
        <button class="btn" data-action="pull" data-times="1">1회 · ${LM.GACHA_COST}P</button>
        <button class="btn primary" data-action="pull" data-times="10">10회 · ${LM.GACHA_TEN_COST}P</button>
      </div>
      <p class="hint gacha-rates">${rates}<br>10회 뽑기는 고급 이상 1개 보장 · 전설 확정까지 ${left}회</p>
      <div class="modal-actions"><button class="btn ghost" data-action="close-modal">닫기</button></div>`;
  }

  async function doPull(times, mode) {
    const cost = times === 10 ? LM.GACHA_TEN_COST : LM.GACHA_COST;
    if (wallet.points < cost) {
      toast(`포인트가 ${(cost - wallet.points).toLocaleString()}P 모자라요.`);
      return;
    }
    if (mode === 'pokemon' && !(await ensureDex())) return;
    const results = mode === 'pokemon' ? LM.pullPokemon(state, times) : LM.pull(state, times);
    if (!results) return;
    await commit();
    render();
    openModal(mode === 'pokemon' ? pkGachaHtml(results) : gachaHtml(results));
  }

  // ---------- 보관함 ----------

  function viewVault() {
    const ownedCount = LM.ITEMS.filter((it) => wallet.owned[it.id]).length;
    const showPk = pkMode() || pkw.kinds > 0;
    if (vaultView === 'pokemon' && !showPk) vaultView = 'items';
    const seg = (id, label) => `<button role="tab" class="${vaultView === id ? 'on' : ''}" aria-selected="${vaultView === id}" data-action="vault-view" data-view="${id}">${label}</button>`;
    const views = { honors: viewHonors, items: viewItems, pokemon: viewPokedex };
    return `
      <div class="segmented ${showPk ? 'three' : ''}" role="tablist">
        ${seg('honors', '훈장 · 업적')}
        ${seg('items', `아이템 ${ownedCount}/${LM.ITEMS.length}`)}
        ${showPk ? seg('pokemon', `포켓몬 ${pkw.kinds}/${LM.PK_MAX}`) : ''}
      </div>
      ${views[vaultView]()}`;
  }

  function viewPokedex() {
    const list = LM.pokedex();
    if (!list) {
      LM.loadPokedex().then(safeRender).catch((err) => toast(err.message));
      return '<p class="empty">포켓몬 도감을 불러오는 중이에요…</p>';
    }
    const counts = Object.keys(LM.PK_RARITIES).map((t) => {
      const all = list.filter((p) => p.tier === t);
      return `<span class="rarity-pill r-${t}">${LM.PK_RARITIES[t].label} ${all.filter((p) => pkw.owned[p.id]).length}/${all.length}</span>`;
    }).join(' ');
    const tiles = list.map((p) => {
      const o = pkw.owned[p.id];
      return `
        <button class="pk-tile r-${p.tier} ${o ? '' : 'locked'}" data-action="pk" data-id="${p.id}" aria-label="${LM.pkNo(p.id)} ${o ? esc(p.name) : '아직 못 만난 포켓몬'}">
          <img src="${LM.pkArt(p.id)}" alt="" loading="lazy" decoding="async">
          <span class="pk-no">${LM.pkNo(p.id)}</span>
          <span class="item-name">${o ? esc(p.name) : '???'}</span>
          ${o && o.count !== 1 ? `<span class="item-count ${o.count ? '' : 'zero'}">×${o.count}</span>` : ''}
        </button>`;
    }).join('');
    return `
      <section class="card">
        <div class="wallet-row">
          <div><span class="hint" style="margin:0">보유 포인트 · 사탕</span><div class="wallet-points">${wallet.points.toLocaleString()}P · 🍬${pkw.candy}</div></div>
          <button class="btn primary" data-action="gacha" data-mode="pokemon">포켓몬 뽑기</button>
        </div>
        <p class="hint">겹친 포켓몬은 사탕이 돼요. 사탕으로 가진 포켓몬을 진화시키거나, 아직 없는 포켓몬을 데려올 수 있어요.</p>
        <div class="pill-row">${counts}</div>
      </section>
      <div class="pk-grid">${tiles}</div>
      <p class="footer-note">포켓몬 이름·그림 출처: PokeAPI<br>포켓몬의 저작권은 Nintendo · Creatures · GAME FREAK · The Pokémon Company에 있어요.</p>`;
  }

  function showPokemon(id) {
    const p = LM.pk(id);
    if (!p) return;
    const o = pkw.owned[id]; // 도감에 있는지 (한 번이라도 만났는지)
    const n = o ? o.count : 0; // 지금 가진 수
    const r = LM.PK_RARITIES[p.tier];
    const actions = [];
    if (!n) {
      actions.push(`<button class="btn primary" data-action="pk-exchange" data-id="${id}">사탕 ${r.price}개로 ${o ? '다시 ' : ''}데려오기</button>`);
    } else {
      p.children.forEach((c) => {
        const cp = LM.pk(c);
        actions.push(`<button class="btn" data-action="pk-evolve" data-from="${id}" data-to="${c}">${esc(cp.name)}${roJosa(cp.name)} 진화 · 사탕 ${LM.evolveCost(c)}</button>`);
      });
      if (n - LM.pkPlacedCount(state, id) > 0) {
        actions.push(`<button class="btn primary" data-action="room-place" data-kind="pokemon" data-ref="${id}">방에 놓기</button>`);
      }
    }
    // 진화 계열: 이전 모습 → 이 포켓몬 → 다음 모습
    const name = (x) => (pkw.owned[x] ? esc(LM.pk(x).name) : '???');
    const line = [];
    if (p.parent) line.push(name(p.parent));
    line.push(`<b>${esc(p.name)}</b>`);
    if (p.children.length) line.push(p.children.map(name).join(' / '));
    openModal(`
      <div class="item-detail">
        <img class="pk-big ${o ? '' : 'locked'}" src="${LM.pkArt(id)}" alt="">
        <p class="hint" style="margin:0">${LM.pkNo(id)}</p>
        <h2>${esc(p.name)}</h2>
        <p class="hint"><span class="rarity-pill r-${p.tier}">${r.label}</span> ${p.types.map((t) => LM.PK_TYPES[t] || t).join(' · ')}</p>
        <p class="hint">${o ? `${fmtDay(o.firstAt)}에 처음 만남 · 지금 ${n}마리` : '아직 못 만났어요'} · 사탕 ${pkw.candy}개</p>
        ${line.length > 1 ? `<p class="hint">진화: ${line.join(' → ')}</p>` : ''}
      </div>
      <div class="modal-actions">
        <button class="btn ghost" data-action="close-modal">닫기</button>${actions.join('')}
      </div>`);
  }

  function viewItems() {
    const owned = wallet.owned;
    const groups = Object.entries(LM.ITEM_CATEGORIES).map(([cat, label]) => {
      const items = LM.ITEMS.filter((it) => it.category === cat);
      const tiles = items.map((it) => {
        const o = owned[it.id];
        return `
          <button class="item-tile r-${it.rarity} ${o ? '' : 'locked'}" data-action="item" data-item="${it.id}">
            <span class="item-emoji">${it.emoji}</span>
            <span class="item-name">${esc(it.name)}</span>
            ${o && o.count > 1 ? `<span class="item-count">×${o.count}</span>` : ''}
          </button>`;
      }).join('');
      return `
        <h2 class="section-title">${label} <span class="count">${items.filter((it) => owned[it.id]).length}/${items.length}</span></h2>
        <div class="item-grid">${tiles}</div>`;
    }).join('');
    return `
      <section class="card">
        <div class="wallet-row">
          <div><span class="hint" style="margin:0">보유 포인트</span><div class="wallet-points">${wallet.points.toLocaleString()}P</div></div>
          <button class="btn primary" data-action="gacha" data-mode="items">아이템 뽑기</button>
        </div>
        <p class="hint">조각 ${wallet.shards}개 · 겹친 아이템은 조각이 되고, 조각으로 아직 없는 아이템을 교환할 수 있어요.</p>
      </section>
      ${groups}`;
  }

  function showItem(itemId) {
    const it = LM.itemById(itemId);
    if (!it) return;
    const o = wallet.owned[itemId];
    const r = LM.RARITIES[it.rarity];
    const isAvatar = it.category === 'avatar';
    let action = '';
    let note = isAvatar ? '아바타로 쓰면 이름 옆과 내 방에 보여요.' : '내 방에 놓을 수 있어요.';
    if (!o) action = `<button class="btn primary" data-action="exchange" data-item="${it.id}">조각 ${r.price}개로 교환</button>`;
    else if (isAvatar && state.character.avatar === it.id) action = `<button class="btn" data-action="set-avatar" data-item="">아바타 해제</button>`;
    else if (isAvatar) action = `<button class="btn primary" data-action="set-avatar" data-item="${it.id}">아바타로 쓰기</button>`;
    else {
      const left = o.count - LM.placedCount(state, it.id);
      if (left > 0) action = `<button class="btn primary" data-action="room-place" data-kind="item" data-ref="${it.id}">방에 놓기</button>`;
      else note = '가진 만큼 모두 방에 놓았어요.';
    }
    openModal(`
      <div class="item-detail">
        <div class="item-big r-${it.rarity} ${o ? '' : 'locked'}">${it.emoji}</div>
        <h2>${esc(it.name)}</h2>
        <p class="hint"><span class="rarity-pill r-${it.rarity}">${r.label}</span> ${LM.ITEM_CATEGORIES[it.category]}</p>
        <p class="hint">${o ? `${fmtDay(o.firstAt)}에 처음 얻음 · ${o.count}개` : `아직 없어요 · 보유 조각 ${wallet.shards}개`}</p>
        <p class="hint">${note}</p>
      </div>
      <div class="modal-actions"><button class="btn ghost" data-action="close-modal">닫기</button>${action}</div>`);
  }

  // ---------- 내 방 ----------

  function roomEntity(r) {
    if (r.kind === 'item') {
      const it = LM.itemById(r.ref);
      return it && wallet.owned[it.id] ? { inner: it.emoji, label: it.name, cls: `ri-${it.category}` } : null;
    }
    if (r.kind === 'medal') {
      const h = progress.honors.medals.find((m) => m.entryId === r.ref);
      return h ? { inner: LM.medalSvg(h, 40), label: `${h.title} 훈장`, cls: 'ri-medal' } : null;
    }
    if (r.kind === 'pokemon') {
      if (!pkw.has(r.ref)) return null;
      const p = LM.pk(r.ref);
      // 포켓몬은 도트 그림 자체가 움직이므로 반려동물처럼 좌우로 돌아다니게 하지 않는다.
      return { inner: `<img class="pk-pixel" src="${LM.pkPixel(r.ref)}" alt="">`, label: p ? p.name : LM.pkNo(r.ref), cls: 'ri-pokemon' };
    }
    const av = avatarItem();
    return av ? { inner: av.emoji, label: state.character.name, cls: 'ri-avatar' } : null;
  }

  function roomItemHtml(r) {
    const ent = roomEntity(r);
    if (!ent) return '';
    let action = '';
    if (!roomEdit && r.kind === 'medal') action = `data-action="story" data-kind="medal" data-id="${r.ref}"`;
    else if (!roomEdit) action = `data-action="room-tap" data-label="${esc(ent.label)}"`;
    return `
      <button class="room-item ${ent.cls} ${roomEdit && roomSel === r.id ? 'sel' : ''}" data-rid="${r.id}" ${action}
        style="left:${r.x}%;top:${r.y}%;z-index:${Math.round(r.y * 10)};--s:${r.scale}" aria-label="${esc(ent.label)}">
        <span class="ri-move"><span class="ri-inner ${r.flip ? 'flip' : ''}">${ent.inner}</span></span>
      </button>`;
  }

  function roomEditor() {
    if (roomDrawer === 'pokemon' && !pkw.kinds) roomDrawer = 'items';
    const sel = roomSel && state.room.items.find((r) => r.id === roomSel);
    const selEnt = sel && roomEntity(sel);
    const tools = selEnt ? `
      <div class="room-tools">
        <span class="rt-name">${esc(selEnt.label)}</span>
        <button class="btn small" data-action="room-size" data-dir="-1" aria-label="작게">작게</button>
        <button class="btn small" data-action="room-size" data-dir="1" aria-label="크게">크게</button>
        <button class="btn small" data-action="room-flip">뒤집기</button>
        ${sel.kind === 'avatar' ? '' : '<button class="btn small ghost danger" data-action="room-remove">빼기</button>'}
      </div>`
      : '<p class="hint room-tip">물건을 끌어서 옮기고, 누르면 크기를 바꾸거나 뺄 수 있어요.</p>';

    let drawer = '';
    if (roomDrawer === 'items') {
      const list = LM.ITEMS.filter((it) => LM.placeableItem(it) && wallet.owned[it.id]);
      drawer = list.length
        ? `<div class="drawer-grid">${list.map((it) => {
          const left = wallet.owned[it.id].count - LM.placedCount(state, it.id);
          return `
            <button class="drawer-tile r-${it.rarity} ${left > 0 ? '' : 'used'}" data-action="room-add" data-kind="item" data-ref="${it.id}" aria-label="${esc(it.name)} 놓기">
              <span class="item-emoji">${it.emoji}</span>
              <span class="item-name">${esc(it.name)}</span>
              <span class="drawer-left">${left > 0 ? `${left}개 남음` : '다 놓음'}</span>
            </button>`;
        }).join('')}</div>`
        : '<p class="hint">아직 놓을 물건이 없어요. 퀘스트 탭의 뽑기에서 가구·소품·반려동물을 얻을 수 있어요.</p>';
    } else if (roomDrawer === 'pokemon') {
      const ids = Object.keys(pkw.owned).map(Number).filter((id) => pkw.has(id)).sort((a, b) => a - b);
      drawer = !ids.length ? '<p class="hint">지금 가진 포켓몬이 없어요.</p>' : `<div class="drawer-grid">${ids.map((id) => {
        const p = LM.pk(id);
        const left = pkw.owned[id].count - LM.pkPlacedCount(state, id);
        return `
          <button class="drawer-tile r-${p ? p.tier : 'common'} ${left > 0 ? '' : 'used'}" data-action="room-add" data-kind="pokemon" data-ref="${id}" aria-label="${esc(p ? p.name : LM.pkNo(id))} 놓기">
            <img class="pk-mini" src="${LM.pkArt(id)}" alt="" loading="lazy">
            <span class="item-name">${esc(p ? p.name : LM.pkNo(id))}</span>
            <span class="drawer-left">${left > 0 ? `${left}마리 남음` : '다 놓음'}</span>
          </button>`;
      }).join('')}</div>`;
    } else if (roomDrawer === 'medals') {
      const medals = progress.honors.medals;
      drawer = medals.length
        ? `<div class="drawer-grid">${medals.map((h) => {
          const placed = LM.medalPlaced(state, h.entryId);
          return `
            <button class="drawer-tile ${placed ? 'used' : ''}" data-action="room-add" data-kind="medal" data-ref="${h.entryId}" aria-label="${esc(h.title)} 걸기">
              ${LM.medalSvg(h, 34)}
              <span class="item-name">${esc(h.title)}</span>
              <span class="drawer-left">${placed ? '걸려 있음' : '걸기'}</span>
            </button>`;
        }).join('')}</div>`
        : '<p class="hint">아직 훈장이 없어요. 받은 훈장은 벽에 걸 수 있어요.</p>';
    } else {
      const tile = ([key, t]) => `
        <button class="theme-tile ${state.room.theme === key ? 'on' : ''}" data-action="room-theme" data-theme="${key}" aria-pressed="${state.room.theme === key}" ${t.concept ? `title="${esc(t.concept)}"` : ''}>
          <span class="room room-mini scene-${t.scene}" style="${LM.sceneStyle(t)}" aria-hidden="true">${LM.sceneHtml(t.scene)}</span>
          <span>${t.label}</span>
        </button>`;
      const themes = Object.entries(LM.ROOM_THEMES);
      drawer = `
        <p class="drawer-label">컨셉 배경</p>
        <div class="theme-grid concept">${themes.filter(([, t]) => t.scene !== 'room').map(tile).join('')}</div>
        <p class="drawer-label">방 색깔</p>
        <div class="theme-grid">${themes.filter(([, t]) => t.scene === 'room').map(tile).join('')}</div>`;
    }

    const seg = (id, label) => `<button role="tab" class="${roomDrawer === id ? 'on' : ''}" aria-selected="${roomDrawer === id}" data-action="room-drawer" data-view="${id}">${label}</button>`;
    const hasPk = pkw.kinds > 0;
    return `
      ${tools}
      <div class="room-drawer card">
        <div class="segmented ${hasPk ? 'four' : 'three'}" role="tablist">${seg('items', '물건')}${hasPk ? seg('pokemon', '포켓몬') : ''}${seg('medals', '훈장')}${seg('theme', '배경')}</div>
        ${drawer}
        <button class="btn primary block" data-action="room-done">꾸미기 끝내기</button>
      </div>`;
  }

  function roomHtml() {
    const t = LM.ROOM_THEMES[state.room.theme];
    // 진화 등으로 가진 수보다 많이 놓여 있는 포켓몬은 가진 수만큼만 보여 준다.
    const shown = {};
    const items = state.room.items.map((r) => {
      if (r.kind === 'pokemon') {
        const k = Number(r.ref);
        shown[k] = (shown[k] || 0) + 1;
        if (shown[k] > (pkw.owned[k] ? pkw.owned[k].count : 0)) return '';
      }
      return roomItemHtml(r);
    }).join('');
    const placed = state.room.items.filter((r) => r.kind !== 'avatar' && roomEntity(r)).length;
    return `
      <section class="room-wrap">
        <div class="room scene-${t.scene} ${t.dark ? 'dark-scene' : ''} ${roomEdit ? 'editing' : ''}" id="room" style="${LM.sceneStyle(t)}">
          <div class="scene" aria-hidden="true">${LM.sceneHtml(t.scene)}</div>
          ${items}
          ${!items.trim() ? '<p class="room-empty">뽑기에서 얻은 가구·반려동물·포켓몬을<br>방에 놓아 보세요</p>' : ''}
        </div>
        ${roomEdit ? roomEditor() : `
          <div class="room-bar">
            <span class="hint" style="margin:0">${esc(state.character.name)}의 방 · 물건 ${placed}개</span>
            <button class="btn small" data-action="room-edit">꾸미기</button>
          </div>`}
      </section>`;
  }

  // 방의 포켓몬 도트는 원래 크기에 비례해 키운다(작은 포켓몬은 작게, 큰 포켓몬은 크게).
  function sizePixel(img) {
    const room = img.closest('.room');
    const item = img.closest('.room-item');
    if (!room || !item || !img.naturalHeight) return;
    const s = parseFloat(item.style.getPropertyValue('--s')) || 1;
    img.style.height = `${Math.round(img.naturalHeight * (room.clientWidth / 300) * s)}px`;
  }
  const sizePixels = () => document.querySelectorAll('.pk-pixel').forEach((img) => { if (img.complete) sizePixel(img); });
  document.addEventListener('load', (ev) => {
    if (ev.target.classList && ev.target.classList.contains('pk-pixel')) sizePixel(ev.target);
  }, true);
  window.addEventListener('resize', sizePixels);

  // 물건을 방에 놓고 꾸미기 모드로 연다.
  async function placeInRoom(kind, ref) {
    if (kind === 'item') {
      const o = wallet.owned[ref];
      if (!o || o.count - LM.placedCount(state, ref) <= 0) {
        toast('가진 만큼 모두 놓았어요.');
        return;
      }
    } else if (kind === 'pokemon') {
      ref = Number(ref);
      const o = pkw.owned[ref];
      if (!o || o.count - LM.pkPlacedCount(state, ref) <= 0) {
        toast('가진 만큼 모두 놓았어요.');
        return;
      }
    } else if (LM.medalPlaced(state, ref)) {
      const r = state.room.items.find((x) => x.kind === 'medal' && x.ref === ref);
      roomSel = r.id;
      roomEdit = true;
      render();
      toast('이미 벽에 걸려 있어요.');
      return;
    }
    const item = LM.newRoomItem(kind, ref);
    state.room.items.push(item);
    roomSel = item.id;
    roomEdit = true;
    await commit();
    render();
  }

  async function updateSelected(fn) {
    const r = state.room.items.find((x) => x.id === roomSel);
    if (!r) return;
    fn(r);
    await commit();
    render();
  }

  // 꾸미기 중 물건 끌기 (마우스·터치 공통)
  document.addEventListener('pointerdown', (ev) => {
    const el = ev.target.closest('.room.editing .room-item');
    if (!el) return;
    const r = state.room.items.find((x) => x.id === el.dataset.rid);
    if (!r) return;
    ev.preventDefault();
    const rect = el.closest('.room').getBoundingClientRect();
    drag = {
      r, el, rect,
      startX: ev.clientX,
      startY: ev.clientY,
      offX: ev.clientX - (rect.left + (r.x / 100) * rect.width),
      offY: ev.clientY - (rect.top + (r.y / 100) * rect.height),
      moved: false,
    };
    try {
      el.setPointerCapture(ev.pointerId);
    } catch (err) { /* 캡처가 안 돼도 문서 단위로 움직임을 받으므로 괜찮다 */ }
  });

  document.addEventListener('pointermove', (ev) => {
    if (!drag) return;
    if (!drag.moved && Math.hypot(ev.clientX - drag.startX, ev.clientY - drag.startY) < 5) return;
    drag.moved = true;
    const { rect, r, el } = drag;
    r.x = Math.round(LM.clamp(((ev.clientX - drag.offX - rect.left) / rect.width) * 100, 3, 97) * 10) / 10;
    r.y = Math.round(LM.clamp(((ev.clientY - drag.offY - rect.top) / rect.height) * 100, 12, 99) * 10) / 10;
    el.style.left = `${r.x}%`;
    el.style.top = `${r.y}%`;
    el.style.zIndex = Math.round(r.y * 10);
  });

  const endDrag = async () => {
    if (!drag) return;
    const { r, moved } = drag;
    drag = null;
    roomSel = r.id;
    if (moved) await commit();
    render();
  };
  document.addEventListener('pointerup', () => { endDrag().catch(handleError); });
  document.addEventListener('pointercancel', () => { endDrag().catch(handleError); });

  // ---------- 훈장 ----------

  function viewHonors() {
    const { medals, achievements, points } = progress.honors;
    const eq = equippedHonor();
    const medalCards = medals.slice().reverse().map((h) => `
      <button class="medal-card" data-action="story" data-kind="medal" data-id="${h.entryId}">
        ${LM.medalSvg(h, 64)}
        <span class="medal-name">${esc(h.title)}</span>
        <span class="medal-sub">${LM.MEDAL_GRADES[h.grade].label} · ${fmtGameDate(h.gameDate)}</span>
      </button>`).join('');
    const achvRows = achievements.slice().reverse().map((h) => `
      <button class="achv-row" data-action="story" data-kind="achievement" data-id="${h.entryId}">
        <span class="achv-badge">${esc(h.symbol)}</span>
        <span class="achv-text"><b>${esc(h.title)}</b>${h.description ? `<small>${esc(h.description)}</small>` : ''}</span>
        <span class="achv-date">${fmtGameDate(h.gameDate)}</span>
      </button>`).join('');

    return `
      <section class="card honors-summary">
        <div class="points"><b>${points.toLocaleString()}</b><span>업적 포인트</span></div>
        <p class="hint">훈장 ${medals.length}개 · 업적 ${achievements.length}개</p>
        <div class="equipped">
          <span class="hint" style="margin:0">달고 있는 칭호</span>
          ${eq ? `<span class="title-pill">${esc(eq.title)}</span>` : '<span class="hint" style="margin:0">없음</span>'}
          ${medals.length + achievements.length ? '<button class="btn small ghost" data-action="choose-title">바꾸기</button>' : ''}
        </div>
      </section>
      <h2 class="section-title">훈장 <span class="count">${medals.length}</span></h2>
      ${medals.length
        ? `<div class="medal-grid">${medalCards}</div>`
        : '<p class="empty">아직 훈장이 없어요. 나에게 기념할 만한 날이 오면 기록관이 훈장을 달아 줘요.</p>'}
      <h2 class="section-title">업적 <span class="count">${achievements.length}</span></h2>
      ${achievements.length
        ? `<div class="achv-list">${achvRows}</div>`
        : '<p class="empty">업적은 일지를 쓸 때 무작위로 찾아와요.</p>'}`;
  }

  // ---------- 캐릭터 ----------

  function rulesHtml() {
    const tiers = LM.SKILL_TIERS.map((t) => `<td>${t.name}<br>${t.xp.toLocaleString()}</td>`).join('');
    return `
      <h3>스탯 경험치 (활동 강도별)</h3>
      <table>
        <tr><th>강도</th><th>예시</th><th>XP</th></tr>
        ${Object.entries(LM.INTENSITY).map(([n, x]) => `<tr><td>${'★'.repeat(n)} ${x.label}</td><td>${x.example}</td><td>${x.xp}</td></tr>`).join('')}
      </table>
      <p>함께 오른 스탯은 절반을 받아요. 스탯 하나는 하루에 최대 ${LM.STAT_DAILY_CAP} XP까지 오르고, 기념비 활동만 예외예요.</p>
      <p>다음 레벨까지 필요한 XP = 20 + (현재 스탯 − 10) × 5. 쉬어도 스탯은 깎이지 않아요.</p>
      <h3>스킬 숙련도</h3>
      <p>숙련도 XP = 투입량 × 새로움 배율 × 결과물 배율</p>
      <p>투입량: ${LM.MINUTES_PER_POINT}분당 1점, 스킬 하나당 하루 최대 ${LM.SKILL_DAILY_POINT_CAP}점</p>
      <p>새로움: ${Object.values(LM.NOVELTY).map((v) => `${v.label} ×${v.mult}`).join(' / ')}</p>
      <p>결과물: ${Object.values(LM.OUTPUT).map((v) => `${v.label} ×${v.mult}`).join(' / ')}</p>
      <table><tr>${tiers}</tr></table>
      <h3>훈장과 업적</h3>
      <p>훈장: 기록관이 '나에게 기념할 만한 날'이라고 판단하면 받아요. 업적 포인트 ${Object.values(LM.MEDAL_GRADES).map((g) => `${g.label} ${g.points}`).join(' / ')}. 동·은 훈장은 ${LM.MEDAL_COOLDOWN_DAYS}일에 한 번이고, 금은 언제든 받을 수 있어요.</p>
      <p>업적: 일지를 쓸 때마다 ${Math.round(LM.ACHIEVEMENT_CHANCE * 100)}% 확률로 찾아오고, ${LM.ACHIEVEMENT_PITY}번째 일지까지 안 나오면 확정이에요. 업적 포인트 ${LM.ACHIEVEMENT_POINTS}.</p>
      <p>훈장과 업적의 이름은 칭호가 되어 이름 옆에 달 수 있어요. 업적 포인트는 쓰는 돈이 아니라 쌓이는 기록이에요.</p>
      <h3>퀘스트와 뽑기</h3>
      <p>포인트: 하루 첫 일지 +${LM.DIARY_POINTS}P, 퀘스트 ${KINDS.map((k) => `${LM.QUEST_KINDS[k].label} +${LM.QUEST_KINDS[k].reward}P`).join(' / ')}.</p>
      <p>뽑기: 1회 ${LM.GACHA_COST}P, 10회 ${LM.GACHA_TEN_COST}P(고급 이상 1개 보장). ${Object.values(LM.RARITIES).map((r) => `${r.label} ${r.weight}%`).join(' / ')}. ${LM.GACHA_PITY}번째 뽑기까지 전설이 안 나오면 확정이에요.</p>
      <p>겹친 아이템은 조각이 돼요 (${Object.values(LM.RARITIES).map((r) => `${r.label} ${r.shards}`).join(' / ')}). 조각으로 없는 아이템을 교환할 수 있어요 (${Object.values(LM.RARITIES).map((r) => `${r.label} ${r.price}`).join(' / ')}).</p>
      <h3>포켓몬 뽑기 (설정에서 뽑기 종류를 바꾸면)</h3>
      <p>1~${LM.PK_MAX}번 포켓몬. ${Object.values(LM.PK_RARITIES).map((r) => `${r.label} ${r.weight}%`).join(' / ')}. 천장은 없고, 10회 뽑기는 고급 이상 1마리를 보장해요.</p>
      <p>등급: 환상(공식 환상 포켓몬) · 전설(공식 전설 포켓몬) · 희귀(최종 진화 중 종족값 500 이상) · 고급(진화한 포켓몬, 진화하지 않는 포켓몬, 원작에서 잡기 어려운 기본형) · 일반(그 밖의 진화 전 포켓몬)</p>
      <p>사탕: 뽑을 때마다 ${LM.PK_CANDY_PER_PULL}개, 겹치면 더 (${Object.values(LM.PK_RARITIES).map((r) => `${r.label} +${r.dupCandy}`).join(' / ')}). 데려오기 (${Object.values(LM.PK_RARITIES).map((r) => `${r.label} ${r.price}`).join(' / ')}), 진화 (진화한 모습이 ${Object.entries(LM.PK_EVOLVE_COST).slice(0, 3).map(([k, v]) => `${LM.PK_RARITIES[k].label}이면 ${v}`).join(' / ')}).</p>`;
  }

  function viewCharacter() {
    const total = state.stats.reduce((sum, s) => sum + progress.stats[s.id].value, 0);
    const editBtn = `<button class="btn small ghost" data-action="toggle-edit">${charEdit ? '완료' : '편집'}</button>`;

    const statRows = state.stats.map((s) => {
      const p = progress.stats[s.id];
      const need = LM.statNeed(p.value);
      return `
        <li>
          <div class="row-top">
            <span class="name">${esc(s.name)}</span>
            <span class="val">${p.value}</span>
            ${charEdit ? `<button class="icon-btn danger" data-action="remove-stat" data-id="${s.id}" aria-label="${esc(s.name)} 지우기">×</button>` : ''}
          </div>
          <div class="bar"><i style="width:${pct(p.xp, need)}%"></i></div>
          <p class="hint">${p.xp} / ${need} XP · 다음 레벨까지 ${need - p.xp} XP</p>
        </li>`;
    }).join('');

    const skillRows = state.skills.map((s) => {
      const xp = progress.skills[s.id].xp;
      const t = LM.skillTier(xp);
      const w = t.next ? pct(xp - t.floor, t.next.xp - t.floor) : 100;
      return `
        <li>
          <div class="row-top">
            <span class="name">${esc(s.name)}</span>
            <span class="tier">${t.name}</span>
            ${charEdit ? `<button class="icon-btn danger" data-action="remove-skill" data-id="${s.id}" aria-label="${esc(s.name)} 지우기">×</button>` : ''}
          </div>
          <div class="bar skill"><i style="width:${w}%"></i></div>
          <p class="hint">누적 ${xp.toLocaleString()} XP · ${t.next ? `${t.next.name}까지 ${(t.next.xp - xp).toLocaleString()} XP` : '최고 단계'}</p>
        </li>`;
    }).join('');

    const addForm = (kind, placeholder) => `
      <form class="add-form" data-submit="add-${kind}">
        <input name="name" maxlength="20" placeholder="${placeholder}" autocomplete="off">
        <button class="btn small">추가</button>
      </form>`;

    return `
      ${roomHtml()}
      <section class="card hero">
        ${equippedHonor() ? `<div><span class="title-pill">${esc(equippedHonor().title)}</span></div>` : ''}
        <div class="hero-name">${esc(state.character.name)}<button class="icon-btn" data-action="rename" aria-label="이름 바꾸기">✎</button></div>
        <div class="hero-meta">${fmtDay(state.createdAt)} 기록 시작 · 일지 ${state.entries.length}개 · 스탯 합계 ${total} · 업적 포인트 ${progress.honors.points.toLocaleString()}</div>
      </section>
      <section class="card">
        <div class="card-head"><h2 class="card-title">스탯</h2>${editBtn}</div>
        <ul class="stat-list">${statRows}</ul>
        ${charEdit ? addForm('stat', '새 스탯 이름 (예: 체력)') : ''}
      </section>
      <section class="card">
        <div class="card-head"><h2 class="card-title">스킬</h2>${editBtn}</div>
        ${state.skills.length ? `<ul class="skill-list">${skillRows}</ul>` : '<p class="hint" style="margin-top:0">키우고 싶은 스킬을 추가해 보세요. 일기에서 관련된 활동이 나오면 숙련도가 올라요.</p>'}
        ${charEdit || !state.skills.length ? addForm('skill', '새 스킬 이름 (예: 마케팅)') : ''}
      </section>
      <details class="card rules"><summary>성장 규칙 보기</summary>${rulesHtml()}</details>`;
  }

  // ---------- 설정 ----------

  function viewSettings() {
    const ai = state.settings.ai;
    const providers = [
      ['none', '직접 판정 (AI 없음)', '키 없이 내가 직접 활동을 골라요'],
      ['gemini', 'Google Gemini', '구글 계정만 있으면 무료 키를 받을 수 있어요'],
      ['claude', 'Claude', '쓴 만큼 요금이 나오는 유료 키가 필요해요'],
    ];
    if (LM.MOCK_ENABLED) providers.push(['mock', '테스트용 가짜 AI', '개발 확인용이에요']);

    const geminiModelField = geminiModels.length
      ? `<select data-change="model" data-provider="gemini">
          ${geminiModels.some((m) => m.id === ai.models.gemini) ? '' : `<option value="${esc(ai.models.gemini)}" selected>${esc(ai.models.gemini)}</option>`}
          ${geminiModels.map((m) => `<option value="${esc(m.id)}" ${m.id === ai.models.gemini ? 'selected' : ''}>${esc(m.id)}</option>`).join('')}
        </select>`
      : `<input data-change="model" data-provider="gemini" value="${esc(ai.models.gemini)}" autocomplete="off">`;

    const gemini = `
      <label class="field"><span>Gemini API 키</span>
        <input type="password" data-change="key" data-provider="gemini" value="${esc(ai.keys.gemini)}" placeholder="AIza로 시작하는 키" autocomplete="off">
      </label>
      <label class="field"><span>모델</span>${geminiModelField}</label>
      <div class="row-actions">
        <button class="btn small ghost" data-action="list-models">모델 목록 불러오기</button>
        <a class="btn small ghost" href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">무료 키 받으러 가기 ↗</a>
      </div>
      <p class="notice warn">무료 키로 쓰면 구글 약관에 따라 보낸 일기가 구글 서비스 개선에 쓰이거나 사람이 검토할 수 있어요. 남에게 보이기 싫은 내용은 빼고 쓰거나, 결제를 연결한 키를 쓰세요.</p>`;

    const claude = `
      <label class="field"><span>Claude API 키</span>
        <input type="password" data-change="key" data-provider="claude" value="${esc(ai.keys.claude)}" placeholder="sk-ant-로 시작하는 키" autocomplete="off">
      </label>
      <label class="field"><span>모델</span>
        <select data-change="model" data-provider="claude">
          ${LM.CLAUDE_MODELS.map((m) => `<option value="${m.id}" ${m.id === ai.models.claude ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}
        </select>
      </label>
      <div class="row-actions">
        <a class="btn small ghost" href="https://platform.claude.com/" target="_blank" rel="noopener">API 키 받으러 가기 ↗</a>
      </div>
      <p class="hint">일기 1건 판정에 Haiku는 약 10원, Opus는 약 40~50원 정도 들어요. 일기 길이에 따라 달라져요.</p>`;

    const lastBackup = state.settings.lastBackupAt
      ? `마지막 백업: ${fmtDay(state.settings.lastBackupAt)}`
      : '아직 백업한 적이 없어요.';

    const backLabel = { today: '오늘로', history: '기록으로', quests: '퀘스트로', vault: '보관함으로', character: '캐릭터로' }[prevTab] || '오늘로';
    return `
      <div class="page-head">
        <h1>설정</h1>
        <button class="btn small" data-action="settings-close">← ${backLabel} 돌아가기</button>
      </div>
      ${syncCard()}
      <section class="card">
        <h2 class="card-title">AI 기록관</h2>
        <div class="radio-list">${providers.map(([v, label, desc]) => `
          <label class="radio">
            <input type="radio" name="provider" value="${v}" data-change="provider" ${ai.provider === v ? 'checked' : ''}>
            <span><b>${label}</b><small>${desc}</small></span>
          </label>`).join('')}
        </div>
        ${ai.provider === 'gemini' ? gemini : ''}
        ${ai.provider === 'claude' ? claude : ''}
        ${ai.provider !== 'none' ? '<div class="row-actions"><button class="btn small" data-action="test-ai">연결 테스트</button><span id="test-result" class="hint" style="margin:0"></span></div>' : ''}
        <p class="hint">API 키는 이 기기의 브라우저에만 저장되고, 백업 파일에는 들어가지 않아요.</p>
      </section>
      <section class="card">
        <h2 class="card-title">뽑기 종류</h2>
        <div class="radio-list">
          <label class="radio">
            <input type="radio" name="gacha-mode" value="items" data-change="gacha-mode" ${state.settings.gachaMode === 'items' ? 'checked' : ''}>
            <span><b>꾸미기 아이템</b><small>가구·소품·반려동물·아바타 ${LM.ITEMS.length}종</small></span>
          </label>
          <label class="radio">
            <input type="radio" name="gacha-mode" value="pokemon" data-change="gacha-mode" ${state.settings.gachaMode === 'pokemon' ? 'checked' : ''}>
            <span><b>포켓몬 1세대</b><small>1~${LM.PK_MAX}번 포켓몬. 처음 켤 때 PokeAPI에서 이름과 그림을 불러와요(인터넷 필요).</small></span>
          </label>
        </div>
        <p class="hint">포인트는 함께 쓰고, 모은 것은 양쪽 다 남아요. 퀘스트 탭의 뽑기 버튼이 고른 종류로 열려요.</p>
      </section>
      <section class="card">
        <h2 class="card-title">하루 기준 시각</h2>
        <label class="field inline"><span>하루가 바뀌는 시각</span>
          <select data-change="day-start">
            ${[0, 1, 2, 3, 4, 5, 6].map((h) => `<option value="${h}" ${h === state.settings.dayStartHour ? 'selected' : ''}>${h === 0 ? '자정 (0시)' : `새벽 ${h}시`}</option>`).join('')}
          </select>
        </label>
        <p class="hint">이 시각 전에 쓴 일기는 전날 기록이 돼요. 지금은 ${fmtGameDate(today())} 일지를 쓰는 중이에요.</p>
      </section>
      <section class="card">
        <h2 class="card-title">백업</h2>
        <p style="margin:0">기록은 이 브라우저 안에만 저장돼요. 브라우저 데이터를 지우거나 기기를 바꾸면 사라지니 백업 파일을 저장해 두세요.</p>
        <p class="hint">${lastBackup}</p>
        <div class="row-actions">
          <button class="btn primary" data-action="export">백업 파일 저장</button>
          <label class="btn">백업 불러오기<input type="file" accept=".json,application/json" data-change="import" hidden></label>
        </div>
      </section>
      <section class="card danger-zone">
        <h2 class="card-title">모든 데이터 지우기</h2>
        <p class="hint" style="margin-top:0">캐릭터와 모든 기록이 지워지고 되돌릴 수 없어요.</p>
        <div class="row-actions"><button class="btn danger" data-action="reset">모두 지우기</button></div>
      </section>
      <p class="footer-note">인생 메이커 · 데이터 버전 ${state.version}</p>`;
  }

  async function testAi(btn) {
    const out = document.getElementById('test-result');
    out.className = 'hint';
    out.textContent = '확인 중…';
    btn.disabled = true;
    try {
      const r = await LM.testConnection(state.settings);
      out.className = 'hint ok';
      out.textContent = `연결됐어요 (${r.model})`;
    } catch (err) {
      console.error(err);
      out.className = 'hint error';
      out.textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  }

  async function loadGeminiModels(btn) {
    btn.disabled = true;
    try {
      const key = state.settings.ai.keys.gemini;
      if (!key) throw new Error('API 키를 먼저 넣어 주세요.');
      geminiModels = await LM.listGeminiModels(key);
      render();
      toast(`모델 ${geminiModels.length}개를 불러왔어요.`);
    } catch (err) {
      toast(err.message);
    } finally {
      btn.disabled = false;
    }
  }

  // ---------- 동기화 ----------

  let renderPending = false;
  let lastSyncError = null;

  // 다른 기기의 기록을 받아 화면을 새로 그릴 때, 글을 쓰는 중이면 끝날 때까지 미룬다.
  function safeRender() {
    const a = document.activeElement;
    const typing = a && $app.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName);
    if (typing || drag) {
      renderPending = true;
      return;
    }
    renderPending = false;
    render();
  }

  function syncStatusText() {
    const S = LM.sync;
    if (S.status === 'syncing') return '다른 기기와 맞추는 중…';
    if (S.status === 'offline') return '인터넷 연결이 없어 잠시 멈췄어요. 연결되면 다시 맞춰요.';
    if (S.status === 'error') return S.message || '맞추지 못했어요.';
    if (S.lastSyncAt) return `마지막으로 맞춘 시각: ${fmtTime(new Date(S.lastSyncAt).toISOString())}`;
    return '로그인되어 있어요.';
  }

  const syncHooks = {
    getState: () => state,
    isBusy: () => busy || !!drag,
    apply(next) {
      const keepAi = state && state.settings.ai;
      state = migrate(next);
      if (keepAi) state.settings.ai = keepAi;
      recompute();
      LM.db.save(state).catch(handleError);
      LM.syncSnap(state);
      safeRender();
    },
    onStatus(S) {
      const el = document.getElementById('sync-status');
      if (el) {
        el.textContent = syncStatusText();
        el.className = `hint${S.status === 'error' ? ' error' : ''}`;
      }
      if (S.status === 'error' && S.message !== lastSyncError) {
        lastSyncError = S.message;
        toast(`동기화 문제: ${S.message}`);
      }
      if (S.status === 'ok') lastSyncError = null;
    },
  };

  function syncCard() {
    if (!LM.FIREBASE) return '';
    if (!LM.sync.loggedIn()) {
      return `
        <section class="card">
          <h2 class="card-title">PC·휴대폰 동기화</h2>
          <p class="hint" style="margin-top:0">로그인하면 이 기기의 기록이 다른 기기와 자동으로 맞춰져요. 기록은 이 기기에서 비밀번호로 잠근 뒤에만 올라가서, 보관소에서는 아무도 내용을 읽을 수 없어요.</p>
          <div class="row-actions"><button class="btn primary" data-action="sync-login">로그인</button></div>
        </section>`;
    }
    return `
      <section class="card">
        <h2 class="card-title">PC·휴대폰 동기화</h2>
        <p style="margin:0">${esc(LM.sync.email())} 계정으로 로그인됨</p>
        <p class="hint${LM.sync.status === 'error' ? ' error' : ''}" id="sync-status">${esc(syncStatusText())}</p>
        <div class="row-actions">
          <button class="btn" data-action="sync-now">지금 맞추기</button>
          <button class="btn ghost" data-action="sync-logout">로그아웃</button>
        </div>
        <p class="hint">일기와 기록은 잠긴 채로 보관돼요. API 키는 기기마다 따로 넣어요.</p>
      </section>`;
  }

  const loginModal = () => ask(`
    <form data-submit="modal-ok">
      <h2>동기화 로그인</h2>
      <p class="hint" style="margin-top:0">Firebase에 만들어 둔 계정의 이메일과 비밀번호를 넣어 주세요.</p>
      <label class="field"><span>이메일</span><input id="sync-email" type="email" autocomplete="username" inputmode="email"></label>
      <label class="field"><span>비밀번호</span><input id="sync-password" type="password" autocomplete="current-password"></label>
      <div class="modal-actions">
        <button type="button" class="btn ghost" data-action="close-modal">취소</button>
        <button class="btn primary">로그인</button>
      </div>
    </form>`, () => ({
    email: document.getElementById('sync-email').value.trim(),
    password: document.getElementById('sync-password').value,
  }));

  // 비밀번호를 바꾼 뒤 로그인하면, 처음 동기화할 때 쓴 비밀번호로 기록 잠금을 연다.
  async function unlockFlow(message, newPassword) {
    const old = await ask(`
      <form data-submit="modal-ok">
        <h2>기록 잠금 열기</h2>
        <p>${esc(message)}</p>
        <label class="field"><span>처음 동기화할 때 쓴 비밀번호</span><input id="old-password" type="password" autocomplete="off"></label>
        <button type="button" class="btn small ghost" data-action="modal-choice" data-value="__reset__">처음 비밀번호가 기억나지 않아요</button>
        <div class="modal-actions">
          <button type="button" class="btn ghost" data-action="close-modal">취소</button>
          <button class="btn primary">열기</button>
        </div>
      </form>`, () => document.getElementById('old-password').value);
    if (!old) {
      await LM.sync.logout();
      return null;
    }
    if (old === '__reset__') {
      const ok = await confirmModal({
        title: '클라우드 기록을 새로 잠글까요?',
        body: state
          ? `클라우드에 있던 기록을 지우고, 이 기기의 기록(${state.character.name}, 일지 ${state.entries.length}개)을 지금 비밀번호로 다시 올려요. 이 기기에 없는 기록만 사라지니, 기록이 가장 많은 기기에서 하세요.`
          : '이 기기에는 기록이 없어서, 클라우드 기록이 모두 지워지고 빈 상태로 다시 시작해요. 기록이 있는 다른 기기에서 하시는 걸 권해요.',
        okLabel: '새로 잠그기',
        danger: true,
      });
      if (!ok) return unlockFlow(message, newPassword);
      openModal(loadingHtml('클라우드 기록을 새로 잠그는 중…'), { locked: true });
      try {
        return await LM.sync.resetCloud(newPassword);
      } catch (err) {
        closeModal();
        toast(err.message);
        await LM.sync.logout();
        return null;
      }
    }
    openModal(loadingHtml('기록 잠금을 여는 중…'), { locked: true });
    try {
      return await LM.sync.unlock(old);
    } catch (err) {
      closeModal();
      toast(err.message);
      return unlockFlow(message, newPassword);
    }
  }

  async function loginFlow() {
    const cred = await loginModal();
    if (!cred) return;
    if (!cred.email || !cred.password) {
      toast('이메일과 비밀번호를 모두 넣어 주세요.');
      return;
    }
    openModal(loadingHtml('로그인하는 중…'), { locked: true });
    let result;
    try {
      result = await LM.sync.login(cred.email, cred.password);
    } catch (err) {
      closeModal();
      if (err.kind === 'crypto-mismatch') {
        result = await unlockFlow(err.message, cred.password);
        if (!result) return;
      } else {
        await LM.sync.logout();
        toast(err.message || String(err));
        return;
      }
    }
    try {
      await linkAfterLogin(result.cloudHas);
    } catch (err) {
      console.error(err);
      closeModal();
      toast(err.message || String(err));
    }
  }

  // 로그인 직후: 이 기기와 클라우드에 기록이 있는지에 따라 불러오기·올리기·합치기를 정한다.
  async function linkAfterLogin(cloudHas) {
    if (!state) {
      if (!cloudHas) {
        closeModal();
        render();
        toast('클라우드에 아직 기록이 없어요. 여기서 새로 시작하면 그 기록이 올라가요.');
        return;
      }
      openModal(loadingHtml('클라우드 기록을 불러오는 중…'), { locked: true });
      state = migrate(LM.assembleState(await LM.sync.pullAll()));
      onboardDraft = null;
      await saveSynced();
      LM.db.requestPersist();
      closeModal();
      goHome();
      render();
      toast(`${state.character.name}의 기록을 불러왔어요.`);
      return;
    }

    if (!cloudHas) {
      openModal(loadingHtml('이 기기의 기록을 올리는 중…'), { locked: true });
      await LM.sync.syncNow();
      closeModal();
      render();
      toast('이 기기의 기록을 올렸어요. 다른 기기에서 로그인하면 이어서 쓸 수 있어요.');
      return;
    }

    openModal(loadingHtml('클라우드 기록을 불러오는 중…'), { locked: true });
    const cloud = migrate(LM.assembleState(await LM.sync.pullAll()));
    cloud.settings.ai = state.settings.ai;
    const localHas = state.entries.length > 0 || state.gacha.pulls.length > 0;
    if (!localHas) {
      state = cloud;
      await saveSynced();
      closeModal();
      render();
      toast(`${state.character.name}의 기록을 불러왔어요.`);
      return;
    }

    closeModal();
    const choice = await ask(`
      <h2>기록을 어떻게 할까요?</h2>
      <p>이 기기(${esc(state.character.name)}, 일지 ${state.entries.length}개)와 클라우드(${esc(cloud.character.name)}, 일지 ${cloud.entries.length}개)에 각각 기록이 있어요.</p>
      <div class="choice-list">
        <button class="choice" data-action="modal-choice" data-value="merge">
          <b>합치기 (추천)</b>
          <small>같은 사람의 기록이니 하나로 합쳐요. 일지·훈장·아이템은 모두 남기고, 이름이 같은 스탯·스킬은 하나로 묶어요.</small>
        </button>
        <button class="choice" data-action="modal-choice" data-value="cloud">
          <b>클라우드 기록으로 바꾸기</b>
          <small>이 기기 기록은 백업 파일로 내려받아 두고, 클라우드 기록만 써요.</small>
        </button>
      </div>
      <div class="modal-actions"><button class="btn ghost" data-action="close-modal">취소 (로그아웃)</button></div>`);
    if (!choice) {
      await LM.sync.logout();
      render();
      toast('로그인을 취소했어요.');
      return;
    }
    if (choice === 'cloud') {
      downloadBackup(state);
      state = cloud;
      await saveSynced();
      render();
      toast('클라우드 기록으로 바꿨어요. 이 기기 기록은 백업 파일로 내려받았어요.');
      return;
    }
    const keepAi = state.settings.ai;
    state = migrate(LM.firstLinkMerge(state, cloud));
    state.settings.ai = keepAi;
    await commit();
    openModal(loadingHtml('합친 기록을 올리는 중…'), { locked: true });
    await LM.sync.syncNow();
    closeModal();
    render();
    toast('두 기록을 합쳤어요.');
  }

  // ---------- 백업 ----------

  // 백업 파일 내려받기만 한다. (API 키는 넣지 않는다.)
  function downloadBackup(s) {
    const now = new Date();
    const copy = JSON.parse(JSON.stringify(s));
    copy.settings.ai.keys = { gemini: '', claude: '' };
    copy.settings.lastBackupAt = now.toISOString();
    const payload = { app: 'life-maker', format: 1, exportedAt: now.toISOString(), state: copy };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `인생메이커-백업-${LM.gameDate(now, 0)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return now.toISOString();
  }

  function exportBackup() {
    state.settings.lastBackupAt = downloadBackup(state);
    commit().then(render);
    toast('백업 파일을 저장했어요.');
  }

  async function importBackup(input) {
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    let payload;
    try {
      payload = JSON.parse(await file.text());
    } catch (err) {
      toast('백업 파일을 읽지 못했어요.');
      return;
    }
    const s = payload && payload.app === 'life-maker' ? payload.state : null;
    if (!isValidState(s)) {
      toast('인생 메이커 백업 파일이 아니에요.');
      return;
    }
    const syncing = LM.sync.loggedIn() && state;
    if (state) {
      const saved = `${payload.exportedAt ? `${fmtDay(payload.exportedAt)} 저장, ` : ''}일지 ${s.entries.length}개`;
      const ok = await confirmModal({
        title: '백업을 불러올까요?',
        body: syncing
          ? `동기화 중이라 지금 기록에 백업 파일(${saved})의 기록을 합쳐요. 이름이 같은 스탯·스킬은 하나로 묶어요.`
          : `지금 이 기기의 기록이 백업 파일(${saved})의 내용으로 바뀌어요.`,
        okLabel: syncing ? '합치기' : '불러오기',
      });
      if (!ok) return;
    }
    const keepAi = state ? state.settings.ai : null;
    // 동기화 중에 통째로 바꾸면 다른 기기 기록과 엉키므로, 지금 기록에 합친다.
    state = syncing ? migrate(LM.firstLinkMerge(migrate(s), state)) : migrate(s);
    if (keepAi) state.settings.ai = keepAi;
    onboardDraft = null;
    await commit();
    LM.db.requestPersist();
    goHome();
    render();
    toast(`${state.character.name}의 기록을 불러왔어요.`);
  }

  // ---------- 그리기 ----------

  const TAB_IDS = [...TABS.map(([id]) => id), 'settings'];
  const tabFromHash = () => {
    const h = location.hash.replace('#', '');
    return TAB_IDS.includes(h) ? h : null;
  };

  // 처음 화면(오늘)으로. 뒤로 가기 기록은 새로 쌓지 않는다.
  function goHome() {
    tab = 'today';
    prevTab = 'today';
    history.replaceState({ tab }, '', '#today');
  }

  // 탭 이동. 뒤로 가기 버튼으로 돌아올 수 있게 기록을 남긴다.
  function setTab(next, fromHistory) {
    if (!TAB_IDS.includes(next)) next = 'today';
    if (next === tab) {
      if (!fromHistory) window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    if (next === 'settings') prevTab = tab;
    settingsPushed = next === 'settings' && !fromHistory;
    tab = next;
    charEdit = false;
    roomEdit = false;
    roomSel = null;
    if (!fromHistory) history.pushState({ tab }, '', `#${tab}`);
    render();
    window.scrollTo(0, 0);
  }

  function render() {
    if (!state) {
      $app.innerHTML = viewOnboarding();
      return;
    }
    const views = {
      today: viewToday, history: viewHistory, quests: viewQuests, vault: viewVault, character: viewCharacter, settings: viewSettings,
    };
    const eq = equippedHonor();
    const avatar = avatarItem();
    $app.innerHTML = `
      <header class="topbar">
        <div class="brand">인생 메이커</div>
        <div class="topbar-right">
          <div class="topbar-meta">
            ${eq ? `<span class="title-pill">${esc(eq.title)}</span>` : ''}
            <span>${avatar ? `${avatar.emoji} ` : ''}${esc(state.character.name)} · ${fmtGameDate(today())}</span>
          </div>
          <button class="icon-btn gear ${tab === 'settings' ? 'on' : ''}" data-action="gear" aria-label="${tab === 'settings' ? '설정 닫기' : '설정'}" aria-pressed="${tab === 'settings'}">${ICONS.settings}</button>
        </div>
      </header>
      <main>${views[tab]()}</main>
      <nav class="tabbar" aria-label="메뉴">
        <div class="tabbar-inner">
          ${TABS.map(([id, label]) => `
            <button class="tab ${tab === id ? 'on' : ''}" data-action="tab" data-tab="${id}" ${tab === id ? 'aria-current="page"' : ''}>${ICONS[id]}${label}</button>`).join('')}
        </div>
      </nav>`;
    sizePixels();
  }

  // ---------- 이벤트 ----------

  async function onAction(action, el) {
    const id = el.dataset.id;
    switch (action) {
      case 'tab':
        setTab(el.dataset.tab);
        break;
      case 'gear':
      case 'settings-close':
        if (tab !== 'settings') setTab('settings');
        else if (settingsPushed) history.back(); // 설정을 연 기록을 되돌려, 뒤로 가기로 설정이 다시 열리지 않게
        else setTab(prevTab);
        break;
      case 'close-modal':
        closeModal();
        break;
      case 'modal-ok':
        modalOk();
        break;

      case 'ob-remove':
        onboardDraft[el.dataset.kind].splice(Number(el.dataset.i), 1);
        render();
        break;
      case 'ob-start':
        await startAdventure();
        break;

      case 'submit-diary':
        await submitDiary();
        break;
      case 'judge':
        closeModal();
        await runAiJudge(id);
        break;
      case 'manual':
        closeModal();
        openManual(id);
        break;
      case 'show-result':
        showResult(id, false);
        break;
      case 'expand':
        el.classList.toggle('open');
        break;
      case 'story':
        showStory(el.dataset.kind, id);
        break;

      case 'quests-receive':
        await receiveQuests(false);
        break;
      case 'quests-template':
        await receiveQuests(true);
        break;
      case 'quest-check':
        await checkQuest(el.dataset.period, el.dataset.quest);
        break;
      case 'quest-minus':
        await checkQuest(el.dataset.period, el.dataset.quest, -1);
        break;
      case 'quest-reroll':
        await rerollQuest(el.dataset.period, el.dataset.quest);
        break;
      case 'quest-remove': {
        const p = state.quests.periods[el.dataset.period];
        if (!p) return;
        p.active = p.active.filter((q) => q.id !== el.dataset.quest);
        await commit();
        render();
        break;
      }
      case 'quest-add':
        await addCustomQuest(el.dataset.kind);
        break;
      case 'edit-focus':
        await editFocus();
        break;
      case 'gacha':
        await openGacha(el.dataset.mode || state.settings.gachaMode);
        break;
      case 'pull':
        await doPull(Number(el.dataset.times), el.dataset.mode || 'items');
        break;
      case 'pk':
        showPokemon(Number(el.dataset.id));
        break;
      case 'pk-exchange': {
        const p = LM.pk(id);
        const price = LM.PK_RARITIES[p.tier].price;
        if (pkw.candy < price) {
          toast(`사탕이 ${price - pkw.candy}개 모자라요.`);
          return;
        }
        const ok = await confirmModal({ title: `${p.name} 데려오기`, body: `사탕 ${price}개를 써서 ${p.name}${josa(p.name, '을', '를')} 데려올까요?`, okLabel: '데려오기' });
        if (!ok || !LM.exchangePokemon(state, p.id)) return;
        await commit();
        render();
        showPokemon(p.id);
        toast(`${p.name}${josa(p.name, '이', '가')} 도감에 등록됐어요.`);
        break;
      }
      case 'pk-evolve': {
        const from = LM.pk(el.dataset.from);
        const to = LM.pk(el.dataset.to);
        const cost = LM.evolveCost(to.id);
        if (pkw.candy < cost) {
          toast(`사탕이 ${cost - pkw.candy}개 모자라요.`);
          return;
        }
        const left = pkw.owned[from.id].count - 1;
        const ok = await confirmModal({
          title: `${from.name} 진화`,
          body: `사탕 ${cost}개를 써서 ${from.name} 1마리를 ${to.name}${roJosa(to.name)} 진화시킬까요? ${from.name}${josa(from.name, '은', '는')} ${left}마리가 남아요.${left ? '' : ' (도감 기록은 그대로 남아요)'}`,
          okLabel: '진화시키기',
        });
        if (!ok || !LM.evolvePokemon(state, from.id, to.id)) return;
        await commit();
        render();
        showPokemon(to.id);
        toast(`${from.name}${josa(from.name, '이', '가')} ${to.name}${roJosa(to.name)} 진화했어요!`);
        break;
      }
      case 'vault-view':
        vaultView = el.dataset.view;
        render();
        break;
      case 'item':
        showItem(el.dataset.item);
        break;
      case 'exchange': {
        const it = LM.itemById(el.dataset.item);
        const price = LM.RARITIES[it.rarity].price;
        if (wallet.shards < price) {
          toast(`조각이 ${price - wallet.shards}개 모자라요.`);
          return;
        }
        const ok = await confirmModal({ title: `${it.name} 교환`, body: `조각 ${price}개를 써서 교환할까요?`, okLabel: '교환' });
        if (!ok || !LM.exchangeItem(state, it.id)) return;
        await commit();
        render();
        showItem(it.id);
        toast(`${it.name}${josa(it.name, '을', '를')} 얻었어요.`);
        break;
      }
      case 'room-edit':
        roomEdit = true;
        roomSel = null;
        render();
        document.getElementById('room').scrollIntoView({ behavior: 'smooth', block: 'start' });
        break;
      case 'room-done':
        roomEdit = false;
        roomSel = null;
        render();
        toast('방을 저장했어요.');
        break;
      case 'room-drawer':
        roomDrawer = el.dataset.view;
        render();
        break;
      case 'room-add':
        await placeInRoom(el.dataset.kind, el.dataset.ref);
        break;
      case 'room-place':
        closeModal();
        setTab('character');
        await placeInRoom(el.dataset.kind, el.dataset.ref);
        document.getElementById('room').scrollIntoView({ behavior: 'smooth', block: 'start' });
        toast('방에 놓았어요. 끌어서 원하는 곳으로 옮겨 보세요.');
        break;
      case 'room-size':
        await updateSelected((r) => {
          const i = LM.ROOM_SIZES.indexOf(r.scale);
          r.scale = LM.ROOM_SIZES[LM.clamp((i < 0 ? 1 : i) + Number(el.dataset.dir), 0, LM.ROOM_SIZES.length - 1)];
        });
        break;
      case 'room-flip':
        await updateSelected((r) => { r.flip = !r.flip; });
        break;
      case 'room-remove':
        state.room.items = state.room.items.filter((r) => r.id !== roomSel);
        roomSel = null;
        await commit();
        render();
        break;
      case 'room-theme':
        state.room.theme = el.dataset.theme;
        await commit();
        render();
        break;
      case 'room-tap':
        el.classList.remove('hop');
        void el.offsetWidth;
        el.classList.add('hop');
        toast(el.dataset.label);
        break;
      case 'set-avatar': {
        const current = state.character.avatar;
        state.character.avatar = el.dataset.item || null;
        LM.ensureAvatarInRoom(state);
        await commit();
        render();
        showItem(el.dataset.item || current);
        toast(el.dataset.item ? '아바타를 바꿨어요.' : '아바타를 해제했어요.');
        break;
      }
      case 'equip':
      case 'unequip': {
        const key = action === 'equip' ? el.dataset.key : state.character.title;
        state.character.title = action === 'equip' ? key : null;
        await commit();
        render();
        toast(action === 'equip' ? '칭호로 달았어요.' : '칭호를 뗐어요.');
        const [kind, entryId] = String(key).split(':');
        showStory(kind, entryId);
        break;
      }
      case 'choose-title':
        await chooseTitle();
        break;
      case 'delete-entry': {
        const doomed = findEntry(id);
        const ok = await confirmModal({
          title: '이 기록을 지울까요?',
          body: doomed && (doomed.medal || doomed.achievement)
            ? '일기와 이 기록으로 얻은 경험치, 훈장·업적이 함께 사라져요.'
            : '일기와 이 기록으로 얻은 경험치가 함께 사라져요.',
          okLabel: '지우기',
          danger: true,
        });
        if (!ok) return;
        for (const qp of (doomed && doomed.questProgress) || []) {
          const q = findQuest(qp.periodId, qp.questId);
          if (q) LM.stepQuest(q, -qp.amount, 'undo', id);
        }
        state.entries = state.entries.filter((e) => e.id !== id);
        LM.tomb(state, 'entries', id);
        await commit();
        render();
        toast('기록을 지웠어요.');
        break;
      }

      case 'manual-add':
        readManual();
        manual.rows.push(blankRow());
        renderManual();
        $modal.querySelectorAll('.mrow')[manual.rows.length - 1].scrollIntoView({ behavior: 'smooth', block: 'start' });
        break;
      case 'manual-remove':
        readManual();
        manual.rows.splice(Number(el.dataset.i), 1);
        renderManual();
        break;
      case 'manual-submit':
        await submitManual();
        break;

      case 'toggle-edit':
        charEdit = !charEdit;
        render();
        break;
      case 'rename': {
        const name = await promptModal({ title: '이름 바꾸기', label: '기록자 이름', value: state.character.name });
        if (!name) return;
        state.character.name = name;
        await commit();
        render();
        break;
      }
      case 'remove-stat': {
        if (state.stats.length <= 1) {
          toast('스탯이 하나 이상 있어야 해요.');
          return;
        }
        const ok = await confirmModal({
          title: `'${statName(id)}' 스탯을 지울까요?`,
          body: '이 스탯으로 쌓은 경험치가 사라져요. 같은 이름으로 다시 만들어도 10부터 시작해요.',
          okLabel: '지우기',
          danger: true,
        });
        if (!ok) return;
        state.stats = state.stats.filter((s) => s.id !== id);
        LM.tomb(state, 'stats', id);
        await commit();
        render();
        break;
      }
      case 'remove-skill': {
        const ok = await confirmModal({
          title: `'${skillName(id)}' 스킬을 지울까요?`,
          body: '이 스킬로 쌓은 숙련도가 사라져요.',
          okLabel: '지우기',
          danger: true,
        });
        if (!ok) return;
        state.skills = state.skills.filter((s) => s.id !== id);
        LM.tomb(state, 'skills', id);
        await commit();
        render();
        break;
      }

      case 'test-ai':
        await testAi(el);
        break;
      case 'list-models':
        await loadGeminiModels(el);
        break;
      case 'export':
        exportBackup();
        break;
      case 'reset': {
        const syncing = LM.sync.loggedIn();
        const ok = await confirmModal({
          title: '모든 데이터를 지울까요?',
          body: syncing
            ? '이 기기의 캐릭터와 일기가 지워지고 동기화에서도 로그아웃돼요. 클라우드 기록은 그대로 남아 있어서, 다시 로그인하면 불러올 수 있어요.'
            : '캐릭터와 모든 일기가 지워지고 되돌릴 수 없어요. 먼저 백업 파일을 저장해 두는 걸 권해요.',
          okLabel: '모두 지우기',
          danger: true,
        });
        if (!ok) return;
        if (syncing) await LM.sync.logout();
        await LM.db.clear();
        state = null;
        progress = null;
        LM.syncSnap(null);
        onboardDraft = freshDraft();
        draftText = '';
        saveDraft('');
        goHome();
        render();
        toast(syncing ? '이 기기의 기록을 지웠어요. 클라우드 기록은 그대로 있어요.' : '모든 데이터를 지웠어요.');
        break;
      }

      case 'sync-login':
        await loginFlow();
        break;
      case 'sync-now':
        try {
          await LM.sync.syncNow();
          toast('다른 기기와 맞췄어요.');
        } catch (err) {
          toast(err.message);
        }
        break;
      case 'sync-logout': {
        const ok = await confirmModal({
          title: '동기화에서 로그아웃할까요?',
          body: '이 기기의 기록은 그대로 남고, 다른 기기와 자동으로 맞추는 것만 멈춰요.',
          okLabel: '로그아웃',
        });
        if (!ok) return;
        await LM.sync.logout();
        render();
        toast('로그아웃했어요.');
        break;
      }
      case 'modal-choice': {
        const p = pending;
        pending = null;
        closeModal();
        if (p) p.resolve(el.dataset.value);
        break;
      }
      default:
        break;
    }
  }

  async function onSubmit(kind, form) {
    const input = form.querySelector('[name="name"]');
    const name = input ? input.value.trim() : '';
    switch (kind) {
      case 'modal-ok':
        modalOk();
        return;
      case 'ob-add': {
        const list = onboardDraft[form.dataset.kind];
        const label = form.dataset.kind === 'stats' ? '스탯' : '스킬';
        const problem = nameProblem(name, list, form.dataset.kind === 'stats' ? MAX_STATS : MAX_SKILLS, label);
        if (problem) { toast(problem); return; }
        list.push(name);
        render();
        document.querySelector(`form[data-kind="${form.dataset.kind}"] input`).focus();
        return;
      }
      case 'add-stat':
      case 'add-skill': {
        const isStat = kind === 'add-stat';
        const list = isStat ? state.stats : state.skills;
        const problem = nameProblem(name, list.map((x) => x.name), isStat ? MAX_STATS : MAX_SKILLS, isStat ? '스탯' : '스킬');
        if (problem) { toast(problem); return; }
        list.push(isStat ? { id: uid(), name } : { id: uid(), name, createdAt: new Date().toISOString() });
        await commit();
        render();
        toast(`'${name}' ${isStat ? '스탯' : '스킬'}을 추가했어요.`);
        return;
      }
      default:
    }
  }

  async function onChange(kind, el) {
    const ai = state && state.settings.ai;
    switch (kind) {
      case 'provider':
        ai.provider = el.value;
        await commit();
        render();
        break;
      case 'key':
        ai.keys[el.dataset.provider] = el.value.trim();
        await commit();
        break;
      case 'model':
        ai.models[el.dataset.provider] = el.value.trim();
        await commit();
        break;
      case 'day-start':
        state.settings.dayStartHour = Number(el.value);
        await commit();
        render();
        break;
      case 'gacha-mode': {
        if (el.value === 'pokemon' && !(await ensureDex())) {
          render(); // 불러오지 못했으면 원래 선택으로 되돌린다
          return;
        }
        state.settings.gachaMode = el.value;
        await commit();
        render();
        toast(el.value === 'pokemon' ? '이제 포켓몬을 뽑아요. 보관함에 포켓몬 도감이 생겼어요.' : '이제 꾸미기 아이템을 뽑아요.');
        break;
      }
      case 'import':
        await importBackup(el);
        break;
      case 'manual-skill':
        el.closest('.mrow').querySelector('.skill-grid').hidden = !el.value;
        break;
      default:
    }
  }

  document.addEventListener('click', (ev) => {
    if (ev.target.matches('[data-backdrop]') && !modalLocked) {
      closeModal();
      return;
    }
    const el = ev.target.closest('[data-action]');
    if (!el) return;
    if (el.tagName === 'A') return;
    ev.preventDefault();
    onAction(el.dataset.action, el).catch(handleError);
  });

  document.addEventListener('submit', (ev) => {
    const form = ev.target.closest('form[data-submit]');
    if (!form) return;
    ev.preventDefault();
    onSubmit(form.dataset.submit, form).catch(handleError);
  });

  document.addEventListener('change', (ev) => {
    const el = ev.target;
    if (el.name === 'secondary' && el.checked) {
      const row = el.closest('.mrow');
      if (row.querySelectorAll('[name="secondary"]:checked').length > 2) {
        el.checked = false;
        toast('함께 오른 스탯은 2개까지 고를 수 있어요.');
      }
      return;
    }
    if (!el.dataset.change) return;
    onChange(el.dataset.change, el).catch(handleError);
  });

  document.addEventListener('input', (ev) => {
    if (ev.target.id === 'diary') {
      draftText = ev.target.value;
      saveDraft(draftText);
    } else if (ev.target.id === 'ob-name' && onboardDraft) {
      onboardDraft.name = ev.target.value;
    }
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && $modal.innerHTML && !modalLocked) closeModal();
  });

  // 휴대폰·브라우저의 뒤로 가기: 창이 열려 있으면 창만 닫고, 아니면 이전 탭으로.
  window.addEventListener('popstate', (ev) => {
    if (!state) return;
    if ($modal.innerHTML) {
      if (!modalLocked) closeModal();
      history.pushState({ tab }, '', `#${tab}`);
      return;
    }
    setTab((ev.state && ev.state.tab) || tabFromHash() || 'today', true);
  });

  // 다른 기기에서 바꾼 기록을 받아 온다. (너무 자주는 하지 않는다)
  function syncSoon() {
    if (LM.sync.loggedIn() && state && Date.now() - (LM.sync.lastSyncAt || 0) > 15000) LM.sync.syncNow().catch(() => {});
  }

  // 앱을 켜 둔 채로 하루가 바뀌면 화면의 날짜를 새로 그리고, 다른 기기의 기록도 받아 온다.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !state) return;
    if (!$modal.innerHTML) safeRender();
    syncSoon();
  });
  window.addEventListener('online', syncSoon);
  document.addEventListener('focusout', () => {
    if (renderPending) setTimeout(() => { if (renderPending) safeRender(); }, 0);
  });

  function handleError(err) {
    console.error(err);
    toast(`문제가 생겼어요: ${err.message || err}`);
  }

  async function init() {
    try {
      state = await LM.db.load();
    } catch (err) {
      console.error(err);
      $app.innerHTML = `<div class="boot">데이터를 불러오지 못했어요: ${esc(err.message)}</div>`;
      return;
    }
    if (state) {
      state = migrate(state);
      recompute();
      tab = tabFromHash() || 'today';
      history.replaceState({ tab }, '', `#${tab}`);
    } else {
      onboardDraft = freshDraft();
    }
    LM.syncSnap(state);
    draftText = loadDraft();
    render();
    // 포켓몬을 쓰는 중이면 도감을 미리 불러 둔다(기기에 저장돼 있으면 바로 끝난다).
    if (state && (pkMode() || pkw.kinds > 0)) LM.loadPokedex().then(safeRender).catch(() => {});
    await LM.sync.init(syncHooks);
    if (LM.sync.loggedIn()) {
      safeRender();
      if (state) LM.sync.syncNow().catch(() => {});
    }
  }

  init();
})(window.LM);
