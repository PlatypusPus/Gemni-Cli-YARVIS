import { spawn } from "bun";

const mic = "Microphone (CDS.KT USB Audio)";

console.log("Recording 5 seconds...");

const proc = spawn([
  "ffmpeg",
  "-f", "dshow",
  "-i", `audio=${mic}`,
  "-t", "10",
  "-ac", "1",
  "-ar", "16000",
  "-y",
  "input.wav"
]);

await proc.exited;

console.log("Recording complete.");