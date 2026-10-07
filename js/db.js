// 브라우저 안에 게임 데이터를 저장한다.
// 기본은 IndexedDB, 쓸 수 없는 환경이면 localStorage로 대신한다.

window.LM = window.LM || {};

(function (LM) {
  const DB_NAME = 'life-maker';
  const STORE = 'kv';
  const KEY = 'state'; // localStorage에서는 'life-maker-state'

  let backend = null; // 'idb' | 'ls'
  let dbPromise = null;

  function openDb() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }

  function idb(mode, fn) {
    return openDb().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
    }));
  }

  async function pickBackend() {
    if (backend) return backend;
    try {
      await openDb();
      backend = 'idb';
    } catch (err) {
      console.warn('IndexedDB를 쓸 수 없어 localStorage를 사용합니다.', err);
      backend = 'ls';
    }
    return backend;
  }

  // 키 하나에 값 하나를 저장한다. 게임 기록은 'state', 동기화 정보는 'sync'.
  async function loadKey(key) {
    if ((await pickBackend()) === 'idb') {
      return (await idb('readonly', (s) => s.get(key))) || null;
    }
    const raw = localStorage.getItem(`life-maker-${key}`);
    return raw ? JSON.parse(raw) : null;
  }

  async function saveKey(key, value) {
    if ((await pickBackend()) === 'idb') {
      await idb('readwrite', (s) => (value == null ? s.delete(key) : s.put(value, key)));
    } else if (value == null) {
      localStorage.removeItem(`life-maker-${key}`);
    } else {
      localStorage.setItem(`life-maker-${key}`, JSON.stringify(value));
    }
  }

  LM.db = {
    loadKey,
    saveKey,
    load: () => loadKey(KEY),
    save: (state) => saveKey(KEY, state),
    clear: () => saveKey(KEY, null),

    // 브라우저가 공간이 부족할 때 데이터를 임의로 지우지 않도록 요청한다.
    async requestPersist() {
      try {
        if (navigator.storage && navigator.storage.persist) await navigator.storage.persist();
      } catch (err) {
        console.warn('영구 저장 요청 실패', err);
      }
    },
  };
})(window.LM);
