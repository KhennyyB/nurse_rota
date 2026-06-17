// Auto-scheduling engine for the 28-day rota.
//
// Universal 16-day cycle for ALL roles (strict, no override): 4M → 4OFF → 4N → 4OFF
//   Offsets are snapped to 4-day block boundaries so every nurse always starts
//   at the beginning of a block (never mid-block).
//   enforceMinima reports violations but NEVER modifies assignments.
//
// Coverage nurses follow a bespoke per-period pattern:
//   NC block  : 4 consecutive NC shifts, sequentially staggered across nurses,
//               rotating lead nurse each period (continuous across periods)
//   Post-NC   : 4 forced OFF days immediately after the NC block
//   Post-NC+  : resume NURSE_CYCLE from position 0 (4M → 4OFF → 4N …)
//   Pre-NC    : NURSE_CYCLE from staggered 4-block phase (same as all other roles)
//   MWC       : one nurse per weekend rotates Sat+Sun MWC, others OFF on weekends
//   Fri/Mon   : forced OFF for the MWC nurse (rest before and after the weekend)
//
// Matrons are never auto-scheduled (Mon–Fri mornings tracked at shift-page level).

export type ShiftCode = "M" | "N" | "OFF" | "LEAVE" | "MWC" | "NC";

export const SHIFT_TIMES = {
  M: { start: "08:00", end: "17:00", hours: 9, label: "Morning" },
  N: { start: "17:00", end: "08:00", hours: 15, label: "Night" },
  NC: { start: "17:00", end: "08:00", hours: 15, label: "Night Coverage" },
  MWC: { start: "08:00", end: "17:00", hours: 9, label: "Morning Weekend Coverage" },
} as const;

export interface NurseInput {
  id: string;
  name: string;
  role: string;
  ward: string | null;
  facility?: string | null;
  target_hours: number;
}

export interface WardInput {
  id: string;
  name: string;
  facility?: string | null;
  min_morning_nurses: number;
  min_morning_supervisor: number;
  min_morning_na: number;
  min_night_nurses: number;
  min_night_supervisor: number;
  min_night_na: number;
}

export interface LeaveInput {
  nurse_id: string;
  from_date: string;
  to_date: string;
  status: string;
}

export interface DraftAssignment {
  nurse_id: string;
  ward: string | null;
  shift_date: string;
  shift: ShiftCode;
}

export interface SafetyViolation {
  ward: string;
  date: string;
  shift: "M" | "N";
  role: "nurse" | "supervisor" | "na";
  required: number;
  actual: number;
}

// 16-day cycle: 4M → 4OFF → 4N → 4OFF. Every N block is followed by 4 OFF days
// so the rest rule (no M the day after N) is always satisfied.
const NURSE_CYCLE: readonly ShiftCode[] = [
  "M",
  "M",
  "M",
  "M",
  "OFF",
  "OFF",
  "OFF",
  "OFF",
  "N",
  "N",
  "N",
  "N",
  "OFF",
  "OFF",
  "OFF",
  "OFF",
];

type WardMins = Pick<
  WardInput,
  | "min_morning_nurses"
  | "min_morning_supervisor"
  | "min_morning_na"
  | "min_night_nurses"
  | "min_night_supervisor"
  | "min_night_na"
>;

