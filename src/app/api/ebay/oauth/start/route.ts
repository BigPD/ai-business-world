import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { buildAuthorizeUrl } from "@/lib/ebay";

export const dynamic = "force-dynamic";

// Visiting this URL kicks off eBay's "Sign in with eBay" consent flow for
// the JDM Kingdom seller account. On approval eBay redirects back to
// /api/ebay/oauth/callback with an authorization code.
export async function GET() {
  const state = randomBytes(16).toString("hex");
  return NextResponse.redirect(buildAuthorizeUrl(state));
}
