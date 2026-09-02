import { NextResponse } from "next/server";
import { ebayApiFetch } from "@/lib/ebay";
import { fetchAllActiveListings } from "@/lib/ebayTrading";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function isAuthorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // no secret configured yet — allow (dev/local)
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

async function syncListings() {
  const db = supabaseAdmin();
  const listings = await fetchAllActiveListings();
  let upserted = 0;
  for (const item of listings) {
    if (!item.itemId) continue;
    const { error } = await db.from("store_listings").upsert(
      {
        ebay_item_id: item.itemId,
        sku: item.sku,
        title: item.title,
        category_id: item.categoryId,
        category_name: item.categoryName,
        price: item.price,
        currency: item.currency ?? "AUD",
        quantity_available: item.quantity,
        quantity_sold: item.quantitySold ?? 0,
        listing_format: item.listingType,
        listing_status: "active",
        watch_count: item.watchCount,
        listing_url: item.listingUrl,
        image_url: item.imageUrl,
        hit_count: item.hitCount,
        listed_at: item.startTime,
        ends_at: item.endTime,
        last_synced_at: new Date().toISOString(),
        raw: item,
      },
      { onConflict: "ebay_item_id" }
    );
    if (!error) upserted += 1;
  }
  return { found: listings.length, upserted };
}

async function syncOrders() {
  const db = supabaseAdmin();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  let offset = 0;
  const limit = 100;
  let total = 0;
  let upserted = 0;

  while (true) {
    const data = await ebayApiFetch(
      `/sell/fulfillment/v1/order?filter=${encodeURIComponent(
        `creationdate:[${since}..]`
      )}&limit=${limit}&offset=${offset}`
    );
    const orders = data.orders ?? [];
    total = data.total ?? orders.length;
    for (const order of orders) {
      const { error } = await db.from("store_orders").upsert(
        {
          ebay_order_id: order.orderId,
          order_status: order.orderFulfillmentStatus,
          buyer_username: order.buyer?.username,
          order_total: order.pricingSummary?.total?.value ? Number(order.pricingSummary.total.value) : null,
          currency: order.pricingSummary?.total?.currency ?? "AUD",
          placed_at: order.creationDate,
          line_items: order.lineItems,
          shipping_status: order.orderFulfillmentStatus,
          last_synced_at: new Date().toISOString(),
          raw: order,
        },
        { onConflict: "ebay_order_id" }
      );
      if (!error) upserted += 1;
    }
    offset += limit;
    if (offset >= total || orders.length === 0) break;
  }
  return { found: total, upserted };
}

// Pulls JDM Kingdom's current listings + last 30 days of orders from eBay
// into Supabase. Wired up as a Vercel Cron target (see vercel.json).
export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const [listings, orders] = await Promise.all([syncListings(), syncOrders()]);
    return NextResponse.json({ ok: true, listings, orders });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
