import { mimeCodec } from "../shared/globalConstants";
import { waitForEventOrCondition, updateBufferSize, removeAllChunksFromSourceBuffer,
    decrementbufferedBytesSender,
    removeSeekedStateAllPeers,
    waitForConditionRxJS, addMetaEntryReceiver, shiftMetaEntryReceiver} from "./utils";
import { getMediaMetadata, setLokalIndexForChunksSender } from "./sender";
import { broadcast_state, broadcastSeeked} from "./broadcastFunctions";
import { getConnections } from "./peer";
import { seekedStateAllPeers$, MetaEntryReceiver$, currentBufferSize$, player, liveStream$ } from "./stateVariables";
import { setPlayerDurationDisplay } from "./style";


let mediaSource = new MediaSource();
let sourceBuffer: SourceBuffer;
let bufferQueue: Uint8Array[] = []; // Warteschlange für Chunks
let lastSeekedSender: number[] = []; //Um doppelte/n-fache Seeked Events zu verhindern

export function initReceiver(){
    player.addEventListener("play", () => {
        console.log("Player is playing.");
        broadcast_state();
    });
      
    player.addEventListener("pause", () => {
        console.log("Player is paused.");
        broadcast_state();
    });
      
    player.addEventListener("seeking", () => {
      if(!liveStream$.value){
        if(MetaEntryReceiver$.value.length > 1){//Kein Seeken notwendig
          if(MetaEntryReceiver$.value[0].start >= player.currentTime && MetaEntryReceiver$.value[MetaEntryReceiver$.value.length-1].end <= player.currentTime){
            return;
          }
          else if(lastSeekedSender.includes(player.currentTime)){
            console.log("Seeked position already processed.");
            return;
          }
        }
        console.log("Player try to seeked to:", player.currentTime);
        removeSeekedStateAllPeers();
        broadcast_state();
        broadcastSeeked(player.currentTime);
      }
    });
    
    player.addEventListener("timeupdate", async () => {
        if(MetaEntryReceiver$.value.length > 1){//Inital mindestens 2 Segmente
          if(player.currentTime > MetaEntryReceiver$.value[1].end){ //Ende des 2. Segments sodaaß das 1. Segment entfernt werden kann
            console.log(`Current time updated: ${player.currentTime}`, MetaEntryReceiver$.value[0].end);
            await removeChunkFromSourceBuffer();
            decrementbufferedBytesSender(false, MetaEntryReceiver$.value[0].byteLength); //Recht für den Sender aus braucht der Empfänger nicht
            console.log("Buffered chunks:", currentBufferSize$.value.totalBufferSize);
            shiftMetaEntryReceiver();
          }
        }
    });
}
mediaSource.addEventListener("sourceopen", () => {
  if (!MediaSource.isTypeSupported(mimeCodec)) {
    console.error("Unsupported MIME type or codec:", mimeCodec);
    return;
  }
  sourceBuffer = mediaSource.addSourceBuffer(mimeCodec);

sourceBuffer.addEventListener("updateend", () => {
  console.log("Buffer updated, processing next chunk.");

  processBufferQueue(); // Verarbeite weitere Chunks
});
});

async function processBufferQueue() {
  console.log("Processing buffer queue...");
  if (!sourceBuffer) {
    console.warn("SourceBuffer is not initialized.");
    return;
  }
  if (!mediaSource) {
    console.warn("MediaSource is not initialized.");
    return;
  }
  
  if (mediaSource.readyState !== "open") {
    console.warn("MediaSource is not open. Cannot process buffer queue.", mediaSource);
    if(mediaSource.readyState === "ended"){
      console.log("MediaSource is ended.");
      return;
    }
    return;
  }

  if (sourceBuffer.updating) {
    console.log("SourceBuffer is updating.");
    let timeForUpdate = await waitForEventOrCondition(sourceBuffer, "updateend", () => !sourceBuffer.updating);
    console.log("SourceBuffer update completed in ", timeForUpdate, "ms");
  }

  if (bufferQueue.length === 0) {
    console.log("Buffer queue is empty.");
    return;
  }

  const chunk = bufferQueue.shift()!;
  try {
    console.log("Chunks in SourceBuffer:", currentBufferSize$.value.totalBufferSize);
    sourceBuffer.appendBuffer(chunk);
    updateBufferSize(chunk.byteLength, true, false, false);
    console.log("Chunk appended successfully:", chunk.byteLength, "bytes in buffer:", currentBufferSize$.value.totalBufferSize);

  } catch (error) {
    console.error("Error appending buffer:", error);
    bufferQueue.unshift(chunk); // Füge den Chunk zurück in die Warteschlange
    return;
  }
}

export async function onPlayerDurationReceived(duration: number) {
  setPlayerDurationDisplay(duration);//Style anpassen für Duration Display
    if (!sourceBuffer || mediaSource.readyState !== "open") {
      console.warn("SourceBuffer or MediaSource not ready. Can not set player duration.");
      await waitForEventOrCondition(sourceBuffer, "updateend", () => !sourceBuffer.updating);
    }
    mediaSource.duration = duration;
  }
  
export function onHeaderReceived(start: number, end: number, chunkSize: number) {
    addMetaEntryReceiver({start: start, end: end, byteLength: chunkSize});
    console.log("Header received:", MetaEntryReceiver$.value);
    updateBufferSize(0, false, true, false);
}
  
export function onChunkReceived(chunk: Uint8Array) {
    if(!bufferQueue){
      console.warn("BufferQueue not initialized");
      return;
    }
    bufferQueue.push(chunk); // Chunk zur Warteschlange hinzufügen
    console.log("received chunk", chunk.length);
    processBufferQueue();
  }

