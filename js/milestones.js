// 누적 업적
// 일기에 숫자로 남은 양(스킬에 쓴 시간, 달린 거리, 읽은 쪽수, 횟수…)을 화면에 보이지 않게 쌓아 두고,
// 쌓인 양이 의미 있는 큰 숫자를 넘으면 업적으로 남긴다. '하루'의 성과가 아니라 '쌓인 양'에 주는 업적이다.
// - 시간: 100·1000·10000시간을 넘으면 코드가 정해서 준다(직접 판정에서도). 이름은 AI가 지어 주면 그걸 쓴다.
// - 그 밖의 숫자: AI가 그 일과 이 사람에게 의미 있는 기준인지 판단하고, 코드는 실제로 넘었는지만 확인한다.
// 쌓인 양도 스탯처럼 일지에서 매번 다시 계산하므로, 일지를 지우면 그만큼 빠진다.

window.LM = window.LM || {};

(function (LM) {
  LM.MILESTONE_POINTS = 30;
  LM.TIME_MILESTONES = [100, 1000, 10000]; // 시간
  const MAX_PER_ENTRY = 3;
  const MAX_MEASURES = 5;
  const EPS = 1e-6;
  const TIME_SYMBOLS = { 100: '⏳', 1000: '🌳', 10000: '🏔️' };

  // 같은 단위를 여러 가지로 적어도 하나로 모은다. 분은 시간으로 바꿔 쌓는다.
  const UNIT_ALIASES = {
    시간: ['시간', 'h', 'hr', 'hrs', 'hour', 'hours'],
    km: ['km', '킬로', '키로', '킬로미터', 'kilometer', 'kilometers'],
    m: ['m', '미터', 'meter', 'meters'],
    쪽: ['쪽', '페이지', 'p', 'pg', 'page', 'pages'],
    회: ['회', '번', 'rep', 'reps', 'times'],
    세트: ['세트', 'set', 'sets'],
  };
  const MINUTE_UNITS = ['분', 'min', 'mins', 'minute', 'minutes'];
  const aliasOf = {};
  Object.entries(UNIT_ALIASES).forEach(([unit, list]) => list.forEach((a) => { aliasOf[a] = unit; }));

  function normUnit(raw) {
    const u = String(raw || '').trim().toLowerCase().replace(/\.$/, '');
    if (MINUTE_UNITS.includes(u)) return { unit: '시간', scale: 1 / 60 };
    return { unit: aliasOf[u] || u.slice(0, 8), scale: 1 };
  }
  const normName = (n) => String(n || '').trim().replace(/\s+/g, ' ').slice(0, 20);
  const nameKey = (n) => normName(n).toLowerCase().replace(/\s/g, '');
  const measureKey = (name, unit) => `m:${nameKey(name)}|${unit}`;
  const round1 = (n) => Math.round(n * 10) / 10;

  LM.fmtAmount = (n, unit) => `${round1(n).toLocaleString('ko-KR')}${unit}`;

  // AI가 준 숫자 기록 하나를 다듬는다. 쓸 수 없으면 null.
  LM.normMeasure = (m) => {
    if (!m) return null;
    const name = normName(m.name);
    const { unit, scale } = normUnit(m.unit);
    const amount = Number(m.amount) * scale;
    if (!name || !unit || !Number.isFinite(amount) || amount <= 0 || amount > 1e6) return null;
    return { name, unit, amount: Math.round(amount * 1000) / 1000 };
  };
  LM.normMeasures = (list) => (Array.isArray(list) ? list : []).map(LM.normMeasure).filter(Boolean).slice(0, MAX_MEASURES);

  // 일지 하나가 쌓은 양: Map(카운터 key → { key, name, unit, amount })
  function entryCounts(state, entry) {
    const out = new Map();
    const add = (key, name, unit, amount) => {
      if (!out.has(key)) out.set(key, { key, name, unit, amount: 0 });
      out.get(key).amount += amount;
    };
    for (const a of entry.activities || []) {
      for (const sk of a.skills || []) {
        const skill = state.skills.find((s) => s.id === sk.id);
        if (skill && sk.minutes > 0) add(`s:${skill.id}`, skill.name, '시간', sk.minutes / 60);
      }
      for (const m of a.measures || []) {
        const n = LM.normMeasure(m);
        if (n) add(measureKey(n.name, n.unit), n.name, n.unit, n.amount);
      }
    }
    return out;
  }

  // 판정된 일지 전체(exceptId는 빼고)의 누적: Map(key → { key, name, unit, total, lastAt, reached: [받은 기준…] })
  LM.computeCounters = (state, exceptId) => {
    const out = new Map();
    const judged = state.entries
      .filter((e) => e.status === 'judged' && e.id !== exceptId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const e of judged) {
      entryCounts(state, e).forEach((c) => {
        if (!out.has(c.key)) out.set(c.key, { key: c.key, name: c.name, unit: c.unit, total: 0, lastAt: '', reached: [] });
        const t = out.get(c.key);
        t.total += c.amount;
        t.lastAt = e.createdAt;
        t.name = c.name; // 가장 최근에 쓴 이름으로 보여 준다
      });
    }
    for (const e of judged) {
      for (const m of e.milestones || []) {
        const t = out.get(m.counter);
        if (t && !t.reached.includes(m.threshold)) t.reached.push(m.threshold);
      }
    }
    return out;
  };

  // AI에게 보여 줄 누적 기록(이번 일지 전까지). 최근에 쌓인 것부터 최대 40개.
  LM.counterLines = (state, entry) => [...LM.computeCounters(state, entry.id).values()]
    .sort((a, b) => b.lastAt.localeCompare(a.lastAt))
    .slice(0, 40)
    .map((c) => {
      const reached = c.reached.slice().sort((x, y) => x - y).map((t) => LM.fmtAmount(t, c.unit));
      return `- ${c.name} (${c.unit}${c.key.startsWith('s:') ? ', 스킬에 쓴 시간' : ''}): ${LM.fmtAmount(c.total, c.unit)}${reached.length ? ` · 이미 받은 기준: ${reached.join(', ')}` : ''}`;
    });

  // 10, 20, 50, 100, 200, 500, 1000…처럼 1·2·5로 시작하는 딱 떨어지는 수인지
  function isRound(n) {
    if (!Number.isFinite(n) || n < 10) return false;
    const p = 10 ** Math.floor(Math.log10(n) + EPS);
    return [1, 2, 5].some((d) => Math.abs(n / p - d) < EPS);
  }

  // AI가 제안한 누적 업적이 어느 카운터를 가리키는지
  function hintTarget(state, h) {
    const { unit, scale } = normUnit(h.unit);
    const threshold = Number(h.threshold) * scale;
    if (unit === '시간') {
      const skill = state.skills.find((s) => nameKey(s.name) === nameKey(h.name));
      if (skill) return { key: `s:${skill.id}`, threshold };
    }
    return { key: measureKey(h.name, unit), threshold };
  }

  // 이번 일지로 넘은 누적 기준을 정한다. entry는 활동이 채워진 상태여야 한다.
  // hints: AI가 제안한 누적 업적 [{ name, unit, threshold, title, description, symbol }]
  LM.decideMilestones = (state, entry, hints) => {
    const before = LM.computeCounters(state, entry.id);
    const awarded = new Set();
    before.forEach((c) => c.reached.forEach((t) => awarded.add(`${c.key}@${t}`)));
    const targets = (Array.isArray(hints) ? hints : []).map((h) => ({ ...h, ...hintTarget(state, h) }));
    const out = [];

    const give = (c, total, threshold, hint) => {
      const once = `${c.key}@${threshold}`;
      if (awarded.has(once) || out.length >= MAX_PER_ENTRY) return;
      awarded.add(once);
      const amount = LM.fmtAmount(threshold, c.unit);
      out.push({
        id: LM.uid(),
        counter: c.key,
        name: c.name,
        unit: c.unit,
        threshold,
        total: round1(total),
        title: (hint && hint.title) || `${c.name} ${amount}`.slice(0, 20),
        description: (hint && hint.description)
          || (c.unit === '시간' ? `${c.name}에 쓴 시간이 모두 ${amount}에 이르렀다.` : `${c.name} 누적 ${amount}에 이르렀다.`),
        symbol: (hint && hint.symbol) || TIME_SYMBOLS[threshold] || '🏁',
      });
    };

    entryCounts(state, entry).forEach((c) => {
      const prevTotal = before.has(c.key) ? before.get(c.key).total : 0;
      const total = prevTotal + c.amount;
      const mine = targets.filter((h) => h.key === c.key);
      if (c.unit === '시간') {
        LM.TIME_MILESTONES.forEach((t) => {
          if (total + EPS >= t) give(c, total, t, mine.find((h) => Math.abs(h.threshold - t) < EPS));
        });
        return;
      }
      // 시간이 아닌 숫자는 '쌓인 양'일 때만: 전에도 쌓인 기록이 있고, 딱 떨어지는 기준을 실제로 넘었을 때
      mine.forEach((h) => {
        if (prevTotal > 0 && isRound(h.threshold) && total + EPS >= h.threshold) give(c, total, h.threshold, h);
      });
    });
    return out;
  };
})(window.LM);
