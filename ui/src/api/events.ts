/**
 * WebSocket event stream client for ChainsawRecon.
 * Supports automatic reconnection with exponential backoff,
 * journal event catch-up via `afterSeq`, and REST gap recovery.
 */

import { JournalEvent, JournalStreamFrame } from './types';

export type ConnectionState = 'connected' | 'connecting' | 'reconnecting' | 'disconnected';
export type StreamEventHandler = (event: JournalEvent) => void;
export type StateChangeHandler = (state: ConnectionState) => void;
export type GapHandler = (fromSeq: number, toSeq: number) => void;

function getDefaultWsUrl(): string {
  if (import.meta.env.VITE_WS_URL) {
    return import.meta.env.VITE_WS_URL;
  }
  const protocol = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = typeof window !== 'undefined' && window.location.host ? window.location.host : '127.0.0.1:8765';
  return `${protocol}//${host}/api/v1/events`;
}

export class ChainsawEventClient {
  private ws: WebSocket | null = null;
  private baseUrl: string;
  private currentSessionId: string | null = null;
  private lastSeq: number = 0;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 10;
  private reconnectTimer: number | null = null;
  private state: ConnectionState = 'disconnected';
  private eventHandlers: Set<StreamEventHandler> = new Set();
  private stateHandlers: Set<StateChangeHandler> = new Set();
  private gapHandlers: Set<GapHandler> = new Set();
  private enabled: boolean = true;

  constructor(url?: string) {
    this.baseUrl = url || getDefaultWsUrl();
  }

  public connect(sessionId?: string, fromSeq?: number) {
    this.enabled = true;
    if (sessionId !== undefined) {
      this.currentSessionId = sessionId;
    }
    if (fromSeq !== undefined) {
      this.lastSeq = fromSeq;
    }

    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.setState(this.reconnectAttempts === 0 ? 'connecting' : 'reconnecting');

    try {
      const urlObj = new URL(this.baseUrl, typeof window !== 'undefined' ? window.location.origin : 'http://127.0.0.1:8765');
      if (this.currentSessionId) {
        urlObj.searchParams.set('sessionId', this.currentSessionId);
      }
      if (this.lastSeq > 0) {
        urlObj.searchParams.set('afterSeq', this.lastSeq.toString());
      }

      this.ws = new WebSocket(urlObj.toString());

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.setState('connected');
      };

      this.ws.onmessage = (messageEvent) => {
        try {
          const parsed = JSON.parse(messageEvent.data) as JournalStreamFrame | Record<string, unknown>;
          
          let journalEvt: JournalEvent | null = null;
          if ('kind' in parsed && parsed.kind === 'journal' && 'event' in parsed && parsed.event) {
            journalEvt = parsed.event as JournalEvent;
          } else if ('seq' in parsed && 'type' in parsed) {
            journalEvt = parsed as unknown as JournalEvent;
          }

          if (journalEvt && typeof journalEvt.seq === 'number') {
            // Check for sequence gap
            if (this.lastSeq > 0 && journalEvt.seq > this.lastSeq + 1) {
              const gapFrom = this.lastSeq;
              const gapTo = journalEvt.seq;
              this.gapHandlers.forEach((handler) => handler(gapFrom, gapTo));
            }

            if (journalEvt.seq > this.lastSeq) {
              this.lastSeq = journalEvt.seq;
            }

            this.eventHandlers.forEach((handler) => handler(journalEvt as JournalEvent));
          }
        } catch (err) {
          console.error('[ChainsawEventClient] Failed to parse event', err);
        }
      };

      this.ws.onerror = () => {
        // Handled in onclose
      };

      this.ws.onclose = () => {
        this.ws = null;
        this.setState('disconnected');
        if (this.enabled) {
          this.scheduleReconnect();
        }
      };
    } catch {
      this.setState('disconnected');
      if (this.enabled) {
        this.scheduleReconnect();
      }
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.warn('[ChainsawEventClient] Max reconnect attempts reached');
      return;
    }

    // Exponential backoff: 1s, 2s, 4s, 8s, up to 30s max
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;

    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  public disconnect() {
    this.enabled = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setState('disconnected');
  }

  public subscribe(handler: StreamEventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  public onStateChange(handler: StateChangeHandler): () => void {
    this.stateHandlers.add(handler);
    handler(this.state);
    return () => this.stateHandlers.delete(handler);
  }

  public onGap(handler: GapHandler): () => void {
    this.gapHandlers.add(handler);
    return () => this.gapHandlers.delete(handler);
  }

  public getState(): ConnectionState {
    return this.state;
  }

  public getLastSeq(): number {
    return this.lastSeq;
  }

  public setLastSeq(seq: number): void {
    this.lastSeq = seq;
  }

  private setState(state: ConnectionState) {
    this.state = state;
    this.stateHandlers.forEach((handler) => handler(state));
  }
}

export const eventClient = new ChainsawEventClient();
