import { spawn } from 'child_process';
import express, { Request, Response } from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { backendThumbnailPort, thumbnailOutputDir, thumbnailSpriteSheetOutputDir } from '../shared/globalConstants.js';

const corsOptions = {
  origin: ['http://127.0.0.1:8080', 'http://192.168.178.62:8080'], // Erlaubte Quellen
  methods: ['GET', 'POST'],           // Erlaubte HTTP-Methoden
  allowedHeaders: ['Content-Type'],   // Erlaubte Header
};
  
const app = express();
app.use(cors(corsOptions));
app.use('/thumbnails', express.static(path.resolve(thumbnailOutputDir)));
app.use('/spriteSheets', express.static(path.resolve(thumbnailSpriteSheetOutputDir)));

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
        '-qscale:v', '1',
        outputPath
      ];
      const ffmpegProcess = spawn('ffmpeg', ffmpegCommand);

      ffmpegProcess.on('close', (code) => {
        fs.unlinkSync(tempChunkPath); // Temporäre Datei löschen
        if (code === 0) {
          resolve();
        } else {
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
    console.log(`Output Path: ${thumbnailPath}`);
    await generateThumbnailFromBuffer(Buffer.from(chunkData, 'base64'), thumbnailPath);
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
        console.log("End of Video, es wurden alle Thumbnails generiert.");
        //Starte die Generierung des Sprite-Sheets
        console.log("VideoID: ", `video_${videoId}`);
        await generateSpriteSheetForVideoChunk(`${thumbnailOutputDir}\\`, `video_${videoId}` , 0, end, `${thumbnailSpriteSheetOutputDir}\\sprite_sheet_%03d.jpg`);
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
        console.log(`File: ${file}`, "Start:", start, "End:", end, "Total:", countFiles, "Round", Math.round(end));
        if(countFiles >= Math.round(end)){//Im schnitt passt das(kann manchmal zu Rundungsfehlern führen, merkt man aber net)
          counterIngnoredFiles++;
          console.log(`Ignoriere File: ${file}`, "Total:", counterIngnoredFiles);
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
    console.log(`Sprite-Sheet erfolgreich erstellt: ${outputPath}`);
  } catch (error) {
    console.error('Fehler bei der Sprite-Sheet-Generierung:', error);
  }
}

// Backend starten
const thumbnailPort = backendThumbnailPort;
app.listen(thumbnailPort, () => {
  console.log(`Thumbnail generation server running on port ${thumbnailPort}`);
});
