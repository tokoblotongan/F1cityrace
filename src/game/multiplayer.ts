import type { RealtimeChannel } from '@supabase/supabase-js';
import { CircuitId } from '../data/circuits.ts';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient.ts';

export type WeatherId = 'cerah' | 'hujan' | 'kabut';
export type RoomStatus = 'WAITING' | 'RACING';

export interface LiveryPreset {
  hex: string;
  num: number;
  label: string;
}

export const LIVERY_PRESETS: LiveryPreset[] = [
  { hex: '#e10600', num: 0xe10600, label: 'Rosso Corsa' },
  { hex: '#00d2be', num: 0x00d2be, label: 'Teal Arrow' },
  { hex: '#ff8000', num: 0xff8000, label: 'Papaya Speed' },
  { hex: '#006f62', num: 0x006f62, label: 'Verde Racing' },
  { hex: '#3b82f6', num: 0x3b82f6, label: 'Azzurra Corse' },
  { hex: '#facc15', num: 0xfacc15, label: 'Giallo Motors' },
  { hex: '#a855f7', num: 0xa855f7, label: 'Viola GP' },
  { hex: '#f472b6', num: 0xf472b6, label: 'Rose Racing' },
];

export function colorHexToNum(hex: string | number | undefined): number {
  if (typeof numFromUnknown(hex) === 'number') return numFromUnknown(hex)!;
  return 0xe10600;
}