// Ikoyi-specific minimum staffing per ward.
export const IKOYI_WARD_MINIMUMS: Record<string, WardMins> = {
  "IP Ward": {
    min_morning_nurses: 5,
    min_morning_supervisor: 0,
    min_morning_na: 3,
    min_night_nurses: 5,
    min_night_supervisor: 0,
    min_night_na: 2,
  },
  ER: {
    min_morning_nurses: 1,
    min_morning_supervisor: 0,
    min_morning_na: 1,
    min_night_nurses: 1,
    min_night_supervisor: 0,
    min_night_na: 1,
  },
  ICU: {
    min_morning_nurses: 5,
    min_morning_supervisor: 0,
    min_morning_na: 2,
    min_night_nurses: 5,
    min_night_supervisor: 0,
    min_night_na: 2,
  },
  "Operation Theatre": {
    min_morning_nurses: 6,
    min_morning_supervisor: 0,
    min_morning_na: 2,
    min_night_nurses: 1,
    min_night_supervisor: 0,
    min_night_na: 1,
  },
  NICU: {
    min_morning_nurses: 4,
    min_morning_supervisor: 0,
    min_morning_na: 1,
    min_night_nurses: 3,
    min_night_supervisor: 0,
    min_night_na: 1,
  },
  SCBU: {
    min_morning_nurses: 4,
    min_morning_supervisor: 0,
    min_morning_na: 1,
    min_night_nurses: 3,
    min_night_supervisor: 0,
    min_night_na: 1,
  },
  GOPD: {
    min_morning_nurses: 4,
    min_morning_supervisor: 0,
    min_morning_na: 4,
    min_night_nurses: 0,
    min_night_supervisor: 0,
    min_night_na: 0,
  },
  "Labour Ward": {
    min_morning_nurses: 1,
    min_morning_supervisor: 0,
    min_morning_na: 0,
    min_night_nurses: 1,
    min_night_supervisor: 0,
    min_night_na: 0,
  },
  Dialysis: {
    min_morning_nurses: 2,
    min_morning_supervisor: 0,
    min_morning_na: 0,
    min_night_nurses: 0,
    min_night_supervisor: 0,
    min_night_na: 0,
  },
  Oncology: {
    min_morning_nurses: 1,
    min_morning_supervisor: 0,
    min_morning_na: 0,
    min_night_nurses: 0,
    min_night_supervisor: 0,
    min_night_na: 0,
  },
};

export const IKOYI_WARD_NAMES = Object.keys(IKOYI_WARD_MINIMUMS);

// Ligali-specific minimum staffing per ward.
// Note: Operation Theatre is morning-only (no night shift).
// Special rule not yet enforced: all OT nurses on duty every Saturday.
export const LIGALI_WARD_MINIMUMS: Record<string, WardMins> = {
  ER: {
    min_morning_nurses: 2,
    min_morning_supervisor: 0,
    min_morning_na: 1,
    min_night_nurses: 1,
    min_night_supervisor: 0,
    min_night_na: 1,
  },
  GOPD: {
    min_morning_nurses: 4,
    min_morning_supervisor: 0,
    min_morning_na: 4,
    min_night_nurses: 1,
    min_night_supervisor: 0,
    min_night_na: 1,
  },
  "IP Ward": {
    min_morning_nurses: 3,
    min_morning_supervisor: 0,
    min_morning_na: 1,
    min_night_nurses: 2,
    min_night_supervisor: 0,
    min_night_na: 1,
  },
  "ICU & CathLab": {
    min_morning_nurses: 3,
    min_morning_supervisor: 0,
    min_morning_na: 1,
    min_night_nurses: 1,
    min_night_supervisor: 0,
    min_night_na: 1,
  },
  "Operation Theatre": {
    min_morning_nurses: 2,
    min_morning_supervisor: 0,
    min_morning_na: 2,
    min_night_nurses: 0,
    min_night_supervisor: 0,
    min_night_na: 0,
  },
};

export const LIGALI_WARD_NAMES = Object.keys(LIGALI_WARD_MINIMUMS);

// Ikeja-specific minimum staffing per ward.
// Several wards are morning-only (Labour Ward, ER, SCBU, HDU, GOPD).
// Special rule not yet enforced: Ikeja GOPD requires 7 nurses + 3 NA on
// Wednesdays and Fridays (day-of-week override, not expressible as a static min).
export const IKEJA_WARD_MINIMUMS: Record<string, WardMins> = {
  "IP Ward": {
    min_morning_nurses: 10,
    min_morning_supervisor: 0,
    min_morning_na: 3,
    min_night_nurses: 9,
    min_night_supervisor: 0,
    min_night_na: 2,
  },
  "Labour Ward": {
    min_morning_nurses: 1,
    min_morning_supervisor: 0,
    min_morning_na: 0,
    min_night_nurses: 0,
    min_night_supervisor: 0,
    min_night_na: 0,
  },
  ER: {
    min_morning_nurses: 1,
    min_morning_supervisor: 0,
    min_morning_na: 0,
    min_night_nurses: 0,
    min_night_supervisor: 0,
    min_night_na: 0,
  },
  SCBU: {
    min_morning_nurses: 2,
    min_morning_supervisor: 0,
    min_morning_na: 0,
    min_night_nurses: 0,
    min_night_supervisor: 0,
    min_night_na: 0,
  },
  HDU: {
    min_morning_nurses: 1,
    min_morning_supervisor: 0,
    min_morning_na: 0,
    min_night_nurses: 0,
    min_night_supervisor: 0,
    min_night_na: 0,
  },
  GOPD: {
    min_morning_nurses: 5,
    min_morning_supervisor: 0,
    min_morning_na: 3,
    min_night_nurses: 0,
    min_night_supervisor: 0,
    min_night_na: 0,
  },
};

