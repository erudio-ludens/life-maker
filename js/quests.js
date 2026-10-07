// 퀘스트: 기간 계산, AI 없이 쓰는 기본 퀘스트, 최근 달성률.

window.LM = window.LM || {};

(function (LM) {
  LM.QUEST_KINDS = {
    daily: { label: '일일', reward: 10, prefix: 'd', recent: 7 },
    weekly: { label: '주간', reward: 40, prefix: 'w', recent: 4 },
    monthly: { label: '월간', reward: 150, prefix: 'm', recent: 3 },
  };
  LM.QUESTS_SHOWN = 3; // 기간마다 보이는 퀘스트 수
  LM.QUESTS_PER_BATCH = 9; // 한 번에 받는 수 (나머지는 다시 뽑기용 예비)
  LM.MAX_ACTIVE_QUESTS = 5; // 직접 추가까지 합친 최대 수
  LM.DIARY_POINTS = 5; // 하루 첫 일지 보상

  const parse = (gd) => { const [y, m, d] = gd.split('-').map(Number); return new Date(y, m - 1, d); };
  const fmt = (dt) => `${dt.getFullYear()}-${LM.pad(dt.getMonth() + 1)}-${LM.pad(dt.getDate())}`;

  // 게임 날짜가 속한 기간의 키: 일일=그날, 주간=그 주 월요일, 월간=YYYY-MM
  LM.periodKey = (kind, gd) => {
    if (kind === 'daily') return gd;
    if (kind === 'monthly') return gd.slice(0, 7);
    const dt = parse(gd);
    dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));
    return fmt(dt);
  };
  LM.periodId = (kind, gd) => `${kind}:${LM.periodKey(kind, gd)}`;

  LM.periodLabel = (kind, key) => {
    if (kind === 'daily') { const dt = parse(key); return `${dt.getMonth() + 1}월 ${dt.getDate()}일`; }
    if (kind === 'monthly') return `${Number(key.slice(5, 7))}월`;
    const start = parse(key);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    const endText = start.getMonth() === end.getMonth() ? `${end.getDate()}일` : `${end.getMonth() + 1}월 ${end.getDate()}일`;
    return `${start.getMonth() + 1}월 ${start.getDate()}일 ~ ${endText}`;
  };

  LM.questDone = (q) => q.progress >= q.target;

  LM.newQuest = (text, target, source) => ({
    id: LM.uid(),
    text: String(text).trim().slice(0, 60),
    target: LM.clamp(Math.round(Number(target)) || 1, 1, 99),
    progress: 0,
    log: [],
    source, // ai | template | self
    doneAt: null,
  });

  // 진행도를 바꾸고 완료 시각을 맞춘다.
  LM.stepQuest = (q, amount, by, entryId) => {
    const before = q.progress;
    q.progress = LM.clamp(q.progress + amount, 0, q.target);
    const applied = q.progress - before;
    if (applied) q.log.push({ amount: applied, by, entryId: entryId || null, at: new Date().toISOString() });
    q.doneAt = LM.questDone(q) ? (q.doneAt || new Date().toISOString()) : null;
    return applied;
  };

  // 지난 기간들의 달성률 (0~1). 기록이 없으면 null.
  LM.questRate = (state, kind, gd) => {
    const current = LM.periodKey(kind, gd);
    const quests = Object.values(state.quests.periods)
      .filter((p) => p.kind === kind && p.key < current)
      .sort((a, b) => b.key.localeCompare(a.key))
      .slice(0, LM.QUEST_KINDS[kind].recent)
      .flatMap((p) => p.active);
    if (!quests.length) return null;
    return quests.filter(LM.questDone).length / quests.length;
  };

  LM.recentQuestTexts = (state, kind, limit) => [...new Set(Object.values(state.quests.periods)
    .filter((p) => p.kind === kind)
    .sort((a, b) => b.key.localeCompare(a.key))
    .flatMap((p) => [...p.active, ...p.spare].map((q) => q.text)))]
    .slice(0, limit);

  // ---------- AI 없이 쓰는 기본 퀘스트 ----------

  const POOL = {
    daily: [
      ['물 8잔 마시기', 1], ['20분 걷기', 1], ['책 10쪽 읽기', 1], ['스트레칭 10분 하기', 1],
      ['오늘 배운 것 한 줄 적기', 1], ['방 한 구석 정리하기', 1], ['5분 명상하기', 1], ['감사한 일 3가지 적기', 1],
      ['팔굽혀펴기 20개', 1], ['스쿼트 30개', 1], ['자정 전에 잠들기', 1], ['휴대폰 없이 30분 보내기', 1],
      ['새 단어 5개 외우기', 1], ['가족이나 친구에게 연락하기', 1], ['엘리베이터 대신 계단 이용하기', 1],
    ],
    weekly: [
      ['운동 3번 하기', 3], ['책 1권 끝까지 읽기', 1], ['일지 5번 쓰기', 5], ['새로운 요리 해 먹기', 1],
      ['산책 3번 하기', 3], ['블로그 글 1편 쓰기', 1], ['다음 주 계획 세우기', 1], ['안 해 본 일 하나 해 보기', 1],
      ['방 대청소 하기', 1], ['친구 만나기', 1], ['1시간 공부하는 날 3일 만들기', 3], ['일찍 일어나는 날 3일 만들기', 3],
    ],
    monthly: [
      ['책 3권 읽기', 3], ['새로운 기술 하나 배우기 시작하기', 1], ['운동 12번 하기', 12], ['한 달 지출 정리하기', 1],
      ['작은 결과물 하나 완성하기', 1], ['오래 연락 못 한 사람 만나기', 1], ['일지 20번 쓰기', 20], ['안 가 본 곳 가 보기', 1],
      ['시험이나 자격증 일정 하나 정하기', 1], ['한 가지 습관 2주 이어 가기', 1],
    ],
  };

  const FOCUS = {
    daily: [(k) => [`${k}에 30분 쓰기`, 1], (k) => [`${k} 관련해 한 가지 해내기`, 1], (k) => [`${k} 관련 자료 하나 찾아보기`, 1]],
    weekly: [(k) => [`${k}에 시간 쓰는 날 3일 만들기`, 3], (k) => [`${k} 이번 주 목표 하나 해내기`, 1], (k) => [`${k} 관련해 배운 것 정리하기`, 1]],
    monthly: [(k) => [`${k}에 시간 쓰는 날 12일 만들기`, 12], (k) => [`${k} 관련 작은 결과물 하나 만들기`, 1], (k) => [`${k} 한 달 돌아보기 쓰기`, 1]],
  };

  const shuffle = (list) => list.map((x) => [Math.random(), x]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);

  LM.templateQuests = (state, kind, count) => {
    const focus = (state.quests.focus[kind] || '').trim();
    const recent = new Set(LM.recentQuestTexts(state, kind, 30));
    const picks = [];
    const seen = new Set();
    const add = ([text, target]) => {
      if (seen.has(text)) return;
      seen.add(text);
      picks.push([text, target]);
    };
    if (focus) shuffle(FOCUS[kind]).forEach((f) => add(f(focus)));
    shuffle(POOL[kind]).filter(([t]) => !recent.has(t)).forEach(add);
    shuffle(POOL[kind]).forEach(add); // 다 써 버렸으면 겹쳐도 채운다
    return picks.slice(0, count).map(([t, n]) => LM.newQuest(t, n, 'template'));
  };
})(window.LM);
