import type { PeerPresence } from "@mindmap/core";
import type { LoroSyncAdapter } from "@mindmap/core/loro";
import { OWNER_HEADER, ROOM_HEADER } from "./shared.js";

const PEER_COLORS = [
  "#3B82F6FF",
  "#10B981FF",
  "#F59E0BFF",
  "#EC4899FF",
  "#8B5CF6FF",
  "#06B6D4FF",
  "#EF4444FF",
];

function hashColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) {
    h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
  }
  return PEER_COLORS[Math.abs(h) % PEER_COLORS.length];
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

interface BroadcastPacket {
  kind: "update" | "presence";
  peerId: string;
  name: string;
  color: string;
  selectedTopicIds?: string[];
  updateB64?: string;
}

interface CollabGetResponse {
  revision?: number;
  latestSeq: number;
  updates: Array<{ seq: number; peerId: string; actor: string; updateB64: string }>;
  peers: PeerPresence[];
}

export class CollabSession {
  readonly peerId = crypto.randomUUID();
  readonly color: string;
  private channel: BroadcastChannel | null = null;
  private polling = false;
  private pushing = false;
  private applyingRemote = false;
  private closed = false;
  private pendingPushTimer: number | null = null;
  private pollTimer: number | null = null;
  private localSelection: string[] = [];
  private peerMap = new Map<string, PeerPresence>();
  private unsubAdapter: (() => void) | null = null;
  private lastSentVersion: ReturnType<LoroSyncAdapter["getVersion"]>;
  private pendingDeltaBytes: Uint8Array[] = [];

  constructor(
    private readonly owner: string,
    private readonly mapId: string,
    private readonly displayName: string,
    private readonly adapter: LoroSyncAdapter,
    private readonly readOnly: boolean,
    private readonly onPeersChange: (peers: PeerPresence[]) => void,
    readonly room: string,
    public cursor: number,
    public revision: number,
    private readonly refresh: () => void,
  ) {
    this.color = hashColor(`${displayName}:${this.peerId}`);
    this.lastSentVersion = adapter.getVersion();
  }

