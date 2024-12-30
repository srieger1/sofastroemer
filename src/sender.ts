import { processVideoChunks, loadVideoChunks } from "./setupFileStreaming";
import { initFFmpegLiveStreaming, liveStreamingVBRtoCBR, onCBRDataAvailable } from "./setupLiveStreaming";
import { defaultVideoURL, chunkSize, MAX_BUFFER_SIZE, LIVE_STREAMING_SPEED,
  MAX_BUFFER_STREAM_TIME, FRAME_RATE_LIVE_STREAMING,
  recorderOptions, backendURL, directCBRMode, LIVE_STREAMING_DUMMY_FRAME_INTERVAL,
  thumbnail
 } from "../shared/globalConstants";
import {MetaEntry, CurrentBufferSizes} from "./types"
import { broadcastResettingMediaSource, broadcastPlayerDuration, broadcastHeader, 
  broadcastChunk, broadcastEndOfStream, broadcastStreaming, broadcastPlayPauseStreaming,
  broadcastPlayerRoles
  } from "./broadcastFunctions";
import { getBufferQueue} from "./receiver";
import { canAddToBuffer, removeBufferedBytesSender, addBufferedBytesSender,
  waitForConditionRxJS
 } from "./utils";
import { getConnections } from "./peer";
import { bufferedBytesSender$, currentBufferSize$, mediaSourceStateAllPeers$, liveStream$, player } from "./stateVariables";
import { fetchFile } from "@ffmpeg/util";
import { initThumbnailGeneration } from "./generateThumbnails";

let MediaMetadata: MetaEntry[] = [];
let lokalIndexForChunksSender = 0;
let uniqueChunkIdentifier = 0;
const dummyCanvas = document.createElement('canvas');
const dummyContext = dummyCanvas.getContext('2d');

