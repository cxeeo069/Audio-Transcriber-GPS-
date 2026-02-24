import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

let ffmpeg: FFmpeg | null = null;

export const getFFmpeg = async () => {
  if (ffmpeg) {
    return ffmpeg;
  }
  ffmpeg = new FFmpeg();
  
  const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
  
  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
  });
  
  return ffmpeg;
};

export const convertAudio = async (
  file: File | Blob,
  targetFormat: 'mp3' | 'm4a' | 'aac',
  onProgress?: (progress: number) => void
): Promise<Blob> => {
  const ff = await getFFmpeg();
  
  if (onProgress) {
    ff.on('progress', ({ progress }) => {
      onProgress(progress * 100);
    });
  }

  const inputName = `input.${file.type.split('/')[1] || 'mp3'}`;
  const outputName = `output.${targetFormat}`;

  await ff.writeFile(inputName, await fetchFile(file));
  
  // Run conversion
  await ff.exec(['-i', inputName, outputName]);
  
  const data = await ff.readFile(outputName);
  
  // Clean up
  await ff.deleteFile(inputName);
  await ff.deleteFile(outputName);
  
  if (onProgress) {
    ff.off('progress', () => {});
  }
  
  return new Blob([data], { type: `audio/${targetFormat}` });
};
