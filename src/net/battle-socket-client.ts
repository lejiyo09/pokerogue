import type { PvpClientMessage, PvpServerMessage } from "#net/pvp-protocol-types";

type ServerMessageType = PvpServerMessage["type"];
type ServerMessageOf<K extends ServerMessageType> = Extract<PvpServerMessage, { type: K }>;
type ServerMessageListener<K extends ServerMessageType> = (message: ServerMessageOf<K>) => void;
/** Untyped form used for internal storage; type safety is enforced at the `on`/`off` boundary instead. */
type AnyServerMessageListener = (message: PvpServerMessage) => void;

/**
 * Thin, typed wrapper around a single WebSocket connection to the PvP server.
 *
 * Deliberately kept dumb: it only knows how to open/close a socket and
 * (de)serialize {@linkcode PvpClientMessage}/{@linkcode PvpServerMessage} JSON payloads.
 * Room/battle/turn orchestration lives in {@linkcode PvpRoomManager}.
 * @see docs/pvp-online-battle-design.md §6.1
 */
export class BattleSocketClient {
  private socket: WebSocket | null = null;
  private readonly url: string;
  private readonly listeners: Partial<Record<ServerMessageType, Set<AnyServerMessageListener>>> = {};
  private closedByUser = false;

  constructor(url: string = import.meta.env.VITE_PVP_SERVER_URL ?? "") {
    this.url = url;
  }

  /** Whether the underlying socket is currently open. */
  public get isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  /**
   * Open the WebSocket connection.
   * @returns A promise that resolves once the connection is open, or rejects on failure.
   */
  public connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.url) {
        reject(new Error("No PvP server URL configured (VITE_PVP_SERVER_URL)"));
        return;
      }

      this.closedByUser = false;
      const socket = new WebSocket(this.url);
      this.socket = socket;

      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener("error", () => reject(new Error(`Failed to connect to PvP server at ${this.url}`)), {
        once: true,
      });
      socket.addEventListener("message", event => this.handleMessage(event.data));
      socket.addEventListener("close", () => this.handleClose());
    });
  }

  /** Close the connection. Does not emit a synthetic `DISCONNECT` event. */
  public disconnect(): void {
    this.closedByUser = true;
    this.socket?.close();
    this.socket = null;
  }

  /** Serialize and send a message to the server. */
  public send(message: PvpClientMessage): void {
    if (!this.isConnected) {
      throw new Error("Cannot send message: PvP socket is not open");
    }
    this.socket?.send(JSON.stringify(message));
  }

  /** Subscribe to a specific server message type. */
  public on<K extends ServerMessageType>(type: K, listener: ServerMessageListener<K>): void {
    let set = this.listeners[type];
    if (!set) {
      set = new Set();
      this.listeners[type] = set;
    }
    set.add(listener as AnyServerMessageListener);
  }

  /** Unsubscribe a previously registered listener. */
  public off<K extends ServerMessageType>(type: K, listener: ServerMessageListener<K>): void {
    this.listeners[type]?.delete(listener as AnyServerMessageListener);
  }

  private handleMessage(raw: unknown): void {
    if (typeof raw !== "string") {
      console.error("Received non-string PvP server message:", raw);
      return;
    }

    let message: PvpServerMessage;
    try {
      message = JSON.parse(raw);
    } catch {
      console.error("Received malformed PvP server message:", raw);
      return;
    }

    for (const listener of this.listeners[message.type] ?? []) {
      listener(message);
    }
  }

  /**
   * Emit a synthetic {@linkcode OpponentDisconnectedMessage} when the socket closes
   * unexpectedly (i.e. not via {@linkcode disconnect}), so callers don't need to
   * separately listen for the raw WebSocket `close` event.
   */
  private handleClose(): void {
    this.socket = null;
    if (this.closedByUser) {
      return;
    }
    for (const listener of this.listeners.DISCONNECT ?? []) {
      listener({ type: "DISCONNECT", graceSeconds: 0 });
    }
  }
}
