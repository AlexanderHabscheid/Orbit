export type BackpressurePolicy = "drop_oldest" | "drop_newest";

export interface EchoCoreOptions {
  channelsMax?: number;
  channelSlots?: number;
  slotBytes?: number;
  backpressure?: BackpressurePolicy;
}

export interface EchoMessage {
  channel: string;
  seq: number;
  ts: number;
  payload: Uint8Array;
}

export interface EchoChannelStats {
  channel: string;
  published: number;
  dropped: number;
  ringSize: number;
  ringCapacity: number;
  oldestSeq: number;
  latestSeq: number;
}

export interface DaemonStartOptions extends EchoCoreOptions {
  socketPath?: string;
  tcpPort?: number;
  maxPendingBytes?: number;
}
