//import videojs from 'video.js';

/**
 * mimeCodec: Genereller Codec für Sofastroemer Projekt(HTLM5 Video Element und MSE)
 */
//export const mimeCodec = 'video/webm; codecs="av01.0.08M.08", opus'; // AV1 Codec opus(am besten)
//export const mimeCodec = 'video/webm; codecs="vp8, vorbis"'; // VP8 Codec
export const mimeCodec = 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"'; // H.264 Codec Software
//export const mimeCodec = 'video/webm; codecs="vp9, opus"'; // VP9 Codec()

/**
 * mimeCodecMediaRecorder: Codec für MediaRecorder (entweder vp8 oder vp9)
 */
export const mimeCodecMediaRecorder = 'video/webm; codecs="vp8, opus"'; // VP8 Codec
//export const mimeCodecMediaRecorder = 'video/webm; codecs="vp9, opus"'; // VP8 Codec

/**
 * mimeCodecLiveStreaming: 
 * Codec für Live Streaming zwangsweise codec mit Hardwarebeschleunigung erforderlich
 */
export const mimeCodecLiveStreaming = 'video/mp4; codecs="h264_nvenc, aac"'; // h264_nvenc Codec
//export const mimeCodecLiveStreaming = 'video/webm; codecs="other?, opus"'; // Other Hardware Codec

/*codecs dynamisch dann braucht man das nicht mehr
if (mimeCodec.split(';')[0] !== mimeCodecLiveStreaming.split(';')[0]) {
    throw new Error(`MIME codec mismatch: mimeCodec (${mimeCodec}) and mimeCodecLiveStreaming (${mimeCodecLiveStreaming}) must have the same format.`);
}*/

export const MAX_BUFFER_SIZE = 25 * 1024 * 1024; // 25 MB
export const chunkSize = 256 * 1024; // 256 KB
export const LIVE_STREAMING_SPEED = 1000; // 1 Sekunde
export const LIVE_STREAMING_DUMMY_FRAME_INTERVAL = LIVE_STREAMING_SPEED / 10; // 0.1 Sekunden
export const CBR_AUDIO = '128k'; // 128 kbit/s
export const AUDIOCODECPRESET = '-shortest';
export const INITAL_PACKET_IGNORE_SIZE = 20; // Die ersten 20 Pakete ignorieren um Probleme mit VBR zu vermeiden

//Weniger Rechenintensiv für LiveStreaming VBR zu CBR
/*
export const FRAME_RATE_LIVE_STREAMING = 30; // 30 FPS
export const CBR_BITRATE = '1000k'; // 1 Mbit/s
export const CBR_BUFFER  = '2000k'; // 2 Mbit
export const KEYFRAME_INTERVAL = 2; // Alle 2 Sekunden ein Keyframe
export const VIDEOCODECPRESET = 'fast';
*/

//Mehr Rechenintensiv für LiveStreaming VBR zu CBR
export const directCBRMode = false;
export const FRAME_RATE_LIVE_STREAMING = 60; // 60 FPS
export const CBR_BITRATE = '5000k'; // 5 Mbit/s
export const CBR_BUFFER = '2000k'; // 10 Mbit Buffer
export const KEYFRAME_INTERVAL = FRAME_RATE_LIVE_STREAMING; // Keyframe alle 1 Sekunden
export const VIDEOCODECPRESET = 'slow'; // Maximale Qualität
export const VIDEOCRF = '0';       // Konstante Qualität
export const FRAGMENT_DURATION = '1000';

/*
//Direkte CBR Aufnahme im Backend
export const directCBRMode = true; // Direkter CBR Modus
export const FRAME_RATE_LIVE_STREAMING = 60; // 60 FPS
export const CBR_BITRATE = '5000k'; // 5 Mbit/s
export const CBR_BUFFER = '2000k'; // 2 Mbit Buffer
export const KEYFRAME_INTERVAL = (FRAME_RATE_LIVE_STREAMING / 2); // Keyframe alle 0,5 Sekunden
export const VIDEOCODECPRESET = 'slow'; // Maximale Qualität
export const VIDEOCRF = '0';       // Konstante Qualität
export const FRAGMENT_DURATION = '1000'; // 0.1 Sekunde
*/
/**
 * Gibt die Zeit eines Segmentes auf der Empfängerseite an(nur für Live Streaming) IN SEKUNDEN
 * Bei 10 sekündigen Segmenten wird bei Ende des zweiten Segmentes das erste Segment gelöscht
 * D.h. die Bufferzeit liegt bei etwa 20 Sekunden
 */
export const MAX_BUFFER_STREAM_TIME = 10;

export const codecConfig = (() => {
    if (mimeCodec.includes('av01')) {
        return { videoCodec: 'libaom-av1', audioCodec: 'libopus', format: 'webm' };
    } else if (mimeCodec.includes('vp8')) {
        return { videoCodec: 'libvpx', audioCodec: 'libvorbis', format: 'webm' };
    } else if (mimeCodec.includes('vp9')) {
        return { videoCodec: 'libvpx-vp9', audioCodec: 'libopus', format: 'webm' };
    } else if (mimeCodec.includes('avc1')) {
        return { videoCodec: 'libx264', audioCodec: 'aac', format: 'mp4' };
    } else {
        throw new Error(`Unsupported MIME codec: ${mimeCodec}`);
    }
})();

export const codecConfigLiveStreaming = (() => {
    const codecConfigLiveStreaming = {videoCodec: '', audioCodec: '', format: ''};
    if(mimeCodecLiveStreaming.includes('h264_nvenc')){
        codecConfigLiveStreaming.videoCodec = 'h264_nvenc';
        codecConfigLiveStreaming.format = 'mp4';
    }
    if(mimeCodecLiveStreaming.includes('aac')){
        codecConfigLiveStreaming.audioCodec = 'aac';
    }
return codecConfigLiveStreaming;
})();

export const ffmpegConfigLiveStreaming = {
    videoCodec: codecConfigLiveStreaming.videoCodec,
    audioCodec: codecConfigLiveStreaming.audioCodec,
    videoPreset: VIDEOCODECPRESET,
    audioPreset: AUDIOCODECPRESET,
    format: codecConfigLiveStreaming.format,
    videoBitrate: CBR_BITRATE,
    maxBitrate: CBR_BITRATE,
    minBitrate: CBR_BITRATE,
    bufferSize: CBR_BUFFER,
    audioBitrate: CBR_AUDIO,
    keyframeInterval: `${KEYFRAME_INTERVAL}`,
    fragmentDuration: FRAGMENT_DURATION,
    videoCRF: VIDEOCRF,
};

export const recorderOptions = {
    mimeType: mimeCodecMediaRecorder, //Erstmal VP8 muss immer vp8 oder vp9 sein
    videoBitsPerSecond: parseInt(CBR_BITRATE.replace('k', '')) * 1000, 
    audioBitsPerSecond: parseInt(CBR_AUDIO.replace('k', '')) * 1000
}

export const defaultVideoURL = "https://box.open-desk.net/Big Buck Bunny [YE7VzlLtp-4].mp4";
//export const defaultVideoURL = "https://ftp.nluug.nl/pub/graphics/blender/demo/movies/ToS/tearsofsteel_4k.mov";
//export const defaultVideoURL = "";

export const backendURL = 'ws://localhost:8081';
export const backendPort = 8081;