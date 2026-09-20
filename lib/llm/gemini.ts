// Gemini adapter (DESIGN.md 7.9). Uses the @google/genai SDK.
// 8-second timeout, one retry on 429 or 5xx after 1 second, then returns null for fallback.
import { GoogleGenAI } from "@google/genai";
import type { LLMProvider } from "./provider";

const TIMEOUT_MS = 8_000;
const RETRY_DELAY_MS = 1_000;

function isRetryable(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message;
  // The SDK throws errors whose message contains the HTTP status code.
  return /429|500|502|503|504/.test(msg);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("LLM timeout")), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e: unknown) => { clearTimeout(timer); reject(e); },
    );
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class GeminiProvider implements LLMProvider {
  private readonly client: GoogleGenAI;
  private readonly model: string;

  constructor(apiKey: string, model: string) {
    this.client = new GoogleGenAI({ apiKey });
    this.model = model;
  }

  async chat(system: string, user: string): Promise<string> {
    const response = await withTimeout(
      this.client.models.generateContent({
        model: this.model,
        contents: user,
        config: {
          systemInstruction: system,
          maxOutputTokens: 300,
          temperature: 0.3,
        },
      }),
      TIMEOUT_MS,
    );
    const text = response.text;
    if (typeof text !== "string" || text.trim() === "") {
      throw new Error("Gemini returned empty response");
    }
    return text.trim();
  }
}

/**
 * Try to call Gemini. Returns the text reply on success, null on failure (so the caller
 * falls through to the template fallback).
 */
export async function callGemini(
  provider: LLMProvider, system: string, user: string,
): Promise<string | null> {
  try {
    return await provider.chat(system, user);
  } catch (err) {
    if (isRetryable(err)) {
      await delay(RETRY_DELAY_MS);
      try {
        return await provider.chat(system, user);
      } catch {
        return null;
      }
    }
    return null;
  }
}

const DEFAULT_MODEL = "gemini-2.0-flash";

/**
 * Returns a GeminiProvider when the API key is set, null otherwise (fallback-only mode).
 */
export function getProvider(): LLMProvider | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  return new GeminiProvider(apiKey, model);
}
