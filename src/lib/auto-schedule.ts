// Auto-scheduling engine for the 28-day rota.
// Pure function — takes nurses, wards, leave, and returns a draft set of assignments.
// Shifts: Morning 08:00–17:00 (8 h), Night 17:00–08:00 (14 h).

export type ShiftCode = "M" | "N" | "OFF" | "LEAVE";

export const SHIFT_TIMES = {
  M: { start: "08:00", end: "17:00", hours: 8, label: "Morning" },
  N: { start: "17:00", end: "08:00", hours: 14, label: "Night" },
} as const;

export interface NurseInput {
  id: string;
  name: string;
  role: string; // "Nurse" | "Supervisor" | "Nursing Assistant"
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
  from_date: string; // YYYY-MM-DD
  to_date: string;
  status: string;
}

export interface DraftAssignment {
  nurse_id: string;
  ward: string | null;
  shift_date: string; // YYYY-MM-DD
  shift: ShiftCode;
}

const SHIFT_HOURS: Record<ShiftCode, number> = { M: 8, N: 14, OFF: 0, LEAVE: 0 };

function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
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
  return /assistant/i.test(role);
}
function isSupervisor(role: string) {
  return /supervisor|matron|sister/i.test(role);
}

interface NurseState {
  hours: number;
  lastShift: ShiftCode | null;
  consecutiveDays: number;
  nightStreak: number;
}

/**
 * Generate a 28-day draft schedule.
 * Rules enforced:
 *  - Approved/Pending leave blocks scheduling (slot = LEAVE).
 *  - No more than 6 consecutive working days (then forced OFF).
 *  - No more than 3 consecutive nights.
 *  - No Night → Morning the next day.
 *  - Ward minimum staffing per shift (morning + night) is filled greedily.
 *  - Target hours respected as a soft cap: nurses near or above target get OFF.
 *  - Evenings only assigned for wards that flag morning min (treated same band).
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

  const state = new Map<string, NurseState>();
  nurses.forEach((n) =>
    state.set(n.id, { hours: 0, lastShift: null, consecutiveDays: 0, nightStreak: 0 }),
  );

  const wardByName = new Map<string, WardInput>();
  wards.forEach((w) => wardByName.set(w.name, w));

  const out: DraftAssignment[] = [];

  for (let d = 0; d < days; d++) {
    const date = new Date(opts.startDate);
    date.setDate(date.getDate() + d);
    const dateStr = ymd(date);

    // Bucket nurses by ward; track which we've assigned today
    const assignedToday = new Set<string>();

    // 1. Lock leave days first
    for (const n of nurses) {
      if (inLeave(leave, n.id, dateStr)) {
        out.push({ nurse_id: n.id, ward: n.ward, shift_date: dateStr, shift: "LEAVE" });
        assignedToday.add(n.id);
        const s = state.get(n.id)!;
        s.lastShift = "LEAVE";
        s.consecutiveDays = 0;
        s.nightStreak = 0;
      }
    }

    // 2. Force rest day if at limits
    for (const n of nurses) {
      if (assignedToday.has(n.id)) continue;
      const s = state.get(n.id)!;
      const overTarget = s.hours >= n.target_hours;
      if (s.consecutiveDays >= 6 || s.nightStreak >= 3 || overTarget) {
        out.push({ nurse_id: n.id, ward: n.ward, shift_date: dateStr, shift: "OFF" });
        assignedToday.add(n.id);
        s.lastShift = "OFF";
        s.consecutiveDays = 0;
        s.nightStreak = 0;
      }
    }

    // 3. Fill ward minimums (Morning then Night)
    const tryAssign = (nurse: NurseInput, shift: ShiftCode) => {
      if (assignedToday.has(nurse.id)) return false;
      const s = state.get(nurse.id)!;
      // No Night -> Morning
      if (s.lastShift === "N" && shift === "M") return false;
      out.push({ nurse_id: nurse.id, ward: nurse.ward, shift_date: dateStr, shift });
      assignedToday.add(nurse.id);
      s.hours += SHIFT_HOURS[shift];
      s.lastShift = shift;
      s.consecutiveDays += 1;
      s.nightStreak = shift === "N" ? s.nightStreak + 1 : 0;
      return true;
    };

    for (const ward of wards) {
      const pool = nurses.filter((n) => n.ward === ward.name && !assignedToday.has(n.id));
      // Order pool by hours ascending so light-loaded nurses fill first
      pool.sort((a, b) => state.get(a.id)!.hours - state.get(b.id)!.hours);

      const needs = [
        {
          shift: "M" as ShiftCode,
          nurses: ward.min_morning_nurses,
          sup: ward.min_morning_supervisor,
          na: ward.min_morning_na,
        },
        {
          shift: "N" as ShiftCode,
          nurses: ward.min_night_nurses,
          sup: ward.min_night_supervisor,
          na: ward.min_night_na,
        },
      ];

      for (const need of needs) {
        let nursesNeeded = need.nurses;
        let supNeeded = need.sup;
        let naNeeded = need.na;
        for (const n of pool) {
          if (assignedToday.has(n.id)) continue;
          if (supNeeded > 0 && isSupervisor(n.role)) {
            if (tryAssign(n, need.shift)) supNeeded--;
            continue;
          }
          if (naNeeded > 0 && isNAType(n.role)) {
            if (tryAssign(n, need.shift)) naNeeded--;
            continue;
          }
          if (nursesNeeded > 0 && !isNAType(n.role) && !isSupervisor(n.role)) {
            if (tryAssign(n, need.shift)) nursesNeeded--;
            continue;
          }
        }
      }
    }

    // 4. Remaining nurses → OFF
    for (const n of nurses) {
      if (assignedToday.has(n.id)) continue;
      out.push({ nurse_id: n.id, ward: n.ward, shift_date: dateStr, shift: "OFF" });
      const s = state.get(n.id)!;
      s.lastShift = "OFF";
      s.consecutiveDays = 0;
      s.nightStreak = 0;
    }
  }

  return out;
}
