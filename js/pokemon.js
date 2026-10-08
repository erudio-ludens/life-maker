// 포켓몬 모드 (뽑기 종류를 '포켓몬 1세대'로 바꿨을 때)
// - 저작권을 지키기 위해 이 저장소에는 포켓몬 이름·그림을 넣지 않는다.
//   모드를 켤 때 PokeAPI(공개 포켓몬 데이터 서비스)에서 1~151번 정보를 불러와 기기에 저장하고,
//   그림은 PokeAPI 그림 저장소에서 바로 보여 준다.
// - 등급은 불러온 데이터(전설·환상 여부, 진화 단계, 종족값, 잡기 난이도)로 정한다.
// - 천장은 없고, 사탕을 모아 원하는 포켓몬을 데려오거나 진화시킨다.

window.LM = window.LM || {};

(function (LM) {
  LM.PK_MAX = 151;
  LM.PK_RARITIES = {
    common: { label: '일반', weight: 52, dupCandy: 2, price: 12 },
    uncommon: { label: '고급', weight: 35, dupCandy: 4, price: 25 },
    rare: { label: '희귀', weight: 10, dupCandy: 10, price: 60 },
    legendary: { label: '전설', weight: 2.5, dupCandy: 30, price: 150 },
    mythical: { label: '환상', weight: 0.5, dupCandy: 50, price: 250 },
  };
  LM.PK_CANDY_PER_PULL = 1; // 뽑을 때마다 받는 사탕 (겹치면 등급별 사탕을 더 받는다)
  LM.PK_EVOLVE_COST = { common: 5, uncommon: 8, rare: 25, legendary: 150, mythical: 250 }; // 진화한 모습의 등급 기준

  LM.PK_TYPES = {
    normal: '노말', fire: '불꽃', water: '물', grass: '풀', electric: '전기', ice: '얼음', fighting: '격투',
    poison: '독', ground: '땅', flying: '비행', psychic: '에스퍼', bug: '벌레', rock: '바위', ghost: '고스트',
    dragon: '드래곤', dark: '악', steel: '강철', fairy: '페어리',
  };

  const SPRITES = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon';
  LM.pkArt = (id) => `${SPRITES}/other/official-artwork/${id}.png`; // 도감·뽑기 카드
  LM.pkPixel = (id) => `${SPRITES}/versions/generation-v/black-white/animated/${id}.gif`; // 내 방 (움직이는 도트)
  LM.pkKey = (id) => `pk:${id}`;
  LM.pkNum = (itemId) => Number(String(itemId).slice(3));
  LM.pkNo = (id) => `No.${String(id).padStart(3, '0')}`;

  // ---------- 도감 불러오기 ----------

  let dex = null; // [{ id, name, tier, types, parent, children, bst }]
  let dexById = new Map();
  let loading = null;

  LM.pokedex = () => dex;
  LM.pk = (id) => dexById.get(Number(id)) || null;

  // 등급 규칙: 환상 > 전설 > 희귀(최종 진화 중 종족값 500 이상) > 고급(진화한 포켓몬·진화 안 하는 포켓몬·구하기 어려운 기본형) > 일반
  function buildDex(raw) {
    const byId = new Map(raw.map((r) => [r.id, r]));
    const children = {};
    raw.forEach((r) => { if (r.parent && byId.has(r.parent)) (children[r.parent] = children[r.parent] || []).push(r.id); });
    const stage = (r) => {
      let n = 0;
      let p = r.parent;
      while (p && byId.has(p)) { n += 1; p = byId.get(p).parent; }
      return n;
    };
    return raw.map((r) => {
      const isFinal = !children[r.id];
      let tier = 'common';
      if (r.mythical) tier = 'mythical';
      else if (r.legendary) tier = 'legendary';
      else if (isFinal && r.bst >= 500) tier = 'rare';
      else if (stage(r) >= 1 || isFinal || r.capture <= 45) tier = 'uncommon';
      return { id: r.id, name: r.name, tier, types: r.types, parent: byId.has(r.parent) ? r.parent : null, children: children[r.id] || [], bst: r.bst };
    });
  }

  async function fetchJson(url, opts) {
    const res = await fetch(url, opts);
    if (!res.ok) throw new Error(`${res.status}`);
    return res.json();
  }

  // 한 번에 받는 방법(GraphQL). 실패하면 하나씩 받는 방법(REST)으로.
  async function fetchGraphql() {
    const query = `query { s: pokemon_v2_pokemonspecies(where:{id:{_lte:${LM.PK_MAX}}}, order_by:{id:asc}) {
      id name capture_rate is_legendary is_mythical evolves_from_species_id
      names: pokemon_v2_pokemonspeciesnames(where:{language_id:{_eq:3}}) { name }
      p: pokemon_v2_pokemons(where:{is_default:{_eq:true}}) {
        stats: pokemon_v2_pokemonstats { base_stat }
        types: pokemon_v2_pokemontypes(order_by:{slot:asc}) { t: pokemon_v2_type { name } } } } }`;
    const data = await fetchJson('https://beta.pokeapi.co/graphql/v1beta', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }),
    });
    const list = data && data.data && data.data.s;
    if (!list || list.length < LM.PK_MAX) throw new Error('incomplete');
    return list.map((s) => ({
      id: s.id,
      name: (s.names[0] && s.names[0].name) || s.name,
      capture: s.capture_rate,
      legendary: s.is_legendary,
      mythical: s.is_mythical,
      parent: s.evolves_from_species_id,
      bst: s.p[0].stats.reduce((sum, x) => sum + x.base_stat, 0),
      types: s.p[0].types.map((x) => x.t.name),
    }));
  }

  async function fetchRest(onProgress) {
    const API = 'https://pokeapi.co/api/v2';
    const ids = Array.from({ length: LM.PK_MAX }, (_, i) => i + 1);
    const out = [];
    let done = 0;
    const worker = async () => {
      while (ids.length) {
        const id = ids.shift();
        const [sp, pk] = await Promise.all([fetchJson(`${API}/pokemon-species/${id}`), fetchJson(`${API}/pokemon/${id}`)]);
        const ko = sp.names.find((n) => n.language.name === 'ko');
        const parentUrl = sp.evolves_from_species && sp.evolves_from_species.url;
        out.push({
          id,
          name: ko ? ko.name : sp.name,
          capture: sp.capture_rate,
          legendary: sp.is_legendary,
          mythical: sp.is_mythical,
          parent: parentUrl ? Number(parentUrl.split('/').filter(Boolean).pop()) : null,
          bst: pk.stats.reduce((sum, x) => sum + x.base_stat, 0),
          types: pk.types.sort((a, b) => a.slot - b.slot).map((x) => x.type.name),
        });
        done += 1;
        if (onProgress) onProgress(done);
      }
    };
    await Promise.all(Array.from({ length: 8 }, worker));
    return out.sort((a, b) => a.id - b.id);
  }

  function setDex(list) {
    dex = list;
    dexById = new Map(list.map((p) => [p.id, p]));
  }

  // 기기에 저장된 도감이 있으면 그걸 쓰고, 없으면 PokeAPI에서 받아 저장한다.
  LM.loadPokedex = async (onProgress) => {
    if (dex) return dex;
    if (loading) return loading;
    loading = (async () => {
      const cached = await LM.db.loadKey('pokedex').catch(() => null);
      if (cached && cached.v === 1 && Array.isArray(cached.list) && cached.list.length === LM.PK_MAX) {
        setDex(cached.list);
        return dex;
      }
      let raw;
      try {
        raw = await fetchGraphql();
      } catch (err) {
        try {
          raw = await fetchRest(onProgress);
        } catch (err2) {
          throw new Error('포켓몬 도감을 불러오지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.');
        }
      }
      setDex(buildDex(raw));
      await LM.db.saveKey('pokedex', { v: 1, at: new Date().toISOString(), list: dex });
      return dex;
    })().finally(() => { loading = null; });
    return loading;
  };

  // ---------- 지갑 (사탕·가진 포켓몬) ----------

  // owned[id] = { count: 지금 가진 수, firstAt: 처음 만난 때 }
  // 진화하면 원래 포켓몬이 1마리 줄지만, 한 번 만난 포켓몬은 0마리가 돼도 도감(owned)에 남는다.
  LM.pkWallet = (state) => {
    let candy = 0;
    const owned = {};
    const add = (id, at) => {
      const o = owned[id] || (owned[id] = { count: 0, firstAt: at });
      o.count += 1;
    };
    const take = (id) => { if (owned[id] && owned[id].count > 0) owned[id].count -= 1; };

    // 뽑기·데려오기·진화를 일어난 순서대로 반영한다.
    const events = [];
    state.gacha.pulls.forEach((p) => {
      if (LM.isPk(p.itemId)) events.push([p.at, () => { candy += p.candy || 0; add(LM.pkNum(p.itemId), p.at); }]);
    });
    state.gacha.exchanges.forEach((x) => {
      if (LM.isPk(x.itemId)) events.push([x.at, () => { candy -= x.cost; add(LM.pkNum(x.itemId), x.at); }]);
    });
    (state.gacha.evolutions || []).forEach((e) => {
      events.push([e.at, () => { candy -= e.cost; take(e.from); add(e.to, e.at); }]);
    });
    events.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).forEach(([, run]) => run());

    const has = (id) => !!owned[id] && owned[id].count > 0;
    return { candy, owned, has, kinds: Object.keys(owned).length };
  };

  // ---------- 뽑기·교환·진화 ----------

  function rollTier() {
    const entries = Object.entries(LM.PK_RARITIES);
    const total = entries.reduce((sum, [, r]) => sum + r.weight, 0);
    let roll = Math.random() * total;
    for (const [key, r] of entries) {
      roll -= r.weight;
      if (roll < 0) return key;
    }
    return 'common';
  }

  // 포켓몬 뽑기. 포인트가 모자라거나 도감이 없으면 null. (천장 없음, 10회는 고급 이상 1마리 보장)
  LM.pullPokemon = (state, times) => {
    if (!dex) return null;
    const cost = times === 10 ? LM.GACHA_TEN_COST : LM.GACHA_COST * times;
    if (LM.wallet(state).points < cost) return null;
    const seen = new Set(Object.keys(LM.pkWallet(state).owned).map(Number)); // 도감에 이미 있으면 '겹침'
    const now = new Date().toISOString();
    const batch = LM.uid();
    let gotBetter = false;
    const results = [];
    for (let i = 0; i < times; i += 1) {
      let tier = rollTier();
      if (times === 10 && i === times - 1 && !gotBetter && tier === 'common') tier = 'uncommon';
      if (tier !== 'common') gotBetter = true;
      const pool = dex.filter((p) => p.tier === tier);
      const picked = pool[Math.floor(Math.random() * pool.length)];
      const dup = seen.has(picked.id);
      seen.add(picked.id);
      results.push({
        id: LM.uid(), at: now, batch, itemId: LM.pkKey(picked.id), rarity: tier, cost: cost / times, dup,
        candy: LM.PK_CANDY_PER_PULL + (dup ? LM.PK_RARITIES[tier].dupCandy : 0),
      });
    }
    state.gacha.pulls.push(...results);
    return results;
  };

  // 사탕으로 지금 없는 포켓몬 데려오기 (진화시켜서 0마리가 된 포켓몬도 다시 데려올 수 있다)
  LM.exchangePokemon = (state, id) => {
    const p = LM.pk(id);
    const w = LM.pkWallet(state);
    if (!p || w.has(id)) return false;
    const price = LM.PK_RARITIES[p.tier].price;
    if (w.candy < price) return false;
    state.gacha.exchanges.push({ id: LM.uid(), at: new Date().toISOString(), itemId: LM.pkKey(id), cost: price });
    return true;
  };

  // 가진 포켓몬 1마리를 진화시킨다. 원래 포켓몬은 1마리 줄고 진화한 모습이 1마리 늘어난다.
  // 방에 놓아 둔 포켓몬이 남는 수보다 많아지면, 방에 있던 아이가 그 자리에서 진화한 모습으로 바뀐다.
  LM.evolveCost = (toId) => { const p = LM.pk(toId); return p ? LM.PK_EVOLVE_COST[p.tier] : null; };
  LM.evolvePokemon = (state, fromId, toId) => {
    fromId = Number(fromId);
    toId = Number(toId);
    const from = LM.pk(fromId);
    const w = LM.pkWallet(state);
    if (!from || !from.children.includes(toId) || !w.has(fromId)) return false;
    const cost = LM.evolveCost(toId);
    if (w.candy < cost) return false;
    state.gacha.evolutions = state.gacha.evolutions || [];
    state.gacha.evolutions.push({ id: LM.uid(), at: new Date().toISOString(), from: fromId, to: toId, cost });
    const placed = state.room.items.filter((r) => r.kind === 'pokemon' && Number(r.ref) === fromId);
    if (placed.length > w.owned[fromId].count - 1) placed[placed.length - 1].ref = toId;
    return true;
  };
})(window.LM);
