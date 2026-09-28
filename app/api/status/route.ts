import { razorpayConfig } from "@/integrations/razorpay/payment-links";

export const dynamic = "force-dynamic";

export async function GET() {
  const rzp = razorpayConfig();
  return Response.json({
    razorpayMode: rzp.mode,
    razorpayReason: rzp.reason ?? null,
    classifier: process.env.GROQ_API_KEY ? `live (Groq · ${process.env.RESOLVE_LIVE_MODEL ?? "openai/gpt-oss-120b"})` : "demo-lexicon-v1 (deterministic)",
  });
}
