// db.js - IndexedDB データ管理層
// 即売会バイヤー: サークル情報・エリア・地図画像の永続化

const DB_NAME = 'DoujinBuyerDB';
const DB_VERSION = 1;

class DoujinDB {
  constructor() {
    this.db = null;
  }

  // DB初期化
  async init() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        // サークル情報ストア
        if (!db.objectStoreNames.contains('circles')) {
          const store = db.createObjectStore('circles', { keyPath: 'id', autoIncrement: true });
          store.createIndex('area', 'area', { unique: false });
          store.createIndex('space', 'space', { unique: false });
          store.createIndex('status', 'status', { unique: false });
        }
        // エリア情報ストア（地図画像を含む）
        if (!db.objectStoreNames.contains('areas')) {
          db.createObjectStore('areas', { keyPath: 'id', autoIncrement: true });
        }
        // ピン情報ストア
        if (!db.objectStoreNames.contains('pins')) {
          const pinStore = db.createObjectStore('pins', { keyPath: 'id', autoIncrement: true });
          pinStore.createIndex('areaId', 'areaId', { unique: false });
        }
      };
      req.onsuccess = (e) => { this.db = e.target.result; resolve(); };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  // --- サークル操作 ---
  async addCircle(circle) {
    return this._put('circles', circle);
  }
  async updateCircle(circle) {
    return this._put('circles', circle);
  }
  async deleteCircle(id) {
    return this._delete('circles', id);
  }
  async getCircle(id) {
    return this._get('circles', id);
  }
  async getAllCircles() {
    return this._getAll('circles');
  }
  async getCirclesByArea(areaId) {
    return this._getAllByIndex('circles', 'area', areaId);
  }

  // --- エリア操作 ---
  async addArea(area) {
    return this._put('areas', area);
  }
  async updateArea(area) {
    return this._put('areas', area);
  }
  async deleteArea(id) {
    // エリアに紐づくピンとサークルも削除
    const pins = await this.getPinsByArea(id);
    for (const pin of pins) await this._delete('pins', pin.id);
    const circles = await this.getCirclesByArea(id);
    for (const c of circles) await this._delete('circles', c.id);
    return this._delete('areas', id);
  }
  async getAllAreas() {
    return this._getAll('areas');
  }

  // --- ピン操作 ---
  async addPin(pin) {
    return this._put('pins', pin);
  }
  async updatePin(pin) {
    return this._put('pins', pin);
  }
  async deletePin(id) {
    return this._delete('pins', id);
  }
  async getPinsByArea(areaId) {
    return this._getAllByIndex('pins', 'areaId', areaId);
  }

  // --- 汎用ヘルパー ---
  _put(storeName, data) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = data.id ? store.put(data) : store.add(data);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  _get(storeName, id) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  _getAll(storeName) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  _getAllByIndex(storeName, indexName, value) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readonly');
      const idx = tx.objectStore(storeName).index(indexName);
      const req = idx.getAll(value);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  _delete(storeName, id) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readwrite');
      const req = tx.objectStore(storeName).delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }
}
