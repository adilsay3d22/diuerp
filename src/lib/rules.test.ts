import { test } from "node:test";
import assert from "node:assert/strict";
import { grade, courseTotal, gpa, paidRatio, clearance, clash, registrationProblems } from "./rules.ts";

test("grading scale boundaries", () => {
  assert.deepEqual(grade(80), { letter: "A+", gp: 4 });
  assert.deepEqual(grade(79.99), { letter: "A", gp: 3.75 });
  assert.deepEqual(grade(40), { letter: "D", gp: 2 });
  assert.deepEqual(grade(39.5), { letter: "F", gp: 0 });
});

test("course total weights to 100", () => {
  assert.equal(courseTotal([{ score: 8, max: 10, weight: 20 }, { score: 30, max: 40, weight: 80 }]), 76);
  assert.equal(courseTotal([{ score: null, max: 10, weight: 100 }]), 0);
});

test("gpa is credit weighted, 2dp", () => {
  assert.equal(gpa([{ credits: 3, gp: 4 }, { credits: 1.5, gp: 3.25 }]), 3.75);
  assert.equal(gpa([]), 0);
});

test("payments clear older charges first", () => {
  assert.equal(paidRatio(10000, 40000, 30000), 0.5);
  assert.equal(paidRatio(10000, 40000, 5000), 0);
  assert.equal(paidRatio(0, 40000, 90000), 1);
});

test("clearance", () => {
  const c = clearance({ prevDue: 0, ratio: 0.6, midPct: 50, finalPct: 100, lowAttendance: [], exceptions: [] });
  assert.deepEqual(c.map((r) => r.ok), [true, true, false]);
  const e = clearance({ prevDue: 5, ratio: 1, midPct: 50, finalPct: 100, lowAttendance: ["CSE221"], exceptions: ["registration"] });
  assert.deepEqual(e.map((r) => r.ok), [true, true, false]);
});

test("time clash and registration checks", () => {
  assert.ok(clash({ day: "Sun", start: "08:30", end: "10:00" }, { day: "Sun", start: "09:30", end: "11:00" }));
  assert.ok(!clash({ day: "Sun", start: "08:30", end: "10:00" }, { day: "Sun", start: "10:00", end: "11:30" }));
  assert.equal(registrationProblems({ windowOpen: true, missingPrereqs: [], creditsAfter: 15, maxCredits: 21, clashesWith: [], alreadyTaken: false }).length, 0);
  assert.equal(registrationProblems({ windowOpen: false, missingPrereqs: ["CSE112"], creditsAfter: 24, maxCredits: 21, clashesWith: ["X"], alreadyTaken: false }).length, 4);
});
