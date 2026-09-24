'use strict';

// Microphone capture with simple energy-based voice activity detection.
// start() resolves once you stop talking (or finish()/cancel() is called) with 16 kHz mono Float32 audio for Whisper.
class VoiceCapture {
  static SAMPLE_RATE = 16000;
  static SILENCE_END_MS = 1000;     // this much quiet after speech ends the utterance
  static NO_SPEECH_MS = 8000;       // give up if nothing is said
  static MAX_MS = 30000;            // Whisper's window
  static MIN_SPEECH_MS = 350;       // ignore clicks and coughs

  constructor(onLevel) {
    this.onLevel = onLevel || (() => {});
    this.chunks = [];
    this.preroll = [];
    this.speechStarted = false;
    this.speechMs = 0;
    this.recent = [];                 // last ~1.3 s of levels; the quietest one approximates room noise
    this.threshold = 0.02;
    this.lastVoiceAt = 0;
    this.total = 0;                   // samples kept since speech started
    this.voicedTotal = 0;             // ...up to and including the last voiced chunk
    this.done = false;
  }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    this.ctx = new AudioContext({ sampleRate: VoiceCapture.SAMPLE_RATE });
    await this.ctx.audioWorklet.addModule('pcm-worklet.js');
    await this.ctx.resume();

    const source = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, 'pcm-capture');
    const mute = this.ctx.createGain();
    mute.gain.value = 0; // keep the graph pulled without playing the mic back
    source.connect(this.node).connect(mute).connect(this.ctx.destination);

    this.startedAt = performance.now();
    return new Promise((resolve) => {
      this.resolve = resolve;
      this.node.port.onmessage = (e) => this.onChunk(e.data);
      // Timeouts run on their own clock so a stalled or silent device can never leave the mic open.
      this.timer = setInterval(() => this.tick(), 150);
    });
  }

  onChunk(chunk) {
    if (this.done) return;
    const now = performance.now();
    let sum = 0;
    for (let i = 0; i < chunk.length; i++) sum += chunk[i] * chunk[i];
    const rms = Math.sqrt(sum / chunk.length);
    this.onLevel(Math.min(1, rms * 12));

    // Adaptive threshold: a few times the quietest recent level, clamped so that talking from the very first
    // moment (no quiet lead-in to learn from) can't push it above normal speech level.
    this.recent.push(rms);
    if (this.recent.length > 40) this.recent.shift();
    this.threshold = Math.min(0.03, Math.max(0.012, Math.min(...this.recent) * 3.5));

    const loud = rms > this.threshold;
    if (!this.speechStarted) {
      this.preroll.push(chunk);
      if (this.preroll.length > 20) this.preroll.shift(); // ~650 ms kept from before the trigger, so soft first words survive
      if (loud) {
        this.speechStarted = true;
        this.chunks = [...this.preroll];
        this.total = this.chunks.reduce((n, c) => n + c.length, 0);
        this.voicedTotal = this.total;
        this.lastVoiceAt = now;
      }
      return;
    }

    this.chunks.push(chunk);
    this.total += chunk.length;
    if (rms > this.threshold * 0.6) {
      this.lastVoiceAt = now;
      this.voicedTotal = this.total;
      this.speechMs += (chunk.length / VoiceCapture.SAMPLE_RATE) * 1000;
    }
  }

  /** Audio captured since speech began, for live partial transcription. null until someone is talking. */
  snapshot() {
    if (!this.speechStarted || this.done) return null;
    return { audio: this.concat(), voicedSamples: this.voicedTotal };
  }

  concat() {
    const audio = new Float32Array(this.chunks.reduce((n, c) => n + c.length, 0));
    let o = 0;
    for (const c of this.chunks) { audio.set(c, o); o += c.length; }
    return audio;
  }

  tick() {
    if (this.done) return;
    const now = performance.now();
    if (!this.speechStarted) {
      if (now - this.startedAt > VoiceCapture.NO_SPEECH_MS) this.end('timeout');
    } else if (now - this.lastVoiceAt > VoiceCapture.SILENCE_END_MS || now - this.startedAt > VoiceCapture.MAX_MS) {
      this.end('speech');
    }
  }

  /** Stop now and use whatever was heard (second press of the hotkey). */
  finish() { this.end('manual'); }

  cancel() { this.end('cancel'); }

  end(reason) {
    if (this.done) return;
    this.done = true;
    clearInterval(this.timer);
    this.node?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close();
    this.onLevel(0);

    let audio = null;
    if (reason !== 'cancel' && reason !== 'timeout' && this.speechStarted && this.speechMs >= VoiceCapture.MIN_SPEECH_MS) {
      audio = this.concat();
    }
    this.resolve({ audio, reason, voicedSamples: this.voicedTotal });
  }
}
