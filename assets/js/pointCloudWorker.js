// pointCloudWorker.js

// Import pako for decompression
import * as pako from 'pako';

self.onmessage = function (event) {
  const data = event.data;
  try {
    const compressedData = new Uint8Array(data);
    const decompressedData = pako.inflate(compressedData);

    const dataView = new DataView(decompressedData.buffer);
    let offset = 0;

    // Read number of points (uint32)
    const numPoints = dataView.getUint32(offset, true);
    offset += 4;

    // Read has_colors flag (uint8)
    const hasColors = dataView.getUint8(offset);
    offset += 1;

    // Read positions
    const positions = new Float32Array(numPoints * 3);
    for (let i = 0; i < numPoints * 3; i++) {
      positions[i] = dataView.getFloat32(offset, true);
      offset += 4;
    }

    // Read colors if available
    let colors = null;
    if (hasColors) {
      colors = new Float32Array(numPoints * 3);
      for (let i = 0; i < numPoints * 3; i++) {
        const colorValue = dataView.getUint8(offset);
        colors[i] = colorValue / 255.0; // Normalize to [0,1]
        offset += 1;
      }
    }

    // Post the parsed data back to the main thread
    self.postMessage({ positions, colors, numPoints }, [
      positions.buffer,
      colors ? colors.buffer : null,
    ]);
  } catch (error) {
    console.error('Worker parsing error:', error);
    self.postMessage({ error: error.message });
  }
};
