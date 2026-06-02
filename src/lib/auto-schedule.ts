// Auto-scheduling engine for the 28-day rota.
//
// Nurse/NA cycle (12-day): 3 × Morning → 3 × OFF → 3 × Night → 3 × OFF
// Head Nurse cycle (7-day): M→N→M→N→M→OFF→OFF  (5 on, 2 off, both shifts)
//   Global coverage nurses — not ward-specific, work weekends too.
// Ward Supervisor cycle (4-day): 3 × Morning → 1 × OFF
//   Senior Nurse / Matron / Sister — ward shift leaders, mornings only.
// Intern Nurses: scheduled globally with NURSE_CYCLE, displayed under
//   assigned ward but NOT counted toward ward minimum staffing.

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
// All wards include min_*_supervisor: 1 (experienced nurse as shift leader per shift).
// Applied when facility === "Ikoyi", overriding database ward values.
const IKOYI_WARD_MINIMUMS: Record<string, WardMins> = {
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
  "NICU & SCBU": {
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

// Global Head Nurse: not ward-specific, covers all departments.
export function isGlobalHead(role: string) {
  return /^head\s*nurse$/i.test(role);
}

// Ward-level supervisor / shift leader: Senior Nurse, Experienced Nurse, Matron, Sister.
export function isWardSupervisor(role: string) {
  return (
    !isGlobalHead(role) && /supervisor|matron|sister|senior\s*nurse|experienced\s*nurse/i.test(role)
  );
}

// Kept for callers that still reference the old name.
export function isHeadOrSupervisor(role: string) {
  return isGlobalHead(role) || isWardSupervisor(role);
}

function isNurseOrIntern(role: string) {
  return !isNAType(role) && !isHeadOrSupervisor(role);
}

function computeShift(i: number, d: number, N: number, cycle: readonly ShiftCode[]): ShiftCode {
  const len = cycle.length;
  const step = Math.max(1, Math.round(len / N));
  return cycle[(i * step + d) % len];
}

function scheduleGroup(
  group: NurseInput[],
  cycle: readonly ShiftCode[],
  days: number,
  startDate: Date,
  leave: LeaveInput[],
  wardName: string | null,
  out: DraftAssignment[],
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
        leaveVacancies.push(computeShift(i, d, N, cycle));
        onLeave.add(i);
      }
    }

    let mVac = leaveVacancies.filter((s) => s === "M").length;
    let nVac = leaveVacancies.filter((s) => s === "N").length;

    const rotation: { i: number; shift: ShiftCode }[] = [];
    for (let i = 0; i < N; i++) {
      if (onLeave.has(i)) continue;
      rotation.push({ i, shift: computeShift(i, d, N, cycle) });
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

function enforceMinima(
  out: DraftAssignment[],
  wardNurses: NurseInput[],
  ward: WardInput,
  days: number,
  startDate: Date,
): void {
  const nurseById = new Map(wardNurses.map((n) => [n.id, n]));

  for (let d = 0; d < days; d++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + d);
    const dateStr = ymd(date);

    const dayAssignments = out.filter(
      (a) => a.shift_date === dateStr && nurseById.has(a.nurse_id),
    );

    const countOnShift = (shift: ShiftCode, roleTest: (r: string) => boolean) =>
      dayAssignments.filter(
        (a) => a.shift === shift && roleTest(nurseById.get(a.nurse_id)?.role ?? ""),
      ).length;

    const promote = (
      needed: number,
      current: number,
      targetShift: ShiftCode,
      roleTest: (r: string) => boolean,
    ) => {
      let deficit = needed - current;
      for (const a of dayAssignments) {
        if (deficit <= 0) break;
        if (a.shift !== "OFF") continue;
        const role = nurseById.get(a.nurse_id)?.role ?? "";
        if (roleTest(role)) {
          a.shift = targetShift;
          deficit--;
        }
      }
    };

    promote(
      ward.min_morning_supervisor,
      countOnShift("M", isWardSupervisor),
      "M",
      isWardSupervisor,
    );
    promote(ward.min_morning_nurses, countOnShift("M", isNurseOrIntern), "M", isNurseOrIntern);
    promote(ward.min_morning_na, countOnShift("M", isNAType), "M", isNAType);

    promote(ward.min_night_supervisor, countOnShift("N", isWardSupervisor), "N", isWardSupervisor);
    promote(ward.min_night_nurses, countOnShift("N", isNurseOrIntern), "N", isNurseOrIntern);
    promote(ward.min_night_na, countOnShift("N", isNAType), "N", isNAType);
  }
}

/**
 * Given a list of ward names and an intern's current ward, return the next ward
 * in round-robin rotation. Called by rota.tsx when rotateInterns is enabled.
 */
export function nextInternWard(currentWard: string | null, wardNames: string[]): string | null {
  if (!wardNames.length) return currentWard;
  if (!currentWard) return wardNames[0];
  const idx = wardNames.indexOf(currentWard);
  return wardNames[(idx + 1) % wardNames.length];
}

/**
 * Generate a 28-day draft schedule.
 *
 * - Head Nurses: global, no ward, HEAD_NURSE_CYCLE (5 on/2 off, M+N).
 * - Intern Nurses: global, NURSE_CYCLE, ward shown for display only (not in ward minimums).
 * - Ward Supervisors (Senior/Experienced Nurse, Matron, Sister): SUPERVISOR_CYCLE, mornings.
 * - Regular Nurses + NAs: NURSE_CYCLE, ward-specific.
 * - Ikoyi facility: IKOYI_WARD_MINIMUMS override DB ward values.
 */
export function generateSchedule(opts: {
  nurses: NurseInput[];
  wards: WardInput[];
  leave: LeaveInput[];
  startDate: Date;
  days?: number;
  facility?: string;
}): DraftAssignment[] {
  const { nurses, wards, leave } = opts;
  const days = opts.days ?? 28;
  const facility = opts.facility ?? "";
  const out: DraftAssignment[] = [];
  const scheduled = new Set<string>();

  // 1. Global Head Nurses — ward = null (general coverage across all departments)
  const headNurses = nurses.filter((n) => isGlobalHead(n.role));
  scheduleGroup(headNurses, HEAD_NURSE_CYCLE, days, opts.startDate, leave, null, out);
  headNurses.forEach((n) => scheduled.add(n.id));

  // 2. Intern Nurses — grouped by assigned ward for display; NOT in ward minimums
  const interns = nurses.filter((n) => isInternType(n.role));
  const internsByWard = new Map<string | null, NurseInput[]>();
  for (const intern of interns) {
    const ward = parseWards(intern.ward)[0] ?? null;
    const group = internsByWard.get(ward) ?? [];
    group.push(intern);
    internsByWard.set(ward, group);
  }
  for (const [ward, group] of internsByWard) {
    scheduleGroup(group, NURSE_CYCLE, days, opts.startDate, leave, ward, out);
    group.forEach((n) => scheduled.add(n.id));
  }

  // 3. Per-ward scheduling (supervisors, regulars, NAs)
  // For Ikoyi: Senior Nurses use NURSE_CYCLE (both M + N) so they lead every shift.
  // For all other facilities: Senior Nurses use SUPERVISOR_CYCLE (mornings only).
  const supervisorCycle = facility === "Ikoyi" ? NURSE_CYCLE : SUPERVISOR_CYCLE;

  for (const ward of wards) {
    // Always use DB ward values — the Ikoyi wards are seeded into the DB from
    // IKOYI_WARD_MINIMUMS and are editable there. No hardcoded override is applied.
    const effectiveWard: WardInput = ward;

    const wardNurses = nurses.filter(
      (n) => parseWards(n.ward)[0] === ward.name && !isGlobalHead(n.role) && !isInternType(n.role),
    );

    const supervisors = wardNurses.filter((n) => isWardSupervisor(n.role));
    const regulars = wardNurses.filter((n) => !isNAType(n.role) && !isWardSupervisor(n.role));
    const nas = wardNurses.filter((n) => isNAType(n.role));

    scheduleGroup(supervisors, supervisorCycle, days, opts.startDate, leave, ward.name, out);
    scheduleGroup(regulars, NURSE_CYCLE, days, opts.startDate, leave, ward.name, out);
    scheduleGroup(nas, NURSE_CYCLE, days, opts.startDate, leave, ward.name, out);

    enforceMinima(out, wardNurses, effectiveWard, days, opts.startDate);
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

  return out;
}
