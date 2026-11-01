class JarvisPcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.phase = 0;
    this.pending = [];
    this.chunkSamples = 320; // 20 ms at 16 kHz.
  }

  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (output) output.fill(0);
    if (!input || input.length === 0) return true;

    const inputRate = sampleRate;
    const targetRate = 16000;
    for (let index = 0; index < input.length; index += 1) {
      this.phase += targetRate;
      while (this.phase >= inputRate) {
        this.phase -= inputRate;
        const sample = Math.max(-1, Math.min(1, input[index]));
        const pcm = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
        this.pending.push(Math.round(pcm));
        if (this.pending.length === this.chunkSamples) {
          const chunk = Int16Array.from(this.pending);
          this.pending.length = 0;
          this.port.postMessage(chunk.buffer, [chunk.buffer]);
        }
      }
    }
    return true;
  }
}

registerProcessor("jarvis-pcm-capture", JarvisPcmCaptureProcessor);
