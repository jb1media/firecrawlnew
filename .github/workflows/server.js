// server.js
import express from "express";
import { chromium } from "playwright";

const app = express();
app.use(express.json());

// Small UA rotation to look less bot-like
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.4 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
];

function pickUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function safeUrl(u) {
  try { return new URL(u).toString(); } catch { return null; }
}

// /scrape?url=... or POST { url, proxy (optional), waitMs (optional) }
app.all("/scrape", async (req, res) => {
  const url = (req.method === "GET" ? req.query.url : req.body.url) || req.body?.url;
  const proxy = (req.method === "GET" ? req.query.proxy : req.body.proxy) || null;
  const waitMs = parseInt((req.method === "GET" ? req.query.waitMs : req.body.waitMs) || "1200", 10);

  if (!url || !safeUrl(url)) return res.status(400).json({ error: "Missing or invalid url" });

  let browser;
  try {
    const launchOpts = { headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] };
    if (proxy) {
      // proxy should be like http://user:pass@host:port or http://host:port
      launchOpts.proxy = { server: proxy };
    }

    browser = await chromium.launch(launchOpts);
    const context = await browser.newContext({
      userAgent: pickUA(),
      viewport: { width: 1366, height: 768 },
      locale: "en-US",
    });

    const page = await context.newPage();
    // Extra headers
    await page.setExtraHTTPHeaders({
      "accept-language": "en-US,en;q=0.9",
      "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    });

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    // small additional wait for JS-rendered content
    await page.waitForTimeout(Math.max(200, waitMs));

    const html = await page.content();
    const title = (await page.title()) || "";
    // text extraction: body innerText (trimmed)
    let text = "";
    try {
      text = (await page.innerText("body")).trim().replace(/\s{2,}/g, " ");
    } catch {
      text = "";
    }

    // cookies (optional) - return for debug
    const cookies = await context.cookies();

    await context.close();
    await browser.close();

    return res.json({
      success: true,
      url,
      title,
      text,
      html,
      cookies
    });
  } catch (err) {
    try { if (browser) await browser.close(); } catch {}
    return res.status(500).json({ error: "Scrape failed", details: String(err) });
  }
});

// /crawl?url=...&limit=10 or POST { url, limit, proxy }
app.all("/crawl", async (req, res) => {
  const url = (req.method === "GET" ? req.query.url : req.body.url) || req.body?.url;
  const proxy = (req.method === "GET" ? req.query.proxy : req.body.proxy) || null;
  const limit = parseInt((req.method === "GET" ? req.query.limit : req.body.limit) || "20", 10);

  if (!url || !safeUrl(url)) return res.status(400).json({ error: "Missing or invalid url" });

  let browser;
  try {
    const launchOpts = { headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] };
    if (proxy) launchOpts.proxy = { server: proxy };

    browser = await chromium.launch(launchOpts);
    const context = await browser.newContext({ userAgent: pickUA(), viewport: { width: 1366, height: 768 } });
    const page = await context.newPage();

    await page.setExtraHTTPHeaders({
      "accept-language": "en-US,en;q=0.9",
      "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    });

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(800);

    // collect links
    let links = await page.$$eval("a[href]", as =>
      Array.from(as)
        .map(a => (a as HTMLAnchorElement).href)
        .filter(Boolean)
    );

    // normalize + unique + same-origin optional
    const base = new URL(url);
    links = links
      .map(l => {
        try { return new URL(l, base).toString(); } catch { return null; }
      })
      .filter(Boolean);

    // unique preserve order
    const seen = new Set();
    const uniq = [];
    for (const l of links) {
      if (!seen.has(l) && uniq.length < limit) {
        seen.add(l);
        uniq.push(l);
      }
    }

    // optionally fetch titles for first N links (conservative)
    const results = [];
    for (const link of uniq) {
      try {
        const p = await context.newPage();
        await p.goto(link, { waitUntil: "domcontentloaded", timeout: 15000 });
        const title = (await p.title()) || "";
        await p.close();
        results.push({ url: link, title });
      } catch {
        results.push({ url: link, title: null });
      }
    }

    await context.close();
    await browser.close();

    return res.json({ success: true, origin: url, results });
  } catch (err) {
    try { if (browser) await browser.close(); } catch {}
    return res.status(500).json({ error: "Crawl failed", details: String(err) });
  }
});

const port = parseInt(process.env.PORT || "8080", 10);
app.listen(port, () => {
  console.log(`Slim Scraper API running on ${port}`);
});
