import net from "node:net";

interface ClientConnectOptions {
  socketPath?: string;
  host?: string;
  port?: number;
}

export interface EchoClient {
  send: (cmd: unknown) => void;
  onLine: (handler: (line: string) => void) => void;
  close: () => void;
}

const DEFAULT_SOCKET_PATH = "/tmp/echocore.sock";

export async function connectEchoClient(options: ClientConnectOptions = {}): Promise<EchoClient> {
  const socket = await connect(options);
  socket.setEncoding("utf-8");

  let buffer = "";
  let lineHandler: (line: string) => void = () => undefined;

  socket.on("data", (chunk) => {
    buffer += chunk;
    for (;;) {
      const idx = buffer.indexOf("\n");
      if (idx < 0) break;
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      lineHandler(line);
    }
  });

  return {
    send(cmd: unknown) {
      socket.write(`${JSON.stringify(cmd)}\n`);
    },
    onLine(handler: (line: string) => void) {
      lineHandler = handler;
    },
    close() {
      socket.end();
      socket.destroy();
    }
  };
}

function connect(options: ClientConnectOptions): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error): void => reject(err);
    const socket = options.port
      ? net.createConnection({ host: options.host ?? "127.0.0.1", port: options.port })
      : net.createConnection({ path: options.socketPath ?? DEFAULT_SOCKET_PATH });

    socket.once("error", onError);
    socket.once("connect", () => {
      socket.off("error", onError);
      resolve(socket);
    });
  });
}
