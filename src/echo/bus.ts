import { SharedRingBuffer } from "./ring_buffer.js";
import { BackpressurePolicy, EchoChannelStats, EchoCoreOptions, EchoMessage } from "./types.js";

interface Subscriber {
  id: number;
  cursor: number;
  onMessage: (message: EchoMessage) => void;
  onDrop?: (gap: number) => void;
}

interface ChannelState {
  name: string;
  ring: SharedRingBuffer;
  published: number;
  dropped: number;
  subscribers: Map<number, Subscriber>;
}

const DEFAULT_CHANNELS_MAX = 256;
const DEFAULT_CHANNEL_SLOTS = 1024;
const DEFAULT_SLOT_BYTES = 65536;

export class EchoCore {
  private readonly channels = new Map<string, ChannelState>();
  private readonly channelsMax: number;
  private readonly channelSlots: number;
  private readonly slotBytes: number;
  private readonly backpressure: BackpressurePolicy;
  private nextSubId = 0;

  constructor(options: EchoCoreOptions = {}) {
    this.channelsMax = options.channelsMax ?? DEFAULT_CHANNELS_MAX;
    this.channelSlots = options.channelSlots ?? DEFAULT_CHANNEL_SLOTS;
    this.slotBytes = options.slotBytes ?? DEFAULT_SLOT_BYTES;
    this.backpressure = options.backpressure ?? "drop_oldest";
  }

  publish(channel: string, payload: Uint8Array): { seq: number; dropped: number; accepted: boolean } {
    const state = this.getOrCreateChannel(channel);
    const result = state.ring.publish(payload, this.backpressure);

    state.published += 1;
    state.dropped += result.dropped;

    if (result.accepted) {
      for (const sub of state.subscribers.values()) {
        this.drainSubscriber(state, sub);
      }
    }

    return result;
  }

  subscribe(
    channel: string,
    onMessage: (message: EchoMessage) => void,
    opts: { fromLatest?: boolean; onDrop?: (gap: number) => void } = {}
  ): () => void {
    const state = this.getOrCreateChannel(channel);
    const id = ++this.nextSubId;
    const cursor = opts.fromLatest ? state.ring.latestSeq : state.ring.oldestSeq - 1;
    const sub: Subscriber = { id, cursor, onMessage, onDrop: opts.onDrop };
    state.subscribers.set(id, sub);
    this.drainSubscriber(state, sub);
    return () => {
      state.subscribers.delete(id);
    };
  }

  stats(channel?: string): EchoChannelStats[] {
    const channels = channel ? [this.getOrCreateChannel(channel)] : [...this.channels.values()];
    return channels.map((state) => ({
      channel: state.name,
      published: state.published,
      dropped: state.dropped,
      ringSize: state.ring.length,
      ringCapacity: state.ring.capacity,
      oldestSeq: state.ring.oldestSeq,
      latestSeq: state.ring.latestSeq
    }));
  }

  private getOrCreateChannel(channel: string): ChannelState {
    const normalized = channel.trim();
    if (!normalized) throw new Error("channel cannot be empty");

    const existing = this.channels.get(normalized);
    if (existing) return existing;

    if (this.channels.size >= this.channelsMax) {
      throw new Error(`channel limit reached: ${this.channelsMax}`);
    }

    const created: ChannelState = {
      name: normalized,
      ring: new SharedRingBuffer(this.channelSlots, this.slotBytes),
      published: 0,
      dropped: 0,
      subscribers: new Map()
    };
    this.channels.set(normalized, created);
    return created;
  }

  private drainSubscriber(state: ChannelState, sub: Subscriber): void {
    const oldestSeq = state.ring.oldestSeq;
    if (oldestSeq > sub.cursor + 1 && sub.onDrop) {
      sub.onDrop(oldestSeq - (sub.cursor + 1));
      sub.cursor = oldestSeq - 1;
    }

    for (const message of state.ring.readSince(sub.cursor)) {
      sub.cursor = message.seq;
      sub.onMessage({
        channel: state.name,
        seq: message.seq,
        ts: message.ts,
        payload: message.payload
      });
    }
  }
}
