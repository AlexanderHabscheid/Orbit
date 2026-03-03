export { EchoCore } from "./bus.js";
export { SharedRingBuffer } from "./ring_buffer.js";
export { startEchoDaemon } from "./daemon.js";
export { connectEchoClient } from "./client.js";
export { benchmarkEchoVsNetwork } from "./benchmark.js";
export type { BackpressurePolicy, DaemonStartOptions, EchoChannelStats, EchoCoreOptions, EchoMessage } from "./types.js";
