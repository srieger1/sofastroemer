let ws: WebSocket | null = null;

/**
 * Initializes the WebSocket connection to the live streaming backend.
 * @param {string} url - WebSocket URL for the backend.
 * @returns {Promise<void>} Resolves when the connection is established.
 */
export function initFFmpegLiveStreaming(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws) {
      console.warn('WebSocket is already connected.');
      resolve();
      return;
    }

    ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      console.log('Connected to live streaming backend.');
      resolve();
    };

    ws.onerror = (err) => {
      console.error('WebSocket connection error:', err);
      reject(err);
    };

    ws.onclose = () => {
      console.log('Disconnected from live streaming backend.');
      ws = null;
    };
  });
}

/**
 * Sends VBR live streaming data to the backend for conversion.
 * @param {Uint8Array} data - The VBR data to send.
 */
export function liveStreamingVBRtoCBR(data: Uint8Array): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.error('WebSocket is not connected.');
    return;
  }

  ws.send(data);
}

/**
 * Registers a callback to handle incoming CBR data from the backend.
 * @param {function} callback - The function to process incoming data.
 */
export function onCBRDataAvailable(callback: (data: Uint8Array) => void): void {
  if (!ws) {
    console.error('WebSocket is not initialized.');
    return;
  }

  ws.onmessage = (event: MessageEvent) => {
    if (event.data instanceof ArrayBuffer) {
      callback(new Uint8Array(event.data));
    } else {
      console.warn('Unexpected data type received:', typeof event.data);
    }
  };
}
