const DATABASE_NAME = "jarvis-media-asset-library";
const DATABASE_VERSION = 1;
const STORE_NAME = "assets";

export const MEDIA_ASSET_LIMITS = Object.freeze({
  maxBytes: 100 * 1024 * 1024,
  maxTags: 12,
  maxTagLength: 30,
  maxNameLength: 180,
  maxQueryLength: 120
});

function cleanText(value, limit) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

export function normalizeMediaAssetKind(mimeType) {
  const value = String(mimeType || "").toLowerCase();
  if (value.startsWith("image/")) return "image";
  if (value.startsWith("video/")) return "video";
  if (value.startsWith("audio/")) return "audio";
  return "";
}

export function normalizeMediaAssetTags(input) {
  const source = Array.isArray(input) ? input : String(input || "").split(",");
  const unique = new Set();
  for (const item of source) {
    const tag = cleanText(item, MEDIA_ASSET_LIMITS.maxTagLength).toLocaleLowerCase();
    if (!tag || unique.has(tag)) continue;
    unique.add(tag);
    if (unique.size >= MEDIA_ASSET_LIMITS.maxTags) break;
  }
  return [...unique];
}

export function normalizeMediaAssetMetadata(input = {}) {
  const name = cleanText(input.name, MEDIA_ASSET_LIMITS.maxNameLength);
  const mimeType = cleanText(input.mimeType || input.type, 120).toLowerCase();
  const kind = normalizeMediaAssetKind(mimeType);
  const size = Number(input.size);
  if (!name) throw new TypeError("Choose a file with a valid name.");
  if (!kind) throw new TypeError("The asset library accepts image, video and audio files only.");
  if (!Number.isFinite(size) || size <= 0) throw new TypeError("The selected asset is empty or has an invalid size.");
  if (size > MEDIA_ASSET_LIMITS.maxBytes) throw new TypeError("Library assets must be 100 MiB or smaller.");
  return {
    id: cleanText(input.id, 100),
    name,
    mimeType,
    kind,
    size,
    tags: normalizeMediaAssetTags(input.tags),
    createdAt: cleanText(input.createdAt, 40),
    updatedAt: cleanText(input.updatedAt, 40),
    lastUsedAt: cleanText(input.lastUsedAt, 40)
  };
}

export function filterMediaAssets(records, filters = {}) {
  const query = cleanText(filters.query, MEDIA_ASSET_LIMITS.maxQueryLength).toLocaleLowerCase();
  const kind = cleanText(filters.kind, 12).toLowerCase();
  const tag = cleanText(filters.tag, MEDIA_ASSET_LIMITS.maxTagLength).toLocaleLowerCase();
  return (Array.isArray(records) ? records : []).filter((record) => {
    if (kind && kind !== "all" && record.kind !== kind) return false;
    if (tag && !record.tags?.includes(tag)) return false;
    if (!query) return true;
    const searchable = [
      record.name,
      record.kind,
      record.mimeType,
      ...(Array.isArray(record.tags) ? record.tags : [])
    ].join(" ").toLocaleLowerCase();
    return searchable.includes(query);
  }).sort((left, right) =>
    String(right.lastUsedAt || right.updatedAt || right.createdAt || "")
      .localeCompare(String(left.lastUsedAt || left.updatedAt || left.createdAt || ""))
  );
}

export function formatMediaAssetSize(bytes) {
  const value = Math.max(0, Number(bytes) || 0);
  if (value < 1024) return value + " B";
  if (value < 1024 * 1024) return (value / 1024).toFixed(1) + " KB";
  if (value < 1024 * 1024 * 1024) return (value / (1024 * 1024)).toFixed(1) + " MB";
  return (value / (1024 * 1024 * 1024)).toFixed(2) + " GB";
}

function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return "asset-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12);
}

function publicRecord(record) {
  if (!record) return null;
  const { blob, ...metadata } = record;
  return metadata;
}

export function createMediaAssetLibrary(options = {}) {
  const indexedDBProvider = options.indexedDB || globalThis.indexedDB;
  let databasePromise = null;

  function openDatabase() {
    if (!indexedDBProvider) {
      return Promise.reject(new Error("This browser does not support the local asset library. You can still attach files directly to the timeline."));
    }
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      let request;
      try {
        request = indexedDBProvider.open(DATABASE_NAME, DATABASE_VERSION);
      } catch {
        reject(new Error("The local asset library could not be opened in this browser."));
        return;
      }
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          const store = database.createObjectStore(STORE_NAME, { keyPath: "id" });
          store.createIndex("kind", "kind", { unique: false });
          store.createIndex("name", "name", { unique: false });
          store.createIndex("updatedAt", "updatedAt", { unique: false });
        }
      };
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => database.close();
        resolve(database);
      };
      request.onerror = () => {
        databasePromise = null;
        reject(new Error("The local asset library could not be opened. Check browser storage permissions."));
      };
      request.onblocked = () => {
        databasePromise = null;
        reject(new Error("Another JARVIS tab is updating the asset library. Close the older tab and retry."));
      };
    });
    return databasePromise;
  }

  async function transact(mode, work) {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      let transaction;
      let request;
      let result;
      try {
        transaction = database.transaction(STORE_NAME, mode);
        request = work(transaction.objectStore(STORE_NAME));
      } catch {
        reject(new Error("The local asset library request could not be started."));
        return;
      }
      request.onsuccess = () => { result = request.result; };
      request.onerror = () => reject(request.error || new Error("The local asset library request failed."));
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error || new Error("The local asset library transaction failed."));
      transaction.onabort = () => reject(transaction.error || new Error("The local asset library transaction was cancelled."));
    });
  }

  return {
    async save(file, tags = []) {
      if (!file || typeof file.slice !== "function") throw new TypeError("Choose an image, video or audio file first.");
      const metadata = normalizeMediaAssetMetadata({
        name: file.name,
        mimeType: file.type,
        size: file.size,
        tags
      });
      const now = new Date().toISOString();
      const record = {
        ...metadata,
        id: createId(),
        createdAt: now,
        updatedAt: now,
        lastUsedAt: "",
        blob: file.slice(0, file.size, file.type)
      };
      try {
        await transact("readwrite", (store) => store.add(record));
      } catch (error) {
        if (error?.name === "QuotaExceededError") {
          throw new Error("Browser storage is full. Remove unused library files or attach this file directly to the timeline.");
        }
        throw new Error(error?.message || "The asset could not be saved in this browser.");
      }
      return publicRecord(record);
    },

    async list(filters = {}) {
      const records = await transact("readonly", (store) => store.getAll());
      return filterMediaAssets(records || [], filters).map(publicRecord);
    },

    async get(id) {
      const key = cleanText(id, 100);
      if (!key) return null;
      const record = await transact("readonly", (store) => store.get(key));
      return record || null;
    },

    async markUsed(id) {
      const key = cleanText(id, 100);
      if (!key) return false;
      const record = await this.get(key);
      if (!record) return false;
      record.lastUsedAt = new Date().toISOString();
      record.updatedAt = record.lastUsedAt;
      await transact("readwrite", (store) => store.put(record));
      return true;
    },

    async remove(id) {
      const key = cleanText(id, 100);
      if (!key) return false;
      await transact("readwrite", (store) => store.delete(key));
      return true;
    }
  };
}