export const IKEJA_WARD_NAMES = Object.keys(IKEJA_WARD_MINIMUMS);

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
type DayName = (typeof DAY_NAMES)[number];

// Day-of-week overrides keyed by "Facility|WardName". These are not stored in
// the DB — they are applied by enforceMinima at generation time only.
// A value of 99 for nurse/NA counts acts as "all available" (promoteOff will
// promote every remaining OFF nurse before reaching 99).
const DAY_OVERRIDES: Record<string, Partial<Record<DayName, Partial<WardMins>>>> = {
  // Ligali OT: every available OT nurse must work the morning shift on Saturday.
  "Ligali|Operation Theatre": {
    Sat: { min_morning_nurses: 99, min_morning_na: 99 },
  },
  // Ikeja GOPD: minimum 7 nurses + 3 NA on Wednesdays and Fridays.
  "Ikeja|GOPD": {
    Wed: { min_morning_nurses: 7, min_morning_na: 3 },
    Fri: { min_morning_nurses: 7, min_morning_na: 3 },
  },
};

function ymd(d: Date) {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function parseWards(ward: string | null): string[] {
  if (!ward) return [];
  return ward.split("|").filter(Boolean);
}

function inLeave(leave: LeaveInput[], nurseId: string, dateStr: string) {
  return leave.some(
    (l) =>
      l.nurse_id === nurseId &&
      l.status === "Approved" &&
      l.from_date <= dateStr &&
      l.to_date >= dateStr,
  );
}

export function isNAType(role: string) {
  return /nurse\s*assistant/i.test(role);
}

export function isInternType(role: string) {
  return /nurse\s*intern|intern\s*nurse/i.test(role);
}

export function isGlobalHead(role: string) {
  return /^(head|coverage)\s*nurse$/i.test(role);
}

export function isMatron(role: string) {
  return /^matron$/i.test(role);
}

export function isWardSupervisor(role: string) {
  return (
    !isGlobalHead(role) &&
    !isMatron(role) &&
    /supervisor|matron|sister|senior\s*nurse|experienced\s*nurse/i.test(role)
  );
}

export function isHeadOrSupervisor(role: string) {
  return isGlobalHead(role) || isWardSupervisor(role);
}

function isNurseOrIntern(role: string) {
  return !isNAType(role) && !isHeadOrSupervisor(role);
}

function stableGroupOffset(group: NurseInput[]): number {
  if (group.length === 0) return 0;
  let h = 5381;
  for (const n of group) {
    for (let k = 0; k < n.id.length; k++) {
      h = (((h << 5) + h) ^ n.id.charCodeAt(k)) >>> 0;
    }
  }
  return h % group.length;
}

function computeShift(i: number, d: number, N: number, cycle: readonly ShiftCode[]): ShiftCode {
  const len = cycle.length;
  const blockSize = 4;
  const numBlocks = Math.floor(len / blockSize);
  // Snap offset to a 4-day block boundary so every nurse starts at the top of a block.
  const block = Math.round((i * numBlocks) / N) % numBlocks;
  const offset = block * blockSize;
  return cycle[(((d + offset) % len) + len) % len];
}

/**
 * Schedule a group of nurses strictly following `cycle`, writing into `out`.
 *
 * Each nurse is assigned exactly their cycle position (4-block staggered) or
 * LEAVE when approved leave is active.  No vacancy filling, no rest-rule
 * overrides — the NURSE_CYCLE already guarantees N→M is never consecutive.
 * `phase` = periodOffset carries the cycle position forward across periods.
 */
function scheduleGroup(
  group: NurseInput[],
  cycle: readonly ShiftCode[],
  days: number,
  startDate: Date,
  leave: LeaveInput[],
  wardName: string | null,
  out: DraftAssignment[],
  phase = 0,
): void {
  const N = group.length;
  if (N === 0) return;
  for (let d = 0; d < days; d++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + d);
    const dateStr = ymd(date);
    for (let i = 0; i < N; i++) {
      out.push({
        nurse_id: group[i].id,
        ward: wardName,
        shift_date: dateStr,
        shift: inLeave(leave, group[i].id, dateStr)
          ? "LEAVE"
          : computeShift(i, d + phase, N, cycle),
      });
    }
  }
}