export function initSender(){
    document.querySelector("#play")?.addEventListener("click", async (event) => {
        event.preventDefault();
        broadcastPlayerRoles(true);//Setzt denjenigen der Play gedrückt hat als Sender, alle anderen Empfänger
        const fileInput = document.querySelector("#file") as HTMLInputElement;
        const file = fileInput?.files?.item(0);
        
        if (!file) {
          console.warn("No file selected. Using default video source.");
          player.src = defaultVideoURL; // Fallback URL
          player.play();
          return;
        }
        let blobSource = URL.createObjectURL(new Blob([file], { type: 'video/webm' }))
        console.log("Streaming file:", file.name, "Blob URL:", blobSource);
        let result = await processVideoChunks(blobSource)
        let totalNumberOfChunks = result.chunkCount;
        MediaMetadata = result.metaEntries;
        let uniqueIdentifier = result.uniqueIdentifier;
        let ffmpeg = result.ffmpeg;
        if(thumbnail){initThumbnailGeneration(ffmpeg, totalNumberOfChunks,uniqueIdentifier, MediaMetadata);}
        broadcastResettingMediaSource(true);
        // Warte das alle Teilnehmer die Mediasource zurückgesetzt haben
        console.log("Waiting for all peers to reset MediaSource...");
        const start = performance.now();
        await waitForConditionRxJS((value: boolean[]) => value.length === getConnections().size + 1, mediaSourceStateAllPeers$);//Der Initator wird nicht als Peer gezählt deshalb +1
        const end = performance.now();
        console.log("All peers are ready to reset MediaSource.", mediaSourceStateAllPeers$.value, " === ",getConnections().size + 1, " Time:", end-start);
        console.log("Broadcasting player duration:", MediaMetadata[MediaMetadata.length-1].end);
        broadcastPlayerDuration(MediaMetadata[MediaMetadata.length-1].end);
        //Frage länge von sourcebuffer.buffered ab, solange weniger als 5 Chunks im Buffer sind lade weitere Chunks
       lokalIndexForChunksSender = 0;  //Nur für den Sender Relevant
       removeBufferedBytesSender(); //Nur für den Sender Relevant
       while(lokalIndexForChunksSender < totalNumberOfChunks || (bufferedBytesSender$.value + MediaMetadata[lokalIndexForChunksSender].byteLength) <= MAX_BUFFER_SIZE){ {
          console.log("Buffered chunks:", bufferedBytesSender$.value, "MetaMediaData ByteLength:", MediaMetadata[lokalIndexForChunksSender].byteLength);
          if((bufferedBytesSender$.value + MediaMetadata[lokalIndexForChunksSender].byteLength) > MAX_BUFFER_SIZE){ 
            const start = performance.now();
            await waitForConditionRxJS((value: number) => value + MediaMetadata[lokalIndexForChunksSender].byteLength <= MAX_BUFFER_SIZE, bufferedBytesSender$);
            const end = performance.now();
            console.log("Time to load new chunks:", end - start);
            continue;
          }
          const chunkData = await loadVideoChunks(ffmpeg, uniqueIdentifier, lokalIndexForChunksSender);
          broadcastHeader(MediaMetadata[lokalIndexForChunksSender].start, MediaMetadata[lokalIndexForChunksSender].end, MediaMetadata[lokalIndexForChunksSender].byteLength);
          startSendingChunks(chunkData);
          addBufferedBytesSender(MediaMetadata[lokalIndexForChunksSender].byteLength);
          lokalIndexForChunksSender++;
          const start = performance.now();
          await waitForConditionRxJS((value: CurrentBufferSizes) => value.chunkSizes[value.chunkSizes.length -1] === chunkData.byteLength, currentBufferSize$);
          const end = performance.now();
          console.log("Video chunk length:", chunkData.byteLength, " Buffered chunk sizes:", currentBufferSize$.value.chunkSizes[currentBufferSize$.value.chunkSizes.length - 1], "Time:", end - start);
          if(lokalIndexForChunksSender >= totalNumberOfChunks){
            broadcastEndOfStream(true);
            break;
          }
        }
      }
    });

    document.querySelector("#live")?.addEventListener("click", async (event) => {
      event.preventDefault();
      await initFFmpegLiveStreaming(backendURL);
      broadcastStreaming(true);
      broadcastResettingMediaSource(true);
      // Warte das alle Teilnehmer die Mediasource zurückgesetzt haben
      console.log("Waiting for all peers to reset MediaSource...");
      const start = performance.now();
      await waitForConditionRxJS((value: boolean[]) => value.length === getConnections().size + 1, mediaSourceStateAllPeers$);//Der Initator wird nicht als Peer gezählt deshalb +1
      const end = performance.now();
      console.log("All peers are ready to reset MediaSource.", mediaSourceStateAllPeers$.value, " === ",getConnections().size + 1, " Time:", end-start);
      broadcastPlayerDuration(10000);
      let lokalByteCountForStream = 0;
      let lokalEndTimeCountForStream = MAX_BUFFER_STREAM_TIME;
      //Erster Header für den Livestream
      broadcastHeader(0, lokalEndTimeCountForStream, lokalByteCountForStream);
      //CBR vs VBR derzeit CBR für Livestreaming
      if(!directCBRMode){
        const desktopStream = await startDesktopStream();
        const recorder = new MediaRecorder(desktopStream, recorderOptions);
        let lastTriggerTime: number | undefined = undefined;
        recorder.ondataavailable = async (event) => { 
        if (event.data && event.data.size > 0) {
            const data = await fetchFile(event.data);
              if (typeof lastTriggerTime !== 'undefined') {
              const timeDifference = (new Date().getTime() - lastTriggerTime) / 1000;
              console.log("Time since last trigger: ", timeDifference, " seconds");
              }
              lastTriggerTime = new Date().getTime();
            liveStreamingVBRtoCBR(data);
          }
        };
        recorder.start(LIVE_STREAMING_SPEED);
      }

      //Header alle 10 Sekunden, Zeitraum wird über CBR geschätzt nicht genau!!!
      let roundHeaderCounter = true;
      let startHeader = 0;
      onCBRDataAvailable((chunk) => {
        if(roundHeaderCounter){
          startHeader = performance.now();
          roundHeaderCounter = false;
        }
        const data = new Uint8Array(chunk);
        lokalByteCountForStream += data.byteLength;
        if(startHeader + (1000 * MAX_BUFFER_STREAM_TIME) <= performance.now()){
          const startTime = lokalEndTimeCountForStream;
          const endTime = startTime + MAX_BUFFER_STREAM_TIME;
          console.log("Live Stream Header", startTime, endTime, lokalByteCountForStream);
          //broadcastPlayerDuration(endTime);
          broadcastHeader(startTime, endTime, lokalByteCountForStream);
          roundHeaderCounter = true;
          lokalEndTimeCountForStream = endTime;
          lokalByteCountForStream = 0;
        }
        //Weiterverarbeitung der Daten
        startSendingChunks(data);
      });
      //await new Promise(resolve => setTimeout(resolve, (5000)));
      broadcastPlayPauseStreaming(true);
    });

}

