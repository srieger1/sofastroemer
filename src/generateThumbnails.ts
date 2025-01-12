import axios from 'axios';
import { backendThumbnailPort, thumbnailSpriteSheetOutputDir, MAX_CONCURRENT_TASKS  } from '../shared/globalConstants';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { MetaEntry } from './types';
import { addSpriteSheet, removeSpriteSheet } from './utils'; 


export async function initThumbnailGeneration(ffmpeg: FFmpeg, totalNumberOfChunks: number, uniqueIdentifier: string, MediaMetadata: MetaEntry[]) {
  const tasks = [];
  removeSpriteSheet();
  for (let chunk = 0; chunk < totalNumberOfChunks; chunk++) {
      if(MediaMetadata[chunk].end - MediaMetadata[chunk].start < 2 && chunk !== totalNumberOfChunks - 1){
        console.log(`Skipping chunk ${chunk} because it is too short...`);
        continue;
      }
      tasks.push((async () => {
        const chunkStr = chunk.toString().padStart(3, '0');
        const data = await fetchFile(new Blob([(await ffmpeg.readFile(`${uniqueIdentifier}_${chunkStr}.webm`))]));
        console.log(`Generating thumbnail for chunk ${chunk}...`);
  
        let inputName = `${uniqueIdentifier}_${chunkStr}_${MediaMetadata[chunk].start}-${MediaMetadata[chunk].end}_%03d`;
        if (chunk === 0) {
          inputName = `${uniqueIdentifier}_${chunkStr}_${MediaMetadata[chunk].start}.0-${MediaMetadata[chunk].end}_%03d`;
        }
        await generateThumbnailFromChunk(data, inputName, MediaMetadata[totalNumberOfChunks-1].end);
      })());
      if (tasks.length >= MAX_CONCURRENT_TASKS) {
        await Promise.all(tasks.splice(0, MAX_CONCURRENT_TASKS));
      }
    }
    await Promise.all(tasks);

    console.log('All thumbnails generated.');
    for (let i = 1; i <= Math.ceil((MediaMetadata[(totalNumberOfChunks-1)].end / 36) / 2); i++) {
      const spriteSheetNumber = i.toString().padStart(3, '0');
      const spriteSheet = await toBlobURL(`http://localhost:${backendThumbnailPort}/${thumbnailSpriteSheetOutputDir}/sprite_sheet_${spriteSheetNumber}.jpg`, 'image/jpeg');
      addSpriteSheet(spriteSheet);
      console.log("SpriteSheet: ", spriteSheet);
    }
    
}

export async function generateThumbnailFromChunk(chunkData: Uint8Array, chunkName: string, endOfFileNumber: number): Promise<string | undefined> {
    const chunkBase64 = arrayBufferToBase64(chunkData);
    let endOfFile = false;
    if(chunkName.includes(endOfFileNumber.toString())){
      endOfFile = true;
    }

    console.log('Generating thumbnail for chunk:', chunkName, endOfFile);

    try {
        await axios.post(`http://localhost:${backendThumbnailPort}/generate-thumbnail`, {
        chunkData: chunkBase64,
        chunkName,
        endOfFile: endOfFile
      });
      return chunkName;

    } catch (error) {
      console.error('Error generating thumbnail:', error);
    }
}

function arrayBufferToBase64(buffer: Uint8Array): string {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
  
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
  
    return btoa(binary);
}
