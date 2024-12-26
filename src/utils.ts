import { MetaEntry, CurrentBufferSizes } from "./types";
import { mimeCodec, MAX_BUFFER_SIZE } from "../shared/globalConstants";
import { getMediaSource, setMediaSource, getSourceBuffer, 
    setSourceBuffer, setBufferQueue
} from "./receiver";
import { bufferedBytesSender$, mediaSourceStateAllPeers$, 
  seekedStateAllPeers$, MetaEntryReceiver$, currentBufferSize$, liveStream$, player } from "./stateVariables";
import { Observable, of } from "rxjs";
import { filter, first} from "rxjs/operators";
import { toggelLiveIndicator } from "./style";

let resolveCondition: (() => void) | null = null;
let resolveConditionSender: (() => void) | null = null;


export function waitForConditionSender(condition: () => boolean): Promise<number> {
  const startTime = performance.now();
  return new Promise((resolve) => {
    const checkCondition = () => {
      if (condition()) {
        console.log("Triggering condition check True1");
        const endTime = performance.now();
        resolve(endTime - startTime); // Bedingung erfüllt, auflösen
      } else {
        resolveConditionSender = () => {
          if (condition()) {
            console.log("Triggering condition check True2");
            const endTime = performance.now();
            resolve(endTime - startTime); // Beim nächsten Trigger prüfen
            resolveConditionSender = null; // Zurücksetzen
          }
        };
      }
    };
    checkCondition();
  });

}

export function waitForCondition(condition: () => boolean): Promise<number> {
    const startTime = performance.now();
    return new Promise((resolve) => {
      const checkCondition = () => {
        if (condition()) {
          console.log("Triggering condition check True1");
          const endTime = performance.now();
          resolve(endTime - startTime); // Bedingung erfüllt, auflösen
        } else {
          resolveCondition = () => {
            if (condition()) {
              console.log("Triggering condition check True2");
              const endTime = performance.now();
              resolve(endTime - startTime); // Beim nächsten Trigger prüfen
              resolveCondition = null; // Zurücksetzen
            }
          };
        }
      };
      checkCondition();
    });
  
  }
/**
 * Wartet auf ein Event und überprüft optional eine Bedingung.
 * @param target Das Ziel, von dem das Event ausgelöst wird.
 * @param eventName Der Name des Events.
 * @param condition Optional: Eine Bedingung, die zusammen mit dem Event überprüft wird.
 * @returns Promise, die aufgelöst wird, wenn das Event ausgelöst und die Bedingung erfüllt ist.
 */
export function waitForEventOrCondition(
    target: EventTarget, 
    eventName: string, 
    condition: () => boolean
  ): Promise<number> {
    const startTime = performance.now();
    return new Promise((resolve) => {
      const eventHandler = () => {
        if (condition()) {
          target.removeEventListener(eventName, eventHandler);
          const endTime = performance.now();
          resolve(endTime - startTime);
        }
      };
  
      if (condition()) {
        const endTime = performance.now();
        resolve(endTime - startTime);
      } else {
        target.addEventListener(eventName, eventHandler);
      }
    });
}

export function forceResolveConditionSender() {
  if (resolveConditionSender) {
      console.log("Force resolving condition.");
      resolveConditionSender();
      resolveConditionSender = null; // Auflösen, danach zurücksetzen
  } else {
      console.log("No condition to resolve.");
  }
}

export function triggerConditionCheck() {
    if (resolveCondition) {
      resolveCondition();
    }
    if (resolveConditionSender) {
      resolveConditionSender();
    }
}

export async function resetMediaSourceCompletely(): Promise<void> {
  //Setzte Variablen fürs Streaming auf Empfängeseite zurück
  removeMetaEntryReceiver();
  removeSeekedStateAllPeers();
  let mediaSource = getMediaSource();
  updateBufferSize(0, false, false, true);
  if (mediaSource.readyState === "open") {
    try {
      mediaSource.endOfStream();
      console.log("MediaSource stream ended.");
    } catch (err) {
      console.warn("Error ending MediaSource stream:", err);
    }
  }

  // Remove the existing sourceBuffer if it exists
  let sourceBuffer = getSourceBuffer();
  if (sourceBuffer) {
    try {
      mediaSource.removeSourceBuffer(sourceBuffer);
      console.log("SourceBuffer removed.");
    } catch (err) {
      console.warn("Error removing SourceBuffer:", err);
    }
  }

  // Create a new MediaSource
  mediaSource = new MediaSource();
  setBufferQueue([]); // Clear buffer queue

  player.src = URL.createObjectURL(mediaSource);
  return new Promise<void>((resolve, reject) => {
    mediaSource.addEventListener(
      "sourceopen",
      () => {
        if (!MediaSource.isTypeSupported(mimeCodec)) {
          console.error("Unsupported MIME type or codec:", mimeCodec);
          reject(new Error("Unsupported MIME type or codec"));
          setMediaSource(mediaSource);
          return;
        }

        try {
          sourceBuffer = mediaSource.addSourceBuffer(mimeCodec);
          //evtl Probleme mit dem SourceBuffer
          //TEST LIVE STREAM!!!!!!!!!!! 
          if(liveStream$.value){
            mediaSource.duration = Infinity;
          }
          setMediaSource(mediaSource);
          setSourceBuffer(sourceBuffer);
          console.log("MediaSource and SourceBuffer are ready.");
          resolve();
        } catch (err) {
          console.error("Error creating SourceBuffer:", err);
          reject(err);
        }
      },
      { once: true } 
    );

    mediaSource.addEventListener(
      "sourceclose",
      () => {
        console.log("MediaSource was closed unexpectedly.");
        reject(new Error("MediaSource closed unexpectedly"));
      },
      { once: true }
    );
  });
}