async function startDesktopStream() {
  try {
      const desktopStream = await navigator.mediaDevices.getDisplayMedia({
          video: {frameRate: FRAME_RATE_LIVE_STREAMING},
          audio: true,
      });
      const settings = desktopStream.getVideoTracks()[0]?.getSettings();
      const audiosetting = desktopStream.getAudioTracks()[0]?.getSettings();
      console.log("Desktop Stream Settings:", settings, audiosetting);
      if(settings.height && settings.width){
        initDummyPixelCanvas(settings.height, settings.width);
      }
      else{
        console.error("No settings for Dummy video track available.");
      }
      console.log("Supportet Constraints:", navigator.mediaDevices.getSupportedConstraints());
      
      const dummyStream = dummyCanvas.captureStream(FRAME_RATE_LIVE_STREAMING);
      const [dummyVideoTrack] = dummyStream.getVideoTracks();
      console.log("Dummy Video Track:");
      desktopStream.addTrack(dummyVideoTrack);

      return desktopStream;
  } catch (err) {
      console.error("Error accessing display media:", err);
      throw err;
  }
}
//Geschuldet durch den MediaRecorder der Prbleme mit standbilder hat
//Immernoch nicht gut gelöst
async function initDummyPixelCanvas(height: number, width: number) {
  dummyCanvas.width = width; 
  dummyCanvas.height = height;
  if (!dummyContext) {
    console.error('Could not create 2D canvas context.');
  }
  setInterval(() => {
    drawBlinkingPixel();
  }, LIVE_STREAMING_DUMMY_FRAME_INTERVAL );

}

function drawBlinkingPixel() {
  if(!dummyContext){
    console.error('Could not create 2D canvas context.');
    return;
  }
  dummyContext.clearRect(0, 0, dummyCanvas.width, dummyCanvas.height);
  // Zufällige Position für den Pixel
  const x = Math.random() * dummyCanvas.width;
  const y = Math.random() * dummyCanvas.height;
  // Blinkender Pixel
  dummyContext.fillStyle = "rgba(255, 0, 0, 1)"; // Roter Pixel
  dummyContext.fillRect(x, y, 10, 10); // 10x10 Pixel Rechteck
}


async function startSendingChunks(data: Uint8Array) {
    while(data.byteLength > 0){
      //console.log("Data Chunk File:", data);
      const chunk = data.slice(0, chunkSize);
      data = data.slice(chunkSize);
      //console.log("Data Chunk File removed:", data, "Chunk:", chunk); 
      if(!liveStream$.value){//Nicht für Livestream benötigt
        if (!canAddToBuffer(chunk.byteLength)) {
          console.warn(
            `Cannot add chunk of size ${chunk.byteLength}. Buffer limit of ${MAX_BUFFER_SIZE} bytes reached.`
          );
        }
        if (getBufferQueue().length > 100) { //Sollte nicht vorkommen deshalb auch nicht Overengineered
          console.log("Buffer queue full. Waiting before loading more chunks...");
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }
      //Einzigartige ID für jeden Chunk, damit er wieder in der Richigen Reihenfolge zusammengesetzt werden kann
      const chunkWithId = add32BitNumberToChunk(chunk, uniqueChunkIdentifier);
      broadcastChunk(chunkWithId);
      uniqueChunkIdentifier++;
    };
  }

  function add32BitNumberToChunk(chunk: Uint8Array, number: number): Uint8Array {
    if (number < 0 || number > 0xFFFFFFFF) {
        console.error("Number out of range for 32-bit number. Over 5000 Terabyte not supported. Please Restart the Application.");
    }
    const buffer = new Uint8Array(4 + chunk.length);
    const view = new DataView(buffer.buffer);
    view.setUint32(0, number, true); // Little-endian
    buffer.set(chunk, 4);

    return buffer;
}

export function getMediaMetadata(): MetaEntry[] {
    return MediaMetadata;
}
export function setMediaMetadata(newMediaMetadata: MetaEntry[]) {
    MediaMetadata = newMediaMetadata;
}
export function setLokalIndexForChunksSender(newLokalIndexForChunksSender: number) {
    lokalIndexForChunksSender = newLokalIndexForChunksSender;
}
export function getLokalIndexForChunksSender(): number {
    return lokalIndexForChunksSender;
}
