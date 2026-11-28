// What the phone keeps in the browser (M4-3): the random player key and the highest
// control number this key has sent.
//
// Browser storage can be missing or throw (private mode, some iPhone settings), so every
// read and write is wrapped. Without storage the page still works; only a reload then
// gives a new player.

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** `localStorage` when it works, otherwise a store in memory. */
export function browserStore(): KeyValueStore {
  try {
    const ls = (globalThis as { localStorage?: KeyValueStore }).localStorage;
    if (ls) {
      ls.setItem("ck.test", "1");
      return ls;
    }
  } catch {
    // fall through
  }
  return memoryStore();
}

export function memoryStore(): KeyValueStore {
  const map = new Map<string, string>();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
}

const KEY = "ck.playerKey";

/** A random key of 32 hex characters (the contract allows 1–64). */
export function newPlayerKey(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The saved player key, or a new one that is saved at once. */
export function playerKey(store: KeyValueStore): string {
  try {
    const saved = store.getItem(KEY);
    if (saved && /^[0-9a-f]{1,64}$/.test(saved)) return saved;
  } catch {
    // fall through
  }
  const key = newPlayerKey();
  try {
    store.setItem(KEY, key);
  } catch {
    // the key lives only in memory now
  }
  return key;
}

/**
 * Control numbers across a reload.
 *
 * M4-2 counts controls from 1 on every page load. The server (M1-1 `mergeControls`) only
 * takes a control whose number is bigger than the last one of this player, so after a
 * reload its controls would be ignored until the count passed the old number (#91, open
 * point 2). So the wire number is `base + local number`, where `base` is the highest number
 * this key ever sent. The page itself keeps using the local numbers of M4-2: `toLocal()`
 * turns a number from the server back, so the prediction of M4-4 compares the same numbers.
 */
export class SeqOffset {
  readonly base: number;
  private readonly store: KeyValueStore;
  private readonly storeKey: string;
  /** The value in storage. Always bigger than every number sent so far. */
  private saved: number;

  constructor(store: KeyValueStore, key: string) {
    this.store = store;
    this.storeKey = `ck.seq.${key}`;
    let base = 0;
    try {
      const v = Number(store.getItem(this.storeKey));
      if (Number.isSafeInteger(v) && v > 0) base = v;
    } catch {
      // start at 0
    }
    this.base = base;
    this.saved = base;
  }

  /** Local number of M4-2 → number on the wire. */
  toWire(local: number): number {
    const wire = this.base + local;
    // Write ahead in steps of 32, so storage is not written for every control. After a
    // reload a few numbers are skipped, but none is used twice.
    if (wire >= this.saved) {
      this.saved = wire + 32;
      try {
        this.store.setItem(this.storeKey, String(this.saved));
      } catch {
        // not saved; fine for this page
      }
    }
    return wire;
  }

  /** Number from the server (last control M1 used) → local number of M4-2. 0 or less: none of this page yet. */
  toLocal(wire: number): number {
    return wire - this.base;
  }
}
