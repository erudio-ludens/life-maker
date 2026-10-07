// 훈장 그림(코드로 그리는 SVG)과 업적 이름 도우미.

window.LM = window.LM || {};

(function (LM) {
  LM.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  const METAL = {
    gold: { base: '#E8B931', dark: '#A87A10', light: '#F8E08A' },
    silver: { base: '#C9CED6', dark: '#7D8592', light: '#F1F3F6' },
    bronze: { base: '#CD8A4F', dark: '#8A5427', light: '#EDC094' },
  };

  LM.RIBBON_COLORS = {
    red: '#D64545', blue: '#3B6FD8', green: '#3C9A5F', purple: '#8155C9', orange: '#E8863A',
    sky: '#4FB3E3', navy: '#2C3E70', pink: '#E06A9A', yellow: '#E9C33B', gray: '#7A7F87',
  };

  const CX = 50;
  const CY = 82;
  const ring = (n, outer, inner) => Array.from({ length: n * 2 }, (_, k) => {
    const r = k % 2 ? inner : outer;
    const a = ((-90 + (k * 180) / n) * Math.PI) / 180;
    return `${(CX + r * Math.cos(a)).toFixed(1)},${(CY + r * Math.sin(a)).toFixed(1)}`;
  }).join(' ');
  const polygon = (n, r) => Array.from({ length: n }, (_, k) => {
    const a = ((-90 + (k * 360) / n) * Math.PI) / 180;
    return `${(CX + r * Math.cos(a)).toFixed(1)},${(CY + r * Math.sin(a)).toFixed(1)}`;
  }).join(' ');

  const SEAL = ring(16, 34, 29.5);
  const HEXAGON = polygon(6, 34);

  LM.MEDAL_SHAPES = {
    circle: (paint) => `<circle cx="${CX}" cy="${CY}" r="32" ${paint}/>`,
    seal: (paint) => `<polygon points="${SEAL}" ${paint}/>`,
    shield: (paint) => `<path d="M50 48 L80 57 L79 84 Q75 106 50 117 Q25 106 21 84 L20 57 Z" ${paint}/>`,
    hexagon: (paint) => `<polygon points="${HEXAGON}" ${paint}/>`,
    diamond: (paint) => `<polygon points="50,46 86,82 50,118 14,82" ${paint}/>`,
  };

  // 이모지 하나만 남긴다. 이모지가 아니면 기본 상징을 쓴다.
  LM.firstEmoji = (text, fallback) => {
    const s = String(text || '').trim();
    if (!s) return fallback;
    const first = window.Intl && Intl.Segmenter
      ? [...new Intl.Segmenter('ko', { granularity: 'grapheme' }).segment(s)][0].segment
      : Array.from(s)[0];
    return /\p{Extended_Pictographic}/u.test(first) ? first : fallback;
  };

  LM.medalSvg = (medal, width) => {
    const w = width || 96;
    const metal = METAL[medal.grade] || METAL.bronze;
    const ribbon = medal.ribbon || [];
    const r1 = LM.RIBBON_COLORS[ribbon[0]] || LM.RIBBON_COLORS.red;
    const r2 = LM.RIBBON_COLORS[ribbon[1]] || LM.RIBBON_COLORS.navy;
    const shape = LM.MEDAL_SHAPES[medal.shape] || LM.MEDAL_SHAPES.circle;
    const grade = (LM.MEDAL_GRADES[medal.grade] || LM.MEDAL_GRADES.bronze).label;
    return `
      <svg class="medal-svg" viewBox="0 0 100 124" width="${w}" height="${Math.round(w * 1.24)}" role="img" aria-label="${LM.esc(medal.title)} ${grade} 훈장">
        <rect x="32" y="0" width="18" height="62" fill="${r1}"/>
        <rect x="50" y="0" width="18" height="62" fill="${r2}"/>
        ${shape(`fill="${metal.base}" stroke="${metal.dark}" stroke-width="3" stroke-linejoin="round"`)}
        <circle cx="${CX}" cy="${CY}" r="23" fill="none" stroke="${metal.light}" stroke-width="2"/>
        <text x="${CX}" y="${CY + 1}" text-anchor="middle" dominant-baseline="central" font-size="24">${LM.esc(medal.symbol || '🏅')}</text>
      </svg>`;
  };

  // 직접 판정으로 단 훈장은 이름을 바탕으로 모양과 리본 색을 정한다.
  LM.medalDesignFor = (title) => {
    let h = 0;
    for (const ch of title) h = (h * 31 + ch.codePointAt(0)) >>> 0;
    const shapes = Object.keys(LM.MEDAL_SHAPES);
    const colors = Object.keys(LM.RIBBON_COLORS);
    const c1 = colors[h % colors.length];
    const c2 = colors[(h >>> 4) % colors.length] === c1 ? colors[(h + 3) % colors.length] : colors[(h >>> 4) % colors.length];
    return { shape: shapes[(h >>> 8) % shapes.length], ribbon: [c1, c2] };
  };

  // AI 없이 업적이 발동했을 때 쓸 이름. 그날의 시간·요일·글 길이를 보고 고른다.
  LM.fallbackAchievement = (state, entry) => {
    const when = new Date(entry.createdAt);
    const hour = when.getHours();
    const day = when.getDay();
    const len = entry.text.length;
    const n = state.entries.filter((e) => e.createdAt <= entry.createdAt).length;

    const contextual = [];
    if (hour < 5) contextual.push(['새벽의 기록자', '모두가 잠든 시간에 하루를 기록했다', '🌙']);
    if (hour >= 5 && hour < 9) contextual.push(['아침을 여는 사람', '이른 아침에 기록을 남겼다', '🌅']);
    if (hour >= 22) contextual.push(['밤을 정리하는 사람', '늦은 밤 하루를 차분히 정리했다', '🌃']);
    if (day === 1) contextual.push(['월요일 생존자', '월요일을 버티고 기록까지 남겼다', '☕']);
    if (day === 5) contextual.push(['금요일의 기록자', '금요일에도 기록을 잊지 않았다', '🎉']);
    if (day === 0 || day === 6) contextual.push(['주말에도 쓰는 사람', '쉬는 날에도 기록을 이어 갔다', '🛋️']);
    if (len >= 600) contextual.push(['장문의 기록자', '할 말이 많은 하루를 길게 남겼다', '📜']);
    if (len < 40) contextual.push(['한 줄의 미학', '짧은 한 줄에 하루를 담았다', '✒️']);
    const generic = [
      ['뜻밖의 행운', '평범한 기록 중에 행운이 찾아왔다', '🍀'],
      ['평범한 날의 반짝임', '별일 없는 하루에도 반짝이는 순간이 있었다', '✨'],
      ['꾸준함의 증인', '오늘도 빠짐없이 기록을 남겼다', '🌱'],
      ['보이지 않는 성실함', '아무도 보지 않아도 기록을 이어 갔다', '🪴'],
    ];

    const owned = new Set(state.entries.filter((e) => e.achievement).map((e) => e.achievement.title));
    const shuffle = (list) => list.map((x) => [Math.random(), x]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
    const pick = [...shuffle(contextual), ...shuffle(generic)].find(([title]) => !owned.has(title))
      || [`${n}번째 페이지`, `기록이 ${n}장째 쌓였다`, '📖'];
    return { title: pick[0], description: pick[1], symbol: pick[2] };
  };
})(window.LM);
