import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// eBay requires every production keyset to register a Marketplace Account
// Deletion/Closure Notification endpoint. eBay verifies it with a GET
// challenge, then POSTs here whenever a user requests their data be deleted.
// See: https://developer.ebay.com/marketplace-account-deletion

function endpointUrl(req: NextRequest) {
  // Must exactly match the HTTPS URL registered in the eBay Developer Portal.
  return process.env.EBAY_DELETION_ENDPOINT_URL ?? new URL(req.nextUrl.pathname, req.url).toString();
}

export async function GET(req: NextRequest) {
  const challengeCode = req.nextUrl.searchParams.get("challenge_code");
  const verificationToken = process.env.EBAY_VERIFICATION_TOKEN;
  if (!challengeCode || !verificationToken) {
    return NextResponse.json({ error: "missing challenge_code or verification token not configured" }, { status: 400 });
  }
  const hash = createHash("sha256");
  hash.update(challengeCode);
  hash.update(verificationToken);
  hash.update(endpointUrl(req));
  return NextResponse.json({ challengeResponse: hash.digest("hex") });
}

export async function POST(req: NextRequest) {
  const payload = await req.json().catch(() => null);
  if (payload) {
    const db = supabaseAdmin();
    await db.from("ebay_account_deletions").insert({
      notification_id: payload?.notificationId ?? null,
      username: payload?.notification?.data?.username ?? null,
      user_id: payload?.notification?.data?.userId ?? null,
      raw: payload,
    });
  }
  return new NextResponse(null, { status: 200 });
}
