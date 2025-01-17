import { spawn } from 'child_process';
import express, { Request, Response } from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { backendThumbnailPort, thumbnailOutputDir, thumbnailSpriteSheetOutputDir, thumbnailUploadDir } from '../shared/globalConstants.js';

const corsOptions = {
  origin: ['http://127.0.0.1:8080', 'http://192.168.178.62:8080'], // Erlaubte Quellen
  methods: ['GET', 'POST'],           // Erlaubte HTTP-Methoden
  allowedHeaders: ['Content-Type'],   // Erlaubte Header
};
  
const app = express();
app.use(cors(corsOptions));
app.use('/thumbnails', express.static(path.resolve(thumbnailOutputDir)));
app.use('/spriteSheets', express.static(path.resolve(thumbnailSpriteSheetOutputDir)));
let testCounter = 0;
let globalRemainder = 0;
const activeProcesses = new Set<Promise<void>>();

/**
 * Löscht den Inhalt von Ordnern sonst zu viele Datein.
 * @param folderPath - Der Pfad zum Ordner, dessen Inhalt gelöscht werden soll.
 */
function clearFolder(folderPath: string): void {
  if (fs.existsSync(folderPath)) {
    fs.readdirSync(folderPath).forEach((file) => {
      const filePath = path.join(folderPath, file);
      if (fs.lstatSync(filePath).isFile()) {
        fs.unlinkSync(filePath);
      } else {
        fs.rmSync(filePath, { recursive: true, force: true });
      }
    });
    console.log(`Inhalt von '${folderPath}' erfolgreich gelöscht.`);
  } else {
    console.log(`Ordner '${folderPath}' existiert nicht.`);
  }
}

clearFolder(thumbnailOutputDir);
clearFolder(thumbnailSpriteSheetOutputDir);
clearFolder(thumbnailUploadDir);

if (!fs.existsSync(thumbnailOutputDir)) {
  fs.mkdirSync(thumbnailOutputDir);
}
/**
 * Generiert ein Thumbnail aus einem Video-Chunk.
 * @param {Buffer} chunkData - Videodaten des Chunks.
 * @param {string} outputPath - Pfad zum erzeugten Thumbnail.
 * @returns {Promise<void>} - Promise, das auf die Fertigstellung wartet.
 */
function generateThumbnailFromBuffer(chunkData: Buffer, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tempChunkPath = path.join('uploads', `${Date.now()}_temp_chunk.webm`);
    fs.writeFileSync(tempChunkPath, chunkData);
    const startMatch = outputPath.match(/_(\d+\.\d+)-/);
    const endMatch = outputPath.match(/-(\d+\.\d+)_/);
    if (!startMatch || !endMatch) {
      return reject(new Error('Invalid outputPath format.'));
    }
    let start = parseFloat(startMatch[1]);
    let end = parseFloat(endMatch[1]);
    start = parseFloat(start.toFixed(3));
    end = parseFloat(end.toFixed(3));
    const formattedStart = start.toFixed(3).padStart(6, '0');
    const formattedEnd = end.toFixed(3).padStart(6, '0');
    outputPath = outputPath.replace(/_(\d+\.\d+)-(\d+\.\d+)_/, `_${formattedStart}-${formattedEnd}_`);
    console.log(`Start: ${start}, End: ${end}`);
    console.log(`Output Path: ${outputPath}`);
    let ffmpegCommand:string[] = [];
    //ffmpeg kann keine Thumbnails mit fps1/2 von Videos mit einer Länge von weniger als 2 Sekunden erstellen
    if (end - start >= 2){
      ffmpegCommand = [
        '-i', tempChunkPath,
        '-vf', 'fps=1/2,scale=w=320:h=-1:force_original_aspect_ratio=decrease,pad=320:180:(ow-iw)/2:(oh-ih)/2',
        '-qscale:v', '2',
        outputPath
      ];
      const ffmpegProcess = spawn('ffmpeg', ffmpegCommand);

      ffmpegProcess.on('close', async (code) => {
        if (code === 0) {
          const fileCount = getFileCount(`${thumbnailOutputDir}\\`);
          const remainder = (end - start) % 2;
          globalRemainder += remainder;
          console.log("FileCount: ", fileCount, "Expected: ", Math.floor(end / 2), "Remainder: ", remainder, "GlobalRemainder: ", globalRemainder);
            if(fileCount < Math.floor(end / 2) || (globalRemainder % 2) > 1){//Zu wenige Files oder Zeitabweichung zu groß
              await generateExtraThumbnail(outputPath,start, end, tempChunkPath);
            }
            fs.unlinkSync(tempChunkPath); // Temporäre Datei löschen
          resolve();
        } else {
          fs.unlinkSync(tempChunkPath); // Temporäre Datei löschen
          reject(new Error(`FFmpeg process exited with code ${code}`)); 
        }
      });
    }else{
      console.log("Zu kurzes Video für Thumbnail, wird übersprungen.");
      fs.unlinkSync(tempChunkPath); // Temporäre Datei löschen
      resolve();
    }
  });

  
}

