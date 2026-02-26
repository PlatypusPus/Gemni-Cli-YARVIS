import { spawn } from "bun";
import { GoogleGenAI, createPartFromBase64, Modality } from "@google/genai";
import { writeFileSync, unlinkSync } from "fs";
import { Memory } from "./memory";

// ── Configuration ──────────────────────────────────────────────────
const CONFIG = {
  microphoneName: "Microphone (CDS.KT USB Audio)",
  ffmpegPath: "C:\\ProgramData\\chocolatey\\bin\\ffmpeg.exe",
  recordSeconds: 10,
  tmpWavPath: `${process.env.TEMP}\\voice_assistant_out.wav`,
  ttsVoice: "Kore",
  model: {
    text: "gemini-2.5-flash",
    tts: "gemini-2.5-flash-preview-tts",
  },
  exitPhrases: ["goodbye", "stop", "exit", "quit"],
} as const;

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY! });
const memory = new Memory();

// ── Audio Utilities ────────────────────────────────────────────────

/** Wraps raw PCM (s16le) bytes in a WAV container header. */
function buildWavFromPcm(
  pcm: Buffer,
  sampleRate = 24000,
  channels = 1,
  bitsPerSample = 16
): Buffer {
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);

  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);       // PCM chunk size
  header.writeUInt16LE(1, 20);        // PCM format
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);

  return Buffer.concat([header, pcm]);
}

// ── Core Steps ─────────────────────────────────────────────────────

/** Records audio from the microphone and returns WAV bytes. */
async function recordAudio(): Promise<Buffer> {
  console.log(`🎙️  Recording ${CONFIG.recordSeconds} seconds...`);

  const proc = spawn({
    cmd: [
      CONFIG.ffmpegPath,
      "-f", "dshow",
      "-i", `audio=${CONFIG.microphoneName}`,
      "-t", String(CONFIG.recordSeconds),
      "-ac", "1",
      "-ar", "16000",
      "-f", "wav",
      "pipe:1",
    ],
    stdout: "pipe",
    stderr: "ignore",
  });

  const chunks: Buffer[] = [];
  const reader = proc.stdout.getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
  }

  await proc.exited;
  console.log("✅ Recording complete.\n");

  return Buffer.concat(chunks);
}

/** Transcribes a WAV buffer to text using Gemini. */
async function transcribeAudio(wavBuffer: Buffer): Promise<string | null> {
  console.log("📝 Transcribing...");

  const response = await ai.models.generateContent({
    model: CONFIG.model.text,
    contents: [
      createPartFromBase64(wavBuffer.toString("base64"), "audio/wav"),
      "Transcribe this audio exactly as spoken. Return only the transcription, nothing else.",
    ],
  });

  const text = response.text?.trim();
  return text && text.length >= 2 ? text : null;
}

/** Generates a conversational reply using Gemini with memory context. */
async function generateReply(): Promise<string> {
  console.log("🧠 Thinking...");

  // memory.toContents() already includes the latest user message as the last entry,
  // so we use the full history directly without appending again.
  const contents = memory.toContents();

  const response = await ai.models.generateContent({
    model: CONFIG.model.text,
    // System instruction keeps the prompt separate from conversation history
    config: {
      systemInstruction: "You are a helpful, concise voice assistant. Respond in 2-3 sentences maximum. Be direct and to the point.",
    },
    contents,
  });

  return response.text ?? "Sorry, I couldn't come up with a response.";
}

/** Converts text to speech and returns a WAV buffer. */
async function synthesizeSpeech(text: string): Promise<Buffer | null> {
  console.log("🔊 Generating speech...");

  const response = await ai.models.generateContent({
    model: CONFIG.model.tts,
    contents: [{ role: "user", parts: [{ text }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: CONFIG.ttsVoice },
        },
      },
    },
  });

  const audioBase64 = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!audioBase64) return null;

  return buildWavFromPcm(Buffer.from(audioBase64, "base64"));
}

/** Writes WAV to a temp file and plays it synchronously via PowerShell. */
async function playAudio(wavBuffer: Buffer): Promise<void> {
  console.log("🔈 Playing response...");
  writeFileSync(CONFIG.tmpWavPath, wavBuffer);

  const proc = spawn({
    cmd: [
      "powershell", "-NoProfile", "-Command",
      `(New-Object System.Media.SoundPlayer '${CONFIG.tmpWavPath}').PlaySync()`,
    ],
    stdout: "ignore",
    stderr: "inherit",
  });

  await proc.exited;

  try { unlinkSync(CONFIG.tmpWavPath); } catch { /* ignore cleanup errors */ }
}

// ── Main Loop ──────────────────────────────────────────────────────

console.log("🤖 Voice assistant ready! (Ctrl+C to quit)");
console.log(`📚 Memory: ${memory.length} messages loaded.\n`);

while (true) {
  // 1. Record
  const wavBuffer = await recordAudio();

  // 2. Transcribe
  const userText = await transcribeAudio(wavBuffer);

  if (!userText) {
    console.log("🔇 No speech detected, listening again...\n");
    continue;
  }

  console.log(`🗣️  You said: "${userText}"\n`);

  // 3. Check for exit intent
  if (CONFIG.exitPhrases.some(phrase => userText.toLowerCase().includes(phrase))) {
    console.log("👋 Goodbye!");
    break;
  }

  // 4. Generate reply
  memory.addUser(userText);
  const reply = await generateReply();
  console.log("📝 Response:", reply, "\n");
  memory.addModel(reply);

  // 5. Speak reply
  const speechBuffer = await synthesizeSpeech(reply);

  if (!speechBuffer) {
    console.error("❌ No audio returned from TTS, skipping playback.");
    continue;
  }

  await playAudio(speechBuffer);

  console.log("✅ Done!\n" + "─".repeat(50) + "\n");
}