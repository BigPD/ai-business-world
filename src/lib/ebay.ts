import { supabaseAdmin } from "./supabase";

type EbayEnv = "sandbox" | "production";

function env(): EbayEnv {
  return process.env.EBAY_ENV === "production" ? "production" : "sandbox";
}

function creds() {
  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;
  const ruName = process.env.EBAY_RU_NAME;
  if (!clientId || !clientSecret || !ruName) {
    throw new Error("EBAY_CLIENT_ID / EBAY_CLIENT_SECRET / EBAY_RU_NAME are not configured");
  }
  return { clientId, clientSecret, ruName };
}

const HOSTS: Record<EbayEnv, { auth: string; api: string }> = {
  sandbox: { auth: "https://auth.sandbox.ebay.com", api: "https://api.sandbox.ebay.com" },
  production: { auth: "https://auth.ebay.com", api: "https://api.ebay.com" },
};

// User-consent scopes: everything the store-sync + listing-management flows need.
export const USER_SCOPES = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.account",
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
  "https://api.ebay.com/oauth/api_scope/sell.analytics.readonly",
  "https://api.ebay.com/oauth/api_scope/sell.marketing",
];

// App-only scope: enough for public Browse API calls (market/trend research), no user login needed.
const APP_SCOPE = "https://api.ebay.com/oauth/api_scope";

function basicAuthHeader() {
  const { clientId, clientSecret } = creds();
  return "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
}

export function buildAuthorizeUrl(state: string) {
  const { clientId, ruName } = creds();
  const url = new URL(`${HOSTS[env()].auth}/oauth2/authorize`);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", ruName);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", USER_SCOPES.join(" "));
  url.searchParams.set("state", state);
  return url.toString();
}

async function persistUserToken(tokens: {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  refresh_token_expires_in?: number;
}) {
  const db = supabaseAdmin();
  const now = Date.now();
  const update: Record<string, unknown> = {
    environment: env(),
    access_token: tokens.access_token,
    access_token_expires_at: new Date(now + tokens.expires_in * 1000).toISOString(),
    scopes: USER_SCOPES,
    updated_at: new Date().toISOString(),
  };
  if (tokens.refresh_token) {
    update.refresh_token = tokens.refresh_token;
  }
  if (tokens.refresh_token_expires_in) {
    update.refresh_token_expires_at = new Date(
      now + tokens.refresh_token_expires_in * 1000
    ).toISOString();
  }
  const { error } = await db.from("ebay_tokens").upsert(update, { onConflict: "environment" });
  if (error) throw error;
}

export async function exchangeCodeForToken(code: string) {
  const { ruName } = creds();
  const res = await fetch(`${HOSTS[env()].api}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: basicAuthHeader(),
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: ruName,
    }),
  });
  if (!res.ok) {
    throw new Error(`eBay token exchange failed: ${res.status} ${await res.text()}`);
  }
  const tokens = await res.json();
  await persistUserToken(tokens);
  return tokens;
}

async function refreshUserToken(refreshToken: string) {
  const res = await fetch(`${HOSTS[env()].api}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: basicAuthHeader(),
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      scope: USER_SCOPES.join(" "),
    }),
  });
  if (!res.ok) {
    throw new Error(`eBay token refresh failed: ${res.status} ${await res.text()}`);
  }
  const tokens = await res.json();
  await persistUserToken(tokens);
  return tokens.access_token as string;
}

// Returns a valid user access token for JDM Kingdom's connected seller account,
// refreshing it first if it's expired or close to expiring.
export async function getUserAccessToken() {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("ebay_tokens")
    .select("access_token, refresh_token, access_token_expires_at")
    .eq("environment", env())
    .maybeSingle();
  if (error) throw error;
  if (!data?.refresh_token) {
    throw new Error("No eBay account connected yet — visit /api/ebay/oauth/start to connect JDM Kingdom.");
  }
  const expiresAt = data.access_token_expires_at ? new Date(data.access_token_expires_at).getTime() : 0;
  if (data.access_token && expiresAt - Date.now() > 60_000) {
    return data.access_token as string;
  }
  return refreshUserToken(data.refresh_token);
}

// App-level (client credentials) token — no seller login required, used for
// public market-research calls like the Browse API.
let cachedAppToken: { token: string; expiresAt: number } | null = null;

