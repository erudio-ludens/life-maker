// 내 방 꾸미기: 벽지·바닥 테마, 물건 크기, 처음 놓을 자리.

window.LM = window.LM || {};

(function (LM) {
  // scene: room(창문 있는 기본 방, 색만 다름) / garden / cafe / study(컨셉 배경)
  // dark: 바닥이 어두워 안내 글씨를 밝게 써야 하는 배경
  LM.ROOM_THEMES = {
    cream: { label: '크림 원목', scene: 'room', wall: '#F3E6CF', floor: '#C9A27A', plank: '#B78E64', window: '#CFE8F7', frame: '#FFFDF7' },
    sky: { label: '하늘 타일', scene: 'room', wall: '#D9E9F6', floor: '#C3C8CF', plank: '#AEB4BC', window: '#EEF8FF', frame: '#FFFFFF' },
    mint: { label: '민트 원목', scene: 'room', wall: '#D6EEE4', floor: '#D7B98F', plank: '#C4A276', window: '#E2F5FF', frame: '#FFFFFF' },
    pink: { label: '벚꽃', scene: 'room', wall: '#F8DFE4', floor: '#EDE3D6', plank: '#DCCDBB', window: '#FFF4E8', frame: '#FFFFFF' },
    night: { label: '밤', scene: 'room', dark: true, wall: '#2F3B5E', floor: '#5B4636', plank: '#4A3829', window: '#1A2140', frame: '#8D7A63' },
    garden: { label: '마당', scene: 'garden', concept: '햇살 드는 잔디 마당' },
    cafe: { label: '카페', scene: 'cafe', concept: '벽돌 벽 동네 카페' },
    study: { label: '서재', scene: 'study', dark: true, concept: '책장 가득한 기록자의 서재' },
  };

  // 배경 그림 조각. 크기는 방 너비 기준(cqw)이라 미리보기 칸에서도 같은 모양으로 줄어든다.
  LM.sceneHtml = (scene) => ({
    room: '<div class="room-floor"></div><div class="room-window"></div>',
    garden: '<div class="g-sun"></div><div class="g-cloud c1"></div><div class="g-cloud c2"></div><div class="g-fence"></div><div class="g-grass"></div>',
    cafe: '<div class="c-wall"></div><div class="c-floor"></div><div class="c-board"><span>오늘의 기록<br>한 잔</span></div><div class="c-lamp l1"></div><div class="c-lamp l2"></div>',
    study: '<div class="s-panel"></div><div class="s-shelf"></div><div class="s-lamp"></div><div class="s-floor"></div><div class="s-rug"></div>',
  }[scene] || '');

  LM.sceneStyle = (t) => (t.scene === 'room'
    ? `--wall:${t.wall};--floor:${t.floor};--plank:${t.plank};--window:${t.window};--frame:${t.frame}`
    : '');
  LM.ROOM_SIZES = [0.7, 1, 1.4]; // 작게 / 보통 / 크게
  LM.WALL_LINE = 58; // 벽과 바닥이 만나는 높이(%)
  const WALL_ITEMS = new Set(['frame', 'clock']); // 처음에 벽에 거는 물건

  LM.placeableItem = (it) => !!it && it.category !== 'avatar';

  LM.placedCount = (state, itemId) => state.room.items.filter((r) => r.kind === 'item' && r.ref === itemId).length;

  LM.medalPlaced = (state, entryId) => state.room.items.some((r) => r.kind === 'medal' && r.ref === entryId);

  // 새 물건을 놓을 자리: 벽에 거는 것은 벽, 나머지는 바닥 어딘가
  LM.roomSpot = (kind, ref) => {
    const onWall = kind === 'medal' || (kind === 'item' && WALL_ITEMS.has(ref));
    const x = Math.round(25 + Math.random() * 50);
    const y = onWall ? Math.round(34 + Math.random() * 10) : Math.round(76 + Math.random() * 16);
    return { x, y };
  };

  LM.newRoomItem = (kind, ref) => ({ id: LM.uid(), kind, ref, ...LM.roomSpot(kind, ref), scale: 1, flip: false });

  // 아바타를 달고 있으면 방에도 서 있게 한다.
  LM.ensureAvatarInRoom = (state) => {
    if (state.character.avatar && !state.room.items.some((r) => r.kind === 'avatar')) {
      state.room.items.push({ id: LM.uid(), kind: 'avatar', ref: 'me', x: 32, y: 88, scale: 1, flip: false });
    }
  };
})(window.LM);
