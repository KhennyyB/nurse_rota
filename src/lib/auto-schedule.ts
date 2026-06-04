// Auto-scheduling engine for the 28-day rota.
//
// Nurse/NA cycle (12-day): M→N→M→OFF→OFF→OFF→N→M→N→OFF→OFF→OFF
// Head Nurse cycle (7-day): M→N→M→N→M→OFF→OFF  (5 on, 2 off, both shifts)
// Ward Supervisor cycle (4-day): M→M→M→OFF  (mornings only, non-Ikoyi)
// Intern Nurses: NURSE_CYCLE, one per ward, phases staggered so off-days
//   never fall on the same day across wards.

export type ShiftCode = "M" | "N" | "OFF" | "LEAVE";

export const SHIFT_TIMES = {
  M: { start: "08:00", end: "17:00", hours: 8, label: "Morning" },
  N: { start: "17:00", end: "08:00", hours: 14, label: "Night" },
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

// 12-day block cycle: 3 mixed shifts → 3 off → 3 mixed shifts → 3 off.
const NURSE_CYCLE: readonly ShiftCode[] = [
  "M",
  "N",
  "M",
  "OFF",
  "OFF",
  "OFF",
  "N",
  "M",
  "N",
  "OFF",
  "OFF",
  "OFF",
];

// 7-day cycle for Head Nurses: 5 working days (M + N), 2 rest.
const HEAD_NURSE_CYCLE: readonly ShiftCode[] = ["M", "N", "M", "N", "M", "OFF", "OFF"];

// 4-day block cycle for ward supervisors (shift leaders): 3 mornings → 1 off.
const SUPERVISOR_CYCLE: readonly ShiftCode[] = ["M", "M", "M", "OFF"];

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
    min_morning_supervisor: 1,
    min_morning_na: 3,
    min_night_nurses: 5,
    min_night_supervisor: 1,
    min_night_na: 2,
  },
  ER: {
    min_morning_nurses: 1,
    min_morning_supervisor: 1,
    min_morning_na: 1,
    min_night_nurses: 1,
    min_night_supervisor: 1,
    min_night_na: 1,
  },
  ICU: {
    min_morning_nurses: 5,
    min_morning_supervisor: 1,
    min_morning_na: 2,
    min_night_nurses: 5,
    min_night_supervisor: 1,
    min_night_na: 2,
  },
  "Operation Theatre": {
    min_morning_nurses: 6,
    min_morning_supervisor: 1,
    min_morning_na: 2,
    min_night_nurses: 1,
    min_night_supervisor: 1,
    min_night_na: 1,
  },
  NICU: {
    min_morning_nurses: 4,
    min_morning_supervisor: 1,
    min_morning_na: 1,
    min_night_nurses: 3,
    min_night_supervisor: 1,
    min_night_na: 1,
  },
  SCBU: {
    min_morning_nurses: 4,
    min_morning_supervisor: 1,
    min_morning_na: 1,
    min_night_nurses: 3,
    min_night_supervisor: 1,
    min_night_na: 1,
  },
  GOPD: {
    min_morning_nurses: 4,
    min_morning_supervisor: 1,
    min_morning_na: 4,
    min_night_nurses: 0,
    min_night_supervisor: 0,
    min_night_na: 0,
  },
  "Labour Ward": {
    min_morning_nurses: 1,
    min_morning_supervisor: 1,
    min_morning_na: 0,
    min_night_nurses: 1,
    min_night_supervisor: 1,
    min_night_na: 0,
  },
  Dialysis: {
    min_morning_nurses: 2,
    min_morning_supervisor: 1,
    min_morning_na: 0,
    min_night_nurses: 0,
    min_night_supervisor: 0,
    min_night_na: 0,
  },
  Oncology: {
    min_morning_nurses: 1,
    min_morning_supervisor: 1,
    min_morning_na: 0,
    min_night_nurses: 0,
    min_night_supervisor: 0,
    min_night_na: 0,
  },
};

export const IKOYI_WARD_NAMES = Object.keys(IKOYI_WARD_MINIMUMS);

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
  return /nursing\s*assistant/i.test(role);
}