function numFromUnknown(hex: string | number | undefined): number | null {
  if (typeof hex === 'number' && Number.isFinite(hex)) return hex;
  if (typeof hex === 'string') {
    const cleaned = hex.trim().replace(/^#/, '');
    const parsed = parseInt(cleaned, 16);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export interface LobbyRoomInfo {
  roomId: string;
  roomName: string;
  hostId: string;
  hostName: string;
  circuit: CircuitId;
  weather: WeatherId;
  playerCount: number;
  maxPlayers: number;
  status: RoomStatus;
  createdAt: number;
}

export interface RoomMember {
  playerId: string;
  name: string;
  liveryColor: string;
  isHost: boolean;
  joinedAt: number;
  gridSlot: number;
}

export interface RaceSlotAssignment {
  playerId: string;
  name: string;
  liveryColor: string;
  gridSlot: number;
}

export interface RaceStartPayload {
  roomId: string;
  hostId: string;
  circuit: CircuitId;
  weather: WeatherId;
  startAtMs: number;
  slots: RaceSlotAssignment[];
}

export interface PlayerTelemetryPacket {
  playerId: string;
  name: string;
  liveryColor: string;
  x: number;
  y: number;
  z: number;
  rotY: number;
  pitch: number;
  speed: number;
  steerVis: number;
  drs: boolean;
  u: number;
  lap: number;
  lapsCompleted: number;
  progress: number;
  hp: number;
  bestLapTime: number | null;
  lastLapTime: number | null;
  currentLapTime: number;
  finished: boolean;
  finishTime: number | null;
  checkpointName?: string;
}

export interface AiTelemetryCar {
  slot: number;
  name: string;
  team: string;
  color: string;
  x: number;
  y: number;
  z: number;
  rotY: number;
  pitch: number;
  speed: number;
  steerVis: number;
  drs: boolean;
  u: number;
  lap: number;
  lapsCompleted: number;
  progress: number;
  bestLapTime: number | null;
  lastLapTime: number | null;
  currentLapTime: number;
  finished: boolean;
  finishTime: number | null;
}

export interface AiTelemetryBatchPacket {
  hostId: string;
  phase: 'LIGHTS' | 'RACING' | 'FINISHED';
  startLights: number;
  raceTime: number;
  chequeredCountdown: number | null;
  cars: AiTelemetryCar[];
}

export interface RoomConfigPayload {
  hostId: string;
  circuit: CircuitId;
  weather: WeatherId;
  status: RoomStatus;
}

export interface ActiveRoomState {
  roomId: string;
  roomName: string;
  hostId: string;
  circuit: CircuitId;
  weather: WeatherId;
  status: RoomStatus;
  members: RoomMember[];
  maxPlayers: number;
}

// Per-tab unique playerId so multiple tabs in one browser operate as distinct racers
const LOCAL_PLAYER_ID: string =
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `drv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;

export function getLocalPlayerId(): string {
  return LOCAL_PLAYER_ID;
}

export function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

export function sanitizeDriverName(raw: string): string {
  const cleaned = raw.trim().slice(0, 16);
  return cleaned || `DRIVER-${LOCAL_PLAYER_ID.slice(0, 4).toUpperCase()}`;
}

export interface LobbyCallbacks {
  onRoomsChange: (rooms: LobbyRoomInfo[]) => void;
  onStatusChange?: (status: 'CONNECTING' | 'CONNECTED' | 'ERROR' | 'UNCONFIGURED') => void;
}

export interface RoomCallbacks {
  onRoomUpdate: (room: ActiveRoomState) => void;
  onRaceStart: (payload: RaceStartPayload) => void;
  onRaceRestart: (payload: RaceStartPayload) => void;
  onPlayerTelemetry: (packet: PlayerTelemetryPacket) => void;
  onAiTelemetry: (packet: AiTelemetryBatchPacket) => void;
  onPlayerLeave: (playerId: string) => void;
  onError?: (message: string) => void;
}

export class MultiplayerManager {
  private lobbyChannel: RealtimeChannel | null = null;
  private lobbySubscribed = false;
  private roomChannel: RealtimeChannel | null = null;
  private roomSubscribed = false;

  private lobbyCallbacks: LobbyCallbacks | null = null;
  private roomCallbacks: RoomCallbacks | null = null;

  private myName = 'DRIVER';
  private myColor = '#e10600';
  private myJoinedAt = Date.now();

  private activeRoom: ActiveRoomState | null = null;
  private roomCreatedAt = Date.now();
  private lastKnownMemberIds = new Set<string>();

  public isConfigured(): boolean {
    return isSupabaseConfigured && !!supabase;
  }

  public getPlayerId(): string {
    return LOCAL_PLAYER_ID;
  }

  public getActiveRoom(): ActiveRoomState | null {
    return this.activeRoom;
  }

  public isHost(): boolean {
    return !!this.activeRoom && this.activeRoom.hostId === LOCAL_PLAYER_ID;
  }

  public setProfile(name: string, liveryColor: string): void {
    this.myName = sanitizeDriverName(name);
    this.myColor = liveryColor || '#e10600';
    if (this.roomChannel && this.roomSubscribed && this.activeRoom) {
      void this.trackRoomPresence();
      if (this.isHost()) {
        this.activeRoom = {
          ...this.activeRoom,
        };
        void this.syncLobbyHostPresence();
      }
    }
  }

  public async connectLobby(callbacks: LobbyCallbacks): Promise<void> {
    this.lobbyCallbacks = callbacks;
    if (!supabase || !isSupabaseConfigured) {
      callbacks.onStatusChange?.('UNCONFIGURED');
      callbacks.onRoomsChange([]);
      return;
    }

    if (this.lobbyChannel) {
      return;
    }

    callbacks.onStatusChange?.('CONNECTING');
    const channel = supabase.channel('f1cityrace:lobby', {
      config: {
        presence: { key: LOCAL_PLAYER_ID },
      },
    });
    this.lobbyChannel = channel;

    const emitLobbyRooms = () => {
      if (!this.lobbyChannel) return;
      const state = this.lobbyChannel.presenceState() as Record<string, any[]>;
      const rooms: LobbyRoomInfo[] = [];
      const seenRoomIds = new Set<string>();
      for (const presences of Object.values(state)) {
        if (!Array.isArray(presences)) continue;
        for (const p of presences) {
          if (p && p.role === 'host' && typeof p.roomId === 'string' && !seenRoomIds.has(p.roomId)) {
            seenRoomIds.add(p.roomId);
            rooms.push({
              roomId: p.roomId,
              roomName: typeof p.roomName === 'string' && p.roomName ? p.roomName : `ROOM ${p.roomId}`,
              hostId: String(p.hostId || ''),
              hostName: String(p.hostName || 'HOST'),
              circuit: p.circuit === 'salatiga-gp' ? 'salatiga-gp' : 'monaco-gp',
              weather: p.weather === 'hujan' || p.weather === 'kabut' ? p.weather : 'cerah',
              playerCount: Math.max(1, Math.min(8, Number(p.playerCount) || 1)),
              maxPlayers: 8,
              status: p.status === 'RACING' ? 'RACING' : 'WAITING',
              createdAt: Number(p.createdAt) || Date.now(),
            });
          }
        }
      }
      rooms.sort((a, b) => b.createdAt - a.createdAt);
      this.lobbyCallbacks?.onRoomsChange(rooms);
    };

    channel.on('presence', { event: 'sync' }, emitLobbyRooms);
    channel.on('presence', { event: 'join' }, emitLobbyRooms);
    channel.on('presence', { event: 'leave' }, emitLobbyRooms);

    channel.subscribe((status) => {
      if (this.lobbyChannel !== channel) return;
      if (status === 'SUBSCRIBED') {
        this.lobbySubscribed = true;
        this.lobbyCallbacks?.onStatusChange?.('CONNECTED');
        emitLobbyRooms();
        if (this.isHost()) {
          void this.syncLobbyHostPresence();
        }
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        this.lobbySubscribed = false;
        this.lobbyCallbacks?.onStatusChange?.('ERROR');
      }
    });
  }

  public async disconnectLobby(): Promise<void> {
    const ch = this.lobbyChannel;
    this.lobbyChannel = null;
    this.lobbySubscribed = false;
    this.lobbyCallbacks = null;
    if (ch && supabase) {
      try {
        await ch.untrack();
      } catch {
        // ignore untrack error on teardown
      }
      await supabase.removeChannel(ch);
    }
  }

  private async syncLobbyHostPresence(): Promise<void> {
    if (!this.lobbyChannel || !this.lobbySubscribed || !this.activeRoom || !this.isHost()) return;
    try {
      await this.lobbyChannel.track({
        role: 'host',
        roomId: this.activeRoom.roomId,
        roomName: this.activeRoom.roomName,
        hostId: LOCAL_PLAYER_ID,
        hostName: this.myName,
        circuit: this.activeRoom.circuit,
        weather: this.activeRoom.weather,
        playerCount: Math.max(1, this.activeRoom.members.length),
        maxPlayers: 8,
        status: this.activeRoom.status,
        createdAt: this.roomCreatedAt,
      });
    } catch {
      // ignore transient track failure
    }
  }

  private async untrackLobbyHost(): Promise<void> {
    if (!this.lobbyChannel || !this.lobbySubscribed) return;
    try {
      await this.lobbyChannel.untrack();
    } catch {
      // ignore
    }
  }

  public async createPublicRoom(
    options: {
      roomName?: string;
      circuit: CircuitId;
      weather: WeatherId;
      driverName: string;
      liveryColor: string;
    },
    callbacks: RoomCallbacks
  ): Promise<ActiveRoomState | null> {
    if (!supabase || !isSupabaseConfigured) {
      callbacks.onError?.('Configure VITE_SUPABASE_URL & VITE_SUPABASE_ANON_KEY');
      return null;
    }

    await this.leaveRoom();
    const roomId = generateRoomCode();
    const cleanRoomName = (options.roomName || '').trim().slice(0, 24) || `${options.circuit === 'salatiga-gp' ? 'SALATIGA' : 'MONACO'} #${roomId.slice(0, 4)}`;
    this.myName = sanitizeDriverName(options.driverName);
    this.myColor = options.liveryColor || '#e10600';
    this.myJoinedAt = Date.now();
    this.roomCreatedAt = this.myJoinedAt;

    const initialState: ActiveRoomState = {
      roomId,
      roomName: cleanRoomName,
      hostId: LOCAL_PLAYER_ID,
      circuit: options.circuit,
      weather: options.weather,
      status: 'WAITING',
      maxPlayers: 8,
      members: [
        {
          playerId: LOCAL_PLAYER_ID,
          name: this.myName,
          liveryColor: this.myColor,
          isHost: true,
          joinedAt: this.myJoinedAt,
          gridSlot: 0,
        },
      ],
    };

    return this.joinRoomInternal(initialState, true, callbacks);
  }

  public async joinPublicRoom(
    room: LobbyRoomInfo,
    options: { driverName: string; liveryColor: string },
    callbacks: RoomCallbacks
  ): Promise<ActiveRoomState | null> {
    if (!supabase || !isSupabaseConfigured) {
      callbacks.onError?.('Configure VITE_SUPABASE_URL & VITE_SUPABASE_ANON_KEY');
      return null;
    }

    await this.leaveRoom();
    this.myName = sanitizeDriverName(options.driverName);
    this.myColor = options.liveryColor || '#e10600';
    this.myJoinedAt = Date.now();
    this.roomCreatedAt = room.createdAt || this.myJoinedAt;

    const initialState: ActiveRoomState = {
      roomId: room.roomId,
      roomName: room.roomName,
      hostId: room.hostId,
      circuit: room.circuit,
      weather: room.weather,
      status: room.status,
      maxPlayers: 8,
      members: [
        {
          playerId: LOCAL_PLAYER_ID,
          name: this.myName,
          liveryColor: this.myColor,
          isHost: room.hostId === LOCAL_PLAYER_ID,
          joinedAt: this.myJoinedAt,
          gridSlot: 0,
        },
      ],
    };

    return this.joinRoomInternal(initialState, false, callbacks);
  }

  private async joinRoomInternal(
    initialState: ActiveRoomState,
    asHost: boolean,
    callbacks: RoomCallbacks
  ): Promise<ActiveRoomState | null> {
    if (!supabase) return null;
    this.roomCallbacks = callbacks;
    this.activeRoom = initialState;
    this.lastKnownMemberIds = new Set([LOCAL_PLAYER_ID]);

    const channel = supabase.channel(`f1cityrace:room:${initialState.roomId}`, {
      config: {
        presence: { key: LOCAL_PLAYER_ID },
        broadcast: { self: false },
      },
    });
    this.roomChannel = channel;
    this.roomSubscribed = false;

    const handlePresenceChange = () => {
      if (!this.roomChannel || !this.activeRoom) return;
      const raw = this.roomChannel.presenceState() as Record<string, any[]>;
      const memberMap = new Map<string, RoomMember & { circuit?: CircuitId; weather?: WeatherId; status?: RoomStatus; roomName?: string }>();

      for (const entries of Object.values(raw)) {
        if (!Array.isArray(entries)) continue;
        for (const entry of entries) {
          if (!entry || typeof entry.playerId !== 'string') continue;
          const prev = memberMap.get(entry.playerId);
          const joinedAt = Number(entry.joinedAt) || Date.now();
          if (!prev || joinedAt <= prev.joinedAt) {
            memberMap.set(entry.playerId, {
              playerId: entry.playerId,
              name: typeof entry.name === 'string' && entry.name ? entry.name : 'DRIVER',
              liveryColor: typeof entry.liveryColor === 'string' && entry.liveryColor ? entry.liveryColor : '#e10600',
              isHost: !!entry.isHost,
              joinedAt,
              gridSlot: 0,
              circuit: entry.circuit,
              weather: entry.weather,
              status: entry.status,
              roomName: entry.roomName,
            });
          }
        }
      }

      if (memberMap.size === 0) return;

      const sorted = Array.from(memberMap.values()).sort((a, b) => {
        if (a.isHost !== b.isHost) return a.isHost ? -1 : 1;
        if (a.joinedAt !== b.joinedAt) return a.joinedAt - b.joinedAt;
        return a.playerId.localeCompare(b.playerId);
      });

      // Deterministic host election if the original host left
      let electedHost = sorted.find((m) => m.isHost);
      if (!electedHost) {
        electedHost = sorted[0];
        electedHost.isHost = true;
      }

      const assignedMembers: RoomMember[] = sorted.slice(0, 8).map((m, idx) => ({
        playerId: m.playerId,
        name: m.name,
        liveryColor: m.liveryColor,
        isHost: m.playerId === electedHost!.playerId,
        joinedAt: m.joinedAt,
        gridSlot: idx,
      }));

      // Detect departed members for 3D car cleanup
      const currentIds = new Set(assignedMembers.map((m) => m.playerId));
      for (const oldId of this.lastKnownMemberIds) {
        if (!currentIds.has(oldId) && oldId !== LOCAL_PLAYER_ID) {
          this.roomCallbacks?.onPlayerLeave(oldId);
        }
      }
      this.lastKnownMemberIds = currentIds;

      const hostEntry = memberMap.get(electedHost.playerId);
      const nextCircuit: CircuitId =
        hostEntry?.circuit === 'salatiga-gp' || hostEntry?.circuit === 'monaco-gp'
          ? hostEntry.circuit
          : this.activeRoom.circuit;
      const nextWeather: WeatherId =
        hostEntry?.weather === 'cerah' || hostEntry?.weather === 'hujan' || hostEntry?.weather === 'kabut'
          ? hostEntry.weather
          : this.activeRoom.weather;
      const nextStatus: RoomStatus =
        hostEntry?.status === 'RACING' || hostEntry?.status === 'WAITING'
          ? hostEntry.status
          : this.activeRoom.status;
      const nextRoomName = hostEntry?.roomName || this.activeRoom.roomName;

      const becameHost =
        this.activeRoom.hostId !== electedHost.playerId && electedHost.playerId === LOCAL_PLAYER_ID;

      this.activeRoom = {
        ...this.activeRoom,
        roomName: nextRoomName,
        hostId: electedHost.playerId,
        circuit: nextCircuit,
        weather: nextWeather,
        status: nextStatus,
        members: assignedMembers,
      };

      this.roomCallbacks?.onRoomUpdate(this.activeRoom);

      if (this.isHost()) {
        if (becameHost) {
          void this.trackRoomPresence();
        }
        void this.syncLobbyHostPresence();
      }
    };

    channel.on('presence', { event: 'sync' }, handlePresenceChange);
    channel.on('presence', { event: 'join' }, handlePresenceChange);
    channel.on('presence', { event: 'leave' }, ({ leftPresences }) => {
      if (Array.isArray(leftPresences)) {
        for (const p of leftPresences) {
          if (p && typeof p.playerId === 'string' && p.playerId !== LOCAL_PLAYER_ID) {
            this.roomCallbacks?.onPlayerLeave(p.playerId);
          }
        }
      }
      handlePresenceChange();
    });

    channel.on('broadcast', { event: 'room:config' }, ({ payload }) => {
      if (!payload || !this.activeRoom) return;
      const cfg = payload as RoomConfigPayload;
      this.activeRoom = {
        ...this.activeRoom,
        circuit: cfg.circuit === 'salatiga-gp' ? 'salatiga-gp' : 'monaco-gp',
        weather: cfg.weather === 'hujan' || cfg.weather === 'kabut' ? cfg.weather : 'cerah',
        status: cfg.status === 'RACING' ? 'RACING' : 'WAITING',
      };
      this.roomCallbacks?.onRoomUpdate(this.activeRoom);
    });

    channel.on('broadcast', { event: 'race:start' }, ({ payload }) => {
      if (!payload || !this.activeRoom) return;
      const startData = payload as RaceStartPayload;
      this.activeRoom = {
        ...this.activeRoom,
        circuit: startData.circuit,
        weather: startData.weather,
        status: 'RACING',
      };
      this.roomCallbacks?.onRoomUpdate(this.activeRoom);
      this.roomCallbacks?.onRaceStart(startData);
    });

    channel.on('broadcast', { event: 'race:restart' }, ({ payload }) => {
      if (!payload || !this.activeRoom) return;
      const restartData = payload as RaceStartPayload;
      this.activeRoom = {
        ...this.activeRoom,
        circuit: restartData.circuit,
        weather: restartData.weather,
        status: 'RACING',
      };
      this.roomCallbacks?.onRoomUpdate(this.activeRoom);
      this.roomCallbacks?.onRaceRestart(restartData);
    });

    channel.on('broadcast', { event: 'telemetry:player' }, ({ payload }) => {
      if (!payload) return;
      const pkt = payload as PlayerTelemetryPacket;
      if (pkt.playerId && pkt.playerId !== LOCAL_PLAYER_ID) {
        this.roomCallbacks?.onPlayerTelemetry(pkt);
      }
    });

    channel.on('broadcast', { event: 'telemetry:ai' }, ({ payload }) => {
      if (!payload) return;
      const pkt = payload as AiTelemetryBatchPacket;
      if (pkt.hostId !== LOCAL_PLAYER_ID) {
        this.roomCallbacks?.onAiTelemetry(pkt);
      }
    });

    channel.subscribe(async (status) => {
      if (this.roomChannel !== channel) return;
      if (status === 'SUBSCRIBED') {
        this.roomSubscribed = true;
        await this.trackRoomPresence();
        if (asHost) {
          await this.syncLobbyHostPresence();
        }
        handlePresenceChange();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        this.roomSubscribed = false;
        this.roomCallbacks?.onError?.('Realtime room connection error — retrying or please rejoin.');
      }
    });

    this.roomCallbacks?.onRoomUpdate(initialState);
    return initialState;
  }

  private async trackRoomPresence(): Promise<void> {
    if (!this.roomChannel || !this.roomSubscribed || !this.activeRoom) return;
    try {
      await this.roomChannel.track({
        playerId: LOCAL_PLAYER_ID,
        name: this.myName,
        liveryColor: this.myColor,
        isHost: this.isHost(),
        joinedAt: this.myJoinedAt,
        roomName: this.activeRoom.roomName,
        circuit: this.activeRoom.circuit,
        weather: this.activeRoom.weather,
        status: this.activeRoom.status,
      });
    } catch {
      // ignore transient track failure
    }
  }

  public async updateHostRoomConfig(circuit: CircuitId, weather: WeatherId, status?: RoomStatus): Promise<void> {
    if (!this.activeRoom || !this.isHost()) return;
    const nextStatus = status ?? this.activeRoom.status;
    this.activeRoom = {
      ...this.activeRoom,
      circuit,
      weather,
      status: nextStatus,
    };
    this.roomCallbacks?.onRoomUpdate(this.activeRoom);
    await this.trackRoomPresence();
    await this.syncLobbyHostPresence();
    if (this.roomChannel && this.roomSubscribed) {
      await this.roomChannel.send({
        type: 'broadcast',
        event: 'room:config',
        payload: {
          hostId: LOCAL_PLAYER_ID,
          circuit,
          weather,
          status: nextStatus,
        } satisfies RoomConfigPayload,
      });
    }
  }

  public async startRaceForAll(isRestart = false): Promise<RaceStartPayload | null> {
    if (!this.activeRoom || !this.isHost()) return null;
    const slots: RaceSlotAssignment[] = this.activeRoom.members.slice(0, 8).map((m, idx) => ({
      playerId: m.playerId,
      name: m.name,
      liveryColor: m.liveryColor,
      gridSlot: idx,
    }));

    const payload: RaceStartPayload = {
      roomId: this.activeRoom.roomId,
      hostId: LOCAL_PLAYER_ID,
      circuit: this.activeRoom.circuit,
      weather: this.activeRoom.weather,
      startAtMs: Date.now(),
      slots,
    };

    this.activeRoom = {
      ...this.activeRoom,
      status: 'RACING',
    };
    this.roomCallbacks?.onRoomUpdate(this.activeRoom);
    await this.trackRoomPresence();
    await this.syncLobbyHostPresence();

    if (this.roomChannel && this.roomSubscribed) {
      await this.roomChannel.send({
        type: 'broadcast',
        event: isRestart ? 'race:restart' : 'race:start',
        payload,
      });
    }
    return payload;
  }

  public sendPlayerTelemetry(packet: PlayerTelemetryPacket): void {
    if (!this.roomChannel || !this.roomSubscribed) return;
    void this.roomChannel.send({
      type: 'broadcast',
      event: 'telemetry:player',
      payload: packet,
    });
  }

  public sendAiTelemetry(packet: AiTelemetryBatchPacket): void {
    if (!this.roomChannel || !this.roomSubscribed || !this.isHost()) return;
    void this.roomChannel.send({
      type: 'broadcast',
      event: 'telemetry:ai',
      payload: packet,
    });
  }

  public async leaveRoom(): Promise<void> {
    const ch = this.roomChannel;
    this.roomChannel = null;
    this.roomSubscribed = false;
    this.activeRoom = null;
    this.roomCallbacks = null;
    this.lastKnownMemberIds.clear();
    await this.untrackLobbyHost();
    if (ch && supabase) {
      try {
        await ch.untrack();
      } catch {
        // ignore
      }
      await supabase.removeChannel(ch);
    }
  }

  public async dispose(): Promise<void> {
    await this.leaveRoom();
    await this.disconnectLobby();
  }
}
