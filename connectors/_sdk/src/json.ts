import type {
  JsonDecodeIssue,
  JsonDecodeLimits,
  JsonDecodeResult,
  JsonObject,
  JsonValue,
} from "./types.js";

const FORBIDDEN_MEMBER_NAMES = new Set(["__proto__", "prototype", "constructor"]);

class JsonFailure {
  constructor(readonly issue: JsonDecodeIssue) {}
}

function failure(
  code: JsonDecodeIssue["code"],
  location: JsonDecodeIssue["location"],
  offset: number,
): never {
  throw new JsonFailure(Object.freeze({ code, location, offset }));
}

function validLimit(value: number, maximum: number): boolean {
  return Number.isSafeInteger(value) && value >= 1 && value <= maximum;
}

function readLimits(input: JsonDecodeLimits): JsonDecodeLimits | null {
  try {
    if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const descriptors = Object.getOwnPropertyDescriptors(input);
    if (Reflect.ownKeys(descriptors).length !== 3) return null;
    const values: Record<string, number> = Object.create(null) as Record<string, number>;
    for (const key of ["maxBytes", "maxDepth", "maxMembers"] as const) {
      const descriptor = descriptors[key];
      if (
        descriptor === undefined ||
        !("value" in descriptor) ||
        descriptor.enumerable !== true ||
        typeof descriptor.value !== "number"
      ) return null;
      values[key] = descriptor.value;
    }
    return values as unknown as JsonDecodeLimits;
  } catch {
    return null;
  }
}

class Parser {
  private offset = 0;
  private members = 0;

  constructor(
    private readonly text: string,
    private readonly limits: JsonDecodeLimits,
  ) {}

  parse(): JsonValue {
    this.skipWhitespace();
    const value = this.parseValue(0);
    this.skipWhitespace();
    if (this.offset !== this.text.length) {
      failure("invalid_json", "document", this.offset);
    }
    return value;
  }

  private parseValue(depth: number): JsonValue {
    const token = this.text[this.offset];
    if (token === "{") return this.parseObject(depth + 1);
    if (token === "[") return this.parseArray(depth + 1);
    if (token === '"') return this.parseString();
    if (token === "t") return this.parseLiteral("true", true);
    if (token === "f") return this.parseLiteral("false", false);
    if (token === "n") return this.parseLiteral("null", null);
    if (token === "-" || (token !== undefined && token >= "0" && token <= "9")) {
      return this.parseNumber();
    }
    failure("invalid_json", "token", this.offset);
  }

  private checkDepth(depth: number): void {
    if (depth > this.limits.maxDepth) {
      failure("json_too_deep", "depth", this.offset);
    }
  }

  private countMember(): void {
    this.members += 1;
    if (this.members > this.limits.maxMembers) {
      failure("json_too_large", "member", this.offset);
    }
  }

  private parseObject(depth: number): JsonObject {
    this.checkDepth(depth);
    this.offset += 1;
    this.skipWhitespace();
    const output: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
    const names = new Set<string>();
    if (this.consume("}")) return Object.freeze(output);

    while (true) {
      if (this.text[this.offset] !== '"') {
        failure("invalid_json", "member", this.offset);
      }
      const nameOffset = this.offset;
      const name = this.parseString();
      if (FORBIDDEN_MEMBER_NAMES.has(name)) {
        failure("invalid_json", "member", nameOffset);
      }
      if (names.has(name)) {
        failure("duplicate_member", "member", nameOffset);
      }
      names.add(name);
      this.countMember();
      this.skipWhitespace();
      if (!this.consume(":")) failure("invalid_json", "member", this.offset);
      this.skipWhitespace();
      output[name] = this.parseValue(depth);
      this.skipWhitespace();
      if (this.consume("}")) return Object.freeze(output);
      if (!this.consume(",")) failure("invalid_json", "member", this.offset);
      this.skipWhitespace();
    }
  }

  private parseArray(depth: number): readonly JsonValue[] {
    this.checkDepth(depth);
    this.offset += 1;
    this.skipWhitespace();
    const output: JsonValue[] = [];
    if (this.consume("]")) return Object.freeze(output);

    while (true) {
      this.countMember();
      output.push(this.parseValue(depth));
      this.skipWhitespace();
      if (this.consume("]")) return Object.freeze(output);
      if (!this.consume(",")) failure("invalid_json", "token", this.offset);
      this.skipWhitespace();
    }
  }

  private parseString(): string {
    const start = this.offset;
    this.offset += 1;
    let output = "";
    while (this.offset < this.text.length) {
      const character = this.text[this.offset];
      if (character === '"') {
        this.offset += 1;
        return output;
      }
      if (character === "\\") {
        this.offset += 1;
        output += this.parseEscape();
        continue;
      }
      if (character === undefined || character.charCodeAt(0) <= 0x1f) {
        failure("invalid_json", "token", this.offset);
      }
      const code = character.charCodeAt(0);
      if (code >= 0xdc00 && code <= 0xdfff) failure("invalid_json", "token", this.offset);
      if (code >= 0xd800 && code <= 0xdbff) {
        const low = this.text.charCodeAt(this.offset + 1);
        if (low < 0xdc00 || low > 0xdfff) failure("invalid_json", "token", this.offset);
        output += this.text.slice(this.offset, this.offset + 2);
        this.offset += 2;
        continue;
      }
      output += character;
      this.offset += 1;
    }
    failure("invalid_json", "token", start);
  }

