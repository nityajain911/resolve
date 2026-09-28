import { createPartPaymentLink, type CreateLinkRequest } from "@/integrations/razorpay/payment-links";

export async function POST(request: Request) {
  const body = (await request.json()) as Partial<CreateLinkRequest>;
  if (!body.invoiceNumber || !body.outstandingAmount || !body.firstMinPartialAmount || !body.customer || !body.planId) {
    return Response.json({ error: "Missing fields" }, { status: 400 });
  }
  if (!(body.firstMinPartialAmount > 0 && body.firstMinPartialAmount < body.outstandingAmount)) {
    return Response.json({ error: "First partial amount must be positive and below the outstanding amount" }, { status: 400 });
  }
  const link = await createPartPaymentLink(body as CreateLinkRequest);
  return Response.json({ link });
}