function generateExtraThumbnail(outputPath: string, start: number, end: number, tempChunkPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    testCounter++;
    let numberOfGeneratedThumbnails = Math.floor((end - start) / 2);
    let skipPostionTimeStamp = (end - start - 0.2);
    const hours = Math.floor(skipPostionTimeStamp / 3600).toString().padStart(2, '0');
    const minutes = Math.floor((skipPostionTimeStamp % 3600) / 60).toString().padStart(2, '0');
    const seconds = Math.floor(skipPostionTimeStamp % 60).toString().padStart(2, '0');
    const milliseconds = Math.round((skipPostionTimeStamp % 1) * 100).toString().padStart(2, '0');
    const formattedSkipPosition = `${hours}:${minutes}:${seconds}.${milliseconds}`;
    const newOutputPath = outputPath.replace('%03d', (numberOfGeneratedThumbnails + 1).toString().padStart(3, '0'));
    //Extra Thumbnail notwendig
    //console.log("Extra Thumbnail notwendig, path: ", newOutputPath, "SkipPosition (in the Chunk): ", formattedSkipPosition);
    let extraffmpegCommand:string[] = [];
    extraffmpegCommand = [
      '-y', // Overwrite existing file
      '-ss', formattedSkipPosition, // Seek to the end of the file
      '-i', tempChunkPath,
      '-frames:v', '1', // Output 1 frame
      '-vf', 'scale=w=320:h=-1:force_original_aspect_ratio=decrease,pad=320:180:(ow-iw)/2:(oh-ih)/2',
      '-qscale:v', '2',
      newOutputPath
    ];
    const extraffmpegProcess = spawn('ffmpeg', extraffmpegCommand);
    extraffmpegProcess.on('close', (code) => {
      if (code === 0) {
        console.log("Extra Thumbnail erfolgreich generiert.");
        resolve();
      } else {
        reject(new Error(`FFmpeg process exited with code ${code}`));
      }
    });
  });
}
/**
 * API-Endpunkt zum Empfangen von Chunk-Daten und Generieren eines Thumbnails.
 */
app.post('/generate-thumbnail', express.json({ limit: '1000mb' }), async (req: Request, res: Response) => {
  const { chunkData, chunkName, endOfFile } = req.body;
  if (!chunkData || !chunkName) {
    return res.status(400).json({ error: 'Missing chunkData or chunkName.' });
  }
  try {
    const thumbnailPath = path.join(thumbnailOutputDir, `${chunkName}.jpg`);
    console.log(`Output Path: ${thumbnailPath}, endOfFile: ${endOfFile}`);
    trackProcess(generateThumbnailFromBuffer(Buffer.from(chunkData, 'base64'), thumbnailPath));
    console.log(`Thumbnail ${thumbnailPath} erfolgreich generiert: ${thumbnailPath}, endOfFile: ${endOfFile}`);
    if(endOfFile){
      const endMatch = thumbnailPath.match(/-(\d+\.\d+)_/);
      if (endMatch) {
        const endTime = parseFloat(endMatch[1]);
        const end = parseFloat(endTime.toFixed(3));
        const videoIdMatch = chunkName.match(/video_(\d{13})/);
        if (!videoIdMatch) {
          console.log("Keine VideoID gefunden.");
        }
        const videoId = videoIdMatch[1];
        await Promise.all(activeProcesses);
        console.log("End of Video, es wurden alle Thumbnails generiert.");
        //Starte die Generierung des Sprite-Sheets
        console.log("VideoID: ", `video_${videoId}`);
        //await new Promise(resolve => setTimeout(resolve, 10000));//Testweise 10 Sekunden warten
        await generateSpriteSheetForVideoChunk(`${thumbnailOutputDir}\\`, `video_${videoId}` , 0, end, `${thumbnailSpriteSheetOutputDir}\\sprite_sheet_%03d.jpg`);
        //clearFolder(thumbnailOutputDir);
      } 
    }
    
    res.status(200).json({ message: 'Thumbnail generated successfully.', thumbnailPath });
  } catch (error) {
    console.log(`Output Name ERROR: ${chunkName}`);
    console.error('Error generating thumbnail:', error);
    res.status(500).json({ error: 'Failed to generate thumbnail.' });
  }
});

