"use client";

import { useState, useRef, useEffect, type FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Message {
  role: "user" | "assistant";
  text: string;
  source?: "gemini" | "fallback";
}

export function AssistantChat({ familyId }: { familyId: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [lang, setLang] = useState<"en" | "gu">("en");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const question = input.trim();
    if (!question || loading) return;

    setInput("");
    const userMsg: Message = { role: "user", text: question };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ familyId, question, lang }),
      });
      const data = (await res.json()) as { answer?: string; source?: "gemini" | "fallback"; error?: string };
      if (res.ok && data.answer) {
        const answer: string = data.answer;
        const source: "gemini" | "fallback" = data.source ?? "fallback";
        setMessages((prev) => [...prev, { role: "assistant", text: answer, source }]);
      } else {
        const errorText: string = data.error ?? "Something went wrong. Please try again.";
        setMessages((prev) => [
          ...prev,
          { role: "assistant", text: errorText, source: "fallback" as const },
        ]);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: "Could not reach the assistant. Please try again.", source: "fallback" },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col rounded-lg border">
      <div className="flex items-center justify-between border-b px-4 py-2">
        <h3 className="text-sm font-semibold">Scheme Assistant</h3>
        <div className="flex items-center gap-2">
          <Button
            variant={lang === "en" ? "default" : "outline"}
            size="sm"
            onClick={() => setLang("en")}
            type="button"
          >
            English
          </Button>
          <Button
            variant={lang === "gu" ? "default" : "outline"}
            size="sm"
            onClick={() => setLang("gu")}
            type="button"
          >
            ગુજરાતી
          </Button>
        </div>
      </div>

      <div ref={scrollRef} className="flex min-h-[200px] max-h-[400px] flex-col gap-3 overflow-y-auto p-4">
        {messages.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {lang === "gu"
              ? "તમારી યોજનાઓ વિશે પૂછો. ઉદાહરણ: \"હું કઈ યોજનાઓ માટે પાત્ર છું?\""
              : "Ask about your schemes. Example: \"What schemes am I eligible for?\""}
          </p>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex flex-col gap-1 ${msg.role === "user" ? "items-end" : "items-start"}`}
          >
            <div
              className={`max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
                msg.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted"
              }`}
            >
              {msg.text}
            </div>
            {msg.source && (
              <Badge variant="outline" className="text-[10px]">
                {msg.source === "gemini" ? "Gemini" : "Fallback"}
              </Badge>
            )}
          </div>
        ))}
        {loading && (
          <div className="flex items-start">
            <div className="animate-pulse rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
              {lang === "gu" ? "વિચારી રહ્યું છે..." : "Thinking..."}
            </div>
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2 border-t p-3">
        <Input
          id="assistant-input"
          type="text"
          placeholder={
            lang === "gu" ? "તમારો પ્રશ્ન ટાઇપ કરો..." : "Type your question..."
          }
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={loading}
          autoComplete="off"
        />
        <Button type="submit" disabled={loading || input.trim() === ""}>
          {lang === "gu" ? "મોકલો" : "Send"}
        </Button>
      </form>
    </div>
  );
}
