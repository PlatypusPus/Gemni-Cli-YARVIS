import { spawn } from "bun";
import { GoogleGenAI, createPartFromBase64, Modality } from "@google/genai";
import { readFileSync, writeFileSync } from "fs";

const GEMINI_API_KEY = process.env.GOOGLE_API_KEY!;
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

const mic = "Microphone (CDS.KT USB Audio)";
const RECORD_SECONDS = 10;

// ── Step 1: Record audio from microphone ────────────────────────────
console.log(`🎙️  Recording ${RECORD_SECONDS} seconds from mic...`);

const recordProc = spawn([
  "ffmpeg",
  "-f", "dshow",
  "-i", `audio=${mic}`,
  "-t", String(RECORD_SECONDS),
  "-ac", "1",
  "-ar", "16000",
  "-y",
  "input.wav",
]);

await recordProc.exited;
console.log("✅ Recording complete.\n");


console.log("🧠 Sending audio to Gemini...");

const audioBase64 = readFileSync("input.wav").toString("base64");

const textResponse = await ai.models.generateContent({
  model: "gemini-2.5-flash",
  contents: [
    createPartFromBase64(audioBase64, "audio/wav"),
    `Listen to this audio carefully. 
     First, understand what the speaker is saying or asking.
     Then, provide a concise and helpful response in 2-3 sentences maximum.
     Be direct and to the point.`,
  ],
});

const conciseAnswer = textResponse.text ?? "Sorry, I couldn't understand the audio.";
console.log("📝 Gemini says:\n", conciseAnswer, "\n");

console.log("🔊 Generating speech...");

const ttsResponse = await ai.models.generateContent({
  model: "gemini-2.5-flash-preview-tts",
  contents: conciseAnswer,
  config: {
    responseModalities: [Modality.AUDIO],
    speechConfig: {
      voiceConfig: {
        prebuiltVoiceConfig: {
          voiceName: "Kore",
        },
      },
    },
  },
});

const audioData = ttsResponse.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

if (!audioData) {
  console.error("❌ No audio data returned from TTS.");
  process.exit(1);
}

writeFileSync("output.pcm", Buffer.from(audioData, "base64"));
console.log("✅ Speech generated.\n");

// ── Step 4: Play the audio ──────────────────────────────────────────
console.log("🔈 Playing response...");

const playProc = spawn([
  "ffplay",
  "-autoexit",
  "-nodisp",
  "-f", "s16le",
  "-ar", "24000",
  "-ch_layout", "mono",
  "output.pcm",
]);

await playProc.exited;
console.log("✅ Done!");