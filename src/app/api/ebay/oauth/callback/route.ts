import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForToken } from "@/lib/ebay";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const error = req.nextUrl.searchParams.get("error");
  if (error) {
    return NextResponse.redirect(new URL(`/?ebay_error=${encodeURIComponent(error)}`, req.url));
  }
  if (!code) {
    return NextResponse.redirect(new URL("/?ebay_error=missing_code", req.url));
  }
  await exchangeCodeForToken(code);
  return NextResponse.redirect(new URL("/?connected=1", req.url));
}
