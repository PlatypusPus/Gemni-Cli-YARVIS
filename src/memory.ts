import { readFileSync, writeFileSync, existsSync } from "fs";
import type { Content } from "@google/genai";

export interface MemoryEntry {
  role: "user" | "model";
  text: string;
  timestamp: string;
}

const MEMORY_FILE = "memory.json";
const MAX_TURNS = 20; // keep last 20 exchanges (40 messages) to avoid token bloat

/**
 * Persistent conversation memory.
 * Stores exchanges as {role, text, timestamp} and persists to a JSON file.
 * Provides Gemini-ready Content[] for multi-turn conversations.
 */
export class Memory {
  private entries: MemoryEntry[] = [];

  constructor() {
    this.load();
  }

  /** Load history from disk (if it exists). */
  private load(): void {
    if (existsSync(MEMORY_FILE)) {
      try {
        const raw = readFileSync(MEMORY_FILE, "utf-8");
        this.entries = JSON.parse(raw) as MemoryEntry[];
      } catch {
        this.entries = [];
      }
    }
  }

  /** Persist current history to disk. */
  private save(): void {
    writeFileSync(MEMORY_FILE, JSON.stringify(this.entries, null, 2));
  }

  /** Add user message to history. */
  addUser(text: string): void {
    this.entries.push({ role: "user", text, timestamp: new Date().toISOString() });
    this.trim();
    this.save();
  }

  /** Add model response to history. */
  addModel(text: string): void {
    this.entries.push({ role: "model", text, timestamp: new Date().toISOString() });
    this.trim();
    this.save();
  }

  /** Trim to the last MAX_TURNS pairs to prevent token overflow. */
  private trim(): void {
    const maxMessages = MAX_TURNS * 2;
    if (this.entries.length > maxMessages) {
      this.entries = this.entries.slice(-maxMessages);
    }
  }

  /** Convert stored history into Gemini Content[] for multi-turn context. */
  toContents(): Content[] {
    return this.entries.map((e) => ({
      role: e.role,
      parts: [{ text: e.text }],
    }));
  }

  /** Number of stored messages. */
  get length(): number {
    return this.entries.length;
  }

  /** Clear all memory and delete the file. */
  clear(): void {
    this.entries = [];
    this.save();
  }
}
