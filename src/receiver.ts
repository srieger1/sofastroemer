import { mimeCodec, MAX_NUMBER_OF_DELAYED_CHUNKS } from "../shared/globalConstants";
import { waitForEventOrCondition, updateBufferSize, removeAllChunksFromSourceBuffer,
    decrementbufferedBytesSender, addSeekedStateAllPeers,
    waitForConditionRxJS, addMetaEntryReceiver, shiftMetaEntryReceiver} from "./utils";
import { getMediaMetadata, setLokalIndexForChunksSender } from "./sender";
import { broadcast_state, broadcastSeeked, broadcastReadyToSeek} from "./broadcastFunctions";
import { getConnections } from "./peer";
import { seekedStateAllPeers$, MetaEntryReceiver$, currentBufferSize$, playerRole$, player, liveStream$ } from "./stateVariables";
import { setPlayerDurationDisplay } from "./style";
import { ReadyToSeekAtTime } from "./types";


let mediaSource = new MediaSource();
let sourceBuffer: SourceBuffer;
let bufferQueue: Uint8Array[] = []; // Warteschlange für Chunks
let expectedChunkNumber = 0; // Erwartete Nummer des nächsten Chunks
let bufferQueueForLateChunks: Map<number, Uint8Array> = new Map(); // Warteschlange für späte Chunks
let lastSeekedSender: number[] = []; //Um doppelte/n-fache Seeked Events zu verhindern
let lastChunkReceivedTime:number = 0.0;

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

    //Kann doch ziemlich schnell recht groß werden
    seekedStateAllPeers$.subscribe((seekedStateAllPeers) => {
      if (seekedStateAllPeers.length > 20) {
        seekedStateAllPeers.splice(0, 10);
        console.log("Removed first 10 entries from seekedStateAllPeers.");
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
  
export async function onChunkReceived(chunk: Uint8Array) {
  const currentTime = performance.now();
  if (lastChunkReceivedTime !== 0.0) {
    const timeElapsed = currentTime - lastChunkReceivedTime;
    console.log(`Time elapsed since last chunk received: ${timeElapsed} ms`);
  }
  lastChunkReceivedTime = currentTime;
  //Manchmal Undifined geht aber normalerweise Trotzdem
  const { number: uniqueChunkIdentifier, chunk: originalChunk } = extract32BitNumberAndChunk(chunk);
  if(expectedChunkNumber !== uniqueChunkIdentifier && uniqueChunkIdentifier !== 0){ //Manchmal undifined dann kommt 0 zurück, (undifined !== verdrehter Chunk)
    if(bufferQueueForLateChunks.size > MAX_NUMBER_OF_DELAYED_CHUNKS){
      console.error("Too many delayed chunks. Cannot process further chunks. Please restart the stream.");
      throw new Error("Too many delayed chunks. Cannot process further chunks.");
    }
    console.warn("Chunk number mismatch. Expected:", expectedChunkNumber, "Received:", uniqueChunkIdentifier, "Buffering chunk.");
    bufferQueueForLateChunks.set(uniqueChunkIdentifier, originalChunk);
    return;
  }
  //Der Verspätete Chunk ist angekommen und wird verarbeitet
  if(bufferQueueForLateChunks.size > 0){
    console.log("Processing late chunks, current late chunks size:", bufferQueueForLateChunks.size);
    if(!bufferQueue){
      console.warn("BufferQueue not initialized");
      return;
    }
    bufferQueueForLateChunks.set(uniqueChunkIdentifier, originalChunk);
    const sortedChunks = Array.from(bufferQueueForLateChunks.entries()).sort((a, b) => a[0] - b[0]);
    for (const [chunkNumber, chunkData] of sortedChunks) {
      if(chunkNumber !== expectedChunkNumber){//Falls mehere Hintereinander Fehlen
        console.warn("Chunk number mismatch. Expected:", expectedChunkNumber, "Received:", chunkNumber);
        break;
      }
      bufferQueue.push(chunkData);
      bufferQueueForLateChunks.delete(chunkNumber);
      expectedChunkNumber++;
      processBufferQueue();
    }
    return;
  }

  expectedChunkNumber++;
    if(!bufferQueue){
      console.warn("BufferQueue not initialized");
      return;
    }
    bufferQueue.push(originalChunk); // Chunk zur Warteschlange hinzufügen
    console.log("received chunk", originalChunk.length);
    processBufferQueue();
}

function extract32BitNumberAndChunk(buffer: Uint8Array): { number: number, chunk: Uint8Array } {
  if (buffer.length < 4) {
      throw new Error("Buffer is too small to contain a 32-bit number.");
  }
  const number = (buffer[0] | (buffer[1] << 8) | (buffer[2] << 16) | (buffer[3] << 24)) >>> 0;
  const chunk = buffer.slice(4);
  console.log("Extracted 32-bit number:", number, "from buffer of length:", buffer.length); 
  return { number, chunk };
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
  /*            console.log("Broadcasting ready to seek");
            broadcastReadyToSeek(true);*/
export async function onSeekedReceived(currentTime: number): Promise<void> {
  if (!player.src.startsWith("blob:")){return;} //Im Default Modus nicht Notwendig
    const readyToSeekEntry:ReadyToSeekAtTime = {time: currentTime, readyStateAllPeers: []}; 
    addSeekedStateAllPeers(readyToSeekEntry);
    console.log("Seeked received and added seeked State all Peers:", currentTime);

    if (lastSeekedSender.includes(currentTime)) {//Doppelte/n-fache Seeked Events verhindern
      console.log("Seeked position already processed.");
      return;
    }
    lastSeekedSender.push(currentTime);//Zeitpunkt des Seeked Events speichern
    console.log("Processing Seeking:", lastSeekedSender);
    if (MetaEntryReceiver$.value.length > 1) {
      if (currentTime >= MetaEntryReceiver$.value[0].start && currentTime <= MetaEntryReceiver$.value[MetaEntryReceiver$.value.length - 1].end) {
        console.log("Seeked position is within the buffered range.");
        lastSeekedSender = [];
        return;
      }
      lastSeekedSender = [];
    }
    console.log("Seeked position is outside the buffered range. Clear Buffer");
  
    await removeAllChunksFromSourceBuffer();
    // Zurückgesetzt werden MetaEntryReceiver,
    // currentBufferSize(chunkSizes, totalBufferSize)
    console.log("Buffer cleared. Seeking to new position.");
    if(playerRole$.value){//Receiver
      broadcastReadyToSeek(currentTime, true);//Reviver ist bereit zum Seeken
    }
    else{//Sender
      // zu verändernde Variablen bufferedBytesSender, lokalIndexForChunksSender
      let MediaMetadata = getMediaMetadata();
      if (MediaMetadata.length < 1) {
        console.warn("No MetaEntries available. Cannot seek.");
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
        console.warn("No suitable segment found for the seeked position.");
        lastSeekedSender = [];
        return;
      }
      setLokalIndexForChunksSender(targetIndex);
      //An diesem Punkt muss es sich um den Sender handeln
      //RESET bufferedBytesSender: Triggered, dass von neuem gesendet wird
      //Erst wenn alle anderen Peers in einem Konsistenten Zustand sind
      //Initator ist zu diesem Punkt schon in einem Konsistenten Zustand d.h. nur connections.size
      broadcastReadyToSeek(currentTime, true);
      let connections = getConnections();
      if (connections.size > 0) {  
        const start = performance.now();
        console.log("Waiting for all peers to be ready to seek.");
        await waitForConditionRxJS((value: ReadyToSeekAtTime[]) => {
          const entry = value.find(entry => entry.time === currentTime);
          return entry ? entry.readyStateAllPeers.length === (connections.size + 1) : false;
        }, seekedStateAllPeers$);
        const end = performance.now();
        console.log("All peers are ready to seek.", seekedStateAllPeers$, "current Time: ", currentTime, " === ", (connections.size + 1), " Time:", end - start);
      }
      lastSeekedSender = []; //Seeked Position zurücksetzen
      decrementbufferedBytesSender(true, 0);
    }
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
