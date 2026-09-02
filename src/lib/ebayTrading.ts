import { XMLParser } from "fast-xml-parser";
import { getUserAccessToken } from "./ebay";

// The modern Sell Inventory/Offer REST APIs only manage listings created
// through them. JDM Kingdom's existing store listings were created the
// normal way through eBay, so pulling the *current* live catalog requires
// the legacy Trading API (XML) instead. Orders use the modern Fulfillment
// REST API just fine (see ebay.ts / sync-store route) since that endpoint
// covers all orders regardless of how the item was listed.

const SITE_ID = process.env.EBAY_SITE_ID ?? "15"; // 15 = Australia

function tradingApiHost() {
  return process.env.EBAY_ENV === "production"
    ? "https://api.ebay.com/ws/api.dll"
    : "https://api.sandbox.ebay.com/ws/api.dll";
}

async function callTradingApi(callName: string, bodyXml: string) {
  const token = await getUserAccessToken();
  const res = await fetch(tradingApiHost(), {
    method: "POST",
    headers: {
      "Content-Type": "text/xml",
      "X-EBAY-API-COMPATIBILITY-LEVEL": "1207",
      "X-EBAY-API-CALL-NAME": callName,
      "X-EBAY-API-SITEID": SITE_ID,
      "X-EBAY-API-IAF-TOKEN": token,
    },
    body: bodyXml,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Trading API ${callName} failed: ${res.status} ${text}`);
  }
  const parser = new XMLParser({ ignoreAttributes: false });
  const parsed = parser.parse(text);
  const root = parsed[`${callName}Response`];
  if (root?.Ack === "Failure") {
    throw new Error(`Trading API ${callName} error: ${JSON.stringify(root.Errors)}`);
  }
  return root;
}

export type SellerListItem = {
  itemId: string;
  sku?: string;
  title: string;
  categoryId?: string;
  categoryName?: string;
  price?: number;
  currency?: string;
  quantity?: number;
  quantitySold?: number;
  listingType?: string;
  watchCount?: number;
  hitCount?: number;
  startTime?: string;
  endTime?: string;
  listingUrl?: string;
  imageUrl?: string;
};

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function num(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  const n = typeof value === "object" && value !== null && "#text" in (value as any)
    ? Number((value as any)["#text"])
    : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function text(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "object" && "#text" in (value as any)) return String((value as any)["#text"]);
  return String(value);
}

// Fetches every currently active listing in JDM Kingdom's store, paginating
// through Trading API's GetSellerList. Uses an end-time window (rather than
// start-time) so long-running Good-Til-Cancelled listings are still caught.
export async function fetchAllActiveListings(): Promise<SellerListItem[]> {
  const now = new Date();
  const endTo = new Date(now.getTime() + 119 * 24 * 60 * 60 * 1000);
  const items: SellerListItem[] = [];
  let page = 1;
  const entriesPerPage = 200;

  while (true) {
    const bodyXml = `<?xml version="1.0" encoding="utf-8"?>
<GetSellerListRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ErrorLanguage>en_US</ErrorLanguage>
  <WarningLevel>High</WarningLevel>
  <EndTimeFrom>${now.toISOString()}</EndTimeFrom>
  <EndTimeTo>${endTo.toISOString()}</EndTimeTo>
  <GranularityLevel>Fine</GranularityLevel>
  <IncludeWatchCount>true</IncludeWatchCount>
  <Pagination>
    <EntriesPerPage>${entriesPerPage}</EntriesPerPage>
    <PageNumber>${page}</PageNumber>
  </Pagination>
</GetSellerListRequest>`;

    const root = await callTradingApi("GetSellerList", bodyXml);
    const rawItems = toArray<any>(root?.ItemArray?.Item);
    for (const item of rawItems) {
      items.push({
        itemId: text(item.ItemID) ?? "",
        sku: text(item.SKU),
        title: text(item.Title) ?? "",
        categoryId: text(item.PrimaryCategory?.CategoryID),
        categoryName: text(item.PrimaryCategory?.CategoryName),
        price: num(item.SellingStatus?.CurrentPrice),
        currency: text(item.SellingStatus?.CurrentPrice?.["@_currencyID"]),
        quantity: num(item.Quantity),
        quantitySold: num(item.SellingStatus?.QuantitySold),
        listingType: text(item.ListingType),
        watchCount: num(item.WatchCount),
        hitCount: num(item.HitCount),
        startTime: text(item.ListingDetails?.StartTime),
        endTime: text(item.ListingDetails?.EndTime),
        listingUrl: text(item.ListingDetails?.ViewItemURL),
        imageUrl: text(item.PictureDetails?.GalleryURL),
      });
    }

    const hasMore = text(root?.HasMoreItems) === "true";
    if (!hasMore) break;
    page += 1;
    if (page > 50) break; // safety cap (10k listings) against a runaway loop
  }

  return items;
}
