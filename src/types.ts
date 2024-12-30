export class State {
  play: boolean = false;
  pos: number = 0;

  public static eq(a: State, b: State): boolean {
    return a.play === b.play && a.pos === b.pos;
  }
}

export interface MetaEntry {
  start: number;
  end: number;
  byteLength: number;
}

export interface ReadyToSeekAtTime {
  time: number;
  readyStateAllPeers: boolean[];
}

export interface CurrentBufferSizes {
  chunkSizes: number[];
  totalBufferSize: number;
}

export type PeersMessage = {
  type: "peers";
  peers: Array<string>;
};

export type StreamMessage = {
  type: "stream";
  stream: boolean;
};

export type StateMessage = {
  type: "state";
  state: State;
};

export type ChunkMessage = {
  type: "chunk";
  data: Uint8Array;
};

export type PlayerDuration = {
  type: "playerDuration";
  duration: number;
};

export type HeaderMessage = {
  type: "header";
  start: number;
  end: number;
  chunkSize: number;
};

export type ResettingMediaSource = {
  type: "resettingMediaSource";
  flag: boolean;
};

export type MediaSourceReady = {
  type: "mediaSourceReady";
  flag: boolean;
}

export type EndOfStream = {
  type: "endOfStream";
  flag: boolean;
}

export type Seeked = {
  type: "seeked";
  time: number;
}

export type ReadyToSeek = {
  type: "readyToSeek";
  timestamp: number;
  flag: boolean;
}

export type PlayPauseStreamig = {
  type: "playPauseStreaming";
  flag: boolean;
}

export type AssignPlayerRole = {
  type: "assignPlayerRole";
  flag: boolean;
}

export type Message = PeersMessage | StateMessage | ChunkMessage | HeaderMessage | ResettingMediaSource | MediaSourceReady | EndOfStream | PlayerDuration | Seeked | ReadyToSeek | StreamMessage | PlayPauseStreamig | AssignPlayerRole;
