class SilenceDetectorProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._silenceStart = null;
    this._threshold = 0.01;
    this._silenceDurationMs = 900;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const samples = input[0];
    let sum = 0;
    for (let i = 0; i < samples.length; i++) {
      sum += samples[i] * samples[i];
    }
    const rms = Math.sqrt(sum / samples.length);
    const now = currentTime * 1000;

    if (rms < this._threshold) {
      if (this._silenceStart === null) {
        this._silenceStart = now;
      } else if (now - this._silenceStart > this._silenceDurationMs) {
        this.port.postMessage({ type: "silence" });
        this._silenceStart = null;
      }
    } else {
      this._silenceStart = null;
    }

    return true;
  }
}

registerProcessor("silence-detector", SilenceDetectorProcessor);
