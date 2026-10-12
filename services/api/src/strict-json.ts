const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

class Scanner {
  private index = 0;
  public constructor(private readonly source: string) {}
  public parse(): unknown { this.space(); const value = this.value(); this.space(); if (this.index !== this.source.length) throw new SyntaxError("invalid JSON"); return value; }
  private value(): unknown {
    const value = this.source[this.index];
    if (value === "{") return this.object(); if (value === "[") return this.array(); if (value === '"') return this.string();
    if (value === "t") return this.literal("true", true); if (value === "f") return this.literal("false", false); if (value === "n") return this.literal("null", null);
    return this.number();
  }
  private object(): Record<string, unknown> {
    this.index += 1; this.space(); const output = Object.create(null) as Record<string, unknown>; const keys = new Set<string>();
    if (this.source[this.index] === "}") { this.index += 1; return output; }
    while (true) {
      if (this.source[this.index] !== '"') throw new SyntaxError("invalid JSON object");
      const key = this.string(); if (keys.has(key) || FORBIDDEN_KEYS.has(key)) throw new SyntaxError("invalid JSON member"); keys.add(key); this.space();
      if (this.source[this.index] !== ":") throw new SyntaxError("invalid JSON object"); this.index += 1; this.space(); output[key] = this.value(); this.space();
      if (this.source[this.index] === "}") { this.index += 1; return output; } if (this.source[this.index] !== ",") throw new SyntaxError("invalid JSON object"); this.index += 1; this.space();
    }
  }
  private array(): unknown[] {
    this.index += 1; this.space(); const output: unknown[] = []; if (this.source[this.index] === "]") { this.index += 1; return output; }
    while (true) { output.push(this.value()); this.space(); if (this.source[this.index] === "]") { this.index += 1; return output; } if (this.source[this.index] !== ",") throw new SyntaxError("invalid JSON array"); this.index += 1; this.space(); }
  }
  private string(): string {
    const start = this.index; this.index += 1;
    while (this.index < this.source.length) { const code = this.source.charCodeAt(this.index); if (code === 34) { this.index += 1; return JSON.parse(this.source.slice(start, this.index)) as string; } if (code === 92) { this.index += 2; continue; } if (code < 32) throw new SyntaxError("invalid JSON string"); this.index += 1; }
    throw new SyntaxError("unterminated JSON string");
  }
  private literal<T>(text: string, value: T): T { if (this.source.slice(this.index, this.index + text.length) !== text) throw new SyntaxError("invalid JSON literal"); this.index += text.length; return value; }
  private number(): number { const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/u.exec(this.source.slice(this.index)); if (match === null) throw new SyntaxError("invalid JSON number"); this.index += match[0].length; const value = Number(match[0]); if (!Number.isFinite(value)) throw new SyntaxError("invalid JSON number"); return value; }
  private space(): void { while (this.source[this.index] === " " || this.source[this.index] === "\t" || this.source[this.index] === "\n" || this.source[this.index] === "\r") this.index += 1; }
}

export function parseStrictJson(source: string): unknown { return new Scanner(source).parse(); }
