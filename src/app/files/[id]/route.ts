import { loadFile } from "@/lib/storage.ts";
import { getSession } from "@/lib/auth.ts";
import { get } from "@/lib/db.ts";
import { comms } from "@/modules/index.ts";

// Materials: anyone in the section (or its teacher). Submissions: the uploader or the section's teacher.
export async function GET(_req: Request, ctx: RouteContext<"/files/[id]">) {
  const s = await getSession();
  if (!s) return new Response("Sign in required", { status: 401 });
  const id = Number((await ctx.params).id);
  const file = await get<{ path: string; name: string; type: string; uploaded_by: number }>("SELECT * FROM files WHERE id = ?", id);
  if (!file) return new Response("Not found", { status: 404 });
  const offering =
    await get<{ offering_id: number }>("SELECT offering_id FROM materials WHERE file_id = ?", id) ??
    await get<{ offering_id: number }>("SELECT a.offering_id FROM submissions sb JOIN assessments a ON a.id = sb.assessment_id WHERE sb.file_id = ?", id);
  const isMaterial = !!(await get("SELECT 1 FROM materials WHERE file_id = ?", id));
  const teaches = !!offering && !!(await get("SELECT 1 FROM offerings o JOIN teachers t ON t.id = o.teacher_id WHERE o.id = ? AND t.user_id = ?", offering.offering_id, s.user.id));
  const enrolled = !!offering && !!(await get("SELECT 1 FROM enrollments e JOIN students st ON st.id = e.student_id WHERE e.offering_id = ? AND st.user_id = ? AND e.status IN ('confirmed','completed')", offering.offering_id, s.user.id));
  const officer = async (role: string, table: string) =>
    s.roles.some((r) => r.role === role) && !!(await get(`SELECT 1 FROM ${table} WHERE file_id = ?`, id));
  // Help desk attachments: the requester and the office handling the ticket
  const t = await get<{ ticket_id: number }>("SELECT ticket_id FROM ticket_messages WHERE file_id = ?", id);
  const ticket = t ? await comms.ticket(t.ticket_id) : undefined;
  const onTicket = !!ticket && !!comms.canSeeTicket(s.user.id, s.roles, ticket);
  // Mentor meeting files: the student and the mentor
  const meeting = !!(await get(`SELECT 1 FROM mentor_meetings m JOIN students st ON st.id = m.student_id JOIN teachers te ON te.id = m.teacher_id
    WHERE m.file_id = ? AND (st.user_id = ? OR te.user_id = ?)`, id, s.user.id, s.user.id));
  const allowed = file.uploaded_by === s.user.id || teaches || (isMaterial && enrolled) || onTicket || meeting
    || await officer("admissions_officer", "application_docs") || await officer("registrar", "application_docs") || await officer("transport_officer", "trip_reports")
    || await officer("exam_controller", "question_papers") || await officer("accounts_officer", "scholarship_apps") || await officer("finance_head", "scholarship_apps");
  // TCH-U-11: question papers stay with the Exam Controller and the uploader, even for other teachers of the section
  if (await get("SELECT 1 FROM question_papers WHERE file_id = ?", id) && !(await officer("exam_controller", "question_papers")) && file.uploaded_by !== s.user.id)
    return new Response("Forbidden", { status: 403 });
  if (!allowed) return new Response("Forbidden", { status: 403 });
  const body = await loadFile(file.path);
  if (!body) return new Response("This file is no longer stored.", { status: 404 });
  return new Response(body, {
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${file.name.replace(/[^\w.\- ]/g, "_")}"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