/**
 * Gibt die Anzahl der Dateien in einem Verzeichnis zurück.
 * @param dirPath - Der Pfad zum Verzeichnis.
 * @returns {number} - Die Anzahl der Dateien im Verzeichnis.
 */
function getFileCount(dirPath: string): number {
  if (fs.existsSync(dirPath)) {
    const files = fs.readdirSync(dirPath);
    return files.length;
  } else {
    console.log(`Verzeichnis '${dirPath}' existiert nicht.`);
    return 0;
  }
} 

/**
 * Holt alle Thumbnails für ein Sprite-Sheet basierend auf dem Zeitbereich.
 * @param dir - Verzeichnis mit den Thumbnails.
 * @param videoId - Eindeutige Video-ID.
 * @param startTime - Startzeitpunkt.
 * @param endTime - Endzeitpunkt.
 * @returns {string[]} - Sortierte Liste von Thumbnail-Pfaden.
 */
function getThumbnailsForSpriteSheet(
  dir: string,
  videoId: string,
  startTime: number,
  endTime: number
): string[] {
  const files = fs.readdirSync(dir);
  console.log("Anzahl Files: ", files.length);
  const result: string[] = [];
  let i = 0;
  let countFiles = 2;
  let counterIngnoredFiles = 0;
  while (i < files.length) {
    const file = files[i];
    const match = file.match(/_(\d+\.\d+)-(\d+\.\d+)_/);
    if (match) {
      const start = parseFloat(match[1]);
      const end = parseFloat(match[2]);
      if (file.startsWith(videoId) && start >= startTime && end <= endTime) {
        //console.log(`File: ${file}`, "Start:", start, "End:", end, "Total:", countFiles, "Round", Math.round(end));
        if(countFiles >= Math.round(end)){//Im schnitt passt das(kann manchmal zu Rundungsfehlern führen, merkt man aber net)
          counterIngnoredFiles++;
          //console.log(`Ignoriere File: ${file}`, "Total:", counterIngnoredFiles);
        }
        else{
          result.push(path.join(dir, file));
          countFiles = countFiles + 2;
        }
      }
    }
    i++;
  }
  result.sort((a, b) => a.localeCompare(b));
  return result;
}

/**
 * Erstellt eine Liste mit Eingabedateien für ffmpeg.
 * @param thumbnails - Liste der Thumbnail-Pfade.
 * @param listFilePath - Pfad zur Liste.
 */
function createInputFile(thumbnails: string[], listFilePath: string): void {
  const content = thumbnails.map((file) => `file '${file}'`).join('\n');
  fs.writeFileSync(listFilePath, content);
}

/**
 * Erstellt ein Sprite-Sheet aus einer Liste von Thumbnails.
 * @param listFilePath - Pfad zur Liste der Thumbnails.
 * @param outputPath - Pfad zur Ausgabe des Sprite-Sheets.
 * @returns {Promise<void>} - Promise, das auf die Fertigstellung wartet.
 */
function createSpriteSheet(listFilePath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ffmpegProcess = spawn('ffmpeg', [
      '-f', 'concat',
      '-safe', '0',
      '-i', listFilePath,
      '-vf', 'tile=6x6',
      outputPath,
    ]);

    ffmpegProcess.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFmpeg process exited with code ${code}`));
      }
    });
  });
}
 
async function generateSpriteSheetForVideoChunk(
  dir: string,
  videoId: string,
  startTime: number,
  endTime: number,
  outputPath: string,
  listFilePath: string = 'sprite_sheet_list.txt'
): Promise<void> {
  try {
    // Thumbnails für den angegebenen Bereich holen
    const thumbnails = getThumbnailsForSpriteSheet(dir, videoId, startTime, endTime);

    createInputFile(thumbnails, listFilePath);
    // Sprite-Sheet erstellen
    await createSpriteSheet(listFilePath, outputPath);
    //clearFolder(thumbnailOutputDir);
    console.log(`Sprite-Sheet erfolgreich erstellt: ${outputPath}, TestCounter: ${testCounter}`);
  } catch (error) {
    //clearFolder(thumbnailOutputDir);
    console.error('Fehler bei der Sprite-Sheet-Generierung:', error);
  }
}

function trackProcess(promise: Promise<void>) {
  activeProcesses.add(promise);
  promise.finally(() => activeProcesses.delete(promise));
}


// Backend starten
const thumbnailPort = backendThumbnailPort;
app.listen(thumbnailPort, () => {
  console.log(`Thumbnail generation server running on port ${thumbnailPort}`);
});