export function updateBufferSize(change: number, addToLocalChunk: boolean, addNewChunk: boolean, removeAllChunks: boolean): void {
  let currentBufferSize = currentBufferSize$.value;
  if (addToLocalChunk) {//Small Chunks
    currentBufferSize.chunkSizes[currentBufferSize.chunkSizes.length - 1] += change;
    currentBufferSize.totalBufferSize += change;
    addCurrentBufferSize(currentBufferSize);
  }
  else if(!addToLocalChunk && !addNewChunk && !removeAllChunks){ 
    currentBufferSize.totalBufferSize -= change;
    currentBufferSize.chunkSizes.shift();
  }
  else if(addNewChunk){
    currentBufferSize.chunkSizes.push(change);
    currentBufferSize.totalBufferSize += change;
  }
  else if(removeAllChunks){
    console.log("Remove all chunks from buffer and Resetting Variables");
    currentBufferSize.chunkSizes = [];
    currentBufferSize.totalBufferSize = 0;
    removeMetaEntryReceiver();
  }
  addCurrentBufferSize(currentBufferSize);
  console.log(`Buffer size updated: ${currentBufferSize.totalBufferSize} bytes`, currentBufferSize.chunkSizes); 
}

export function canAddToBuffer(chunkSize: number): boolean {
    return currentBufferSize$.value.totalBufferSize + chunkSize <= MAX_BUFFER_SIZE;
}

export async function removeAllChunksFromSourceBuffer(): Promise<void> {
  //let MetaEntryReceiver = getMetaEntryReceiver();
  let sourceBuffer = getSourceBuffer();
  console.log("MetaEntryReceiver: ", MetaEntryReceiver$.value);
  for (let i = 0; i < MetaEntryReceiver$.value.length; i++) {
    if (sourceBuffer.updating) {
      console.log("SourceBuffer is updating.");
      let timeForUpdate = await waitForEventOrCondition(sourceBuffer, "updateend", () => !sourceBuffer.updating);
      console.log("SourceBuffer update completed in ", timeForUpdate, "ms");
    }
    try {
      sourceBuffer.remove(MetaEntryReceiver$.value[i].start, MetaEntryReceiver$.value[i].end);
      console.log("Removing ", i, "chunk from SourceBuffer");
      await waitForEventOrCondition(sourceBuffer, "updateend", () => !sourceBuffer.updating);
      setSourceBuffer(sourceBuffer); //evtl Probleme mit dem SourceBuffer
    } catch (error) {
      console.error("Error removing buffer:", error);
      setTimeout(() => removeAllChunksFromSourceBuffer(), 100);
    }
  }
  updateBufferSize(0, false, false, true);
}

export function decrementbufferedBytesSender(reset: boolean = false, chunkSize: number) {
  if(reset){
    removeBufferedBytesSender();
  }
  else{
    addBufferedBytesSender(-chunkSize);
  }
}

/**
 * Wartet darauf, dass eine Bedingung erfüllt wird und löst die Promise auf.
 * @param conditionFn Eine Funktion, die die Bedingung überprüft und `true` zurückgibt, wenn sie erfüllt ist.
 * @param observable Optional: Ein RxJS Observable, das überprüft werden soll.
 * @returns Promise, die aufgelöst wird, wenn die Bedingung erfüllt ist.
 */
export function waitForConditionRxJS<T>(
  conditionFn: (value: T) => boolean,
  observable?: Observable<T>
): Promise<void> {
  return new Promise((resolve) => {
    const source = observable || of(true as unknown as T); // Verwende Observable oder Default-Wert

    source
      .pipe(
        filter((value) => conditionFn(value)), // Bedingung mit dem emittierten Wert überprüfen
        first() // Nur die erste Erfüllung der Bedingung verwenden
      )
      .subscribe({
        next: () => resolve(), // Promise auflösen, wenn Bedingung erfüllt ist
        error: (err) => console.error("Error in waitForConditionRxJS:", err),
      });
  });
}

export function addBufferedBytesSender(change: number){
    bufferedBytesSender$.next(bufferedBytesSender$.value + change);
}
export function removeBufferedBytesSender(){
  bufferedBytesSender$.next(0);
}
export function addMediaSourceStateAllPeers(flag: boolean) {
    mediaSourceStateAllPeers$.next([...mediaSourceStateAllPeers$.value, flag]);
}
export function removeMediaSourceStateAllPeers() {
    mediaSourceStateAllPeers$.next([]);
}
export function addSeekedStateAllPeers(flag: boolean) {
    seekedStateAllPeers$.next([...seekedStateAllPeers$.value, flag]);
}
export function removeSeekedStateAllPeers() {
    seekedStateAllPeers$.next([]);
}
export function addMetaEntryReceiver(metaEntry: MetaEntry) {
    MetaEntryReceiver$.next([...MetaEntryReceiver$.value, metaEntry]);
}
export function removeMetaEntryReceiver() {
    MetaEntryReceiver$.next([]);
}
export function shiftMetaEntryReceiver() {
    let metaEntryReceiver = MetaEntryReceiver$.value;
    metaEntryReceiver.shift();
    MetaEntryReceiver$.next(metaEntryReceiver);
}
export function addCurrentBufferSize(currentBufferSize: CurrentBufferSizes) {
    currentBufferSize$.next(currentBufferSize);
}
export function removeCurrentBufferSize() {
    currentBufferSize$.next({chunkSizes: [], totalBufferSize: 0});
}
export function addliveStream(flag: boolean){
    toggelLiveIndicator();//style anpassungen vom liveIndicator
    liveStream$.next(flag);
}