/**
 * Report ward minimum staffing violations for every day in the window.
 *
 * Strict-policy mode: assignments are NEVER modified.  The 4-block cycle is
 * sacrosanct; this function only counts and reports shortfalls so the UI can
 * surface them to the admin.
 */
function enforceMinima(
  out: DraftAssignment[],
  wardNurses: NurseInput[],
  ward: WardInput,
  days: number,
  startDate: Date,
): { violations: SafetyViolation[]; extraPromos: Map<string, number> } {
  const nurseById = new Map(wardNurses.map((n) => [n.id, n]));
  const violations: SafetyViolation[] = [];
  const baseMins: WardMins = {
    min_morning_nurses: ward.min_morning_nurses,
    min_morning_supervisor: ward.min_morning_supervisor,
    min_morning_na: ward.min_morning_na,
    min_night_nurses: ward.min_night_nurses,
    min_night_supervisor: ward.min_night_supervisor,
    min_night_na: ward.min_night_na,
  };
  const overrideKey = ward.facility ? `${ward.facility}|${ward.name}` : null;

  for (let d = 0; d < days; d++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + d);
    const dateStr = ymd(date);
    const dayName = DAY_NAMES[date.getDay()];
    const dayOverride = overrideKey ? DAY_OVERRIDES[overrideKey]?.[dayName] : undefined;
    const mins: WardMins = dayOverride ? { ...baseMins, ...dayOverride } : baseMins;

    const dayAssignments = out.filter((a) => a.shift_date === dateStr && nurseById.has(a.nurse_id));

    const count = (shift: ShiftCode, roleTest: (r: string) => boolean) =>
      dayAssignments.filter(
        (a) => a.shift === shift && roleTest(nurseById.get(a.nurse_id)?.role ?? ""),
      ).length;

    const check = (
      required: number,
      actual: number,
      shift: "M" | "N",
      role: "nurse" | "supervisor" | "na",
    ) => {
      if (required > 0 && actual < required) {
        violations.push({ ward: ward.name, date: dateStr, shift, role, required, actual });
      }
    };

    check(mins.min_morning_supervisor, count("M", isWardSupervisor), "M", "supervisor");
    check(mins.min_morning_nurses, count("M", isNurseOrIntern), "M", "nurse");
    check(mins.min_morning_na, count("M", isNAType), "M", "na");
    check(mins.min_night_supervisor, count("N", isWardSupervisor), "N", "supervisor");
    check(mins.min_night_nurses, count("N", isNurseOrIntern), "N", "nurse");
    check(mins.min_night_na, count("N", isNAType), "N", "na");
  }

  return { violations, extraPromos: new Map() };
}

export function nextInternWard(currentWard: string | null, wardNames: string[]): string | null {
  if (!wardNames.length) return currentWard;
  if (!currentWard) return wardNames[0];
  const idx = wardNames.indexOf(currentWard);
  return wardNames[(idx + 1) % wardNames.length];
}

export interface ExtraShift {
  nurseId: string;
  nurseName: string;
  /** Number of extra shifts added by safety enforcement. */
  extraCount: number;
}

export interface ScheduleResult {
  assignments: DraftAssignment[];
  violations: SafetyViolation[];
  extraShifts: ExtraShift[];
}

