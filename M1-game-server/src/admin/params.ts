// Parameter registry (M1-5, plan #23 section 3.6).
// Every admin parameter lives here with its limits and owner module.
// M5 builds its forms from list(); no package keeps its own fixed numbers.

export type Owner = "M1" | "M2" | "M3" | "M4" | "M6";

export type Group =
  | "game"
  | "obstacles"
  | "players"
  | "physics"
  | "quake"
  | "net"
  | "board";

export interface ParamDef {
  /** `group.name`, for example `physics.grip`. */
  name: string;
  group: Group;
  min: number;
  max: number;
  start: number;
  /** Only whole numbers are allowed. */
  integer?: boolean;
  /** Module that uses the value. M1 sends every change there. */
  owner: Owner;
  /** Short text for the admin form. */
  label: string;
}

/** One row of the `params` message to the admin. */
export interface ParamInfo {
  name: string;
  group: Group;
  label: string;
  value: number;
  min: number;
  max: number;
  integer: boolean;
  owner: Owner;
}

export type ParamError = "unknown_param" | "bad_value" | "out_of_range";

export type SetResult =
  | { ok: true; name: string; value: number; owner: Owner }
  | { ok: false; error: ParamError };

export class ParamRegistry {
  private readonly defs = new Map<string, ParamDef>();
  private readonly values = new Map<string, number>();

  constructor(defs: readonly ParamDef[]) {
    for (const d of defs) {
      if (this.defs.has(d.name)) throw new Error(`parameter twice: ${d.name}`);
      if (!(d.min <= d.start && d.start <= d.max)) {
        throw new Error(`start value out of limits: ${d.name}`);
      }
      if (d.integer && !Number.isInteger(d.start)) {
        throw new Error(`start value not whole: ${d.name}`);
      }
      this.defs.set(d.name, d);
      this.values.set(d.name, d.start);
    }
  }

  has(name: string): boolean {
    return this.defs.has(name);
  }

  /** Current value. Throws for an unknown name: that is a bug in the code, not admin input. */
  get(name: string): number {
    const v = this.values.get(name);
    if (v === undefined) throw new Error(`unknown parameter: ${name}`);
    return v;
  }

  /**
   * Checks the limits first. A good value is saved; a wrong value gives an error
   * and the old value stays (v2.1 section 5.5).
   */
  set(name: string, value: unknown): SetResult {
    const d = this.defs.get(name);
    if (!d) return { ok: false, error: "unknown_param" };
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return { ok: false, error: "bad_value" };
    }
    if (d.integer && !Number.isInteger(value)) return { ok: false, error: "bad_value" };
    if (value < d.min || value > d.max) return { ok: false, error: "out_of_range" };
    this.values.set(name, value);
    return { ok: true, name, value, owner: d.owner };
  }

  /** Back to the start values (admin reset). */
  resetAll(): void {
    for (const d of this.defs.values()) this.values.set(d.name, d.start);
  }

  /** The full list, in the order of the definitions. */
  list(): ParamInfo[] {
    return [...this.defs.values()].map((d) => ({
      name: d.name,
      group: d.group,
      label: d.label,
      value: this.get(d.name),
      min: d.min,
      max: d.max,
      integer: d.integer ?? false,
      owner: d.owner,
    }));
  }
}
