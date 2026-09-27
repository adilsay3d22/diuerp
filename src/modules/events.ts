// Domain events (spec §11). In-process; handlers run in order inside the caller's transaction.
// ponytail: no queue; move to BullMQ/outbox when a listener needs retries or runs slow.
export type Events = {
  "applicant.enrolled": { studentId: number; semesterId: number; by: number; applicationId?: number };
  "student.graduated": { studentId: number; by: number };
  "application.submitted": { requestId: number; studentId: number; amount: number; description: string; by: number };
  "pass.requested": { passId: number; studentId: number; semesterId: number; routeId: number; amount: number; by: number };
  "pass.cancelled": { passId: number; studentId: number; semesterId: number; by: number };
  "trip.delayed": { tripId: number; minutes: number; note: string };
  "trip.cancelled": { tripId: number; note: string };
  "enrollment.confirmed": { studentId: number; offeringId: number; by: number };
  "enrollment.dropped": { studentId: number; offeringId: number; by: number };
  "invoice.paid": { studentId?: number; applicationId?: number; paymentId: number };
  "gradesheet.submitted": { offeringId: number; by: number };
  "gradesheet.approved": { offeringId: number; by: number };
  "result.published": { semesterId: number; studentIds: number[]; by: number };
  "attendance.below_threshold": { studentId: number; offeringId: number; percent: number };
};
type Handler<K extends keyof Events> = (p: Events[K]) => void | Promise<void>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const handlers: Record<string, ((p: any) => void | Promise<void>)[]> = {};

export function on<K extends keyof Events>(name: K, h: Handler<K>) {
  (handlers[name] ??= []).push(h);
}
export async function emit<K extends keyof Events>(name: K, payload: Events[K]) {
  for (const h of handlers[name] ?? []) await h(payload);
}
