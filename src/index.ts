import { spawn } from "bun";
import { GoogleGenAI, createPartFromBase64, Modality } from "@google/genai";
import { readFileSync, writeFileSync } from "fs";
import { Memory } from "./memory";

const GEMINI_API_KEY = process.env.GOOGLE_API_KEY!;
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
const memory = new Memory();

const mic = "Microphone (CDS.KT USB Audio)";
const RECORD_SECONDS = 10;

console.log("🤖 Voice assistant ready! (Ctrl+C to quit)");
console.log(`📚 Memory: ${memory.length} messages loaded.\n`);

// ── Main conversation loop ──────────────────────────────────────────
while (true) {
  // ── Step 1: Record audio from microphone ────────────────────────
  console.log(`🎙️  Recording ${RECORD_SECONDS} seconds from mic...`);

  const recordProc = spawn({
    cmd: [
      "C:\\ProgramData\\chocolatey\\bin\\ffmpeg.exe",
      "-f", "dshow",
      "-i", `audio=${mic}`,
      "-t", String(RECORD_SECONDS),
      "-ac", "1",
      "-ar", "16000",
      "-y",
      "input.wav",
    ],
    stdout: "ignore",
    stderr: "ignore",
  });

  await recordProc.exited;
  console.log("✅ Recording complete.\n");

  // ── Step 2: Transcribe audio ──────────────────────────────────────
  console.log("📝 Transcribing...");

  const audioBase64 = readFileSync("input.wav").toString("base64");

  const transcription = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [
      createPartFromBase64(audioBase64, "audio/wav"),
      "Transcribe this audio exactly as spoken. Return only the transcription, nothing else.",
    ],
  });

  const userText = transcription.text?.trim();

  if (!userText || userText.length < 2) {
    console.log("🔇 No speech detected, listening again...\n");
    continue;
  }

  console.log(`🗣️  You said: "${userText}"\n`);

  // Check for exit commands
  const lower = userText.toLowerCase();
  if (lower.includes("goodbye") || lower.includes("stop") || lower.includes("exit") || lower.includes("quit")) {
    console.log("👋 Goodbye!");
    break;
  }

  // Save user message to memory
  memory.addUser(userText);

  // ── Step 3: Generate contextual response with memory ──────────────
  console.log("🧠 Thinking...");

  const history = memory.toContents();
  // Build contents: previous conversation turns + new user turn with prompt
  const contents = [
    ...history.slice(0, -1), // all previous turns (the last one is the current user message already)
    {
      role: "user" as const,
      parts: [
        {
          text: `${userText}

[System: You are a helpful, concise voice assistant. Use the conversation history above for context. Respond in 2-3 sentences maximum. Be direct and to the point.]`,
        },
      ],
    },
  ];

  const textResponse = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents,
  });

  const answer = textResponse.text ?? "Sorry, I couldn't come up with a response.";
  console.log("📝 Gemini says:", answer, "\n");

  // Save model response to memory
  memory.addModel(answer);

  // ── Step 4: Convert answer to speech via Gemini TTS ─────────────
  console.log("🔊 Generating speech...");

  const ttsResponse = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-tts",
    contents: answer,
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
    continue;
  }

  writeFileSync("output.pcm", Buffer.from(audioData, "base64"));
  console.log("✅ Speech generated.\n");

  // ── Step 5: Play the audio ──────────────────────────────────────
  console.log("🔈 Playing response...");

  const playProc = spawn({
    cmd: [
      "C:\\ProgramData\\chocolatey\\bin\\ffplay.exe",
      "-autoexit",
      "-nodisp",
      "-f", "s16le",
      "-ar", "24000",
      "-ch_layout", "mono",
      "output.pcm",
    ],
    stdout: "ignore",
    stderr: "ignore",
  });

  await playProc.exited;
  console.log("✅ Done!\n");
  console.log("─".repeat(50) + "\n");
}