/**
 * Schedule coverage nurses (global, not ward-bound).
 *
 * Per-period pattern for each nurse (priority order, highest first):
 *   1. LEAVE     — approved leave overrides everything
 *   2. NC block  — 4 consecutive NC shifts (staggered; lead nurse rotates each period)
 *   3. MWC       — Sat+Sun for the rotating MWC duty nurse; others get OFF on weekends
 *   4. Weekend   — OFF for non-MWC nurses
 *   5. Fri/Mon   — forced OFF for the MWC nurse (rest day before and after the weekend)
 *   6. Post-NC   — 4 forced OFF days immediately after the NC block
 *   7. Post-NC+  — resume NURSE_CYCLE from position 0 (4M first) for the rest of the period
 *   8. Default   — NURSE_CYCLE with 4-block staggered phase (same as all other roles)
 *
 * NC nurses AND nurses in their post-NC rest (8 days total) are excluded from MWC duty.
 * MWC rotation advances by 4 nurses per period (28 days = 4 weekends).
 */
function scheduleCoverageNurses(
  group: NurseInput[],
  days: number,
  startDate: Date,
  leave: LeaveInput[],
  out: DraftAssignment[],
  periodOffset = 0,
): void {
  // Sort by ID so assignments are stable regardless of DB query order.
  group = [...group].sort((a, b) => a.id.localeCompare(b.id));
  const N = group.length;
  if (N === 0) return;

  const periodsElapsed = Math.round(periodOffset / days);

  // Stable seed derived from the group's IDs so period-0 doesn't always
  // assign NC and MWC duty to the index-0 nurse.
  const seed = stableGroupOffset(group);

  // NC block stagger: nurse `firstNcNurse` leads each period.
  const firstNcNurse = (periodsElapsed + seed) % N;
  const maxNcBlocks = Math.min(N, Math.floor(days / 4));

  // ncStartDay: nurseIdx → first NC day within this period
  const ncStartDay = new Map<number, number>();
  for (let p = 0; p < maxNcBlocks; p++) {
    ncStartDay.set((firstNcNurse + p) % N, p * 4);
  }

  // Pre-compute MWC duty assignments and surrounding forced OFFs.
  // mwcByDate   : dateStr (Sat or Sun) → nurseIdx on MWC duty
  // mwcForcedOff: dateStr (Fri or Mon) → set of nurseIdx forced OFF
  const mwcByDate = new Map<string, number>();
  const mwcForcedOff = new Map<string, Set<number>>();
  let weekendDutyIdx = (periodsElapsed * 4 + seed) % N;

  for (let d = 0; d < days; d++) {
    const satDate = new Date(startDate);
    satDate.setDate(satDate.getDate() + d);
    if (satDate.getDay() !== 6) continue; // process each Saturday only

    // Exclude nurses whose NC block or post-NC rest covers Saturday (d) OR Sunday (d+1).
    // Without the Sunday check, a nurse whose NC starts on Sunday would be assigned
    // MWC on Saturday but then NC takes over Sunday, giving a one-day MWC instead
    // of the expected Sat+Sun pair.
    const excluded = new Set<number>();
    for (const [nurseIdx, startD] of ncStartDay) {
      if ((d >= startD && d < startD + 8) || (d + 1 >= startD && d + 1 < startD + 8)) {
        excluded.add(nurseIdx);
      }
    }

    // Pick MWC nurse: first available non-excluded nurse in duty rotation.
    let mwcNurse = -1;
    for (let attempt = 0; attempt < N; attempt++) {
      const candidate = (weekendDutyIdx + attempt) % N;
      if (!excluded.has(candidate)) {
        mwcNurse = candidate;
        weekendDutyIdx = (candidate + 1) % N;
        break;
      }
    }
    if (mwcNurse < 0) continue;

    mwcByDate.set(ymd(satDate), mwcNurse); // Saturday

    if (d + 1 < days) {
      const sunDate = new Date(startDate);
      sunDate.setDate(sunDate.getDate() + d + 1);
      mwcByDate.set(ymd(sunDate), mwcNurse); // Sunday
    }

    // Friday before Saturday: forced OFF for MWC nurse
    if (d > 0) {
      const friDate = new Date(startDate);
      friDate.setDate(friDate.getDate() + d - 1);
      const friStr = ymd(friDate);
      if (!mwcForcedOff.has(friStr)) mwcForcedOff.set(friStr, new Set());
      mwcForcedOff.get(friStr)!.add(mwcNurse);
    }

    // Monday after Sunday: forced OFF for MWC nurse
    if (d + 2 < days) {
      const monDate = new Date(startDate);
      monDate.setDate(monDate.getDate() + d + 2);
      const monStr = ymd(monDate);
      if (!mwcForcedOff.has(monStr)) mwcForcedOff.set(monStr, new Set());
      mwcForcedOff.get(monStr)!.add(mwcNurse);
    }
  }

  // Main scheduling loop
  for (let d = 0; d < days; d++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + d);
    const dateStr = ymd(date);
    const dow = date.getDay();
    const isWeekend = dow === 0 || dow === 6;

    for (let i = 0; i < N; i++) {
      if (inLeave(leave, group[i].id, dateStr)) {
        out.push({ nurse_id: group[i].id, ward: null, shift_date: dateStr, shift: "LEAVE" });
        continue;
      }

      const ncStart = ncStartDay.get(i);
      const inNcBlock = ncStart !== undefined && d >= ncStart && d < ncStart + 4;
      const inPostNcOff = ncStart !== undefined && d >= ncStart + 4 && d < ncStart + 8;
      const afterNcOff = ncStart !== undefined && d >= ncStart + 8;

      let shift: ShiftCode;
      if (inNcBlock) {
        shift = "NC";
      } else if (mwcByDate.get(dateStr) === i) {
        shift = "MWC";
      } else if (isWeekend) {
        shift = "OFF";
      } else if (mwcForcedOff.get(dateStr)?.has(i)) {
        shift = "OFF";
      } else if (inPostNcOff) {
        // Mandatory 4-day rest after the NC block (same rest principle as after 4N)
        shift = "OFF";
      } else if (afterNcOff) {
        // Resume NURSE_CYCLE from position 0 (4M → 4OFF → 4N …) after NC + rest
        shift = NURSE_CYCLE[(d - (ncStart! + 8)) % NURSE_CYCLE.length];
      } else {
        // Pre-NC days and non-NC nurses: strict 4-block NURSE_CYCLE with phase continuity
        shift = computeShift(i, periodOffset + d, N, NURSE_CYCLE);
      }

      out.push({ nurse_id: group[i].id, ward: null, shift_date: dateStr, shift });
    }
  }
}