export async function onEndOfStreamRecived(flag: boolean) {
    if (flag) {
      if (mediaSource.readyState !== "open") {
        console.warn("MediaSource is not open. Cannot end stream.");
        return;
      }
      if (sourceBuffer.updating) {
        console.log("SourceBuffer is updating.");
        let timeForUpdate = await waitForEventOrCondition(sourceBuffer, "updateend", () => !sourceBuffer.updating);
        console.log("SourceBuffer update completed in ", timeForUpdate, "ms");
      }
      console.log("Ending MediaSource stream.");
      mediaSource.endOfStream();
    }
  }
  
  //Wenn seeked außerhalb des Buffers ist wird der Buffer geleert(Komplett)
  //Suche VideoSegment welches am nächsten an der seeked Position ist und lade dieses
  //Setzte Variablen fürs Streaming auf neue Werte
  //!!!!!!!ENDING MEDIA SOURCE PORBLEM!!!!!!!!!!!!
export async function onSeekedReceived(currentTime: number): Promise<void> {
    console.log("Seeked received:", currentTime);
    if (lastSeekedSender.includes(currentTime)) {//Doppelte/n-fache Seeked Events verhindern
      console.log("Seeked position already processed.");
      return;
    }
    lastSeekedSender.push(currentTime);//Zeitpunkt des Seeked Events speichern
    console.log("Processing Seeking:", lastSeekedSender);
    if (MetaEntryReceiver$.value.length < 1) {
      console.log("No MetaEntries available. Cannot seek.");
      lastSeekedSender = [];
      return;
    }
    if (currentTime >= MetaEntryReceiver$.value[0].start && currentTime <= MetaEntryReceiver$.value[MetaEntryReceiver$.value.length - 1].end) {
      console.log("Seeked position is within the buffered range.");
      lastSeekedSender = [];
      return;
    }
    console.log("Seeked position is outside the buffered range. Clear Buffer");
    await removeAllChunksFromSourceBuffer();
    // Zurückgesetzt werden MetaEntryReceiver,
    // currentBufferSize(chunkSizes, totalBufferSize)
    console.log("Buffer cleared. Seeking to new position.");
    // zu verändernde Variablen bufferedBytesSender, lokalIndexForChunksSender
    let MediaMetadata = getMediaMetadata();
    if (MediaMetadata.length < 1) {
      console.log("No MetaEntries available. Cannot seek. If Reviver Peer ignore this message.");
      lastSeekedSender = [];
      return;
    }
  
    let targetIndex = -1;
    for (let i = 0; i < MediaMetadata.length; i++) {
      if (currentTime >= MediaMetadata[i].start && currentTime <= MediaMetadata[i].end) {
        console.log("Seeked position:", currentTime, "Segment start:", MediaMetadata[i].start, "Segment end:", MediaMetadata[i].end);
        targetIndex = i;
        break;
      }
    }
  
    if (targetIndex === -1) {
      console.log("No suitable segment found for the seeked position.");
      lastSeekedSender = [];
      return;
    }
    setLokalIndexForChunksSender(targetIndex);
    //An diesem Punkt muss es sich um den Sender handeln
    //RESET bufferedBytesSender: Triggered, dass von neuem gesendet wird
    //Erst wenn alle anderen Peers in einem Konsistenten Zustand sind
    //Initator ist zu diesem Punkt schon in einem Konsistenten Zustand d.h. nur connections.size
    let connections = getConnections();
    if (connections.size > 0) {  
      const start = performance.now();
      await waitForConditionRxJS((value: boolean[]) => value.length === connections.size, seekedStateAllPeers$);
      const end = performance.now();
      console.log("All peers are ready to seek.", seekedStateAllPeers$.value.length, " === ", connections.size, " Time:", end - start);
    }
    removeSeekedStateAllPeers();//Alle Peers sind bereit zum Seeken zurücksetzen
    lastSeekedSender = []; //Seeked Position zurücksetzen
    decrementbufferedBytesSender(true, 0);
  }

function removeChunkFromSourceBuffer() {
    return new Promise<void>(async (resolve, reject) => {
      if (sourceBuffer.updating) {
        console.log("SourceBuffer is updating.");
        let timeForUpdate = await waitForEventOrCondition(sourceBuffer, "updateend", () => !sourceBuffer.updating);
        console.log("SourceBuffer update completed in ", timeForUpdate, "ms");
      }
      try {
        console.log("Removing first chunk from SourceBuffer", MetaEntryReceiver$.value[0].start, MetaEntryReceiver$.value[0].end);
        sourceBuffer.remove(MetaEntryReceiver$.value[0].start, MetaEntryReceiver$.value[0].end);
        updateBufferSize(MetaEntryReceiver$.value[0].byteLength, false, false, false); //Entferne den ersten Chunk aus dem Buffer
        sourceBuffer.addEventListener("updateend", () => {
          console.log("Chunk removed successfully.");
          resolve();
        }, { once: true });
      } catch (error) {
        console.error("Error removing buffer:", error);
        setTimeout(() => removeChunkFromSourceBuffer().then(resolve).catch(reject), 100);
      }
    });
  }


export function getBufferQueue(): Uint8Array[] {
    return bufferQueue;
}
export function setBufferQueue(newBufferQueue: Uint8Array[]): void {
    bufferQueue = newBufferQueue;
}
export function addBufferQueue(newChunk: Uint8Array): void {
    bufferQueue.push(newChunk);
}
export function getSourceBuffer(): SourceBuffer {
    return sourceBuffer;
}
export function setSourceBuffer(newSourceBuffer: SourceBuffer): void {
    sourceBuffer = newSourceBuffer;
}
export function getMediaSource(): MediaSource {
    return mediaSource;
}
export function setMediaSource(newMediaSource: MediaSource): void {
    mediaSource = newMediaSource;
}
