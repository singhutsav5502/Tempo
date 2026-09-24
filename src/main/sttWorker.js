// Runs Whisper (via transformers.js + onnxruntime-node) off the main thread so transcription never freezes the UI.
const { parentPort, workerData } = require('worker_threads');

const MODEL = 'Xenova/whisper-base.en';
let asr = null;
let queue = Promise.resolve();

function load() {
  if (!asr) {
    asr = (async () => {
      const { pipeline, env } = await import('@huggingface/transformers');
      env.cacheDir = workerData.cacheDir;
      const pipe = await pipeline('automatic-speech-recognition', MODEL, {
        dtype: 'q8',
        progress_callback: (p) => parentPort.postMessage({ type: 'progress', p }),
      });
      parentPort.postMessage({ type: 'ready' });
      return pipe;
    })();
    asr.catch(() => { asr = null; }); // allow a retry after a failed download
  }
  return asr;
}

parentPort.on('message', (m) => {
  // Serialize requests: one inference at a time.
  queue = queue.then(async () => {
    try {
      const pipe = await load();
      if (m.type === 'transcribe') {
        const out = await pipe(m.audio);
        parentPort.postMessage({ type: 'result', id: m.id, text: (out.text || '').trim() });
      }
    } catch (err) {
      parentPort.postMessage({ type: 'error', id: m.id, message: err.message });
    }
  });
});
