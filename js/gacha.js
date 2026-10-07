// 뽑기: 아이템 목록, 확률, 포인트·조각 계산.
// 포인트는 일지·퀘스트 기록에서 매번 다시 계산하고, 뽑기 기록만 따로 저장한다.

window.LM = window.LM || {};

(function (LM) {
  LM.RARITIES = {
    common: { label: '일반', weight: 60, shards: 5, price: 30 },
    uncommon: { label: '고급', weight: 28, shards: 15, price: 90 },
    rare: { label: '희귀', weight: 10, shards: 50, price: 300 },
    legendary: { label: '전설', weight: 2, shards: 150, price: 900 },
  };
  LM.GACHA_COST = 100;
  LM.GACHA_TEN_COST = 900; // 10회 뽑기는 1회분 할인 + 고급 이상 1개 보장
  LM.GACHA_PITY = 60; // 60번째 뽑기까지 전설이 안 나오면 확정

  LM.ITEM_CATEGORIES = { furniture: '가구', decor: '소품', pet: '반려동물', avatar: '아바타' };

  const item = (id, emoji, name, category, rarity) => ({ id, emoji, name, category, rarity });
  LM.ITEMS = [
    // 일반
    item('chair', '🪑', '나무 의자', 'furniture', 'common'),
    item('bed', '🛏️', '침대', 'furniture', 'common'),
    item('lamp', '💡', '스탠드', 'furniture', 'common'),
    item('plant', '🪴', '화분', 'decor', 'common'),
    item('candle', '🕯️', '캔들', 'decor', 'common'),
    item('frame', '🖼️', '액자', 'decor', 'common'),
    item('clock', '⏰', '알람시계', 'decor', 'common'),
    item('books', '📚', '책 더미', 'decor', 'common'),
    item('mug', '☕', '머그컵', 'decor', 'common'),
    item('teddy', '🧸', '곰인형', 'decor', 'common'),
    item('backpack', '🎒', '백팩', 'decor', 'common'),
    item('cactus', '🌵', '선인장', 'decor', 'common'),
    item('sunflower', '🌻', '해바라기', 'decor', 'common'),
    item('laptop', '💻', '노트북', 'decor', 'common'),
    item('headphones', '🎧', '헤드폰', 'decor', 'common'),
    item('suitcase', '🧳', '여행 가방', 'decor', 'common'),
    item('gift', '🎁', '선물 상자', 'decor', 'common'),
    item('puzzle', '🧩', '퍼즐', 'decor', 'common'),
    item('dice', '🎲', '주사위', 'decor', 'common'),
    item('fish', '🐠', '열대어', 'pet', 'common'),
    item('turtle', '🐢', '거북이', 'pet', 'common'),
    item('hamster', '🐹', '햄스터', 'pet', 'common'),
    item('coder', '🧑‍💻', '개발자', 'avatar', 'common'),
    item('cook', '🧑‍🍳', '요리사', 'avatar', 'common'),
    item('teacher', '🧑‍🏫', '선생님', 'avatar', 'common'),
    item('farmer', '🧑‍🌾', '농부', 'avatar', 'common'),
    item('runner', '🏃', '러너', 'avatar', 'common'),
    // 고급
    item('sofa', '🛋️', '소파', 'furniture', 'uncommon'),
    item('tv', '📺', '텔레비전', 'furniture', 'uncommon'),
    item('desktop', '🖥️', '데스크톱', 'furniture', 'uncommon'),
    item('mirror', '🪞', '전신 거울', 'furniture', 'uncommon'),
    item('clover', '🍀', '네잎클로버', 'decor', 'uncommon'),
    item('radio', '📻', '라디오', 'decor', 'uncommon'),
    item('phone', '☎️', '다이얼 전화기', 'decor', 'uncommon'),
    item('guitar', '🎸', '기타', 'decor', 'uncommon'),
    item('compass', '🧭', '나침반', 'decor', 'uncommon'),
    item('chess', '♟️', '체스 말', 'decor', 'uncommon'),
    item('kite', '🪁', '연', 'decor', 'uncommon'),
    item('skateboard', '🛹', '스케이트보드', 'decor', 'uncommon'),
    item('cat', '🐈', '고양이', 'pet', 'uncommon'),
    item('dog', '🐕', '강아지', 'pet', 'uncommon'),
    item('rabbit', '🐇', '토끼', 'pet', 'uncommon'),
    item('artist', '🧑‍🎨', '화가', 'avatar', 'uncommon'),
    item('scientist', '🧑‍🔬', '과학자', 'avatar', 'uncommon'),
    item('singer', '🧑‍🎤', '가수', 'avatar', 'uncommon'),
    item('meditator', '🧘', '명상가', 'avatar', 'uncommon'),
    // 희귀
    item('bicycle', '🚲', '자전거', 'furniture', 'rare'),
    item('piano', '🎹', '피아노', 'furniture', 'rare'),
    item('violin', '🎻', '바이올린', 'decor', 'rare'),
    item('vase', '🏺', '도자기', 'decor', 'rare'),
    item('planet', '🪐', '행성 모형', 'decor', 'rare'),
    item('telescope', '🔭', '망원경', 'decor', 'rare'),
    item('trophy', '🏆', '트로피', 'decor', 'rare'),
    item('parrot', '🦜', '앵무새', 'pet', 'rare'),
    item('hedgehog', '🦔', '고슴도치', 'pet', 'rare'),
    item('sloth', '🦥', '나무늘보', 'pet', 'rare'),
    item('firefighter', '🧑‍🚒', '소방관', 'avatar', 'rare'),
    item('pilot', '🧑‍✈️', '파일럿', 'avatar', 'rare'),
    item('climber', '🧗', '클라이머', 'avatar', 'rare'),
    item('surfer', '🏄', '서퍼', 'avatar', 'rare'),
    // 전설
    item('fountain', '⛲', '분수대', 'furniture', 'legendary'),
    item('ferris', '🎡', '관람차 모형', 'decor', 'legendary'),
    item('moai', '🗿', '모아이 석상', 'decor', 'legendary'),
    item('penguin', '🐧', '펭귄', 'pet', 'legendary'),
    item('otter', '🦦', '수달', 'pet', 'legendary'),
    item('astronaut', '🧑‍🚀', '우주비행사', 'avatar', 'legendary'),
  ];
  LM.itemById = (id) => LM.ITEMS.find((it) => it.id === id) || null;

  // 지갑: 번 포인트(일지·퀘스트) − 쓴 포인트(뽑기), 조각, 가진 아이템, 전설 천장까지 남은 수
  LM.wallet = (state) => {
    const diaryDays = new Set(state.entries.filter((e) => e.status === 'judged').map((e) => e.gameDate)).size;
    let questPoints = 0;
    for (const p of Object.values(state.quests.periods)) {
      for (const q of p.active) if (LM.questDone(q)) questPoints += LM.QUEST_KINDS[p.kind].reward;
    }
    const earned = diaryDays * LM.DIARY_POINTS + questPoints;

    let spent = 0;
    let shards = 0;
    let sinceLegend = 0;
    const owned = {};
    const own = (id, at) => {
      const o = owned[id] || (owned[id] = { count: 0, firstAt: at });
      o.count += 1;
    };
    for (const pull of state.gacha.pulls) {
      spent += pull.cost;
      shards += pull.shards || 0;
      own(pull.itemId, pull.at);
      sinceLegend = pull.rarity === 'legendary' ? 0 : sinceLegend + 1;
    }
    for (const ex of state.gacha.exchanges) {
      shards -= ex.cost;
      own(ex.itemId, ex.at);
    }
    return { points: earned - spent, earned, spent, shards, owned, sinceLegend, diaryDays, questPoints };
  };

  function rollRarity() {
    const entries = Object.entries(LM.RARITIES);
    const total = entries.reduce((sum, [, r]) => sum + r.weight, 0);
    let roll = Math.random() * total;
    for (const [key, r] of entries) {
      roll -= r.weight;
      if (roll < 0) return key;
    }
    return 'common';
  }

  // 뽑기. 포인트가 모자라면 null.
  LM.pull = (state, times) => {
    const w = LM.wallet(state);
    const cost = times === 10 ? LM.GACHA_TEN_COST : LM.GACHA_COST * times;
    if (w.points < cost) return null;
    const each = cost / times;
    const counts = {};
    Object.entries(w.owned).forEach(([id, o]) => { counts[id] = o.count; });
    const now = new Date().toISOString();
    const batch = LM.uid();
    let since = w.sinceLegend;
    let gotBetter = false;
    const results = [];

    for (let i = 0; i < times; i += 1) {
      let rarity = since >= LM.GACHA_PITY - 1 ? 'legendary' : rollRarity();
      if (times === 10 && i === times - 1 && !gotBetter && rarity === 'common') rarity = 'uncommon';
      if (rarity !== 'common') gotBetter = true;
      const pool = LM.ITEMS.filter((it) => it.rarity === rarity);
      const picked = pool[Math.floor(Math.random() * pool.length)];
      const dup = (counts[picked.id] || 0) > 0;
      counts[picked.id] = (counts[picked.id] || 0) + 1;
      since = rarity === 'legendary' ? 0 : since + 1;
      results.push({
        id: LM.uid(), at: now, batch, itemId: picked.id, rarity, cost: each, dup,
        shards: dup ? LM.RARITIES[rarity].shards : 0,
      });
    }
    state.gacha.pulls.push(...results);
    return results;
  };

  // 조각으로 아직 없는 아이템 교환. 성공하면 true.
  LM.exchangeItem = (state, itemId) => {
    const it = LM.itemById(itemId);
    const w = LM.wallet(state);
    if (!it || w.owned[itemId]) return false;
    const price = LM.RARITIES[it.rarity].price;
    if (w.shards < price) return false;
    state.gacha.exchanges.push({ id: LM.uid(), at: new Date().toISOString(), itemId, cost: price });
    return true;
  };
})(window.LM);
