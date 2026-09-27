// Pure business rules (grading, GPA, fees, clearance, registration). No imports: tested by rules.test.ts.

// UGC uniform grading scale (spec §14.2 open question: used as-is).
export const SCALE: [min: number, letter: string, gp: number][] = [
  [80, "A+", 4.0], [75, "A", 3.75], [70, "A-", 3.5], [65, "B+", 3.25], [60, "B", 3.0],
  [55, "B-", 2.75], [50, "C+", 2.5], [45, "C", 2.25], [40, "D", 2.0], [0, "F", 0],
];

export function grade(total: number) {
  const [, letter, gp] = SCALE.find(([min]) => total >= min)!;
  return { letter, gp };
}

// Total out of 100 from assessments: sum of (score / max) * weight. Rounded to 2 dp.
export function courseTotal(parts: { score: number | null; max: number; weight: number }[]) {
  const t = parts.reduce((s, p) => s + ((p.score ?? 0) / p.max) * p.weight, 0);
  return Math.round(t * 100) / 100;
}

// Credit-weighted GPA, 2 dp. Retake rule: caller passes one row per course (latest attempt).
export function gpa(rows: { credits: number; gp: number }[]) {
  const cr = rows.reduce((s, r) => s + r.credits, 0);
  if (!cr) return 0;
  const pts = rows.reduce((s, r) => s + r.credits * Math.round(r.gp * 100), 0);
  return Math.round(pts / cr) / 100;
}

// Paid share of the current semester's charges, after older charges absorb payments first (FIFO).
export function paidRatio(prevCharges: number, currentCharges: number, totalPaid: number) {
  if (currentCharges <= 0) return 1;
  return Math.min(1, Math.max(0, totalPaid - prevCharges) / currentCharges);
}

export type ClearanceInput = {
  prevDue: number; ratio: number; midPct: number; finalPct: number;
  lowAttendance: string[]; exceptions: string[];
};
export function clearance(c: ClearanceInput) {
  const row = (exam: string, ok: boolean, reason: string) =>
    c.exceptions.includes(exam) ? { exam, ok: true, reason: "Exception granted" } : { exam, ok, reason: ok ? "Cleared" : reason };
  return [
    row("registration", c.prevDue <= 0, "Previous semester dues outstanding"),
    row("midterm", c.ratio * 100 >= c.midPct, `Less than ${c.midPct}% of semester fees paid`),
    row("final", c.ratio * 100 >= c.finalPct && c.lowAttendance.length === 0,
      c.ratio * 100 < c.finalPct ? `Less than ${c.finalPct}% of semester fees paid` : `Attendance below threshold: ${c.lowAttendance.join(", ")}`),
  ];
}

// Slot overlap on the same day, times as "HH:MM".
export type Slot = { day: string; start: string; end: string };
export const clash = (a: Slot, b: Slot) => a.day === b.day && a.start < b.end && b.start < a.end;

export function registrationProblems(o: {
  windowOpen: boolean; missingPrereqs: string[]; creditsAfter: number; maxCredits: number;
  clashesWith: string[]; alreadyTaken: boolean;
}) {
  const p: string[] = [];
  if (!o.windowOpen) p.push("Registration window is closed");
  if (o.alreadyTaken) p.push("Already registered in this course");
  if (o.missingPrereqs.length) p.push(`Prerequisite not passed: ${o.missingPrereqs.join(", ")}`);
  if (o.creditsAfter > o.maxCredits) p.push(`Credit limit ${o.maxCredits} exceeded (${o.creditsAfter})`);
  if (o.clashesWith.length) p.push(`Time clash with ${o.clashesWith.join(", ")}`);
  return p;
}

export const pct = (present: number, total: number) => (total ? Math.round((present / total) * 1000) / 10 : 100);
