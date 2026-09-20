// LLM provider interface (DESIGN.md 7.9). Swap providers by implementing this interface.

/** A provider takes a system prompt and a user message, and returns the model's reply. */
export interface LLMProvider {
  chat(system: string, user: string): Promise<string>;
}
