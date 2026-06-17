// Auto-scheduling engine for the 28-day rota.
//
// Universal 16-day cycle for ALL roles: 4M → 4OFF → 4N → 4OFF  (4M, 4N, 8OFF)
//   Coverage nurses additionally get: weekends → MWC, first weekday N → NC (once per period).
//   Matrons are never auto-scheduled (Mon–Fri mornings only, handled at shift-tracker level).
// Rest rule: N on day d → cannot work M on day d+1.

export type ShiftCode = "M" | "N" | "OFF" | "LEAVE" | "MC" | "MWC" | "NC";

export const SHIFT_TIMES = {
  M: { start: "08:00", end: "17:00", hours: 9, label: "Morning" },
  N: { start: "17:00", end: "08:00", hours: 15, label: "Night" },
  MC: { start: "08:00", end: "17:00", hours: 9, label: "Morning Coverage" },
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

function computeShift(i: number, d: number, N: number, cycle: readonly ShiftCode[]): ShiftCode {
  const len = cycle.length;
  // Evenly-distributed offsets: avoids duplicate cycle positions when N > len/2.
  const offset = Math.round((i * len) / N) % len;
  return cycle[(((d + offset) % len) + len) % len];
}

/**
 * Schedule a group of nurses using `cycle`, writing into `out`.
 *
 * `phase` shifts each group's starting position in the cycle so that
 * multiple single-nurse groups (e.g. one intern per ward) don't all land
 * on the same off-days simultaneously.
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

  // Cumulative M/N counts per nurse position — used to distribute leave-cover
  // shifts fairly instead of always burdening the first nurse in the array.
  const mCount = new Array<number>(N).fill(0);
  const nCount = new Array<number>(N).fill(0);
  // Track each nurse's shift from the previous day to enforce the N→M rest rule.
  const prevShift = new Array<ShiftCode | null>(N).fill(null);

  for (let d = 0; d < days; d++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + d);
    const dateStr = ymd(date);

    const onLeave = new Set<number>();
    const leaveVacancies: ShiftCode[] = [];

    for (let i = 0; i < N; i++) {
      if (inLeave(leave, group[i].id, dateStr)) {
        out.push({ nurse_id: group[i].id, ward: wardName, shift_date: dateStr, shift: "LEAVE" });
        leaveVacancies.push(computeShift(i, d + phase, N, cycle));
        onLeave.add(i);
      }
    }

    let mVac = leaveVacancies.filter((s) => s === "M").length;
    let nVac = leaveVacancies.filter((s) => s === "N").length;

    const rotation: { i: number; shift: ShiftCode }[] = [];
    for (let i = 0; i < N; i++) {
      if (onLeave.has(i)) continue;
      let shift = computeShift(i, d + phase, N, cycle);
      // Rest rule: cannot work morning shift the day after a night shift.
      if (shift === "M" && prevShift[i] === "N") shift = "OFF";
      rotation.push({ i, shift });
    }

    // Cover M vacancies: pick OFF nurses with fewest accumulated M shifts first.
    if (mVac > 0) {
      const offNurses = rotation
        .filter((r) => r.shift === "OFF")
        .sort((a, b) => mCount[a.i] - mCount[b.i]);
      for (const r of offNurses) {
        if (mVac <= 0) break;
        r.shift = "M";
        mVac--;
      }
    }

    // Cover N vacancies: pick OFF nurses (excl. heads/supervisors) with fewest N shifts first.
    if (nVac > 0) {
      const offNurses = rotation
        .filter((r) => r.shift === "OFF" && !isHeadOrSupervisor(group[r.i].role))
        .sort((a, b) => nCount[a.i] - nCount[b.i]);
      for (const r of offNurses) {
        if (nVac <= 0) break;
        r.shift = "N";
        nVac--;
      }
    }

    for (const r of rotation) {
      prevShift[r.i] = r.shift;
      if (r.shift === "M") mCount[r.i]++;
      else if (r.shift === "N") nCount[r.i]++;
      out.push({ nurse_id: group[r.i].id, ward: wardName, shift_date: dateStr, shift: r.shift });
    }
  }
}

/**
 * Enforce ward minimum staffing for every day in the window.
 *
 * Strategy (in priority order):
 *   1. Promote OFF → target shift (no cost to other shift)
 *   2. As a last resort, reallocate Night → Morning (or vice versa) when
 *      one shift is over-staffed and the other is under-staffed.
 *
 * Returns the set of violations that STILL exist after enforcement (i.e.
 * days where even reallocation cannot satisfy the minimum because there
 * simply aren't enough staff).
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
  // Tracks how many times enforcement promoted each nurse from OFF → working.
  const extraPromos = new Map<string, number>();

  // Cumulative M/N counts per nurse — updated at the end of each day so
  // promotion decisions always favour nurses with the fewest prior shifts.
  const mCum = new Map<string, number>(wardNurses.map((n) => [n.id, 0]));
  const nCum = new Map<string, number>(wardNurses.map((n) => [n.id, 0]));
  // Track the previous day's shift per nurse to enforce the N→M rest rule.
  const prevDayShift = new Map<string, ShiftCode>();

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

    // Re-apply the N→M rest rule using ENFORCED (not cycle) prior shifts.
    // scheduleGroup.prevShift only tracks cycle-computed shifts; if enforcement
    // promoted a nurse to N on day D, the pre-built cycle may still have M for
    // that nurse on day D+1. Correct those assignments here so the counts below
    // are accurate before any promotion logic runs.
    for (const a of dayAssignments) {
      if (a.shift === "M" && prevDayShift.get(a.nurse_id) === "N") {
        a.shift = "OFF";
      }
    }

    const count = (shift: ShiftCode, roleTest: (r: string) => boolean) =>
      dayAssignments.filter(
        (a) => a.shift === shift && roleTest(nurseById.get(a.nurse_id)?.role ?? ""),
      ).length;

    // Promote OFF → targetShift, preferring nurses with fewest accumulated target-shifts.
    const promoteOff = (
      needed: number,
      current: number,
      target: ShiftCode,
      roleTest: (r: string) => boolean,
    ) => {
      let deficit = needed - current;
      if (deficit <= 0) return 0;
      const cum = target === "M" ? mCum : nCum;
      const candidates = dayAssignments
        .filter((a) => {
          if (a.shift !== "OFF") return false;
          if (!roleTest(nurseById.get(a.nurse_id)?.role ?? "")) return false;
          // Rest rule: don't promote to M a nurse who worked N yesterday.
          if (target === "M" && prevDayShift.get(a.nurse_id) === "N") return false;
          return true;
        })
        .sort((a, b) => (cum.get(a.nurse_id) ?? 0) - (cum.get(b.nurse_id) ?? 0));
      for (const a of candidates) {
        if (deficit <= 0) break;
        a.shift = target;
        extraPromos.set(a.nurse_id, (extraPromos.get(a.nurse_id) ?? 0) + 1);
        deficit--;
      }
      return Math.max(0, deficit);
    };

    // Trim a shift down to the exact target: move the excess back to OFF.
    // Prefer demoting those who have accumulated the most of that shift type so
    // the schedule stays balanced over time.
    const demoteExcess = (
      exact: number,
      fromShift: ShiftCode,
      roleTest: (r: string) => boolean,
    ) => {
      const excess = count(fromShift, roleTest) - exact;
      if (excess <= 0) return;
      const cum = fromShift === "M" ? mCum : nCum;
      const candidates = dayAssignments
        .filter((a) => a.shift === fromShift && roleTest(nurseById.get(a.nurse_id)?.role ?? ""))
        .sort((a, b) => (cum.get(b.nurse_id) ?? 0) - (cum.get(a.nurse_id) ?? 0));
      for (let i = 0; i < excess && i < candidates.length; i++) {
        candidates[i].shift = "OFF";
      }
    };

    // Reallocate Night → Morning (last resort): prefer nurses with fewest M shifts.
    const reallocateNightToMorning = (
      deficit: number,
      roleTest: (r: string) => boolean,
      nightMin: number,
    ) => {
      const nightCount = count("N", roleTest);
      const surplus = nightCount - nightMin;
      const movable = Math.min(deficit, Math.max(0, surplus));
      if (movable <= 0) return deficit;
      const candidates = dayAssignments
        .filter(
          (a) =>
            a.shift === "N" &&
            roleTest(nurseById.get(a.nurse_id)?.role ?? "") &&
            prevDayShift.get(a.nurse_id) !== "N",
        )
        .sort((a, b) => (mCum.get(a.nurse_id) ?? 0) - (mCum.get(b.nurse_id) ?? 0));
      let moved = 0;
      for (const a of candidates) {
        if (moved >= movable) break;
        a.shift = "M";
        moved++;
      }
      return deficit - moved;
    };

    // --- Morning enforcement (exact count) ---
    // Demote any excess back to OFF first, then promote any deficit from OFF.
    // This ensures the final count is exactly the configured target, not just ≥.
    demoteExcess(mins.min_morning_supervisor, "M", isWardSupervisor);
    let supShortfall = promoteOff(
      mins.min_morning_supervisor,
      count("M", isWardSupervisor),
      "M",
      isWardSupervisor,
    );
    if (supShortfall > 0)
      supShortfall = reallocateNightToMorning(
        supShortfall,
        isWardSupervisor,
        mins.min_night_supervisor,
      );
    if (supShortfall > 0)
      violations.push({
        ward: ward.name,
        date: dateStr,
        shift: "M",
        role: "supervisor",
        required: mins.min_morning_supervisor,
        actual: mins.min_morning_supervisor - supShortfall,
      });

    demoteExcess(mins.min_morning_nurses, "M", isNurseOrIntern);
    let nurseShortfall = promoteOff(
      mins.min_morning_nurses,
      count("M", isNurseOrIntern),
      "M",
      isNurseOrIntern,
    );
    if (nurseShortfall > 0)
      nurseShortfall = reallocateNightToMorning(
        nurseShortfall,
        isNurseOrIntern,
        mins.min_night_nurses,
      );
    if (nurseShortfall > 0)
      violations.push({
        ward: ward.name,
        date: dateStr,
        shift: "M",
        role: "nurse",
        required: mins.min_morning_nurses,
        actual: mins.min_morning_nurses - nurseShortfall,
      });

    demoteExcess(mins.min_morning_na, "M", isNAType);
    let naShortfall = promoteOff(mins.min_morning_na, count("M", isNAType), "M", isNAType);
    if (naShortfall > 0)
      naShortfall = reallocateNightToMorning(naShortfall, isNAType, mins.min_night_na);
    if (naShortfall > 0)
      violations.push({
        ward: ward.name,
        date: dateStr,
        shift: "M",
        role: "na",
        required: mins.min_morning_na,
        actual: mins.min_morning_na - naShortfall,
      });

    // --- Night enforcement (exact count) ---
    demoteExcess(mins.min_night_supervisor, "N", isWardSupervisor);
    const nSupShortfall = promoteOff(
      mins.min_night_supervisor,
      count("N", isWardSupervisor),
      "N",
      isWardSupervisor,
    );
    if (nSupShortfall > 0)
      violations.push({
        ward: ward.name,
        date: dateStr,
        shift: "N",
        role: "supervisor",
        required: mins.min_night_supervisor,
        actual: mins.min_night_supervisor - nSupShortfall,
      });

    demoteExcess(mins.min_night_nurses, "N", isNurseOrIntern);
    const nNurseShortfall = promoteOff(
      mins.min_night_nurses,
      count("N", isNurseOrIntern),
      "N",
      isNurseOrIntern,
    );
    if (nNurseShortfall > 0)
      violations.push({
        ward: ward.name,
        date: dateStr,
        shift: "N",
        role: "nurse",
        required: mins.min_night_nurses,
        actual: mins.min_night_nurses - nNurseShortfall,
      });

    demoteExcess(mins.min_night_na, "N", isNAType);
    const nNaShortfall = promoteOff(mins.min_night_na, count("N", isNAType), "N", isNAType);
    if (nNaShortfall > 0)
      violations.push({
        ward: ward.name,
        date: dateStr,
        shift: "N",
        role: "na",
        required: mins.min_night_na,
        actual: mins.min_night_na - nNaShortfall,
      });

    // Update cumulative counts and prev-shift map from today's finalized assignments.
    for (const a of dayAssignments) {
      prevDayShift.set(a.nurse_id, a.shift);
      if (a.shift === "M") mCum.set(a.nurse_id, (mCum.get(a.nurse_id) ?? 0) + 1);
      else if (a.shift === "N") nCum.set(a.nurse_id, (nCum.get(a.nurse_id) ?? 0) + 1);
    }
  }

  return { violations, extraPromos };
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
 * Weekend rule  (Sat / Sun): always MWC — morning weekend coverage.
 * Weekday rule: follow HEAD_NURSE_CYCLE [M, M, N, OFF, OFF].
 *   The very first N position each nurse hits in the 28-day period becomes NC
 *   (night coverage); every subsequent N remains a regular N shift.
 */
function scheduleCoverageNurses(
  group: NurseInput[],
  days: number,
  startDate: Date,
  leave: LeaveInput[],
  out: DraftAssignment[],
  phase = 0,
): void {
  const N = group.length;
  if (N === 0) return;
  const cycle = NURSE_CYCLE;
  const len = cycle.length;
  // Track whether each nurse has already received their one NC this period.
  const ncUsed = new Array<boolean>(N).fill(false);

  for (let d = 0; d < days; d++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + d);
    const dateStr = ymd(date);
    const dow = date.getDay(); // 0 = Sun, 6 = Sat
    const isWeekend = dow === 0 || dow === 6;

    for (let i = 0; i < N; i++) {
      if (inLeave(leave, group[i].id, dateStr)) {
        out.push({ nurse_id: group[i].id, ward: null, shift_date: dateStr, shift: "LEAVE" });
        continue;
      }

      let shift: ShiftCode;
      if (isWeekend) {
        shift = "MWC";
      } else {
        const offset = Math.round((i * len) / N) % len;
        const base = cycle[(((d + phase + offset) % len) + len) % len];
        if (base === "N") {
          if (!ncUsed[i]) {
            shift = "NC";
            ncUsed[i] = true;
          } else {
            shift = "N";
          }
        } else {
          shift = base as ShiftCode;
        }
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
    const [, group] = internGroupList[gi];
    const stagger =
      numInternGroups > 1 ? Math.round((gi * NURSE_CYCLE.length) / numInternGroups) : 0;
    for (const intern of group) {
      scheduleGroup(
        [intern],
        NURSE_CYCLE,
        days,
        opts.startDate,
        leave,
        null, // ward = null → bundled with Coverage Nurses card
        out,
        periodOffset + stagger,
      );
      scheduled.add(intern.id);
    }
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

    const supervisors = wardNurses.filter((n) => isWardSupervisor(n.role));
    const regulars = wardNurses.filter((n) => !isNAType(n.role) && !isWardSupervisor(n.role));
    const nas = wardNurses.filter((n) => isNAType(n.role));

    scheduleGroup(
      supervisors,
      NURSE_CYCLE,
      days,
      opts.startDate,
      leave,
      ward.name,
      out,
      periodOffset,
    );
    scheduleGroup(regulars, NURSE_CYCLE, days, opts.startDate, leave, ward.name, out, periodOffset);
    scheduleGroup(nas, NURSE_CYCLE, days, opts.startDate, leave, ward.name, out, periodOffset);

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
