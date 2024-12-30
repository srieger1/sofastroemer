import { State } from "./types";
import { liveStream$, player } from "./stateVariables";
import { getConnections, getState, setState } from "./peer";
import { onChunkReceived, onPlayerDurationReceived, onHeaderReceived, onEndOfStreamRecived, onSeekedReceived} from "./receiver";
import { addMediaSourceStateAllPeers, removeMediaSourceStateAllPeers, 
  resetMediaSourceCompletely, addliveStream, 
updatePlayerRole, addSeekedStateEntryReadyToSeekAtTime} from "./utils";

export function broadcast_state() {
  if(!liveStream$.value){//Nur wenn kein Livestream
    const next = new State();
    next.play = !player.paused;
    next.pos = player.currentTime;
  
    if (State.eq(getState(), next)) {
      return;
    }
    
    setState(next);
  
    const msg = {
      type: "state",
      state: getState(),
    };
  
    for (const conn of getConnections().values()) {
      conn.send(msg);
    }
  }
}

export function broadcastChunk(chunk: Uint8Array) {
  //local append
  console.log("Appending chunk locally for the initiator.");
  onChunkReceived(chunk);

  //Broadcast chunk to all connected peers
  for (const conn of getConnections().values()) {
    console.log(`Sending chunk to peer: ${conn.peer}`);
    conn.send({
      type: "chunk",
      data: chunk,
    });
  }
}

export function broadcastPlayerDuration(duration: number) {
  //local append
  console.log("Set duration locally for the initiator.");
  onPlayerDurationReceived(duration);
  
  for (const conn of getConnections().values()) {
    console.log(`Sending chunk to peer: ${conn.peer}`);
    conn.send({
      type: "playerDuration",
      duration: duration,
    });
  }
}

export function broadcastHeader(start : number, end: number, chunkSize: number) {
  //local append
  console.log("Appending header locally for the initiator.");
  onHeaderReceived(start, end, chunkSize);
  
  for (const conn of getConnections().values()) {
    console.log(`Sending chunk to peer: ${conn.peer}`);
    conn.send({
      type: "header",
      start: start,
      end: end,
      chunkSize: chunkSize
    });
  }
}

export function broadcastEndOfStream(flag: boolean) {
  //local append
  console.log("Ending Stream locally for the initiator.");
  onEndOfStreamRecived(flag);
  
  for (const conn of getConnections().values()) {
    console.log(`Sending chunk to peer: ${conn.peer}`);
    conn.send({
      type: "endOfStream",
      flag: flag
    });
  }
}

export function broadcastMediaSourceReady(flag: boolean) {
    for (const conn of getConnections().values()) {
      conn.send({
        type: "mediaSourceReady",
        flag: flag,
      });
    }
  }
  
export function broadcastReadyToSeek(timestamp: number, flag: boolean) {
  //local append
  addSeekedStateEntryReadyToSeekAtTime(timestamp, flag);
    for (const conn of getConnections().values()) {
        conn.send({
        type: "readyToSeek",
        timestamp: timestamp,
        flag: flag,
        });
    }
}

export async function broadcastResettingMediaSource(flag: boolean) {
    //local reset
    console.log("Resetting MediaSourceAllPeers");
    removeMediaSourceStateAllPeers();
  
    for (const conn of getConnections().values()) {
      conn.send({
        type: "resettingMediaSource",
        flag: flag,
      });
    }
    
    //MediaSource resetten für den Initiator
    console.log("Resetting Mediasource for the initiator.");
    await resetMediaSourceCompletely();
    addMediaSourceStateAllPeers(true);
}

export async function broadcastSeeked(currentTime: number) {
  if(!liveStream$.value){ //Nur wenn kein Livestream
    for (const conn of getConnections().values()) {
      conn.send({
        type: "seeked",
        time: currentTime,
      });
    }
    console.log("Set seeked Position for Initator");
    await onSeekedReceived(currentTime);
  }
}

export function broadcastStreaming(flag: boolean) {
  addliveStream(flag);//Nur für den Initiator
  for (const conn of getConnections().values()) {
      conn.send({
      type: "stream",
      flag: flag,
      });
  }
}

export function broadcastPlayerRoles(flag: boolean) {
  //Setting Role for Initiator(negirtes Flag(Sender) das gegenteil von allen Receivern)
  updatePlayerRole(!flag);
  for (const conn of getConnections().values()) {
      conn.send({
      type: "assignPlayerRole",
      flag: flag,
      });
  }
}

export function broadcastPlayPauseStreaming(flag: boolean) {
  player.play();
  for (const conn of getConnections().values()) {
      conn.send({
      type: "playPauseStreaming",
      flag: flag,
      });
  }
}