export function isInternType(role: string) {
  return /nurse\s*intern|intern\s*nurse/i.test(role);
}

export function isGlobalHead(role: string) {
  return /^head\s*nurse$/i.test(role);
}

export function isWardSupervisor(role: string) {
  return (
    !isGlobalHead(role) && /supervisor|matron|sister|senior\s*nurse|experienced\s*nurse/i.test(role)
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
  const step = Math.max(1, Math.round(len / N));
  return cycle[(((i * step + d) % len) + len) % len];
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
      rotation.push({ i, shift: computeShift(i, d + phase, N, cycle) });
    }

    for (const r of rotation) {
      if (r.shift !== "OFF") continue;
      if (mVac > 0) {
        r.shift = "M";
        mVac--;
      } else if (nVac > 0 && !isHeadOrSupervisor(group[r.i].role)) {
        r.shift = "N";
        nVac--;
      }
      if (!mVac && !nVac) break;
    }

    for (const r of rotation) {
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
): SafetyViolation[] {
  const nurseById = new Map(wardNurses.map((n) => [n.id, n]));
  const violations: SafetyViolation[] = [];

  for (let d = 0; d < days; d++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + d);
    const dateStr = ymd(date);

    const dayAssignments = out.filter((a) => a.shift_date === dateStr && nurseById.has(a.nurse_id));

    const count = (shift: ShiftCode, roleTest: (r: string) => boolean) =>
      dayAssignments.filter(
        (a) => a.shift === shift && roleTest(nurseById.get(a.nurse_id)?.role ?? ""),
      ).length;

    // Promote OFF → targetShift for matching role, return shortfall remaining.
    const promoteOff = (
      needed: number,
      current: number,
      target: ShiftCode,
      roleTest: (r: string) => boolean,
    ) => {
      let deficit = needed - current;
      for (const a of dayAssignments) {
        if (deficit <= 0) break;
        if (a.shift !== "OFF") continue;
        if (roleTest(nurseById.get(a.nurse_id)?.role ?? "")) {
          a.shift = target;
          deficit--;
        }
      }
      return Math.max(0, deficit);
    };

    // Reallocate Night → Morning (last resort when morning is short but night is over minimum).
    const reallocateNightToMorning = (
      deficit: number,
      roleTest: (r: string) => boolean,
      nightMin: number,
    ) => {
      const nightCount = count("N", roleTest);
      const surplus = nightCount - nightMin; // how many night nurses we can afford to move
      const movable = Math.min(deficit, Math.max(0, surplus));
      let moved = 0;
      for (const a of dayAssignments) {
        if (moved >= movable) break;
        if (a.shift !== "N") continue;
        if (roleTest(nurseById.get(a.nurse_id)?.role ?? "")) {
          a.shift = "M";
          moved++;
        }
      }
      return deficit - moved;
    };

    // --- Morning enforcement ---
    let supShortfall = promoteOff(
      ward.min_morning_supervisor,
      count("M", isWardSupervisor),
      "M",
      isWardSupervisor,
    );
    if (supShortfall > 0)
      supShortfall = reallocateNightToMorning(
        supShortfall,
        isWardSupervisor,
        ward.min_night_supervisor,
      );
    if (supShortfall > 0)
      violations.push({
        ward: ward.name,
        date: dateStr,
        shift: "M",
        role: "supervisor",
        required: ward.min_morning_supervisor,
        actual: ward.min_morning_supervisor - supShortfall,
      });

    let nurseShortfall = promoteOff(
      ward.min_morning_nurses,
      count("M", isNurseOrIntern),
      "M",
      isNurseOrIntern,
    );
    if (nurseShortfall > 0)
      nurseShortfall = reallocateNightToMorning(
        nurseShortfall,
        isNurseOrIntern,
        ward.min_night_nurses,
      );
    if (nurseShortfall > 0)
      violations.push({
        ward: ward.name,
        date: dateStr,
        shift: "M",
        role: "nurse",
        required: ward.min_morning_nurses,
        actual: ward.min_morning_nurses - nurseShortfall,
      });

    let naShortfall = promoteOff(ward.min_morning_na, count("M", isNAType), "M", isNAType);
    if (naShortfall > 0)
      naShortfall = reallocateNightToMorning(naShortfall, isNAType, ward.min_night_na);
    if (naShortfall > 0)
      violations.push({
        ward: ward.name,
        date: dateStr,
        shift: "M",
        role: "na",
        required: ward.min_morning_na,
        actual: ward.min_morning_na - naShortfall,
      });

    // --- Night enforcement ---
    const nSupShortfall = promoteOff(
      ward.min_night_supervisor,
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
        required: ward.min_night_supervisor,
        actual: ward.min_night_supervisor - nSupShortfall,
      });

    const nNurseShortfall = promoteOff(
      ward.min_night_nurses,
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
        required: ward.min_night_nurses,
        actual: ward.min_night_nurses - nNurseShortfall,
      });

    const nNaShortfall = promoteOff(ward.min_night_na, count("N", isNAType), "N", isNAType);
    if (nNaShortfall > 0)
      violations.push({
        ward: ward.name,
        date: dateStr,
        shift: "N",
        role: "na",
        required: ward.min_night_na,
        actual: ward.min_night_na - nNaShortfall,
      });
  }

  return violations;
}

