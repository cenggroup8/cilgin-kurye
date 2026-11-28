// The records an adapter sends (README "Output"): metric, event, check, and log for other lines.

export interface MetricRec {
  kind: "metric";
  t?: number;
  mod: string;
  name: string;
  value: number;
  unit?: string;
}
export interface EventRec {
  kind: "event";
  t?: number;
  mod: string;
  name: string;
  data?: Record<string, unknown>;
}
export interface CheckRec {
  kind: "check";
  t?: number;
  mod: string;
  name: string;
  ok: boolean;
  detail?: string;
}
export interface LogRec {
  kind: "log";
  t?: number;
  mod: string;
  text: string;
}
export type Rec = MetricRec | EventRec | CheckRec | LogRec;

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const isName = (x: unknown): x is string => typeof x === "string" && x.length > 0 && x.length <= 120;

/** Returns the record, or an error text if it does not follow the format. */
export function validate(x: unknown): Rec | string {
  if (!isObj(x)) return "not an object";
  if (x.t !== undefined && (typeof x.t !== "number" || !Number.isFinite(x.t) || x.t < 0)) return "t must be a number ≥ 0";
  if (!isName(x.mod)) return "mod missing";
  switch (x.kind) {
    case "metric":
      if (!isName(x.name)) return "name missing";
      if (typeof x.value !== "number" || !Number.isFinite(x.value)) return `metric ${x.name}: value must be a number`;
      if (x.unit !== undefined && typeof x.unit !== "string") return "unit must be text";
      return x as unknown as MetricRec;
    case "event":
      if (!isName(x.name)) return "name missing";
      if (x.data !== undefined && !isObj(x.data)) return "data must be an object";
      return x as unknown as EventRec;
    case "check":
      if (!isName(x.name)) return "name missing";
      if (typeof x.ok !== "boolean") return `check ${x.name}: ok must be true or false`;
      if (x.detail !== undefined && typeof x.detail !== "string") return "detail must be text";
      return x as unknown as CheckRec;
    case "log":
      if (typeof x.text !== "string") return "text missing";
      return x as unknown as LogRec;
    default:
      return `unknown kind ${JSON.stringify(x.kind)}`;
  }
}

/** Splits a line into words; "quoted words" stay one word. */
export function words(line: string): string[] {
  const out: string[] = [];
  const re = /"((?:[^"\\]|\\.)*)"|(\S+)/g;
  for (let m; (m = re.exec(line)); ) out.push(m[1] !== undefined ? m[1].replace(/\\(.)/g, "$1") : m[2]);
  return out;
}

function value(s: string): unknown {
  if (s === "true") return true;
  if (s === "false") return false;
  const n = Number(s);
  return s !== "" && Number.isFinite(n) ? n : s;
}

/**
 * Reads one output line of a program:
 *   {"kind":"metric",...}         a JSON record
 *   @metric name value [unit]
 *   @event name [key=value ...]
 *   @check name ok|fail [detail ...]
 * Every other line (and a broken @ line) becomes a log record, so nothing is lost.
 */
export function parseLine(line: string, mod: string): Rec {
  const text = line.replace(/\r$/, "");
  const log = (why?: string): LogRec => ({ kind: "log", mod, text: why ? `${text}   (bench: ${why})` : text });
  const trimmed = text.trim();

  if (trimmed.startsWith("{")) {
    let x: unknown;
    try {
      x = JSON.parse(trimmed);
    } catch {
      return log();
    }
    if (isObj(x) && x.mod === undefined) x.mod = mod;
    const r = validate(x);
    return typeof r === "string" ? log(r) : r;
  }
  if (!trimmed.startsWith("@")) return log();

  const [tag, name, ...rest] = words(trimmed);
  if (!name) return log("name missing");
  switch (tag) {
    case "@metric": {
      const v = Number(rest[0]);
      if (rest[0] === undefined || !Number.isFinite(v)) return log("value must be a number");
      return rest[1] ? { kind: "metric", mod, name, value: v, unit: rest[1] } : { kind: "metric", mod, name, value: v };
    }
    case "@event": {
      const data: Record<string, unknown> = {};
      for (const w of rest) {
        const i = w.indexOf("=");
        if (i > 0) data[w.slice(0, i)] = value(w.slice(i + 1));
      }
      return Object.keys(data).length ? { kind: "event", mod, name, data } : { kind: "event", mod, name };
    }
    case "@check": {
      if (rest[0] !== "ok" && rest[0] !== "fail") return log("write ok or fail after the name");
      const detail = rest.slice(1).join(" ");
      return detail ? { kind: "check", mod, name, ok: rest[0] === "ok", detail } : { kind: "check", mod, name, ok: rest[0] === "ok" };
    }
    default:
      return log();
  }
}
