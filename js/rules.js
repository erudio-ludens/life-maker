// 게임 규칙과 밸런스 숫자.
// 밸런스를 바꾸고 싶으면 이 파일의 숫자만 고치면 된다.
// 스탯·숙련도는 일기 기록으로부터 매번 다시 계산하므로, 숫자를 바꾸면 과거 기록도 새 기준으로 반영된다.

window.LM = window.LM || {};

(function (LM) {
  LM.DEFAULT_STATS = ['근력', '지구력', '지능', '교양', '지식', '지혜', '매력', '정신력'];
  LM.BASE_STAT = 10;

  // 활동 강도별 스탯 경험치
  LM.INTENSITY = {
    1: { label: '가벼움', xp: 1, example: '산책 20분, 기사 몇 개 읽기' },
    2: { label: '보통', xp: 3, example: '헬스 1시간, 책 50쪽' },
    3: { label: '집중', xp: 6, example: '하루 4시간 공부, 10km 달리기' },
    4: { label: '큰 성취', xp: 12, example: '프로젝트 완성, 시험 응시' },
    5: { label: '기념비', xp: 25, example: '자격증 합격, 마라톤 완주' },
  };
  LM.SECONDARY_RATIO = 0.5; // 보조 스탯은 주 스탯의 절반
  LM.STAT_DAILY_CAP = 15; // 스탯 하나가 하루에 얻는 최대 경험치 (강도 5 활동은 예외)

  // 다음 스탯 1포인트까지 필요한 경험치
  LM.statNeed = (value) => 20 + (value - LM.BASE_STAT) * 5;

  // 스킬 숙련도 = 투입량 × 새로움 배율 × 결과물 배율
  LM.MINUTES_PER_POINT = 30; // 30분당 투입량 1점
  LM.SKILL_DAILY_POINT_CAP = 10; // 스킬 하나당 하루 투입량 최대 10점 (5시간)
  LM.NOVELTY = {
    familiar: { label: '익숙한 반복', mult: 1 },
    somewhat_new: { label: '조금 새로운 것', mult: 1.5 },
    first_challenge: { label: '처음 해보는 도전', mult: 2.5 },
  };
  LM.OUTPUT = {
    practice: { label: '연습·학습', mult: 1 },
    finished: { label: '완성된 결과물', mult: 1.5 },
    system: { label: '남이 쓰거나 계속 돌아가는 것', mult: 3 },
  };
  LM.SKILL_TIERS = [
    { name: '입문', xp: 0 },
    { name: '초보', xp: 100 },
    { name: '견습', xp: 300 },
    { name: '숙련', xp: 800 },
    { name: '전문가', xp: 2000 },
    { name: '달인', xp: 5000 },
    { name: '마스터', xp: 10000 },
  ];

  LM.DEFAULT_DAY_START_HOUR = 4; // 새벽 4시 전까지는 전날로 친다

  // 훈장과 업적
  LM.MEDAL_GRADES = {
    bronze: { label: '동', points: 25, desc: '나에게 의미 있는 첫걸음이나 돌파' },
    silver: { label: '은', points: 50, desc: '오래 노력한 끝에 얻은 뚜렷한 성과' },
    gold: { label: '금', points: 100, desc: '합격, 완주, 출시처럼 인생에 남을 사건' },
  };
  LM.MEDAL_COOLDOWN_DAYS = 7; // 동·은 훈장은 이 기간에 한 번만 (금은 예외)
  LM.ACHIEVEMENT_POINTS = 10;
  LM.ACHIEVEMENT_CHANCE = 0.05; // 일지를 쓸 때마다 5% 확률로 업적 발동
  LM.ACHIEVEMENT_PITY = 30; // 30번째 일지까지 안 나오면 확정

  const pad = (n) => String(n).padStart(2, '0');
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  LM.clamp = clamp;
  LM.pad = pad;
  LM.uid = () => (window.crypto && crypto.randomUUID
    ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2, 10));

  // 하루 기준 시각을 반영한 '게임 날짜' (YYYY-MM-DD)
  LM.gameDate = (date = new Date(), startHour = LM.DEFAULT_DAY_START_HOUR) => {
    const shifted = new Date(date.getTime() - startHour * 3600 * 1000);
    return `${shifted.getFullYear()}-${pad(shifted.getMonth() + 1)}-${pad(shifted.getDate())}`;
  };

  LM.daysBetween = (a, b) => {
    const toUtc = (gd) => { const [y, m, d] = gd.split('-').map(Number); return Date.UTC(y, m - 1, d); };
    return Math.round(Math.abs(toUtc(a) - toUtc(b)) / 86400000);
  };

  // 새 일지의 업적 발동 여부. 일지를 만들 때 한 번만 굴린다.
  LM.rollAchievement = (entries) => {
    let since = 0;
    for (let i = entries.length - 1; i >= 0 && !entries[i].lucky; i--) since++;
    return since >= LM.ACHIEVEMENT_PITY - 1 || Math.random() < LM.ACHIEVEMENT_CHANCE;
  };

  // 가장 가까운 다른 훈장과의 간격. 훈장이 없으면 null.
  LM.daysSinceLastMedal = (state, entry) => {
    let nearest = null;
    for (const e of state.entries) {
      if (e.id === entry.id || !e.medal) continue;
      const gap = LM.daysBetween(e.gameDate, entry.gameDate);
      if (nearest === null || gap < nearest) nearest = gap;
    }
    return nearest;
  };

  LM.medalAllowed = (state, entry, grade) => {
    if (grade === 'gold') return true;
    const gap = LM.daysSinceLastMedal(state, entry);
    return gap === null || gap >= LM.MEDAL_COOLDOWN_DAYS;
  };

  LM.skillTier = (xp) => {
    let index = 0;
    LM.SKILL_TIERS.forEach((tier, i) => { if (xp >= tier.xp) index = i; });
    const tier = LM.SKILL_TIERS[index];
    const next = LM.SKILL_TIERS[index + 1] || null;
    return { index, name: tier.name, floor: tier.xp, next };
  };

  // 모든 판정된 일기를 시간순으로 다시 계산해서 현재 스탯·숙련도와 일기별 획득량을 만든다.
  LM.computeProgress = (state) => {
    const stats = {};
    state.stats.forEach((s) => { stats[s.id] = { value: LM.BASE_STAT, xp: 0 }; });
    const skills = {};
    state.skills.forEach((s) => { skills[s.id] = { xp: 0 }; });

    const perEntry = {};
    const daily = {};
    const judged = state.entries
      .filter((e) => e.status === 'judged')
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    for (const entry of judged) {
      const day = daily[entry.gameDate] || (daily[entry.gameDate] = { stat: {}, skillPoints: {} });
      const statGain = {};
      const skillGain = {};

      for (const act of entry.activities || []) {
        const level = clamp(Math.round(act.intensity) || 1, 1, 5);
        const base = LM.INTENSITY[level].xp;
        const targets = [];
        if (stats[act.primary]) targets.push([act.primary, base]);
        for (const id of act.secondary || []) {
          if (stats[id] && id !== act.primary) targets.push([id, Math.max(1, Math.round(base * LM.SECONDARY_RATIO))]);
        }
        for (const [id, raw] of targets) {
          let xp = raw;
          if (level < 5) {
            const used = day.stat[id] || 0;
            xp = clamp(LM.STAT_DAILY_CAP - used, 0, raw);
            day.stat[id] = used + xp;
          }
          const g = statGain[id] || (statGain[id] = { xp: 0, capped: false });
          g.xp += xp;
          if (xp < raw) g.capped = true;
        }

        for (const sk of act.skills || []) {
          if (!skills[sk.id]) continue;
          const raw = clamp(Math.round((sk.minutes || 0) / LM.MINUTES_PER_POINT), 1, LM.SKILL_DAILY_POINT_CAP);
          const used = day.skillPoints[sk.id] || 0;
          const points = clamp(LM.SKILL_DAILY_POINT_CAP - used, 0, raw);
          day.skillPoints[sk.id] = used + points;
          const novelty = (LM.NOVELTY[sk.novelty] || LM.NOVELTY.familiar).mult;
          const output = (LM.OUTPUT[sk.output] || LM.OUTPUT.practice).mult;
          const xp = Math.round(points * novelty * output);
          const g = skillGain[sk.id] || (skillGain[sk.id] = { xp: 0, capped: false });
          g.xp += xp;
          if (points < raw) g.capped = true;
        }
      }

      const statResults = [];
      for (const [id, g] of Object.entries(statGain)) {
        const s = stats[id];
        const from = s.value;
        s.xp += g.xp;
        while (s.xp >= LM.statNeed(s.value)) {
          s.xp -= LM.statNeed(s.value);
          s.value += 1;
        }
        statResults.push({ id, xp: g.xp, capped: g.capped, from, to: s.value });
      }

      const skillResults = [];
      for (const [id, g] of Object.entries(skillGain)) {
        const s = skills[id];
        const fromTier = LM.skillTier(s.xp).name;
        s.xp += g.xp;
        const toTier = LM.skillTier(s.xp).name;
        skillResults.push({ id, xp: g.xp, capped: g.capped, fromTier, toTier });
      }

      perEntry[entry.id] = { stats: statResults, skills: skillResults };

      // 훈장·업적을 받은 날의 내 모습을 남겨 둔다.
      if (entry.medal || entry.achievement) {
        perEntry[entry.id].snapshot = {
          stats: state.stats.map((s) => ({ id: s.id, value: stats[s.id].value })),
          skills: state.skills.map((s) => ({ id: s.id, xp: skills[s.id].xp })),
        };
      }
    }

    const medals = [];
    const achievements = [];
    for (const entry of judged) {
      if (entry.medal) {
        const grade = LM.MEDAL_GRADES[entry.medal.grade] || LM.MEDAL_GRADES.bronze;
        medals.push({ kind: 'medal', entryId: entry.id, gameDate: entry.gameDate, ...entry.medal, points: grade.points });
      }
      if (entry.achievement) {
        achievements.push({ kind: 'achievement', entryId: entry.id, gameDate: entry.gameDate, ...entry.achievement, points: LM.ACHIEVEMENT_POINTS });
      }
    }
    const points = [...medals, ...achievements].reduce((sum, h) => sum + h.points, 0);

    return { stats, skills, perEntry, honors: { medals, achievements, points } };
  };
})(window.LM);
