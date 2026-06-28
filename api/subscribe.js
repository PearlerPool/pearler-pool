// Vercel serverless function — POST /api/subscribe
// Saves a website email signup to a Google Sheet (via an Apps Script Web App).
// Falls back to Notion if a Google Sheet webhook isn't configured.
// Configure ONE of these in Vercel → Settings → Environment Variables:
//   GSHEET_WEBHOOK_URL  — Apps Script Web App /exec URL  (recommended)
//   NOTION_TOKEN (+ optional NOTION_DATABASE_ID)         — Notion fallback

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const NOTION_VERSION = "2022-06-28";
const FALLBACK_DB = "ad214978a045470794330525d5be6775";

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  try {
    const body =
      typeof req.body === "object" && req.body !== null
        ? req.body
        : JSON.parse(req.body || "{}");

    const email = String(body.email || "").trim().toLowerCase();
    const source = body.source === "home" ? "home" : "landing";

    if (!email || email.length > 200 || !EMAIL_RE.test(email)) {
      res.status(400).json({ error: "invalid_email" });
      return;
    }

    // --- Primary: Google Sheet via Apps Script Web App ---
    const sheetUrl = process.env.GSHEET_WEBHOOK_URL;
    if (sheetUrl) {
      const r = await fetch(sheetUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, source }),
      });
      const text = await r.text();
      if (!r.ok || /"ok"\s*:\s*false/.test(text)) {
        console.error("gsheet_error", r.status, text);
        res.status(502).json({ error: "store_failed" });
        return;
      }
      res.status(200).json({ ok: true });
      return;
    }

    // --- Fallback: Notion ---
    const token = process.env.NOTION_TOKEN;
    if (!token) {
      res.status(500).json({ error: "not_configured" });
      return;
    }
    const db = process.env.NOTION_DATABASE_ID || FALLBACK_DB;
    const r = await fetch("https://api.notion.com/v1/pages", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        parent: { database_id: db },
        properties: {
          Email: { title: [{ text: { content: email } }] },
          Source: { select: { name: source } },
          Status: { select: { name: "new" } },
        },
      }),
    });
    if (!r.ok) {
      const detail = await r.text();
      console.error("notion_error", r.status, detail);
      res.status(502).json({ error: "store_failed" });
      return;
    }
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("subscribe_error", err);
    res.status(500).json({ error: "server_error" });
  }
};
