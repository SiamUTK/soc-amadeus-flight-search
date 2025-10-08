const AMADEUS_HOST =
  (Deno.env.get("AMADEUS_ENV") || "test") === "production"
    ? "https://api.amadeus.com"
    : "https://test.api.amadeus.com";

const CLIENT_ID = Deno.env.get("AMADEUS_API_KEY")!;
const CLIENT_SECRET = Deno.env.get("AMADEUS_API_SECRET")!;

let cachedToken: { access_token: string; expires_at: number } | null = null;

async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expires_at - 30 > now) return cachedToken.access_token;

  const res = await fetch(`${AMADEUS_HOST}/v1/security/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Response(JSON.stringify({ error: "TOKEN_ERROR", detail: t }), {
      status: 500,
      headers: corsHeaders,
    });
  }

  const data = await res.json();
  cachedToken = {
    access_token: data.access_token,
    expires_at: Math.floor(Date.now() / 1000) + (data.expires_in || 1500),
  };
  return cachedToken.access_token;
}

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const {
      originLocationCode,
      destinationLocationCode,
      departureDate,
      returnDate,
      adults = 1,
      currencyCode = "THB",
      max = 50,
      nonStop,
      travelClass,
    } = await req.json();

    const body: any = {
      currencyCode,
      originDestinations: [
        {
          id: "1",
          originLocationCode,
          destinationLocationCode,
          departureDateTimeRange: { date: departureDate },
        },
      ],
      travelers: Array.from({ length: adults }, (_, i) => ({
        id: String(i + 1),
        travelerType: "ADULT",
      })),
      sources: ["GDS"],
      searchCriteria: { maxFlightOffers: Math.min(Number(max) || 50, 250), flightFilters: {} },
    };

    if (returnDate) {
      body.originDestinations.push({
        id: "2",
        originLocationCode: destinationLocationCode,
        destinationLocationCode: originLocationCode,
        departureDateTimeRange: { date: returnDate },
      });
    }
    if (typeof nonStop === "boolean") {
      body.searchCriteria.flightFilters.connectionRestriction = {
        maxNumberOfConnections: nonStop ? 0 : 3,
      };
    }
    if (travelClass) {
      body.searchCriteria.cabinRestrictions = [
        { cabin: travelClass, coverage: "MOST_SEGMENTS", originDestinationIds: ["1", ...(returnDate ? ["2"] : [])] },
      ];
    }

    const token = await getAccessToken();
    const res = await fetch(`${AMADEUS_HOST}/v2/shopping/flight-offers`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const text = await res.text();
    const headers = { ...corsHeaders, "Content-Type": "application/json" };

    if (!res.ok) {
      return new Response(JSON.stringify({ error: "API_ERROR", status: res.status, detail: safeJson(text) }), {
        status: res.status,
        headers,
      });
    }
    return new Response(text, { status: 200, headers });
  } catch (e) {
    const headers = { ...corsHeaders, "Content-Type": "application/json" };
    return new Response(JSON.stringify({ error: "UNCAUGHT", detail: String(e) }), { status: 500, headers });
  }
});

function safeJson(maybeJson: string) {
  try { return JSON.parse(maybeJson); } catch { return maybeJson; }
}
