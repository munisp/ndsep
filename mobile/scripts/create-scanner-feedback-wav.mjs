import fs from "node:fs";
import path from "node:path";

function makeWav(notes, fileName) {
  const sampleRate = 44100;
  const samples = [];
  for (const { frequency, durationMs } of notes) {
    const frames = Math.round((sampleRate * durationMs) / 1000);
    for (let frame = 0; frame < frames; frame += 1) {
      const t = frame / sampleRate;
      const envelope = Math.min(1, frame / 160) * Math.min(1, (frames - frame) / 220);
      samples.push(Math.round(Math.sin(2 * Math.PI * frequency * t) * 0.3 * envelope * 32767));
    }
  }
  const dataLength = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataLength);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataLength, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataLength, 40);
  samples.forEach((sample, index) => buffer.writeInt16LE(sample, 44 + index * 2));
  fs.mkdirSync(path.dirname(fileName), { recursive: true });
  fs.writeFileSync(fileName, buffer);
}

makeWav([{ frequency: 880, durationMs: 110 }, { frequency: 1320, durationMs: 150 }], path.resolve("assets/audio/receipt-scan-success.wav"));
makeWav([{ frequency: 330, durationMs: 170 }, { frequency: 220, durationMs: 230 }], path.resolve("assets/audio/receipt-scan-error.wav"));
