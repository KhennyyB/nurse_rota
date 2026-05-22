// Auto-scheduling engine for the 28-day rota.
//
// Nurse/NA cycle (12-day): 3 × Morning → 3 × OFF → 3 × Night → 3 × OFF
//   Each nurse always works in 3-consecutive-shift blocks separated by 3 rest
//   days. Morning and night runs never overlap within the same block.
//
// Supervisor cycle (4-day): 3 × Morning → 1 × OFF
//   Morning-only; one rest day follows every 3-shift run.
//
// Nurses are staggered by step = round(cycleLen / N) so their starting
// positions spread across the full cycle — the ward sees balanced daily
// coverage while each individual nurse follows the same block pattern.

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
// M and N alternate within each work block so no nurse is stuck on one type
// for an entire run. Each 12-day period yields 3M + 3N + 6 OFF.
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

// 4-day block cycle: 3 consecutive mornings → 1 off → repeat.
const SUPERVISOR_CYCLE: readonly ShiftCode[] = ["M", "M", "M", "OFF"];

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

function isNAType(role: string) {
  return /nursing\s*assistant/i.test(role);
}

function isHeadOrSupervisor(role: string) {
  return /head nurse|supervisor|matron|sister/i.test(role);
}

/**
 * Return the shift for nurse index `i` on day `d` given N total nurses.
 *
 * Nurses are staggered by `step = round(cycleLen / N)` positions so their
 * starting points in the cycle spread across the full 7-day period. Each
 * nurse always completes exactly one full cycle every 7 days regardless of N.
 */
function computeShift(i: number, d: number, N: number, cycle: readonly ShiftCode[]): ShiftCode {
  const len = cycle.length;
  const step = Math.max(1, Math.round(len / N));
  return cycle[(i * step + d) % len];
}

/**
 * Schedule a single role group using the 3-shift cycle.
 * Leave days are assigned first; the vacant shift slots are then covered by
 * promoting the nearest OFF nurses to the required shift type.
 */
function scheduleGroup(
  group: NurseInput[],
  cycle: readonly ShiftCode[],
  days: number,
  startDate: Date,
  leave: LeaveInput[],
  wardName: string,
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

    // Pass 1: assign LEAVE and record which shift slots become vacant
    for (let i = 0; i < N; i++) {
      if (inLeave(leave, group[i].id, dateStr)) {
        out.push({ nurse_id: group[i].id, ward: wardName, shift_date: dateStr, shift: "LEAVE" });
        leaveVacancies.push(computeShift(i, d, N, cycle));
        onLeave.add(i);
      }
    }

    let mVac = leaveVacancies.filter((s) => s === "M").length;
    let nVac = leaveVacancies.filter((s) => s === "N").length;

    // Pass 2: rotation shifts for non-leave nurses
    const rotation: { i: number; shift: ShiftCode }[] = [];
    for (let i = 0; i < N; i++) {
      if (onLeave.has(i)) continue;
      rotation.push({ i, shift: computeShift(i, d, N, cycle) });
    }

    // Promote OFF nurses to cover leave vacancies (supervisors never promoted to N
    // because SUPERVISOR_CYCLE never produces N vacancies)
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
 * Generate a 28-day draft schedule.
 *
 * Each ward's nurses are split by role and scheduled via the 7-day cycle
 * (NURSE_CYCLE for nurses/NAs, SUPERVISOR_CYCLE for supervisors).
 * Nurses without a matching primary ward receive OFF (or LEAVE) for every day.
 */
export function generateSchedule(opts: {
  nurses: NurseInput[];
  wards: WardInput[];
  leave: LeaveInput[];
  startDate: Date;
  days?: number;
}): DraftAssignment[] {
  const { nurses, wards, leave } = opts;
  const days = opts.days ?? 28;
  const out: DraftAssignment[] = [];
  const scheduled = new Set<string>();

  for (const ward of wards) {
    // Each nurse is owned by their primary ward (first in the pipe-delimited list).
    const wardNurses = nurses.filter((n) => parseWards(n.ward)[0] === ward.name);

    const supervisors = wardNurses.filter((n) => isHeadOrSupervisor(n.role));
    const regulars = wardNurses.filter((n) => !isNAType(n.role) && !isHeadOrSupervisor(n.role));
    const nas = wardNurses.filter((n) => isNAType(n.role));

    scheduleGroup(supervisors, SUPERVISOR_CYCLE, days, opts.startDate, leave, ward.name, out);
    scheduleGroup(regulars, NURSE_CYCLE, days, opts.startDate, leave, ward.name, out);
    scheduleGroup(nas, NURSE_CYCLE, days, opts.startDate, leave, ward.name, out);

    wardNurses.forEach((n) => scheduled.add(n.id));
  }

  // Nurses with no matching ward get OFF/LEAVE for every day
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
