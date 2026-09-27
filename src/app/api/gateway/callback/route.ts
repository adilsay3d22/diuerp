import { finance } from "@/modules/index.ts";

// Payment provider callback (IPN). The provider POSTs the outcome signed with the shared secret;
// completeGateway verifies the signature and amount and is idempotent, so retries never double-credit (NFR-7).
export async function POST(req: Request) {
  const fd = await req.formData();
  const get = (k: string) => String(fd.get(k) ?? "");
  const token = get("token");
  const session = await finance.gatewaySession(token);
  const back = (params: string) => new Response(null, { status: 303, headers: { Location: `${session?.return_to ?? "/"}${session?.return_to.includes("?") ? "&" : "?"}${params}` } });
  try {
    const r = await finance.completeGateway(token, get("status"), Number(get("amount")), get("txn_id"), get("signature"));
    return r.status === "paid" ? back(`ok=${encodeURIComponent(`Payment successful. Receipt ${r.receipt}`)}`) : back(`err=${encodeURIComponent("Payment cancelled. Nothing was charged.")}`);
  } catch (e) {
    return back(`err=${encodeURIComponent((e as Error).message)}`);
  }
}
