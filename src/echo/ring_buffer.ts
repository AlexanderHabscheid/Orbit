import { BackpressurePolicy } from "./types.js";

interface RingEntry {
  seq: number;
  len: number;
  ts: number;
}

export interface RingMessage {
  seq: number;
  ts: number;
  payload: Uint8Array;
}

export interface PublishResult {
  seq: number;
  dropped: number;
  accepted: boolean;
}

export class SharedRingBuffer {
  private readonly slotCount: number;
  private readonly slotBytes: number;
  private readonly payload: Uint8Array;
  private readonly entries: Array<RingEntry | undefined>;
  private head = 0;
  private size = 0;
  private nextSeq = 0;

  constructor(slotCount: number, slotBytes: number) {
    if (!Number.isInteger(slotCount) || slotCount < 2) throw new Error("slotCount must be an integer >= 2");
    if (!Number.isInteger(slotBytes) || slotBytes < 64) throw new Error("slotBytes must be an integer >= 64");
    this.slotCount = slotCount;
    this.slotBytes = slotBytes;
    this.payload = new Uint8Array(new SharedArrayBuffer(slotCount * slotBytes));
    this.entries = new Array(slotCount);
  }

  get capacity(): number {
    return this.slotCount;
  }

  get length(): number {
    return this.size;
  }

  get latestSeq(): number {
    return this.nextSeq;
  }

  get oldestSeq(): number {
    if (this.size === 0) return this.nextSeq;
    return this.entries[this.head]?.seq ?? this.nextSeq;
  }

  publish(payload: Uint8Array, policy: BackpressurePolicy): PublishResult {
    if (payload.byteLength > this.slotBytes) {
      throw new Error(`payload too large for slot: ${payload.byteLength} > ${this.slotBytes}`);
    }

    let dropped = 0;
    if (this.size >= this.slotCount) {
      if (policy === "drop_newest") {
        return { seq: this.nextSeq, dropped: 1, accepted: false };
      }
      this.head = (this.head + 1) % this.slotCount;
      this.size -= 1;
      dropped = 1;
    }

    const slot = (this.head + this.size) % this.slotCount;
    const offset = slot * this.slotBytes;
    this.payload.fill(0, offset, offset + this.slotBytes);
    this.payload.set(payload, offset);

    const seq = ++this.nextSeq;
    this.entries[slot] = { seq, len: payload.byteLength, ts: Date.now() };
    this.size += 1;

    return { seq, dropped, accepted: true };
  }

  readSince(lastSeenSeq: number): RingMessage[] {
    if (this.size === 0) return [];
    const out: RingMessage[] = [];
    for (let i = 0; i < this.size; i += 1) {
      const slot = (this.head + i) % this.slotCount;
      const entry = this.entries[slot];
      if (!entry || entry.seq <= lastSeenSeq) continue;
      const offset = slot * this.slotBytes;
      out.push({
        seq: entry.seq,
        ts: entry.ts,
        payload: new Uint8Array(this.payload.buffer, offset, entry.len)
      });
    }
    return out;
  }
}
