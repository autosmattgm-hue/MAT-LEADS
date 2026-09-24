import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { firestoreClient } from "../config/firebase.js";
import { logger } from "../utils/logger.js";

const memoryStore = new Map();
const localStorePath = path.resolve(process.cwd(), process.env.LOCAL_DATA_FILE || "data/local-store.json");
const localStoreWriteErrors = ["EROFS", "EPERM", "EACCES", "ENOENT", "EBADF"];
const STORAGE_WARNING = "Records are stored in the local store of a single instance. Add the Firebase service account (FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY, or paste the service-account JSON into FIREBASE_SERVICE_ACCOUNT) so Firestore keeps accounts, leads and CRM records permanently.";

let localStoreWritable = true;
let storageWarningLogged = false;

export function storageStatus() {
  const persistent = Boolean(firestoreClient());
  return {
    backend: persistent ? "firestore" : localStoreWritable ? "local-json" : "memory",
    persistent,
    warning: persistent ? "" : STORAGE_WARNING
  };
}
let localStoreLoaded = false;
let localStoreWriteQueue = Promise.resolve();

function collectionStore(name) {
  if (!memoryStore.has(name)) memoryStore.set(name, new Map());
  return memoryStore.get(name);
}

async function loadLocalStore() {
  if (localStoreLoaded) return;
  localStoreLoaded = true;

  try {
    const raw = await fs.readFile(localStorePath, "utf8");
    const parsed = JSON.parse(raw);
    for (const [collection, records] of Object.entries(parsed.collections || {})) {
      collectionStore(collection).clear();
      for (const record of Array.isArray(records) ? records : []) {
        if (record?.id) collectionStore(collection).set(record.id, record);
      }
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function localStorePayload() {
  return {
    updatedAt: new Date().toISOString(),
    collections: Object.fromEntries([...memoryStore.entries()].map(([collection, records]) => [
      collection,
      [...records.values()]
    ]))
  };
}

async function persistLocalStore() {
  const payload = JSON.stringify(localStorePayload(), null, 2);
  const directory = path.dirname(localStorePath);
  const tempPath = `${localStorePath}.${process.pid}.tmp`;
  try {
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(tempPath, payload, "utf8");
    await fs.rename(tempPath, localStorePath);
  } catch (error) {
    if (localStoreWriteErrors.includes(error.code)) {
      localStoreWritable = false;
      if (!storageWarningLogged) {
        storageWarningLogged = true;
        logger.warn("local_store_not_writable", { code: error.code, path: localStorePath, message: STORAGE_WARNING });
      }
      return;
    }
    throw error;
  }
}

async function queueLocalStorePersist() {
  localStoreWriteQueue = localStoreWriteQueue.then(persistLocalStore, persistLocalStore);
  return localStoreWriteQueue;
}

function applyWhere(items, where = []) {
  return items.filter((item) => where.every(({ field, op, value }) => {
    if (op !== "==") return true;
    return item[field] === value;
  }));
}

export class FirestoreRepository {
  constructor(collectionName) {
    this.collectionName = collectionName;
  }

  client() {
    return firestoreClient();
  }

  async create(data) {
    const id = data.id || randomUUID();
    const now = new Date().toISOString();
    const payload = { ...data, id, createdAt: data.createdAt || now, updatedAt: now };

    const client = this.client();
    if (client) {
      return client.set(this.collectionName, id, payload);
    }

    await loadLocalStore();
    collectionStore(this.collectionName).set(id, payload);
    await queueLocalStorePersist();
    return payload;
  }

  async upsert(id, data) {
    const now = new Date().toISOString();
    const existing = await this.findById(id);
    const payload = { ...(existing || {}), ...data, id, updatedAt: now, createdAt: existing?.createdAt || now };

    const client = this.client();
    if (client) {
      return client.set(this.collectionName, id, payload);
    }
    await loadLocalStore();
    collectionStore(this.collectionName).set(id, payload);
    await queueLocalStorePersist();
    return payload;
  }

  async findById(id) {
    const client = this.client();
    if (client) {
      return client.get(this.collectionName, id);
    }

    await loadLocalStore();
    return collectionStore(this.collectionName).get(id) || null;
  }

  async list({ where = [], limit = 50, orderBy = "updatedAt" } = {}) {
    const client = this.client();
    if (client) {
      const items = await client.list(this.collectionName, { limit: Math.max(limit, 100) });
      return applyWhere(items, where)
        .sort((a, b) => String(b[orderBy] || "").localeCompare(String(a[orderBy] || "")))
        .slice(0, limit);
    }

    await loadLocalStore();
    const items = Array.from(collectionStore(this.collectionName).values());
    return applyWhere(items, where)
      .sort((a, b) => String(b[orderBy] || "").localeCompare(String(a[orderBy] || "")))
      .slice(0, limit);
  }

  async update(id, data) {
    const existing = await this.findById(id);
    if (!existing) return null;
    return this.upsert(id, { ...existing, ...data });
  }
}
