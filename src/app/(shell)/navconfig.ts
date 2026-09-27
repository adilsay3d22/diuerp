import type { core } from "@/modules/index.ts";
import { comms } from "@/modules/index.ts";

type Item = { href: string; label: string };
export type NavGroup = { label: string; items: Item[] };
const g = (label: string, ...items: [string, string][]): NavGroup => ({ label, items: items.map(([href, l]) => ({ href, label: l })) });

const NAV: Record<core.Role, NavGroup[]> = {
  applicant: [g("Admission", ["/app", "My applications"], ["/notices", "Notices"])],
  driver: [g("Duty", ["/app", "Today's trips"])],
  ta: [g("Teaching", ["/app/sections", "My sections"])],
  admissions_officer: [g("Admission", ["/admin/admissions", "Admission cycles"]), g("Campus", ["/notices", "Notices"])],
  transport_officer: [
    g("Overview", ["/admin/transport", "Transport dashboard"], ["/admin/transport/map", "Live fleet map"]),
    g("Operations", ["/admin/transport/trips", "Trips"], ["/admin/transport/passes", "Passes"], ["/admin/transport/routes", "Routes & stops"], ["/admin/transport/fleet", "Buses & crew"]),
    g("Campus", ["/notices", "Notices"]),
  ],
  student: [
    g("Overview", ["/app", "Dashboard"]),
    g("Academics", ["/app/register", "Course registration"], ["/app/routine", "Class routine"], ["/app/courses", "My courses"], ["/app/attendance", "Attendance"],
      ["/app/exams", "Exams & admit cards"], ["/app/clearance", "Exam clearance"], ["/app/results", "Results"]),
    g("Services", ["/app/services", "Applications & services"], ["/app/fees", "Fees & payments"], ["/app/transport", "Transport"], ["/app/mentor", "Mentor"]),
    g("Campus", ["/app/calendar", "Academic calendar"], ["/notices", "Notices"]),
  ],
  teacher: [
    g("Overview", ["/app", "Dashboard"]),
    g("Teaching", ["/app/sections", "My sections"], ["/app/routine", "Timetable"], ["/app/mentees", "Mentees"], ["/app/evaluations", "My evaluations"]),
    g("Campus", ["/app/calendar", "Academic calendar"], ["/notices", "Notices"]),
  ],
  registrar: [
    g("Semester", ["/admin/registrar", "Course offerings"], ["/admin/registrar/semesters", "Semesters & calendar"]),
    g("Setup", ["/admin/registrar/catalogue", "Programs & courses"], ["/admin/registrar/rooms", "Rooms & time slots"]),
    g("Students", ["/admin/registrar/enroll", "Enroll student"], ["/admin/registrar/import", "Bulk import"], ["/admin/students", "Student records"]),
    g("Campus", ["/notices", "Notices"]),
  ],
  exam_controller: [
    g("Results", ["/admin/exam", "Result publication"], ["/admin/exam/changes", "Grade changes"]),
    g("Exams", ["/admin/exam/schedule", "Exam schedule & seats"], ["/admin/exam/requests", "Service requests"]),
    g("Quality", ["/admin/exam/evaluations", "Teaching evaluations"], ["/admin/exam/mentors", "Mentors"], ["/admin/exam/reports", "Academic reports"]),
    g("Records", ["/admin/students", "Student records"], ["/notices", "Notices"]),
  ],
  dept_head: [g("Department", ["/admin/department", "Department desk"], ["/admin/students", "Student records"]), g("Campus", ["/notices", "Notices"])],
  cashier: [g("Counter", ["/admin/cashier", "Counter"], ["/admin/cashier/shift", "Close shift"])],
  accounts_officer: [
    g("Overview", ["/admin/accounts", "Finance dashboard"], ["/admin/accounts/approvals", "Approvals"]),
    g("Billing", ["/admin/accounts/invoicing", "Invoicing & reminders"], ["/admin/accounts/waivers", "Waivers & scholarships"], ["/admin/accounts/reconcile", "Reconciliation"], ["/admin/accounts/fees", "Fee structures"]),
    g("Records", ["/admin/students", "Student records"], ["/notices", "Notices"]),
  ],
  finance_head: [],
  super_admin: [
    g("Access", ["/admin/system", "Users & roles"], ["/admin/system/settings", "Academic rules"]),
    g("Logs", ["/admin/system/audit", "Audit log"], ["/admin/system/outbox", "Email & SMS log"]),
    g("Campus", ["/notices", "Notices"]),
  ],
};
NAV.finance_head = NAV.accounts_officer;

// Help desk and messages appear for everyone; staff who handle an office also get its queue.
export function navFor(role: core.Role, roles: { role: string; dept_id: number | null }[]): NavGroup[] {
  const handles = comms.officesFor(roles.filter((r) => r.role === role)).length > 0;
  const inbox: Item[] = [
    ...(role === "driver" || role === "applicant" ? [] : [{ href: "/messages", label: "Messages" }]),
    { href: "/helpdesk", label: "Help desk" },
    ...(handles ? [{ href: "/admin/helpdesk", label: "Help desk queue" }] : []),
  ];
  return [...NAV[role], { label: "Inbox", items: inbox }];
}
