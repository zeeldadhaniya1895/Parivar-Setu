import type { JsonValue } from "@/lib/engine/types";

/** The facts that triggered a flag, kept as stored: source record ids and values. */
export function Evidence({ value }: { value: { [key: string]: JsonValue } }) {
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Evidence</summary>
      <pre className="mt-1 max-w-full overflow-x-auto rounded bg-muted p-2">{JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}
