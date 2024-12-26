import WebSocket, { WebSocketServer } from 'ws';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import {ffmpegConfigLiveStreaming, backendPort, directCBRMode, FRAME_RATE_LIVE_STREAMING
} from '../shared/globalConstants.js';

let ffmpeg: ChildProcessWithoutNullStreams | null = null;
let activeConnections = 0; // Anzahl aktiver Verbindungen

/**
 * Starts a WebSocket server to handle FFmpeg-based live streaming.
 * @param {number} port - Port for the WebSocket server.
 */
export function startLiveStreamingBackend(port: number): void {
  const wss = new WebSocketServer({ port });

  wss.on('connection', (ws: WebSocket) => {
    console.log('Client connected to live streaming backend.');
    activeConnections++;
    ws.on('message', (data: Buffer) => {
      if (!ffmpeg) {
        console.error('FFmpeg process is not initialized. Ignoring data.');
        return;
      }
      if (!directCBRMode) {
        // Write incoming VBR data to FFmpeg for conversion
        ffmpeg.stdin.write(data);
      }
    });

    ws.on('close', () => {
      console.log('Client disconnected from live streaming backend.');
      activeConnections--;

      // Wenn keine Verbindungen mehr bestehen, FFmpeg-Prozess beenden
      if (activeConnections === 0) {
        console.log('No active connections. Stopping FFmpeg process...');
        stopFFmpegProcess();
      }
    });

    // Setup FFmpeg process
    if (!ffmpeg) {
      if (directCBRMode) {
        initFFmpegScreenRecording((chunk) => {
          ws.send(chunk);
        });
      } else {
        initFFmpegLiveStreaming((chunk) => {
          ws.send(chunk);
        });
      }
    }
  });

  console.log(`WebSocket server running for live streaming at ws://localhost:${port}`);
}

/**
 * Initializes the FFmpeg process.
 * @param {function} onData - Callback to handle processed CBR data.
 */
function initFFmpegLiveStreaming(onData: (chunk: Buffer) => void): void {
  console.log('Initializing FFmpeg for live streaming with: ', ffmpegConfigLiveStreaming);
  ffmpeg = spawn('ffmpeg', [
    '-i', 'pipe:0',                  // Input from STDIN
    '-c:v', ffmpegConfigLiveStreaming.videoCodec,            // Hardware-accelerated H.264 encoding
    '-preset', ffmpegConfigLiveStreaming.videoPreset,               // Encoding speed
    '-crf', ffmpegConfigLiveStreaming.videoCRF,                  // Constant Rate Factor
    '-b:v', ffmpegConfigLiveStreaming.videoBitrate,                    // Constant Bitrate
    '-maxrate', ffmpegConfigLiveStreaming.maxBitrate,                // Max bitrate
    '-minrate', ffmpegConfigLiveStreaming.minBitrate,                // Min bitrate
    '-bufsize', ffmpegConfigLiveStreaming.bufferSize,                // Buffer size
    '-g', ffmpegConfigLiveStreaming.keyframeInterval,                      // Keyframe interval (1 keyframe per 60 frames)
    '-c:a', ffmpegConfigLiveStreaming.audioCodec,                   // AAC-Audio hinzufügen
    '-b:a', ffmpegConfigLiveStreaming.audioBitrate,                  // Audiobitrate
    ffmpegConfigLiveStreaming.audioPreset,                  // Audio encoding speed
    '-frag_duration', ffmpegConfigLiveStreaming.fragmentDuration,      // Kürzere Länge zwischen Audio und Video
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof', // Fragmented MP4 for streaming
    '-f', ffmpegConfigLiveStreaming.format,                     // MP4 container format
    'pipe:1',                                              // Output to STDOUT
  ]);

  ffmpeg.stdout.on('data', (chunk: Buffer) => {
    onData(chunk); // Pass the processed data back to the callback
  });

  ffmpeg.stderr.on('data', (err) => {
    console.error(err.toString());
  });

  ffmpeg.on('close', (code: number) => {
    console.log(`FFmpeg process exited with code ${code}`);
    ffmpeg = null;
  });
}

function stopFFmpegProcess(): void {
  if (ffmpeg) {
    ffmpeg.stdin.end();
    ffmpeg.kill('SIGINT');
    ffmpeg = null;
    console.log('FFmpeg process stopped.');
  }
}

function initFFmpegScreenRecording(onData: (chunk: Buffer) => void): void {
  console.log('Initializing FFmpeg for direct screen recording.');
  ffmpeg = spawn('ffmpeg', [
    '-f', 'gdigrab', // Screen capture input (Windows)
    '-s', '2560x1440', // Screen resolution
    '-framerate', `${FRAME_RATE_LIVE_STREAMING}`, // Framerate
    '-i', 'desktop', // Capture the entire desktop
    '-f', 'dshow', // Audio input
    '-i', 'audio=Stereomix (Realtek USB Audio)', // Audio device name
    '-c:v', ffmpegConfigLiveStreaming.videoCodec, // Hardware-accelerated H.264 encoding
    '-preset', ffmpegConfigLiveStreaming.videoPreset, // Encoding speed
    '-crf', ffmpegConfigLiveStreaming.videoCRF, // Constant Rate Factor
    '-b:v', ffmpegConfigLiveStreaming.videoBitrate, // Constant Bitrate
    '-minrate', ffmpegConfigLiveStreaming.minBitrate, // Min bitrate
    '-maxrate', ffmpegConfigLiveStreaming.maxBitrate, // Max bitrate
    '-bufsize', ffmpegConfigLiveStreaming.bufferSize, // Buffer size
    '-g', ffmpegConfigLiveStreaming.keyframeInterval, // Keyframe interval
    '-c:a', ffmpegConfigLiveStreaming.audioCodec, // AAC Audio codec
    '-b:a', ffmpegConfigLiveStreaming.audioBitrate, // Audio bitrate
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof', // Fragmented MP4 for streaming
    '-frag_duration', ffmpegConfigLiveStreaming.fragmentDuration, // Shorter duration between audio and video
    '-f', ffmpegConfigLiveStreaming.format, // MP4 container format
    'pipe:1', // Output to STDOUT
  ]);

  ffmpeg.stdout.on('data', (chunk: Buffer) => {
      onData(chunk);
  });

  ffmpeg.stderr.on('data', (err) => {
    console.error(err.toString());
  });

  ffmpeg.on('close', (code: number) => {
    console.log(`FFmpeg process exited with code ${code}`);
    ffmpeg = null;
  });
}

/**
 * Toggles between VBR-to-CBR conversion and direct CBR screen recording.
 * @param {boolean} enableDirectCBR - Enable or disable direct CBR recording.
 */
export function toggleDirectCBRMode(enableDirectCBR: boolean): void {
  console.log(`Switching to ${enableDirectCBR ? 'direct CBR mode' : 'VBR-to-CBR mode'}`);
  //directCBRMode = enableDirectCBR;

  if (ffmpeg) {
    stopFFmpegProcess(); // Restart FFmpeg with the new mode
  }
}

/**
 * Backend starten.
 */
console.log(`Starting live streaming backend on port ${backendPort}...`);
const port = backendPort;
startLiveStreamingBackend(port);

