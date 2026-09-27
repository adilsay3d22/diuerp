import "server-only";
import { redirect } from "next/navigation";
import { requireRole } from "./auth.ts";
import { registrar } from "../modules/index.ts";

export async function studentCtx() {
  const s = await requireRole("student");
  const st = await registrar.studentByUser(s.user.id);
  if (!st) redirect("/login");
  return { s, st, sem: await registrar.currentSemester() };
}

export async function teacherCtx() {
  const s = await requireRole("teacher");
  const t = await registrar.teacherByUser(s.user.id);
  if (!t) redirect("/login");
  return { s, t, sem: await registrar.currentSemester() };
}

// Semester picker value from ?sem=, defaulting to the active semester.
export const pickSemester = async (q: string | string[] | undefined) =>
  await registrar.semester(Number(q)) ?? await registrar.currentSemester();
export const STAFF = ["registrar", "exam_controller", "dept_head", "accounts_officer", "finance_head"] as const;