  start(unsentSince?: ReturnType<LoroSyncAdapter["getVersion"]>): void {
    if (this.closed) return;

    // 1. Subscribe to local Loro adapter mutations and broadcast binary deltas
    const publish = () => {
      if (this.applyingRemote) return;
      if (this.readOnly) return;
      const delta = this.adapter.exportUpdates(this.lastSentVersion);
      this.lastSentVersion = this.adapter.getVersion();
      if (delta.byteLength === 0) return;

      const updateB64 = bytesToBase64(delta);
      this.broadcast({
        kind: "update",
        peerId: this.peerId,
        name: this.displayName,
        color: this.color,
        selectedTopicIds: this.localSelection,
        updateB64,
      });
      this.pendingDeltaBytes.push(delta);
      this.schedulePush();
    };
    this.unsubAdapter = this.adapter.subscribe(publish);

    // 2. Instant same-browser multi-tab sync via BroadcastChannel
    if (typeof BroadcastChannel !== "undefined") {
      try {
        this.channel = new BroadcastChannel(`loomind-collab:${this.owner}:${this.mapId}:${this.room}`);
        this.channel.onmessage = (event: MessageEvent<BroadcastPacket>) => {
          const msg = event.data;
          if (!msg || msg.peerId === this.peerId) return;
          if (msg.kind === "update" && msg.updateB64) {
            if (!this.applyRemoteBytes(base64ToBytes(msg.updateB64))) this.refresh();
          }
          if (msg.selectedTopicIds) {
            this.peerMap.set(msg.peerId, {
              peerId: msg.peerId,
              name: msg.name,
              color: msg.color,
              selectedTopicIds: msg.selectedTopicIds,
              updatedAt: Date.now(),
            });
            this.emitPeers();
          }
        };
      } catch {
        this.channel = null;
      }
    }

    // 3. Initial cloud pull + presence heartbeat
    void this.pollNow();
    void this.postUpdate(null);
    if (unsentSince && unsentSince.compare(this.adapter.getVersion()) !== 0) {
      this.lastSentVersion = unsentSince;
      publish();
    }

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.handleVisibility);
    }
  }

  isApplyingRemote(): boolean {
    return this.applyingRemote;
  }

  setLocalSelection(topicIds: string[]): void {
    const prevKey = this.localSelection.join(",");
    const nextKey = topicIds.join(",");
    if (prevKey === nextKey) return;
    this.localSelection = topicIds.slice(0, 12);
    this.broadcast({
      kind: "presence",
      peerId: this.peerId,
      name: this.displayName,
      color: this.color,
      selectedTopicIds: this.localSelection,
    });
    this.schedulePush(400);
  }

  close(): void {
    this.closed = true;
    this.unsubAdapter?.();
    this.unsubAdapter = null;
    if (this.pendingPushTimer !== null) {
      window.clearTimeout(this.pendingPushTimer);
      this.pendingPushTimer = null;
    }
    if (this.pollTimer !== null) {
      window.clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.handleVisibility);
    }
    this.channel?.close();
    this.channel = null;
  }

  private handleVisibility = () => {
    if (this.closed) return;
    if (typeof document !== "undefined" && !document.hidden) {
      void this.pollNow();
    }
  };

  private broadcast(packet: BroadcastPacket): void {
    try {
      this.channel?.postMessage(packet);
    } catch {
      // Ignore closed channel
    }
  }

  applyRemoteBytes(bytes: Uint8Array): boolean {
    if (this.closed || !bytes.byteLength) return false;
    this.applyingRemote = true;
    try {
      const applied = this.adapter.importUpdates(bytes);
      this.lastSentVersion = this.adapter.getVersion();
      return applied;
    } catch {
      return false;
    } finally {
      this.applyingRemote = false;
    }
  }

  private schedulePush(delayMs = 250): void {
    if (this.closed || this.pendingPushTimer !== null) return;
    this.pendingPushTimer = window.setTimeout(() => {
      this.pendingPushTimer = null;
      void this.flushPending();
    }, delayMs);
  }

  private async flushPending(): Promise<void> {
    if (this.closed || this.pushing) return;
    this.pushing = true;
    try {
      do {
        const frame = this.pendingDeltaBytes[0];
        if (!await this.postUpdate(frame ? bytesToBase64(frame) : null)) break;
        if (frame && this.pendingDeltaBytes[0] === frame) this.pendingDeltaBytes.shift();
      } while (!this.closed && this.pendingDeltaBytes.length);
    } finally {
      this.pushing = false;
      if (this.pendingDeltaBytes.length) this.schedulePush(2_000);
    }
  }

  queueWatermark() { return this.pendingDeltaBytes.at(-1); }

  saved(revision: number, watermark: Uint8Array | undefined) {
    this.revision = Math.max(revision, this.revision);
    const index = watermark ? this.pendingDeltaBytes.indexOf(watermark) : -1;
    if (index >= 0) this.pendingDeltaBytes.splice(0, index + 1);
  }

  private async postUpdate(updateB64: string | null): Promise<boolean> {
    if (this.closed) return false;
    try {
      const res = await fetch(`/api/mindmaps/${this.mapId}/collab`, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          [OWNER_HEADER]: this.owner,
          [ROOM_HEADER]: this.room,
        },
        body: JSON.stringify({
          peerId: this.peerId,
          name: this.displayName,
          color: this.color,
          selectedTopicIds: this.localSelection,
          ...(updateB64 && !this.readOnly ? { updateB64 } : {}),
        }),
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) {
        if (!this.closed && (res.status === 413 || res.status === 409 || res.status === 400)) this.refresh();
        return false;
      }
      const data = (await res.json()) as { seq?: number; peers?: PeerPresence[] };
      if (Array.isArray(data.peers)) {
        this.mergeServerPeers(data.peers);
      }
      return !updateB64 || (typeof data.seq === "number" && data.seq > 0);
    } catch {
      return false;
    }
  }

  private async pollNow(): Promise<void> {
    if (this.closed || this.polling) return;
    if (this.pollTimer !== null) {
      window.clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }

    if (typeof document !== "undefined" && document.hidden) {
      this.scheduleNextPoll();
      return;
    }

    this.polling = true;
    try {
      const res = await fetch(`/api/mindmaps/${this.mapId}/collab?since=${this.cursor}`, {
        credentials: "same-origin",
        cache: "no-store",
        headers: { [OWNER_HEADER]: this.owner, [ROOM_HEADER]: this.room },
        signal: AbortSignal.timeout(8_000),
      });
      if (res.ok) {
        const data = (await res.json()) as CollabGetResponse;
        if (this.closed) return;
        let incomplete = false;
        if (Array.isArray(data.updates)) {
          for (const item of data.updates) {
            if (item.seq <= this.cursor) continue;
            if (item.peerId !== this.peerId && !this.applyRemoteBytes(base64ToBytes(item.updateB64))) incomplete = true;
            if (!incomplete) this.cursor = item.seq;
          }
        }
        if (incomplete || (data.revision ?? 0) > this.revision) this.refresh();
        if (Array.isArray(data.peers)) {
          this.mergeServerPeers(data.peers);
        }
      } else if (res.status === 409 && !this.closed) this.refresh();
    } catch {
      // Ignore network blips
    } finally { this.polling = false; }

    this.scheduleNextPoll();
  }

  private scheduleNextPoll(): void {
    if (this.closed) return;
    const hasOthers = this.getRemotePeers().length > 0;
    const interval = hasOthers ? 2_000 : 5_000;
    this.pollTimer = window.setTimeout(() => {
      this.pollTimer = null;
      void this.pollNow();
    }, interval);
  }

  private mergeServerPeers(serverPeers: PeerPresence[]): void {
    const now = Date.now();
    // Prune stale local broadcast peers (> 20s)
    for (const [id, peer] of this.peerMap) {
      if (now - peer.updatedAt > 20_000) this.peerMap.delete(id);
    }
    for (const p of serverPeers) {
      if (p.peerId === this.peerId) continue;
      this.peerMap.set(p.peerId, p);
    }
    this.emitPeers();
  }

  private getRemotePeers(): PeerPresence[] {
    const now = Date.now();
    return Array.from(this.peerMap.values()).filter(
      (p) => p.peerId !== this.peerId && now - p.updatedAt <= 25_000,
    );
  }

  private emitPeers(): void {
    if (this.closed) return;
    this.onPeersChange(this.getRemotePeers());
  }
}