export function nextInternWard(currentWard: string | null, wardNames: string[]): string | null {
  if (!wardNames.length) return currentWard;
  if (!currentWard) return wardNames[0];
  const idx = wardNames.indexOf(currentWard);
  return wardNames[(idx + 1) % wardNames.length];
}

export interface ScheduleResult {
  assignments: DraftAssignment[];
  violations: SafetyViolation[];
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
}): ScheduleResult {
  const { nurses, wards, leave } = opts;
  const days = opts.days ?? 28;
  const facility = opts.facility ?? "";
  const out: DraftAssignment[] = [];
  const scheduled = new Set<string>();
  const allViolations: SafetyViolation[] = [];

  // 1. Global Head Nurses
  const headNurses = nurses.filter((n) => isGlobalHead(n.role));
  scheduleGroup(headNurses, HEAD_NURSE_CYCLE, days, opts.startDate, leave, null, out);
  headNurses.forEach((n) => scheduled.add(n.id));

  // 2. Intern Nurses — one per ward, phases spread evenly across the cycle so
  //    no two wards share the same off-days.
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
    const [ward, group] = internGroupList[gi];
    // Distribute phases so interns in different wards start at different cycle
    // positions — prevents all interns being off on the same days.
    const phase = numInternGroups > 1 ? Math.round((gi * NURSE_CYCLE.length) / numInternGroups) : 0;
    scheduleGroup(group, NURSE_CYCLE, days, opts.startDate, leave, ward, out, phase);
    group.forEach((n) => scheduled.add(n.id));
  }

  // 3. Per-ward scheduling (supervisors, regulars, NAs) + safety rule enforcement
  const supervisorCycle = facility === "Ikoyi" ? NURSE_CYCLE : SUPERVISOR_CYCLE;

  for (const ward of wards) {
    const wardNurses = nurses.filter(
      (n) => parseWards(n.ward)[0] === ward.name && !isGlobalHead(n.role) && !isInternType(n.role),
    );

    const supervisors = wardNurses.filter((n) => isWardSupervisor(n.role));
    const regulars = wardNurses.filter((n) => !isNAType(n.role) && !isWardSupervisor(n.role));
    const nas = wardNurses.filter((n) => isNAType(n.role));

    scheduleGroup(supervisors, supervisorCycle, days, opts.startDate, leave, ward.name, out);
    scheduleGroup(regulars, NURSE_CYCLE, days, opts.startDate, leave, ward.name, out);
    scheduleGroup(nas, NURSE_CYCLE, days, opts.startDate, leave, ward.name, out);

    // Only validate safety rules for wards that have staff in this run.
    // If wardNurses is empty (e.g. generating only for IP Ward, so ER has
    // no nurses here), we skip enforcement — it would always report violations
    // of every minimum since there is literally nobody scheduled.
    if (wardNurses.length > 0) {
      const wardViolations = enforceMinima(out, wardNurses, ward, days, opts.startDate);
      allViolations.push(...wardViolations);
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

  return { assignments: out, violations: allViolations };
}