  private parseEscape(): string {
    const escaped = this.text[this.offset];
    this.offset += 1;
    if (escaped === '"' || escaped === "\\" || escaped === "/") return escaped;
    if (escaped === "b") return "\b";
    if (escaped === "f") return "\f";
    if (escaped === "n") return "\n";
    if (escaped === "r") return "\r";
    if (escaped === "t") return "\t";
    if (escaped !== "u") failure("invalid_json", "token", this.offset - 1);

    const firstOffset = this.offset;
    const first = this.readHexCodeUnit();
    if (first >= 0xdc00 && first <= 0xdfff) {
      failure("invalid_json", "token", firstOffset);
    }
    if (first < 0xd800 || first > 0xdbff) return String.fromCharCode(first);
    if (this.text.slice(this.offset, this.offset + 2) !== "\\u") {
      failure("invalid_json", "token", firstOffset);
    }
    this.offset += 2;
    const second = this.readHexCodeUnit();
    if (second < 0xdc00 || second > 0xdfff) {
      failure("invalid_json", "token", this.offset - 4);
    }
    return String.fromCodePoint(0x10000 + ((first - 0xd800) << 10) + second - 0xdc00);
  }

  private readHexCodeUnit(): number {
    const value = this.text.slice(this.offset, this.offset + 4);
    if (!/^[0-9A-Fa-f]{4}$/.test(value)) {
      failure("invalid_json", "token", this.offset);
    }
    this.offset += 4;
    return Number.parseInt(value, 16);
  }

  private parseNumber(): number {
    const start = this.offset;
    if (this.consume("-")) {
      if (this.text[this.offset] === undefined) failure("invalid_json", "token", start);
    }
    if (this.consume("0")) {
      const next = this.text[this.offset];
      if (next !== undefined && next >= "0" && next <= "9") {
        failure("invalid_json", "token", this.offset);
      }
    } else {
      const first = this.text[this.offset];
      if (first === undefined || first < "1" || first > "9") {
        failure("invalid_json", "token", this.offset);
      }
      while (this.isDigit(this.text[this.offset])) this.offset += 1;
    }
    if (this.consume(".")) {
      if (!this.isDigit(this.text[this.offset])) failure("invalid_json", "token", this.offset);
      while (this.isDigit(this.text[this.offset])) this.offset += 1;
    }
    const exponent = this.text[this.offset];
    if (exponent === "e" || exponent === "E") {
      this.offset += 1;
      const sign = this.text[this.offset];
      if (sign === "+" || sign === "-") this.offset += 1;
      if (!this.isDigit(this.text[this.offset])) failure("invalid_json", "token", this.offset);
      while (this.isDigit(this.text[this.offset])) this.offset += 1;
    }
    const value = Number(this.text.slice(start, this.offset));
    if (!Number.isFinite(value)) failure("invalid_json", "token", start);
    return value;
  }

  private parseLiteral<T extends JsonValue>(literal: string, value: T): T {
    if (this.text.slice(this.offset, this.offset + literal.length) !== literal) {
      failure("invalid_json", "token", this.offset);
    }
    this.offset += literal.length;
    return value;
  }

  private skipWhitespace(): void {
    while (true) {
      const character = this.text[this.offset];
      if (character !== " " && character !== "\n" && character !== "\r" && character !== "\t") return;
      this.offset += 1;
    }
  }

  private consume(character: string): boolean {
    if (this.text[this.offset] !== character) return false;
    this.offset += 1;
    return true;
  }

  private isDigit(character: string | undefined): boolean {
    return character !== undefined && character >= "0" && character <= "9";
  }
}

function issueResult(issue: JsonDecodeIssue): JsonDecodeResult {
  return Object.freeze({ success: false as const, issues: Object.freeze([issue]) });
}

export function decodeJsonPage(
  bytes: Uint8Array,
  limits: JsonDecodeLimits,
): JsonDecodeResult {
  try {
    const checkedLimits = readLimits(limits);
    if (
      !(bytes instanceof Uint8Array) ||
      checkedLimits === null ||
      !validLimit(checkedLimits.maxBytes, 1_048_576) ||
      !validLimit(checkedLimits.maxDepth, 64) ||
      !validLimit(checkedLimits.maxMembers, 100_000)
    ) {
      return issueResult(Object.freeze({ code: "invalid_json", location: "document", offset: 0 }));
    }
    if (bytes.byteLength > checkedLimits.maxBytes) {
      return issueResult(Object.freeze({ code: "payload_too_large", location: "byte", offset: checkedLimits.maxBytes }));
    }
    if (bytes.byteLength >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      return issueResult(Object.freeze({ code: "invalid_utf8", location: "byte", offset: 0 }));
    }
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
      return issueResult(Object.freeze({ code: "invalid_utf8", location: "byte", offset: 0 }));
    }
    return Object.freeze({ success: true as const, data: new Parser(text, checkedLimits).parse() });
  } catch (error) {
    if (error instanceof JsonFailure) return issueResult(error.issue);
    return issueResult(Object.freeze({ code: "invalid_json", location: "document", offset: 0 }));
  }
}
