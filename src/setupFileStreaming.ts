import { FFmpeg } from '@ffmpeg/ffmpeg';
import {fetchFile, toBlobURL} from '@ffmpeg/util';
import { mimeCodec, SEGMENT_DURATION_GOP_KEYFRAME, VIDEO_FPS } from '../shared/globalConstants';
import { MetaEntry } from './types';

let loaded = false;
//Wenn man das effizenter Macht sollte man SEHR große Videos laden können
export async function processVideoChunks(src: string) {
  const ffmpeg = new FFmpeg();
  let chunkCount = 0;
  let meta = "";
  let metaExaktDuration = "";
  let toggel = false;
  if(!loaded){ //Nur einmal laden
  const load = async () => {
    const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd'
    ffmpeg.on('log', ({ message }) => {
        console.log(message);
        const preciseDurationMatch = message.match(/DURATION\s*:\s(\d{2}:\d{2}:\d{2}\.\d{9})/);
        //const preciseDurationMatch = message.match(/Duration\s*:\s(\d{2}:\d{2}:\d{2}\.\d{2})/);
        if(preciseDurationMatch){
          if(toggel){
            metaExaktDuration += preciseDurationMatch + "\n";
          }
          toggel = !toggel;
        }
        if (message.includes('Opening')) {
          chunkCount++;
        }
        if (message.includes('Duration: ') && message.includes('start:')) {
          const durationInfo = message.trim();
          meta += durationInfo + "\n";
        }
    });
    await ffmpeg.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
    });
    loaded = true;
  }
  await load();
}
  console.log("Input Blob URL:", src);
  await ffmpeg.writeFile('input.webm', await fetchFile(src));
  const uniqueIdentifier = `video_${Date.now()}`;
await ffmpeg.exec([
    '-i',
    'input.webm',             // Eingabedatei
//    '-pix_fmt', 'yuv420p',     // Pixel-Format 
    '-f',
    'segment',                  // Segmentierungsmodus
    '-segment_time',
    `${SEGMENT_DURATION_GOP_KEYFRAME}`,  // Segmentdauer in Sekunden
    '-g',
    `${VIDEO_FPS * SEGMENT_DURATION_GOP_KEYFRAME}`, // GOP-Größe passend zur Segmentzeit FPS * Segmentzeit
    '-sc_threshold',
    '0',                        // Deaktiviert Szenenwechselerkennung für segmentiertes Encoding
    '-force_key_frames',
    `expr:gte(t,n_forced*${SEGMENT_DURATION_GOP_KEYFRAME})`,  // Erzwingt Keyframes alle n Sekunden
    '-reset_timestamps',
    '0',                        // Zurücksetzen der Timestamps pro Segment
    '-map',
    '0',                        // Verwendet die gesamte Eingabe
    '-c:v', 'copy',           // evtl Neukodierung mit VP8
    '-c:a', 'copy',        // evtl Audio mit Vorbis kodieren
    `${uniqueIdentifier}_%03d.webm`          // Ausgabeformat mit 3-stelligem Zähler
]);

const chunkSizes = [];
for (let i = 0; i < chunkCount; i++) {
  const segmentName = `${uniqueIdentifier}_${String(i).padStart(3, '0')}.webm`;
  console.log(`Extrahiere Metadaten aus ${segmentName}`);
  
  const chunkFile = await fetchFile(new Blob([(await ffmpeg.readFile(segmentName))]));
  const chunkSize = chunkFile.byteLength;
  chunkSizes.push(chunkSize);

  await ffmpeg.exec([
    '-i', segmentName,
    '-f', 'ffmetadata',
    `metadata.txt`
  ]);
}
  if(mimeCodec.includes("av01") || mimeCodec.includes("vp9")){//Fix für AV1 VP9 Codec
    chunkCount--;
  }
  console.log("META", meta);
  console.log("Test Meta", metaExaktDuration);
  const metaEntries = combineMetaAndParse(meta,metaExaktDuration, chunkSizes);
  console.log("Meta entries:", metaEntries);
  const timeDifferences = metaEntries.slice(1).map((entry, index) => {
    const previousEntry = metaEntries[index];
    const difference = entry.start - previousEntry.end;
    return { index: index + 1, difference };
  });

  timeDifferences.sort((a, b) => b.difference - a.difference);
  console.log("Time differences (sorted):", timeDifferences);
  
  console.log("Chunks created:", chunkCount);
  return {ffmpeg, chunkCount, metaEntries, uniqueIdentifier};
}

export function combineMetaAndParse(meta: string, metaDuration: string, chunkSizes: number[]): MetaEntry[] {
  let ignoreEntries = 1; // Ignoriere den ersten Eintrag standard für alle codecs
  //let ignoreEntries = 0;

  const metaLines = meta.trim().split("\n").slice(ignoreEntries); 
  const metaDurationLines = metaDuration
    .trim()
    .split("\n")
    .map((line) => line.match(/DURATION\s*:\s*(\d{2}:\d{2}:\d{2}\.\d{9})/)?.[1])
    //.map((line) => line.match(/Duration:\s*(\d{2}:\d{2}:\d{2}\.\d{2})/)?.[1])
    .filter((duration) => duration !== undefined) as string[];
  console.log("Meta Duration Lines", metaDurationLines);
  const result: MetaEntry[] = [];

  metaLines.forEach((line, index) => {
    const startMatch = line.match(/start:\s(\d+\.\d+)/);
    const exactDuration = metaDurationLines[index]; // Exakte Duration

    if (startMatch && exactDuration) {
      let start = parseFloat(startMatch[1]);

      // Exakte Duration in Sekunden berechnen
      const durationParts = exactDuration.match(/(\d{2}):(\d{2}):(\d{2}\.\d{9})/);
      //const durationParts = exactDuration.match(/(\d{2}):(\d{2}):(\d{2}\.\d{2})/);
      if (durationParts) {
        const [, hours, minutes, seconds] = durationParts;
        let durationInSeconds =
          parseFloat(hours) * 3600 + parseFloat(minutes) * 60 + parseFloat(seconds);

        if(mimeCodec.includes("av01")  || mimeCodec.includes("vp9")){//Fix für AV1 Codec
          if(index === 1){
            durationInSeconds = 0;
          }
          let zws = start;
          start = durationInSeconds;
          durationInSeconds = zws;
        }
        result.push({
          start: start,
          end: durationInSeconds,
          byteLength: chunkSizes[index],
        });
      }
    }
  });

  return result;
}

export async function loadVideoChunks(ffmpeg: FFmpeg, uniqueIdentifier: string, chunk: number, header: boolean = false): Promise<Uint8Array> {
  if(!header){
  const chunkStr = chunk.toString().padStart(3, '0');
  const data = await fetchFile(new Blob([(await ffmpeg.readFile(`${uniqueIdentifier}_${chunkStr}.webm`))]));
  return data;
  }else{
    const data = await fetchFile(new Blob([(await ffmpeg.readFile(`init_header_${uniqueIdentifier}.webm`))]));
    return data;
  }
}