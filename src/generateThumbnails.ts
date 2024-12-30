import axios from 'axios';
import { backendThumbnailPort, thumbnailSpriteSheetOutputDir  } from '../shared/globalConstants';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { MetaEntry } from './types';
import { addSpriteSheet } from './utils'; 


export async function initThumbnailGeneration(ffmpeg: FFmpeg, totalNumberOfChunks: number, uniqueIdentifier: string, MediaMetadata: MetaEntry[]) {
  let endOfFile = false;
  for (let chunk = 0; chunk < totalNumberOfChunks; chunk++) {
      if(MediaMetadata[chunk].end - MediaMetadata[chunk].start < 2 && chunk !== totalNumberOfChunks - 1){
        console.log(`Skipping chunk ${chunk} because it is too short...`);
        continue;
      }
      const chunkStr = chunk.toString().padStart(3, '0');
      const data = await fetchFile(new Blob([(await ffmpeg.readFile(`${uniqueIdentifier}_${chunkStr}.webm`))]));
      console.log(`Generating thumbnail for chunk ${chunk}...`);
      let inputName = `${uniqueIdentifier}_${chunkStr}_${MediaMetadata[chunk].start}-${MediaMetadata[chunk].end}_%03d`;
      if(chunk === 0){// Erster Chunk Startzeit auf 0.0 nicht 0
        inputName = `${uniqueIdentifier}_${chunkStr}_${MediaMetadata[chunk].start}.0-${MediaMetadata[chunk].end}_%03d`;
       }
      if(chunk === totalNumberOfChunks - 1){// Letzter Chunk Endzeit auf Duration
        endOfFile = true;
      }
      const outputName = await generateThumbnailFromChunk(data, inputName, endOfFile);
      if(outputName){
        console.log(`Thumbnail generated: ${outputName}`);
        if(endOfFile){
          console.log('All thumbnails generated.');
          for (let i = 1; i <= Math.ceil((MediaMetadata[chunk].end / 36) / 2); i++) {
            const spriteSheetNumber = i.toString().padStart(3, '0');
            const spriteSheet = await toBlobURL(`http://localhost:${backendThumbnailPort}/${thumbnailSpriteSheetOutputDir}/sprite_sheet_${spriteSheetNumber}.jpg`, 'image/jpeg');
            addSpriteSheet(spriteSheet);
            const test = fetchFile(spriteSheet);
            console.log("SpriteSheet: ", test);
          }
        }
      }
    }
}

export async function generateThumbnailFromChunk(chunkData: Uint8Array, chunkName: string, endOfFile: boolean = false): Promise<string | undefined> {
    const chunkBase64 = arrayBufferToBase64(chunkData);
  
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