export async function getAppAccessToken() {
  if (cachedAppToken && cachedAppToken.expiresAt - Date.now() > 60_000) {
    return cachedAppToken.token;
  }
  const res = await fetch(`${HOSTS[env()].api}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: basicAuthHeader(),
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: APP_SCOPE,
    }),
  });
  if (!res.ok) {
    throw new Error(`eBay app token request failed: ${res.status} ${await res.text()}`);
  }
  const tokens = await res.json();
  cachedAppToken = { token: tokens.access_token, expiresAt: Date.now() + tokens.expires_in * 1000 };
  return cachedAppToken.token;
}

export async function ebayApiFetch(
  path: string,
  init: RequestInit & { asUser?: boolean } = {}
) {
  const { asUser = true, ...rest } = init;
  const token = asUser ? await getUserAccessToken() : await getAppAccessToken();
  const res = await fetch(`${HOSTS[env()].api}${path}`, {
    ...rest,
    headers: {
      ...rest.headers,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`eBay API ${path} failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

// Every published listing must reference an existing shipping/payment/
// return policy on the seller's account — fetch the seller's default ones
// so new listings inherit whatever they already use.
export async function getDefaultBusinessPolicies() {
  const [fulfillment, payment, returns] = await Promise.all([
    ebayApiFetch("/sell/account/v1/fulfillment_policy?marketplace_id=EBAY_AU"),
    ebayApiFetch("/sell/account/v1/payment_policy?marketplace_id=EBAY_AU"),
    ebayApiFetch("/sell/account/v1/return_policy?marketplace_id=EBAY_AU"),
  ]);
  const fulfillmentPolicyId = fulfillment.fulfillmentPolicies?.[0]?.fulfillmentPolicyId;
  const paymentPolicyId = payment.paymentPolicies?.[0]?.paymentPolicyId;
  const returnPolicyId = returns.returnPolicies?.[0]?.returnPolicyId;
  if (!fulfillmentPolicyId || !paymentPolicyId || !returnPolicyId) {
    throw new Error(
      "No default shipping/payment/return policy found on this eBay account — set these up in Seller Hub first."
    );
  }
  return { fulfillmentPolicyId, paymentPolicyId, returnPolicyId };
}

// Publishes a draft as a real, live eBay listing via the Inventory API
// (create item -> create offer -> publish offer). Requires the seller's
// merchant location key to exist already (created once via Account API if
// missing).
export async function publishListing(params: {
  sku: string;
  title: string;
  description: string;
  imageUrls: string[];
  quantity: number;
  condition: string;
  categoryId: string;
  price: number;
  currency: string;
}) {
  const { sku, title, description, imageUrls, quantity, condition, categoryId, price, currency } = params;

  await ebayApiFetch(`/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`, {
    method: "PUT",
    body: JSON.stringify({
      availability: { shipToLocationAvailability: { quantity } },
      condition,
      product: { title, description, imageUrls },
    }),
  });

  const policies = await getDefaultBusinessPolicies();

  const merchantLocationKey = await getOrCreateMerchantLocation();

  const offerRes = await ebayApiFetch("/sell/inventory/v1/offer", {
    method: "POST",
    body: JSON.stringify({
      sku,
      marketplaceId: "EBAY_AU",
      format: "FIXED_PRICE",
      availableQuantity: quantity,
      categoryId,
      listingDescription: description,
      merchantLocationKey,
      pricingSummary: { price: { value: price.toFixed(2), currency } },
      listingPolicies: {
        fulfillmentPolicyId: policies.fulfillmentPolicyId,
        paymentPolicyId: policies.paymentPolicyId,
        returnPolicyId: policies.returnPolicyId,
      },
    }),
  });
  const offerId = offerRes.offerId as string;

  const publishRes = await ebayApiFetch(`/sell/inventory/v1/offer/${offerId}/publish/`, {
    method: "POST",
  });

  return { listingId: publishRes.listingId as string, offerId };
}

let cachedMerchantLocationKey: string | null = null;

async function getOrCreateMerchantLocation() {
  if (cachedMerchantLocationKey) return cachedMerchantLocationKey;
  const list = await ebayApiFetch("/sell/inventory/v1/location?limit=1");
  const existing = list.locations?.[0]?.merchantLocationKey;
  if (existing) {
    cachedMerchantLocationKey = existing;
    return existing;
  }
  const key = "jdm-kingdom-default";
  await ebayApiFetch(`/sell/inventory/v1/location/${key}`, {
    method: "POST",
    body: JSON.stringify({
      location: { address: { country: "AU" } },
      locationTypes: ["WAREHOUSE"],
      merchantLocationStatus: "ENABLED",
      name: "JDM Kingdom",
    }),
  });
  cachedMerchantLocationKey = key;
  return key;
}

let cachedCategoryTreeId: string | null = null;

async function getCategoryTreeId() {
  if (cachedCategoryTreeId) return cachedCategoryTreeId;
  const data = await ebayApiFetch(
    "/commerce/taxonomy/v1/get_default_category_tree_id?marketplace_id=EBAY_AU",
    { asUser: false }
  );
  cachedCategoryTreeId = data.categoryTreeId as string;
  return cachedCategoryTreeId;
}

// Asks eBay's Taxonomy API what category a keyword best fits, so listing
// drafts get a real category instead of a guess.
export async function suggestCategory(keyword: string): Promise<{ id: string; name: string } | null> {
  const treeId = await getCategoryTreeId();
  const data = await ebayApiFetch(
    `/commerce/taxonomy/v1/category_tree/${treeId}/get_category_suggestions?q=${encodeURIComponent(keyword)}`,
    { asUser: false }
  );
  const top = data.categorySuggestions?.[0]?.category;
  if (!top) return null;
  return { id: top.categoryId, name: top.categoryName };
}