/**
 * Generate a 28-day draft schedule and return both the assignments and any
 * safety-rule violations that could not be resolved given the available staff.
 */
export function generateSchedule(opts: {
  nurses: NurseInput[];
  wards: WardInput[];
  leave: LeaveInput[];
  startDate: Date;
  days?: number;
  facility?: string;
  /** Days elapsed since the facility's very first scheduled day (period 0 = 0). */
  periodOffset?: number;
}): ScheduleResult {
  const { nurses, wards, leave } = opts;
  const days = opts.days ?? 28;
  const periodOffset = opts.periodOffset ?? 0;
  const out: DraftAssignment[] = [];
  const scheduled = new Set<string>();
  const allViolations: SafetyViolation[] = [];
  const allExtraShifts: ExtraShift[] = [];

  // Matrons are not auto-scheduled; mark them up-front so step 4 skips them.
  nurses.filter((n) => isMatron(n.role)).forEach((n) => scheduled.add(n.id));

  // 1. Coverage Nurses (global, not ward-bound)
  // Uses scheduleCoverageNurses: weekends → MWC, first weekday N → NC, rest stay N.
  const headNurses = nurses.filter((n) => isGlobalHead(n.role));
  scheduleCoverageNurses(headNurses, days, opts.startDate, leave, out, periodOffset);
  headNurses.forEach((n) => scheduled.add(n.id));

  // 2. Intern Nurses — grouped by assigned ward so interns in the same ward share
  //    an identical phase (equal M/N/OFF counts).  Phases are staggered across
  //    ward-groups so different wards don't all share the same off-days.
  //    Assignments are stored with ward = null (same as Coverage Nurses) so that
  //    interns are bundled into the Coverage Nurses approval card and published
  //    together with coverage nurses, independently of any specific ward's
  //    approval timeline.
  const interns = nurses.filter((n) => isInternType(n.role));
  const internsByWard = new Map<string | null, NurseInput[]>();
  for (const intern of interns) {
    const ward = parseWards(intern.ward)[0] ?? null;
    const group = internsByWard.get(ward) ?? [];
    group.push(intern);
    internsByWard.set(ward, group);
  }
  const internGroupList = [...internsByWard.entries()];
  const numInternGroups = internGroupList.length;
  for (let gi = 0; gi < numInternGroups; gi++) {
    const [, rawGroup] = internGroupList[gi];
    // Sort by ID for stable, DB-order-independent phase assignment.
    const group = [...rawGroup].sort((a, b) => a.id.localeCompare(b.id));
    const stagger =
      numInternGroups > 1 ? Math.round((gi * NURSE_CYCLE.length) / numInternGroups) : 0;
    // Schedule interns as a group (not individually) so their phases are staggered
    // across nurses, mirroring the ward nurse pattern.
    scheduleGroup(
      group,
      NURSE_CYCLE,
      days,
      opts.startDate,
      leave,
      null,
      out,
      periodOffset + stagger,
    );
    group.forEach((intern) => scheduled.add(intern.id));
  }

  // 3. Per-ward scheduling (supervisors, regulars, NAs) + safety rule enforcement
  // All roles use the universal 16-day NURSE_CYCLE (4M→4OFF→4N→4OFF).

  for (const ward of wards) {
    const wardNurses = nurses.filter(
      (n) =>
        parseWards(n.ward)[0] === ward.name &&
        !isGlobalHead(n.role) &&
        !isInternType(n.role) &&
        !isMatron(n.role),
    );

    // Sort each sub-group by ID for stable, DB-order-independent scheduling.
    // A per-group phase seed (multiple of 4 = one full block) is added so that
    // different ward sub-groups don't all start at the same cycle position.
    const supervisors = wardNurses
      .filter((n) => isWardSupervisor(n.role))
      .sort((a, b) => a.id.localeCompare(b.id));
    const regulars = wardNurses
      .filter((n) => !isNAType(n.role) && !isWardSupervisor(n.role))
      .sort((a, b) => a.id.localeCompare(b.id));
    const nas = wardNurses.filter((n) => isNAType(n.role)).sort((a, b) => a.id.localeCompare(b.id));

    const supervisorSeed = stableGroupOffset(supervisors) * 4;
    const regularSeed = stableGroupOffset(regulars) * 4;
    const naSeed = stableGroupOffset(nas) * 4;

    scheduleGroup(
      supervisors,
      NURSE_CYCLE,
      days,
      opts.startDate,
      leave,
      ward.name,
      out,
      periodOffset + supervisorSeed,
    );
    scheduleGroup(
      regulars,
      NURSE_CYCLE,
      days,
      opts.startDate,
      leave,
      ward.name,
      out,
      periodOffset + regularSeed,
    );
    scheduleGroup(
      nas,
      NURSE_CYCLE,
      days,
      opts.startDate,
      leave,
      ward.name,
      out,
      periodOffset + naSeed,
    );

    // Only validate safety rules for wards that have staff in this run.
    // If wardNurses is empty (e.g. generating only for IP Ward, so ER has
    // no nurses here), we skip enforcement — it would always report violations
    // of every minimum since there is literally nobody scheduled.
    if (wardNurses.length > 0) {
      const { violations: wardViolations, extraPromos } = enforceMinima(
        out,
        wardNurses,
        ward,
        days,
        opts.startDate,
      );
      allViolations.push(...wardViolations);
      for (const [id, count] of extraPromos) {
        const nurse = wardNurses.find((n) => n.id === id);
        if (nurse) allExtraShifts.push({ nurseId: id, nurseName: nurse.name, extraCount: count });
      }
    }
    wardNurses.forEach((n) => scheduled.add(n.id));
  }

  // 4. Unassigned nurses — OFF or LEAVE for every day
  for (let d = 0; d < days; d++) {
    const date = new Date(opts.startDate);
    date.setDate(date.getDate() + d);
    const dateStr = ymd(date);
    for (const nurse of nurses) {
      if (scheduled.has(nurse.id)) continue;
      out.push({
        nurse_id: nurse.id,
        ward: nurse.ward,
        shift_date: dateStr,
        shift: inLeave(leave, nurse.id, dateStr) ? "LEAVE" : "OFF",
      });
    }
  }

  return { assignments: out, violations: allViolations, extraShifts: allExtraShifts };
}
