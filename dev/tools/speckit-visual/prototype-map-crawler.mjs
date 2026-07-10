import { chromium } from "playwright";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { createHash } from "crypto";
import { writeFileSync, mkdirSync, readFileSync, existsSync, statSync, unlinkSync } from "fs";
import { join, dirname, relative, resolve } from "path";

const DEFAULT_VIEWPORTS = [
  { name: "desktop", width: 1440, height: 1024, deviceScaleFactor: 1 },
  { name: "tablet", width: 768, height: 1024, deviceScaleFactor: 1 },
  { name: "mobile", width: 390, height: 844, deviceScaleFactor: 2 },
];

const DEFAULT_PROTOTYPE_MAP_TEXT = "Prototype Map";
const DEFAULT_MAX_ENTRIES = 200;
const DEFAULT_TIMEOUT_MS = 30000;

const DETERMINISTIC_CSS = `
*, *::before, *::after {
  animation: none !important;
  transition: none !important;
  caret-color: transparent !important;
  scroll-behavior: auto !important;
}
`;

const HIDE_PROTOTYPE_MAP_UI_CSS = `
[class*="pm-fab"],
[class*="proto-fab"],
[class*="proto-map-fab"],
[class*="pm-ui"],
[class*="proto-ui"],
[class*="proto-map-ui"] {
  display: none !important;
}
`;

const COMPUTED_STYLE_PROPS = [
  "display", "position", "boxSizing", "width", "height",
  "margin", "padding", "color", "backgroundColor",
  "fontFamily", "fontSize", "fontWeight", "lineHeight",
  "borderRadius", "boxShadow", "opacity", "overflow",
  "transform", "zIndex",
];

const BOUNDS_KEYS = ["x", "y", "width", "height"];

function printUsage() {
  console.log(`Usage: node prototype-map-crawler.mjs <command> [options]

Commands:
  discover   Open prototype, click Prototype Map, extract entries,
             write prototype-map.json and source-map.json.
  capture    Read source-map.json, replay action paths, capture
             screenshots, extract DOM, write design-ir.json.
  compare    Read route-map.json, open frontend routes, compare
             screenshots against captured design references.
  all        Run discover then capture.

Required options:
  --project <slug>            Project slug for metadata and URL derivation.
  --canonical-url <url>       Canonical Open Design preview URL.
  --output-root <path>        Design context root for artifact output.

Optional options:
  --prototype-map-text <text> Text of the Prototype Map button.
                              Default: "Prototype Map"
  --viewports <def>           Comma-separated viewport definitions.
                              Format: name=WxH@scale
                              Default: desktop=1440x1024@1,tablet=768x1024@1,mobile=390x844@2
  --viewport <name>           Restrict processing to one viewport.
  --max-entries <number>      Max Prototype Map entries.  Default: 200
  --full-page                 Capture full-page screenshots.  Default: false
  --headful                   Run browser headful.  Default: headless
  --timeout-ms <number>       Playwright timeout in ms.  Default: 30000
  --deep                      Enable deep crawl of interactive elements within
                              each captured screen.  Default: false
  --deep-max-depth <number>   Max levels to explore beyond PM screens.
                              Default: 1
  --deep-max-screens <number> Max deep-discovered screens total.  Default: 50
  --dedup                     Remove duplicate screenshots (identical file bytes).
                               PM screens win over deep duplicates.  Default: false
  --no-hide-prototype-map-ui  Keep Prototype Map UI elements (FAB, navigation)
                               visible in captured screenshots.
                               Default: they are hidden automatically.
  --help                      Print this usage.

Compare options:
  --frontend-url <url>        Frontend base URL to compare.
                              Default: FRONTEND_URL env, then
                              http://node-runner:5173
  --route-map <path>          Explicit route-map path.
                              Default: <output-root>/
                              visual-regression/fixtures/route-map.json
  --test-results-dir <path>   Results output directory.
                              Default: <output-root>/
                              visual-regression/test-results
  --fail-on-diff              Exit non-zero when comparison fails.
                              Default: true for compare.
  --no-fail-on-diff           Always exit 0 even when visual diffs found.
  --update-actual             Capture actuals and write report, exit 0.
  --compare-timeout-ms <num>  Timeout per frontend route.
                              Default: --timeout-ms or 30000
  --settle-ms <num>           Extra wait after network/font ready.
                              Default: 500
  --skip-frontend-healthcheck Skip frontend base URL reachability check.

Environment variable fallbacks:
  SPECKIT_PROJECT          Fallback for --project
  DESIGN_PREVIEW_URL       Fallback for --canonical-url
  SPECKIT_VISUAL_OUTPUT_ROOT  Fallback for --output-root
  SPECKIT_PROTOTYPE_MAP_TEXT  Fallback for --prototype-map-text
  FRONTEND_URL             Fallback for --frontend-url
`);
}

function parseArgs(argv) {
  const args = { _: [], flags: {} };
  let i = 0;
  while (i < argv.length) {
    const a = argv[i];
    if (a === "--project") args.project = argv[++i];
    else if (a === "--canonical-url") args.canonicalUrl = argv[++i];
    else if (a === "--output-root") args.outputRoot = argv[++i];
    else if (a === "--prototype-map-text") args.prototypeMapText = argv[++i];
    else if (a === "--viewports") args.viewports = argv[++i];
    else if (a === "--viewport") args.viewportFilter = argv[++i];
    else if (a === "--max-entries") args.maxEntries = parseInt(argv[++i], 10);
    else if (a === "--timeout-ms") args.timeoutMs = parseInt(argv[++i], 10);
    else if (a === "--deep-max-depth") args.deepMaxDepth = parseInt(argv[++i], 10);
    else if (a === "--deep-max-screens") args.deepMaxScreens = parseInt(argv[++i], 10);
    else if (a === "--deep") args.flags.deep = true;
    else if (a === "--dedup") args.flags.dedup = true;
    else if (a === "--full-page") args.flags.fullPage = true;
    else if (a === "--headful") args.flags.headful = true;
    else if (a === "--fail-on-diff") args.flags.failOnDiff = true;
    else if (a === "--no-fail-on-diff") args.flags.noFailOnDiff = true;
    else if (a === "--update-actual") args.flags.updateActual = true;
    else if (a === "--skip-frontend-healthcheck") args.flags.skipFrontendHealthcheck = true;
    else if (a === "--no-hide-prototype-map-ui") args.flags.noHidePrototypeMapUi = true;
    else if (a === "--frontend-url") args.frontendUrl = argv[++i];
    else if (a === "--route-map") args.routeMap = argv[++i];
    else if (a === "--test-results-dir") args.testResultsDir = argv[++i];
    else if (a === "--compare-timeout-ms") args.compareTimeoutMs = parseInt(argv[++i], 10);
    else if (a === "--settle-ms") args.settleMs = parseInt(argv[++i], 10);
    else if (a === "--help" || a === "-h") args.flags.help = true;
    else if (!a.startsWith("--")) args._.push(a);
    else { console.error("Unknown option:", a); process.exit(1); }
    i++;
  }
  return args;
}

function parseViewports(raw) {
  return raw.split(",").map((def) => {
    const m = def.trim().match(/^(.+)=(\d+)x(\d+)@(\d+(?:\.\d+)?)$/);
    if (!m) throw new Error(`Invalid viewport definition: "${def}". Expect name=WxH@scale`);
    return { name: m[1], width: parseInt(m[2], 10), height: parseInt(m[3], 10), deviceScaleFactor: parseFloat(m[4]) };
  });
}

function resolveConfig(parsed) {
  if (parsed.flags.help) {
    printUsage();
    process.exit(0);
  }

  const command = parsed._[0];
  if (!command || !["discover", "capture", "compare", "all"].includes(command)) {
    console.error("Error: command required (discover | capture | compare | all)");
    printUsage();
    process.exit(1);
  }

  const project = parsed.project || process.env.SPECKIT_PROJECT;
  if (!project) {
    console.error("Error: --project is required");
    process.exit(1);
  }

  const canonicalUrl =
    parsed.canonicalUrl ||
    process.env.DESIGN_PREVIEW_URL ||
    `http://design-preview:80/design-context/${project}/index.html`;

  const outputRoot =
    parsed.outputRoot ||
    process.env.SPECKIT_VISUAL_OUTPUT_ROOT ||
    `/workspace/design-context/${project}`;

  const prototypeMapText =
    parsed.prototypeMapText ||
    process.env.SPECKIT_PROTOTYPE_MAP_TEXT ||
    DEFAULT_PROTOTYPE_MAP_TEXT;

  const viewports = parsed.viewports ? parseViewports(parsed.viewports) : DEFAULT_VIEWPORTS;
  const viewportFilter = parsed.viewportFilter || null;
  const maxEntries = parsed.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const fullPage = parsed.flags.fullPage ?? false;
  const headless = parsed.flags.headful ? false : true;
  const timeoutMs = parsed.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const deep = parsed.flags.deep ?? false;
  const deepMaxDepth = parsed.deepMaxDepth ?? 1;
  const deepMaxScreens = parsed.deepMaxScreens ?? 50;
  const dedup = parsed.flags.dedup ?? false;

  const frontendUrl =
    parsed.frontendUrl ||
    process.env.FRONTEND_URL ||
    "http://node-runner:5173";

  const routeMapPath = parsed.routeMap || null;
  const testResultsDir = parsed.testResultsDir || null;
  const failOnDiff = parsed.flags.noFailOnDiff ? false : (parsed.flags.failOnDiff ?? (command === "compare"));
  const updateActual = parsed.flags.updateActual ?? false;
  const compareTimeoutMs = parsed.compareTimeoutMs ?? timeoutMs;
  const settleMs = parsed.settleMs ?? 500;
  const skipFrontendHealthcheck = parsed.flags.skipFrontendHealthcheck ?? false;
  const hidePrototypeMapUi = parsed.flags.noHidePrototypeMapUi ? false : true;

  return { command, project, canonicalUrl, outputRoot, prototypeMapText, viewports, viewportFilter, maxEntries, fullPage, headless, timeoutMs, deep, deepMaxDepth, deepMaxScreens, dedup, frontendUrl, routeMapPath, testResultsDir, failOnDiff, updateActual, compareTimeoutMs, settleMs, skipFrontendHealthcheck, hidePrototypeMapUi };
}

function ensureDir(p) {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 60);
}

function shortSha256(input) {
  return createHash("sha256").update(input).digest("hex").substring(0, 12);
}

function padIndex(n, len) {
  return String(n).padStart(len, "0");
}

function isoNow() {
  return new Date().toISOString();
}

function isElementVisible(bounds) {
  return bounds.width > 1 && bounds.height > 1;
}

function isDismissControl(text) {
  const lower = (text || "").toLowerCase().trim();
  return ["close", "dismiss", "back", "cancel", "×", "✕", "x", "exit"].includes(lower);
}

async function createBrowserAndPage(viewport, config) {
  const browser = await chromium.launch({ headless: config.headless });
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.deviceScaleFactor,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(config.timeoutMs);
  return { browser, context, page };
}

async function navigateAndSettle(page, url, config) {
  const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: config.timeoutMs });
  if (!resp || !resp.ok()) {
    throw new Error(`Failed to load ${url}: status ${resp ? resp.status() : "unknown"}`);
  }
  await page.waitForLoadState("networkidle", { timeout: config.timeoutMs }).catch(() => {
    console.warn("  [warn] networkidle timed out, continuing...");
  });
  try {
    await page.evaluate(() => document.fonts.ready);
  } catch (_) {
    /* fonts API may not be available */
  }
  await page.addStyleTag({ content: DETERMINISTIC_CSS });
  await page.waitForTimeout(500);
}

async function findAndClickPrototypeMapButton(page, text, timeoutMs) {
  const strategies = [
    async () => {
      const btn = page.getByRole("button", { name: new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") });
      if (await btn.count() > 0) {
        await btn.first().click({ timeout: timeoutMs });
        return true;
      }
      return false;
    },
    async () => {
      const link = page.getByRole("link", { name: new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") });
      if (await link.count() > 0) {
        await link.first().click({ timeout: timeoutMs });
        return true;
      }
      return false;
    },
    async () => {
      const el = page.getByText(new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")).first();
      if (await el.count() > 0) {
        await el.click({ timeout: timeoutMs });
        return true;
      }
      return false;
    },
    async () => {
      const result = await page.evaluate((searchText) => {
        const all = document.querySelectorAll("button, a, [role='button'], [role='link']");
        for (const el of all) {
          if (el.textContent && el.textContent.toLowerCase().includes(searchText.toLowerCase())) {
            return { x: el.getBoundingClientRect().left + el.getBoundingClientRect().width / 2, y: el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2 };
          }
        }
        return null;
      }, text);
      if (result) {
        await page.mouse.click(result.x, result.y);
        return true;
      }
      return false;
    },
  ];

  for (const s of strategies) {
    try {
      if (await s()) return true;
    } catch (_) {
      continue;
    }
  }
  return false;
}

async function extractPrototypeMapEntries(page, maxEntries, buttonText) {
  await page.waitForSelector(".pm-panel, [class*='pm-panel'], .pm-scrim, [class*='proto-map-panel']", { timeout: 5000 }).catch(() => {
    console.warn("  [warn] Prototype Map panel not detected by known selectors");
  });
  await page.waitForTimeout(500);

  return page.evaluate(({ max, btnText }) => {
    const panel = document.querySelector(".pm-panel") ||
                  document.querySelector("[class*='pm-panel']") ||
                  document.querySelector(".pm-scrim") ||
                  document.querySelector("[class*='proto-map-panel']");
    const root = panel || document;

    const candidates = [];
    const seen = new Set();

    const protoFabSel = "[class*='pm-fab'], [class*='proto-fab'], [class*='proto-map-fab']";
    const dismissTexts = new Set(["close", "dismiss", "back", "cancel", "×", "✕", "x", "exit"]);
    const btnTextLower = btnText.toLowerCase().trim();

    const isInsidePanel = (el) => {
      if (!panel) return false;
      return panel.contains(el);
    };

    const isPrototypeMapFab = (el) => {
      return el.matches(protoFabSel);
    };

    const isDismissControl = (el) => {
      const aria = (el.getAttribute("aria-label") || "").toLowerCase().trim();
      if (aria && dismissTexts.has(aria)) return true;
      const text = (el.textContent || "").toLowerCase().trim();
      if (text && dismissTexts.has(text)) return true;
      const tag = el.tagName.toLowerCase();
      if (tag === "button" && text === "×") return true;
      if (el.getAttribute("aria-label") === "Close") return true;
      return false;
    };

    const extractLabel = (el) => {
      const inPanel = isInsidePanel(el);
      if (inPanel) {
        const titleEl = el.querySelector(".pc-t");
        if (titleEl) {
          const icon = titleEl.querySelector("svg, img, [class*='icon']");
          const t = titleEl.textContent || "";
          let label = t.trim().substring(0, 120);
          if (icon && label.startsWith(icon.textContent || "")) {
            label = label.substring((icon.textContent || "").length).trim();
          }
          if (label) return label;
        }
      }
      return (el.getAttribute("aria-label") || el.textContent || "").trim().substring(0, 120);
    };

    const getPageId = (el) => {
      return el.getAttribute("data-page-id") ||
             el.getAttribute("data-screen-id") ||
             el.getAttribute("data-frame-id") ||
             null;
    };

    const collectCandidates = (container) => {
      const buttons = container.querySelectorAll("button, a[href], [role='button'], [role='link'], [role='menuitem']");
      for (const el of buttons) {
        if (candidates.length >= max) return;

        const rect = el.getBoundingClientRect();
        if (rect.width <= 1 || rect.height <= 1) continue;

        const cs = window.getComputedStyle(el);
        if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") continue;

        if (isPrototypeMapFab(el)) continue;
        if (isDismissControl(el)) continue;

        const label = extractLabel(el);
        if (!label) continue;
        if (label.toLowerCase().trim() === btnTextLower) continue;

        const pageId = getPageId(el);
        const tag = el.tagName.toLowerCase();
        const role = el.getAttribute("role") || (tag === "button" ? "button" : tag === "a" ? "link" : null);
        const href = el.getAttribute("href");
        const selector = pageId ? `[data-page-id="${pageId}"]` : null;

        const bounds = {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
        const center = {
          x: Math.round(rect.x + rect.width / 2),
          y: Math.round(rect.y + rect.height / 2),
        };
        const key = `${pageId || ""}|${label}|${selector || ""}|${JSON.stringify(bounds)}`;
        if (seen.has(key)) continue;
        seen.add(key);

        candidates.push({
          index: candidates.length,
          label,
          tag,
          role,
          href,
          pageId,
          selector,
          bounds,
          center,
        });
      }
    };

    if (panel) {
      collectCandidates(panel);
    }

    if (candidates.length === 0) {
      collectCandidates(document);
    }

    return candidates;
  }, { max: maxEntries, btnText: buttonText });
}

function deduplicateEntries(entries) {
  const seen = new Set();
  return entries.filter((e) => {
    const key = `${e.pageId || ""}|${e.label}|${e.selector || ""}|${JSON.stringify(e.bounds)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function generateScreenId(entry, idx, indexLen) {
  if (entry.pageId) return `${padIndex(idx + 1, indexLen)}-${slugify(entry.pageId)}`;
  if (entry.label) return `${padIndex(idx + 1, indexLen)}-${slugify(entry.label)}`;
  return `${padIndex(idx + 1, indexLen)}-entry-${idx}`;
}

function generateScreenName(entry) {
  return entry.label || entry.pageId || `Screen ${entry.index}`;
}

function buildActionPath(entry, buttonText) {
  return [
    { type: "openPrototypeMap", label: buttonText },
    {
      type: "clickPrototypeMapEntry",
      label: entry.label,
      pageId: entry.pageId,
      selector: entry.selector,
      center: entry.center,
    },
  ];
}

function writePrototypeMap({ outputRoot, project, startUrl, entries, buttonText, buttonFound, warnings }) {
  const filePath = join(outputRoot, "visual-regression", "fixtures", "prototype-map.json");
  ensureDir(dirname(filePath));

  const indexLen = String(entries.length).length;
  const pages = entries.map((entry, i) => ({
    id: generateScreenId(entry, i, indexLen),
    name: generateScreenName(entry),
    entryIndex: entry.index,
    entryLabel: entry.label,
    pageId: entry.pageId,
    selector: entry.selector,
    bounds: entry.bounds,
    center: entry.center,
    actionPath: buildActionPath(entry, buttonText),
    warnings: [],
  }));

  const doc = {
    version: 1,
    generatedAt: isoNow(),
    project: { slug: project },
    startUrl,
    discovery: {
      strategy: "prototype-map",
      prototypeMapButtonFound: buttonFound,
      prototypeMapText: buttonText,
      entryCount: entries.length,
    },
    pages,
    warnings,
  };
  writeFileSync(filePath, JSON.stringify(doc, null, 2) + "\n");
  console.log(`  wrote ${filePath} (${pages.length} pages)`);
  return filePath;
}

function writeSourceMap({ outputRoot, project, startUrl, entries, buttonText, viewports, warnings }) {
  const filePath = join(outputRoot, "visual-regression", "fixtures", "source-map.json");
  ensureDir(dirname(filePath));

  const indexLen = String(entries.length).length;
  const vpNames = viewports.map((v) => v.name);

  const screens = entries.map((entry, i) => ({
    id: generateScreenId(entry, i, indexLen),
    name: generateScreenName(entry),
    url: startUrl,
    discoveryStrategy: "prototype-map",
    entryIndex: entry.index,
    actionPath: buildActionPath(entry, buttonText),
    viewports: vpNames,
  }));

  const viewportMap = {};
  for (const v of viewports) {
    viewportMap[v.name] = { width: v.width, height: v.height, deviceScaleFactor: v.deviceScaleFactor };
  }

  const doc = {
    version: 1,
    generatedAt: isoNow(),
    project: { slug: project },
    preview: { service: "design-preview", canonicalUrl: startUrl },
    screens,
    viewports: viewportMap,
    warnings,
  };
  writeFileSync(filePath, JSON.stringify(doc, null, 2) + "\n");
  console.log(`  wrote ${filePath} (${screens.length} screens × ${vpNames.length} viewports = ${screens.length * vpNames.length} variants)`);
  return filePath;
}

async function reopenPrototypeMap(page, buttonText) {
  const found = await findAndClickPrototypeMapButton(page, buttonText, 15000);
  if (!found) throw new Error(`Cannot reopen Prototype Map button "${buttonText}"`);
  await page.waitForTimeout(800);
}

async function ensurePrototypeMapClosed(page) {
  const visible = await page.locator(".pm-panel, .pm-scrim").isVisible().catch(() => false);
  if (visible) {
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(300);
    await page.locator(".pm-scrim").click({ position: { x: 10, y: 10 } }).catch(() => {});
    await page.waitForTimeout(500);
  }
}

async function computeContentHash(page) {
  return page.evaluate(() => {
    const body = document.body;
    const elCount = body ? body.querySelectorAll("*").length : 0;
    const text = (body ? body.textContent || "" : "").trim().replace(/\s+/g, " ").substring(0, 2000);
    return `${elCount}:${text}`;
  });
}

async function findDeepElements(page, baseUrl) {
  return page.evaluate((base) => {
    const candidates = [];
    const seen = new Set();
    const elms = document.querySelectorAll("a[href], button, [role='button'], [role='link'], [onclick]");
    const pmSel = "[class*='pm-fab'], [class*='pm-panel'], [class*='pm-scrim'], [class*='proto-map']";
    const dismissTexts = new Set(["close", "dismiss", "back", "cancel", "×", "✕", "x", "exit", "prototype map"]);

    for (const el of elms) {
      const rect = el.getBoundingClientRect();
      if (rect.width <= 1 || rect.height <= 1) continue;
      const cs = window.getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") continue;

      if (el.matches(pmSel)) continue;
      let parent = el.parentElement;
      while (parent) { if (parent.matches(pmSel)) break; parent = parent.parentElement; }
      if (parent) continue;

      const tag = el.tagName.toLowerCase();
      const href = el.getAttribute("href");
      const label = (el.getAttribute("aria-label") || el.textContent || "").trim().substring(0, 80);
      if (!label) continue;
      const lowerLabel = label.toLowerCase().trim();
      if (dismissTexts.has(lowerLabel)) continue;

      if (tag === "a" && href && !href.startsWith("#") && !href.startsWith("javascript:") && !href.startsWith("mailto:")) {
        try {
          const u = new URL(href, window.location.href);
          if (u.origin !== (new URL(base, window.location.href)).origin) continue;
        } catch (_) { continue; }
      }

      const key = `${tag}|${label}|${href || ""}`;
      if (seen.has(key)) continue;
      seen.add(key);

      candidates.push({
        index: candidates.length,
        label,
        tag,
        href,
        selector: el.getAttribute("data-testid") || el.getAttribute("id") || null,
        bounds: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
        center: {
          x: Math.round(rect.x + rect.width / 2),
          y: Math.round(rect.y + rect.height / 2),
        },
      });
    }
    return candidates;
  }, baseUrl);
}

async function clickEntryByIndex(page, entryIndex) {
  await page.waitForSelector(".pm-panel, .pm-scrim", { timeout: 5000 }).catch(() => {});

  const panelBtns = page.locator(".pm-panel button:not([class*='icon']):not([class*='close']), .pm-scrim button:not([class*='icon']):not([class*='close']), .pm-panel .pm-card, .pm-scrim .pm-card");
  const btnCount = await panelBtns.count();

  if (btnCount > 0 && entryIndex < btnCount) {
    await panelBtns.nth(entryIndex).scrollIntoViewIfNeeded();
    await panelBtns.nth(entryIndex).click({ timeout: 5000 });
    return;
  }

  const anyCards = page.locator(".pm-card, [class*='prototype-map'] button, [class*='proto-map'] button");
  const anyCount = await anyCards.count();
  if (anyCount > 0 && entryIndex < anyCount) {
    await anyCards.nth(entryIndex).scrollIntoViewIfNeeded();
    await anyCards.nth(entryIndex).click({ timeout: 5000 });
    return;
  }

  throw new Error(`Cannot find Prototype Map entry at index ${entryIndex}`);
}

async function clickEntryBySelector(page, selector) {
  await page.click(selector, { timeout: 5000 });
}

async function clickEntryByText(page, text) {
  const inPanel = page.locator(".pm-panel, .pm-scrim").getByText(text, { exact: false }).first();
  if (await inPanel.count() > 0) {
    await inPanel.click({ timeout: 5000 });
    return;
  }
  await page.getByText(text, { exact: false }).first().click({ timeout: 5000 });
}

async function clickEntryByCoords(page, center) {
  await page.mouse.click(center.x, center.y);
  await page.waitForTimeout(800);
}

async function replayActionPath(page, actionPath, entryIndex, buttonText) {
  let protoMapOpen = false;

  for (const step of actionPath) {
    if (step.type === "openPrototypeMap") {
      if (!protoMapOpen) {
        await reopenPrototypeMap(page, buttonText);
        protoMapOpen = true;
        await page.waitForSelector(".pm-panel, .pm-scrim", { timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(500);
      }
    } else if (step.type === "clickPrototypeMapEntry") {
      const tried = [];

      if (step.selector) {
        try {
          tried.push("selector");
          await clickEntryBySelector(page, step.selector);
          protoMapOpen = false;
          await page.waitForSelector(".pm-panel, .pm-scrim", { state: "hidden", timeout: 5000 }).catch(() => {});
          await page.waitForTimeout(1000);
          continue;
        } catch (_) {}
      }

      if (step.pageId) {
        try {
          tried.push("pageId");
          const sel = `[data-page-id="${step.pageId}"], [data-screen-id="${step.pageId}"], [data-frame-id="${step.pageId}"]`;
          await clickEntryBySelector(page, sel);
          protoMapOpen = false;
          await page.waitForSelector(".pm-panel, .pm-scrim", { state: "hidden", timeout: 5000 }).catch(() => {});
          await page.waitForTimeout(1000);
          continue;
        } catch (_) {}
      }

      if (entryIndex !== undefined) {
        try {
          tried.push("index");
          await clickEntryByIndex(page, entryIndex);
          protoMapOpen = false;
          await page.waitForSelector(".pm-panel, .pm-scrim", { state: "hidden", timeout: 5000 }).catch(() => {});
          await page.waitForTimeout(1000);
          continue;
        } catch (_) {}
      }

      if (step.label) {
        try {
          tried.push("exactText");
          await clickEntryByText(page, step.label);
          protoMapOpen = false;
          await page.waitForSelector(".pm-panel, .pm-scrim", { state: "hidden", timeout: 5000 }).catch(() => {});
          await page.waitForTimeout(1000);
          continue;
        } catch (_) {}
      }

      if (step.center) {
        try {
          tried.push("coords");
          await clickEntryByCoords(page, step.center);
          protoMapOpen = false;
          await page.waitForSelector(".pm-panel, .pm-scrim", { state: "hidden", timeout: 5000 }).catch(() => {});
          await page.waitForTimeout(1000);
          continue;
        } catch (_) {}
      }

      return { success: false, warning: `Failed to click entry (tried: ${tried.join(", ")})` };
    }
  }
  return { success: true, warning: null };
}

async function captureViewport(page, viewport, screen, config) {
  try {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
  } catch (_) {
    /* some pages may restrict resize; that's ok */
  }

  const panelVisible = await page.locator(".pm-panel, .pm-scrim").isVisible().catch(() => false);
  if (panelVisible) {
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(300);
    await page.locator(".pm-scrim").click({ position: { x: 10, y: 10 } }).catch(() => {});
    await page.waitForTimeout(500);
  }

  await page.waitForTimeout(800);
  try { await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {}); } catch (_) {}
  await page.waitForTimeout(500);

  const screenshotDir = join(config.outputRoot, "visual-regression", "screenshots");
  ensureDir(screenshotDir);

  const fileName = `${screen.id}__${viewport.name}.png`;
  const filePath = join(screenshotDir, fileName);

  if (config.hidePrototypeMapUi) {
    await page.addStyleTag({ content: HIDE_PROTOTYPE_MAP_UI_CSS });
  }

  await page.screenshot({
    path: filePath,
    fullPage: config.fullPage,
    animations: "disabled",
    caret: "hide",
    scale: "css",
  });

  const stats = statSync(filePath);

  const domData = await extractDomTree(page);

  const relPath = join("..", "visual-regression", "screenshots", fileName);

  const variantId = `${screen.id}__${viewport.name}`;

  const viewportDims = {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: viewport.deviceScaleFactor,
  };

  const sig = computeSignature(viewportDims, domData);

  return {
    id: variantId,
    viewport: viewport.name,
    signature: `sha256:${sig}`,
    canvas: {
      width: viewport.width,
      height: viewport.height,
      background: domData.rootBg || "rgb(255,255,255)",
    },
    screenshot: {
      path: relPath,
      width: viewport.width,
      height: viewport.height,
      device_scale_factor: viewport.deviceScaleFactor,
      file_size: stats.size,
    },
    root_node_id: domData.rootId || "node-00001",
    nodes: domData.nodes,
    assets: [],
    warnings: [],
  };
}

function computeSignature(viewport, domData) {
  const parts = [
    JSON.stringify(viewport),
    String((domData.nodes || []).length),
    domData.text || "",
  ];
  const nodes = domData.nodes || [];
  if (nodes.length > 0) {
    const sampleIndexes = [0, Math.floor(nodes.length * 0.1), Math.floor(nodes.length * 0.25), Math.floor(nodes.length * 0.5), Math.floor(nodes.length * 0.75), Math.floor(nodes.length * 0.9), nodes.length - 1];
    for (const idx of sampleIndexes) {
      if (nodes[idx] && nodes[idx].bounds) {
        parts.push(JSON.stringify(nodes[idx].bounds));
      }
      if (nodes[idx] && nodes[idx].tag) {
        parts.push(nodes[idx].tag);
      }
    }
  }
  return createHash("sha256").update(parts.join("|")).digest("hex").substring(0, 16);
}

async function extractDomTree(page) {
  const data = await page.evaluate((styleProps) => {
    const nodes = [];
    const idMap = new Map();
    let counter = 0;
    let totalText = "";
    let rootBg = "";

    const styleMap = {
      display: "display",
      position: "position",
      boxSizing: "box_sizing",
      width: "width",
      height: "height",
      margin: "margin",
      padding: "padding",
      color: "color",
      backgroundColor: "background_color",
      fontFamily: "font_family",
      fontSize: "font_size",
      fontWeight: "font_weight",
      lineHeight: "line_height",
      borderRadius: "border_radius",
      boxShadow: "box_shadow",
      opacity: "opacity",
      overflow: "overflow",
      transform: "transform",
      zIndex: "z_index",
    };

    function assignId(el) {
      let id = el.getAttribute("data-node-id");
      if (!id) {
        id = `node-${String(++counter).padStart(5, "0")}`;
        idMap.set(el, id);
      }
      return id;
    }

    function getComputedStyleSnapshot(el) {
      const cs = window.getComputedStyle(el);
      const out = {};
      for (const prop of styleProps) {
        const key = styleMap[prop] || prop;
        out[key] = cs[prop] || "";
      }
      return out;
    }

    function getBounds(el) {
      const r = el.getBoundingClientRect();
      return {
        x: Math.round(r.x),
        y: Math.round(r.y),
        width: Math.round(r.width),
        height: Math.round(r.height),
      };
    }

    function getVisibleText(el) {
      if (!el) return "";
      const tag = el.tagName.toLowerCase();
      if (tag === "script" || tag === "style" || tag === "template" || tag === "noscript") return "";
      const cs = window.getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") return "";
      let text = "";
      for (const child of el.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) text += child.textContent || "";
        else if (child.nodeType === Node.ELEMENT_NODE) text += getVisibleText(child);
      }
      return text.trim();
    }

    function walk(el, depth, parentId) {
      if (depth > 30) return [];
      const tag = el.tagName.toLowerCase();
      if (tag === "script" || tag === "style" || tag === "template" || tag === "noscript" || tag === "head") return [];

      const id = assignId(el);
      const bounds = getBounds(el);
      const cs = window.getComputedStyle(el);
      const visible = cs.display !== "none" && cs.visibility !== "hidden" && cs.opacity !== "0" && bounds.width > 0 && bounds.height > 0;
      const text = getVisibleText(el);
      if (text) totalText += text + " ";

      const node = {
        id,
        parent_id: parentId,
        index: 0,
        depth,
        tag,
        name: el.getAttribute("name") || el.getAttribute("id") || tag,
        type: "element",
        role: el.getAttribute("role") || null,
        text: text || null,
        visible,
        bounds,
        computed_style: getComputedStyleSnapshot(el),
        attributes: {
          id: el.getAttribute("id") || null,
          class: el.getAttribute("class") || null,
          role: el.getAttribute("role") || null,
          aria_label: el.getAttribute("aria-label") || null,
          src: el.getAttribute("src") || null,
          href: el.getAttribute("href") || null,
        },
        asset_refs: [],
        children: [],
      };

      if (tag === "body") {
        rootBg = cs.backgroundColor || "";
      }

      let childIdx = 0;
      for (const child of el.children) {
        const childNodes = walk(child, depth + 1, id);
        for (const cn of childNodes) {
          cn.index = childIdx++;
          node.children.push(cn.id);
          nodes.push(cn);
        }
      }
      return [node];
    }

    const rootEl = document.body || document.documentElement;
    const roots = walk(rootEl, 0, null);
    for (const r of roots) {
      nodes.unshift(r);
    }

    return { nodes, rootId: roots.length > 0 ? roots[0].id : null, rootBg, text: totalText.trim() };
  }, COMPUTED_STYLE_PROPS);

  return data;
}

function writeDesignIR({ outputRoot, project, startUrl, headless, viewports, screens, warnings }) {
  const filePath = join(outputRoot, "design-processing", "design-ir.json");
  ensureDir(dirname(filePath));

  const doc = {
    version: 1,
    generated_at: isoNow(),
    project: { slug: project },
    preview: {
      canonical_url: startUrl,
      served_by: "opencode-environment:design-preview",
    },
    source_mode: "design-preview",
    render_engine: {
      name: "playwright",
      browser: "chromium",
      headless,
    },
    viewports: viewports.map((v) => ({
      name: v.name,
      width: v.width,
      height: v.height,
      deviceScaleFactor: v.deviceScaleFactor,
    })),
    screens,
    assets: [],
    warnings,
  };
  writeFileSync(filePath, JSON.stringify(doc, null, 2) + "\n");
  console.log(`  wrote ${filePath}`);
  return filePath;
}

async function runDiscover(config) {
  console.log(`\n=== DISCOVER: ${config.project} ===`);
  console.log(`  start URL: ${config.canonicalUrl}`);
  console.log(`  output root: ${config.outputRoot}`);
  console.log(`  max entries: ${config.maxEntries}`);

  const vp = config.viewports[0];
  console.log(`  discovery viewport: ${vp.name} ${vp.width}x${vp.height}@${vp.deviceScaleFactor}x`);

  const { browser, context, page } = await createBrowserAndPage(vp, config);

  let buttonFound = false;
  const warnings = [];

  try {
    console.log(`  opening ${config.canonicalUrl}...`);
    await navigateAndSettle(page, config.canonicalUrl, config);

    console.log(`  searching for Prototype Map: "${config.prototypeMapText}"`);
    buttonFound = await findAndClickPrototypeMapButton(page, config.prototypeMapText, config.timeoutMs);

    if (!buttonFound) {
      console.error(`  ERROR: Prototype Map button "${config.prototypeMapText}" not found`);
      await browser.close();
      process.exit(1);
    }
    console.log(`  Prototype Map opened, waiting for panel...`);
    await page.waitForSelector(".pm-panel, .pm-scrim, [class*='pm-panel'], [class*='proto-map-panel']", { timeout: 5000 }).catch(() => {
      console.warn("  [warn] Prototype Map panel not detected, will try full-page extraction");
    });
    await page.waitForTimeout(1000);

    const rawEntries = await extractPrototypeMapEntries(page, config.maxEntries, config.prototypeMapText);
    console.log(`  extracted ${rawEntries.length} candidates`);

    const entries = deduplicateEntries(rawEntries);
    console.log(`  after dedup: ${entries.length} entries`);

    if (entries.length === 0) {
      console.error("  ERROR: no Prototype Map entries found");
      await browser.close();
      process.exit(1);
    }

    writePrototypeMap({
      outputRoot: config.outputRoot,
      project: config.project,
      startUrl: config.canonicalUrl,
      entries,
      buttonText: config.prototypeMapText,
      buttonFound,
      warnings,
    });

    writeSourceMap({
      outputRoot: config.outputRoot,
      project: config.project,
      startUrl: config.canonicalUrl,
      entries,
      buttonText: config.prototypeMapText,
      viewports: config.viewports,
      warnings,
    });

    console.log(`  DISCOVER complete: ${entries.length} pages found`);
  } finally {
    await browser.close();
  }
}

async function runCapture(config) {
  console.log(`\n=== CAPTURE: ${config.project} ===`);

  const sourceMapPath = join(config.outputRoot, "visual-regression", "fixtures", "source-map.json");
  if (!existsSync(sourceMapPath)) {
    console.error(`  ERROR: source-map.json not found at ${sourceMapPath}`);
    console.error("  Run 'discover' first.");
    process.exit(1);
  }

  const sourceMap = JSON.parse(readFileSync(sourceMapPath, "utf-8"));
  const screens = sourceMap.screens || [];
  const vps = config.viewports;

  console.log(`  screens: ${screens.length}`);
  console.log(`  viewports: ${vps.map((v) => v.name).join(", ")}`);
  if (config.deep) console.log(`  deep crawl: enabled (max depth ${config.deepMaxDepth}, max screens ${config.deepMaxScreens})`);

  let designScreens = [];
  const warnings = [];

  for (const screen of screens) {
    console.log(`\n  [${screen.id}] ${screen.name}`);

    const { browser, context, page } = await createBrowserAndPage(vps[0], config);
    let screenWarnings = [];
    let needReopen = true;

    try {
      const filteredVps = config.viewportFilter
        ? vps.filter((v) => v.name === config.viewportFilter)
        : vps;

      if (filteredVps.length === 0) {
        console.error(`    ERROR: viewport filter "${config.viewportFilter}" matched no viewports`);
        screenWarnings.push(`No viewports matched filter: ${config.viewportFilter}`);
      }

      const variants = [];
      const actionPath = screen.actionPath || [];
      const entryIndex = screen.entryIndex;

      for (const vp of filteredVps) {
        console.log(`    viewport: ${vp.name} (${vp.width}x${vp.height}@${vp.deviceScaleFactor}x)`);

        try {
          if (needReopen) {
            await navigateAndSettle(page, config.canonicalUrl, config);
            await ensurePrototypeMapClosed(page);
            const result = await replayActionPath(page, actionPath, entryIndex, config.prototypeMapText);
            if (!result.success) {
              screenWarnings.push(`Action replay failed for ${screen.id}: ${result.warning}`);
              warnings.push(`screen:${screen.id}: ${result.warning}`);
              needReopen = false;
              continue;
            }
            needReopen = false;
            await page.waitForTimeout(1000);
            try { await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {}); } catch (_) {}
          }

          const variant = await captureViewport(page, vp, screen, config);
          if (screenWarnings.length > 0) variant.warnings = screenWarnings;
          variants.push(variant);
          console.log(`      screenshot: ${variant.screenshot.path} (${variant.screenshot.file_size} bytes)`);
        } catch (err) {
          const msg = `viewport ${vp.name} failed for screen ${screen.id}: ${err.message}`;
          console.warn(`      WARNING: ${msg}`);
          screenWarnings.push(msg);
          warnings.push(`screen:${screen.id}:${vp.name}: ${err.message}`);
        }
      }

      designScreens.push({
        id: screen.id,
        name: screen.name,
        source_path: "index.html",
        source_hash: null,
        kind: "prototype-page",
        preview_url: config.canonicalUrl,
        route_hint: "/",
        discovery_strategy: screen.discoveryStrategy || "prototype-map",
        action_path: actionPath,
        confidence: "high",
        variants,
        warnings: screenWarnings,
      });
    } finally {
      await browser.close();
    }
  }

  writeDesignIR({
    outputRoot: config.outputRoot,
    project: config.project,
    startUrl: config.canonicalUrl,
    headless: config.headless,
    viewports: vps,
    screens: designScreens,
    warnings,
  });

  const totalVariants = designScreens.reduce((sum, s) => sum + (s.variants || []).length, 0);
  console.log(`\n  CAPTURE complete: ${designScreens.length} screens, ${totalVariants} variants captured`);

  if (config.deep) {
    designScreens = await runDeepCapture(config, screens, designScreens);

    if (config.dedup) {
      const dd = deduplicateScreenshots(config.outputRoot, designScreens);
      designScreens = dd.designScreens;
    }

    const deepScreens = designScreens.filter((s) => s.discovery_strategy === "deep");
    if (deepScreens.length > 0) {
      appendDeepToPrototypeMap(config.outputRoot, deepScreens);
      appendDeepToSourceMap(config.outputRoot, deepScreens, vps);
    }
    writeDesignIR({
      outputRoot: config.outputRoot,
      project: config.project,
      startUrl: config.canonicalUrl,
      headless: config.headless,
      viewports: vps,
      screens: designScreens,
      warnings,
    });
  }
}

async function runDeepCapture(config, pmScreens, designScreens) {
  console.log(`\n=== DEEP CRAWL ===`);
  console.log(`  max depth: ${config.deepMaxDepth}`);
  console.log(`  max screens: ${config.deepMaxScreens}`);

  const allContentHashes = new Set();
  for (const s of designScreens) {
    for (const v of s.variants) {
      if (v._contentHash) allContentHashes.add(v._contentHash);
    }
  }

  let deepScreenCounter = 0;
  const vps = config.viewportFilter
    ? config.viewports.filter((v) => v.name === config.viewportFilter)
    : config.viewports;

  for (const screen of pmScreens) {
    if (deepScreenCounter >= config.deepMaxScreens) break;

    console.log(`\n  exploring: [${screen.id}] ${screen.name}`);

    const vp = config.viewports[0];
    const { browser, context, page } = await createBrowserAndPage(vp, config);

    try {
      await navigateAndSettle(page, config.canonicalUrl, config);
      await ensurePrototypeMapClosed(page);
      const actionPath = screen.actionPath || [];
      const entryIndex = screen.entryIndex;
      const result = await replayActionPath(page, actionPath, entryIndex, config.prototypeMapText);
      if (!result.success) continue;
      await page.waitForTimeout(1000);
      try { await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {}); } catch (_) {}

      const deepElements = await findDeepElements(page, config.canonicalUrl);
      console.log(`    found ${deepElements.length} interactive elements`);

      for (const dEl of deepElements) {
        if (deepScreenCounter >= config.deepMaxScreens) break;

        await navigateAndSettle(page, config.canonicalUrl, config);
        await ensurePrototypeMapClosed(page);
        await replayActionPath(page, actionPath, entryIndex, config.prototypeMapText);
        await page.waitForTimeout(500);
        try { await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {}); } catch (_) {}

        try {
          if (dEl.selector) {
            await page.click(`#${dEl.selector}, [data-testid="${dEl.selector}"]`, { timeout: 3000 });
          } else if (dEl.href && dEl.tag === "a") {
            await page.click(`a[href="${dEl.href.replace(/"/g, '\\"')}"]`, { timeout: 3000 });
          } else {
            const btn = page.getByText(dEl.label, { exact: false }).first();
            if (await btn.count() > 0) await btn.click({ timeout: 3000 });
            else await page.mouse.click(dEl.center.x, dEl.center.y);
          }
        } catch (e) {
          continue;
        }

        await page.waitForTimeout(800);
        try { await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {}); } catch (_) {}

        await ensurePrototypeMapClosed(page);
        await page.waitForTimeout(300);

        const hash = await computeContentHash(page);
        if (allContentHashes.has(hash)) continue;

        allContentHashes.add(hash);
        deepScreenCounter++;

        const deepActionPath = [...actionPath, {
          type: "clickDeepElement",
          label: dEl.label,
          tag: dEl.tag,
        }];

        const deepScreen = {
          id: `deep-${String(deepScreenCounter).padStart(2, "0")}-${slugify(screen.name)}-${slugify(dEl.label)}`,
          name: `[${screen.name}] ${dEl.label}`,
          source_path: "index.html",
          source_hash: null,
          kind: "deep-element",
          preview_url: config.canonicalUrl,
          route_hint: "/",
          discovery_strategy: "deep",
          parent_screen_id: screen.id,
          deep_entry_index: dEl.index,
          deep_entry_label: dEl.label,
          deep_entry_tag: dEl.tag,
          deep_bounds: dEl.bounds,
          deep_center: dEl.center,
          action_path: deepActionPath,
          confidence: "medium",
          variants: [],
          warnings: [],
        };

        for (const v of vps) {
          try {
            const variant = await captureViewport(page, v, deepScreen, config);
            variant._contentHash = hash;
            deepScreen.variants.push(variant);
          } catch (err) {
            deepScreen.warnings.push(`${v.name}: ${err.message}`);
          }
        }

        if (deepScreen.variants.length > 0) {
          designScreens.push(deepScreen);
          console.log(`      [${deepScreen.id}] ${dEl.label} (${deepScreen.variants.length} variants)`);
        }
      }
    } finally {
      await browser.close();
    }
  }

  console.log(`\n  DEEP complete: ${deepScreenCounter} new screens discovered`);
  return designScreens;
}

function deduplicateScreenshots(outputRoot, designScreens) {
  console.log(`\n=== DEDUP ===`);

  const hashToInfo = new Map();

  for (const screen of designScreens) {
    for (const variant of screen.variants) {
      const relPath = variant.screenshot.path;
      const filePath = join(outputRoot, "design-processing", relPath);
      if (!existsSync(filePath)) {
        console.warn(`    [warn] screenshot not found: ${filePath}`);
        continue;
      }

      const bytes = readFileSync(filePath);
      const hash = createHash("sha256").update(bytes).digest("hex");

      if (hashToInfo.has(hash)) {
        const existing = hashToInfo.get(hash);
        if (screen.discovery_strategy === "prototype-map" && existing.strategy === "deep") {
          hashToInfo.set(hash, { screenId: screen.id, variantId: variant.id, strategy: screen.discovery_strategy, filePath });
          console.log(`    dedup: ${existing.variantId} (deep) overwritten by ${variant.id} (pm)`);
        } else {
          console.log(`    dedup: ${variant.id} == ${existing.variantId} (duplicate, keeping ${existing.strategy})`);
        }
      } else {
        hashToInfo.set(hash, { screenId: screen.id, variantId: variant.id, strategy: screen.discovery_strategy, filePath });
      }
    }
  }

  const keepVariantIds = new Set(Array.from(hashToInfo.values()).map((v) => v.variantId));

  let removedVariants = 0;
  let removedScreens = 0;

  for (const screen of designScreens) {
    const before = screen.variants.length;
    screen.variants = screen.variants.filter((v) => {
      if (!keepVariantIds.has(v.id)) {
        const filePath = join(outputRoot, "design-processing", v.screenshot.path);
        try { unlinkSync(filePath); } catch (_) {}
        removedVariants++;
        return false;
      }
      return true;
    });
    if (screen.variants.length === 0 && before > 0) {
      removedScreens++;
    }
  }

  const filtered = designScreens.filter((s) => s.variants.length > 0);

  if (removedVariants > 0) {
    console.log(`  removed ${removedVariants} duplicate variants, ${removedScreens} empty screens`);
    console.log(`  screens: ${filtered.length} (was ${designScreens.length})`);
  } else {
    console.log(`  no duplicates found`);
  }

  return { designScreens: filtered, removedVariants, removedScreens };
}

function appendDeepToPrototypeMap(outputRoot, deepScreens) {
  const filePath = join(outputRoot, "visual-regression", "fixtures", "prototype-map.json");
  if (!existsSync(filePath)) return;

  const doc = JSON.parse(readFileSync(filePath, "utf-8"));
  const indexLen = String(doc.pages.length + deepScreens.length).length;

  for (const ds of deepScreens) {
    doc.pages.push({
      id: ds.id,
      name: ds.name,
      entryIndex: null,
      entryLabel: ds.name,
      pageId: null,
      selector: null,
      bounds: ds.deep_bounds || { x: 0, y: 0, width: 0, height: 0 },
      center: ds.deep_center || { x: 0, y: 0 },
      discoveryStrategy: "deep",
      parentScreenId: ds.parent_screen_id,
      actionPath: ds.action_path,
      warnings: [],
    });
  }

  doc.discovery.entryCount = doc.pages.length;
  doc.discovery.deepEntryCount = deepScreens.length;
  doc.generatedAt = isoNow();

  writeFileSync(filePath, JSON.stringify(doc, null, 2) + "\n");
  console.log(`  appended ${deepScreens.length} deep pages to prototype-map.json (total: ${doc.pages.length})`);
}

function appendDeepToSourceMap(outputRoot, deepScreens, viewports) {
  const filePath = join(outputRoot, "visual-regression", "fixtures", "source-map.json");
  if (!existsSync(filePath)) return;

  const doc = JSON.parse(readFileSync(filePath, "utf-8"));
  const vpNames = viewports.map((v) => v.name);

  for (const ds of deepScreens) {
    doc.screens.push({
      id: ds.id,
      name: ds.name,
      url: ds.preview_url,
      discoveryStrategy: "deep",
      parentScreenId: ds.parent_screen_id,
      entryIndex: null,
      actionPath: ds.action_path,
      viewports: vpNames,
    });
  }

  doc.deepEntryCount = deepScreens.length;
  doc.generatedAt = isoNow();

  writeFileSync(filePath, JSON.stringify(doc, null, 2) + "\n");
  console.log(`  appended ${deepScreens.length} deep screens to source-map.json (total: ${doc.screens.length})`);
}

function joinUrl(baseUrl, route) {
  const base = baseUrl.replace(/\/+$/, "");
  const path = route.startsWith("/") ? route : `/${route}`;
  return `${base}${path}`;
}

function normalizeRouteMap(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (raw.entries && typeof raw.entries === "object" && !Array.isArray(raw.entries)) {
    return Object.entries(raw.entries).map(([id, entry]) => ({ ...entry, id: entry.id || id }));
  }
  if (Array.isArray(raw.entries)) return raw.entries;
  return [];
}

function resolveReferenceScreenshot(routeMapDir, refPath) {
  if (!refPath) return null;
  if (refPath.startsWith("/")) return refPath;
  return resolve(routeMapDir, refPath);
}

function compareScreenshots(actualBuf, refBuf, entry) {
  const actualPng = PNG.sync.read(actualBuf);
  const refPng = PNG.sync.read(refBuf);

  if (actualPng.width !== refPng.width || actualPng.height !== refPng.height) {
    return {
      passed: false, diffPixels: actualPng.width * actualPng.height,
      diffPixelRatio: 1, reason: "dimension_mismatch",
      actualWidth: actualPng.width, actualHeight: actualPng.height,
      refWidth: refPng.width, refHeight: refPng.height,
    };
  }

  const { width, height } = actualPng;
  const diff = new PNG({ width, height });
  const threshold = entry.threshold ?? 0.2;
  const diffPixels = pixelmatch(actualPng.data, refPng.data, diff.data, width, height, { threshold });
  const totalPixels = width * height;
  const diffPixelRatio = totalPixels > 0 ? diffPixels / totalPixels : 0;
  const maxDiffPixels = entry.maxDiffPixels ?? 200;
  const maxDiffPixelRatio = entry.maxDiffPixelRatio ?? 0.001;
  const passed = diffPixels <= maxDiffPixels && diffPixelRatio <= maxDiffPixelRatio;

  return {
    passed, diffPixels, diffPixelRatio, maxDiffPixels, maxDiffPixelRatio, threshold,
    diffBuf: PNG.sync.write(diff),
  };
}

function writeComparisonReportJson(resultsDir, report) {
  const jsonPath = join(resultsDir, "comparison-report.json");
  writeFileSync(jsonPath, JSON.stringify(report, null, 2) + "\n");
  console.log(`  wrote ${jsonPath}`);
  return jsonPath;
}

function writeComparisonReportMd(resultsDir, report) {
  const mdPath = join(resultsDir, "comparison-report.md");
  const lines = [];
  lines.push("# Visual Comparison Report");
  lines.push("");
  lines.push(`Project: \`${report.project.slug}\``);
  lines.push("");
  lines.push(`Frontend URL: \`${report.frontend.url}\``);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  const s = report.summary;
  lines.push("| Total | Passed | Failed | Skipped |");
  lines.push("|---:|---:|---:|---:|");
  lines.push(`| ${s.total} | ${s.passed} | ${s.failed} | ${s.skipped} |`);
  lines.push("");
  lines.push("## Results");
  lines.push("");
  lines.push("| Entry | Screen | Viewport | Route | Status | Diff Pixels | Diff Ratio |");
  lines.push("|---|---|---|---|---|---:|---:|");

  for (const r of report.results) {
    const status = r.status === "passed" ? "passed" : r.status === "failed" ? "failed" : "skipped";
    const diffPx = r.diffPixels != null ? String(r.diffPixels) : "—";
    const diffRatio = r.diffPixelRatio != null ? r.diffPixelRatio.toFixed(6) : "—";
    lines.push(`| ${r.id} | ${r.screenName} | ${r.viewport.name} | ${r.implementationRoute || "—"} | ${status} | ${diffPx} | ${diffRatio} |`);
  }

  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("**Actual screenshots:** `actual/`");
  lines.push("");
  lines.push("**Diff screenshots:** `diff/`");
  lines.push("");

  writeFileSync(mdPath, lines.join("\n") + "\n");
  console.log(`  wrote ${mdPath}`);
  return mdPath;
}

async function runCompare(config) {
  console.log(`\n=== COMPARE: ${config.project} ===`);
  console.log(`  frontend URL: ${config.frontendUrl}`);
  console.log(`  output root: ${config.outputRoot}`);

  const routeMapPath = config.routeMapPath ||
    join(config.outputRoot, "visual-regression", "fixtures", "route-map.json");

  if (!existsSync(routeMapPath)) {
    console.error(`  ERROR: route-map.json not found at ${routeMapPath}`);
    console.error("  Run 'discover' and 'capture' first, then ensure route-map.json exists.");
    process.exit(1);
  }

  const routeMapRaw = JSON.parse(readFileSync(routeMapPath, "utf-8"));
  const entries = normalizeRouteMap(routeMapRaw);

  if (entries.length === 0) {
    console.error("  ERROR: no entries found in route-map.json");
    process.exit(1);
  }

  const entriesWithRoutes = entries.filter((e) => e.implementationRoute);
  if (entriesWithRoutes.length === 0) {
    console.error("\nNo implementationRoute values found in route-map.json.");
    console.error("");
    console.error("Edit:");
    console.error(`workspace/design-context/${config.project}/visual-regression/fixtures/route-map.json`);
    console.error("");
    console.error("Set implementationRoute for each screen, for example:");
    console.error("");
    console.error('"implementationRoute": "/001-dashboard"');
    console.error("");
    console.error("Then rerun:");
    console.error(`./bin/oe speckit:visual ${config.project} compare --frontend-url ${config.frontendUrl}`);
    process.exit(1);
  }

  const routeMapDir = dirname(resolve(routeMapPath));
  const resultsDir = config.testResultsDir ||
    join(config.outputRoot, "visual-regression", "test-results");

  ensureDir(resultsDir);
  ensureDir(join(resultsDir, "actual"));
  ensureDir(join(resultsDir, "diff"));

  const firstEntry = entriesWithRoutes[0];
  const firstVp = firstEntry.viewport || DEFAULT_VIEWPORTS[0];
  const vp = { width: firstVp.width, height: firstVp.height, deviceScaleFactor: firstVp.deviceScaleFactor || 1 };
  const timeoutMs = config.compareTimeoutMs;

  const { browser, page } = await createBrowserAndPage(vp, { ...config, timeoutMs });

  const warnings = [];
  const results = [];

  try {
    if (!config.skipFrontendHealthcheck) {
      console.log(`  checking frontend: ${config.frontendUrl}`);
      try {
        await page.goto(config.frontendUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
        console.log("  frontend reachable");
      } catch (err) {
        console.error(`\nFrontend URL is not reachable: ${config.frontendUrl}`);
        console.error("");
        console.error("Start the frontend staging app first:");
        console.error("");
        console.error(`./bin/oe speckit:frontend-stage ${config.project} start`);
        console.error("");
        console.error("Then rerun:");
        console.error(`./bin/oe speckit:visual ${config.project} compare --frontend-url ${config.frontendUrl}`);
        await browser.close();
        process.exit(1);
      }
    }

    for (const entry of entries) {
      const id = entry.id || `${entry.screenId}__${(entry.viewport || {}).name || "unknown"}`;
      const screenId = entry.screenId || id;
      const screenName = entry.screenName || screenId;
      const route = entry.implementationRoute;
      const evp = entry.viewport || { name: "desktop", width: 1440, height: 1024, deviceScaleFactor: 1 };

      if (!route) {
        console.log(`  - ${id} skipped (no implementationRoute)`);
        results.push({
          id, screenId, screenName, viewport: evp, implementationRoute: null,
          url: null, referenceScreenshot: entry.referenceScreenshot || null,
          actualScreenshot: null, diffScreenshot: null,
          status: "skipped", warnings: ["Missing implementationRoute"],
        });
        continue;
      }

      if (!entry.referenceScreenshot) {
        console.log(`  - ${id} skipped (no referenceScreenshot)`);
        results.push({
          id, screenId, screenName, viewport: evp, implementationRoute: route,
          url: joinUrl(config.frontendUrl, route), referenceScreenshot: null,
          actualScreenshot: null, diffScreenshot: null,
          status: "skipped", warnings: ["Missing referenceScreenshot"],
        });
        continue;
      }

      if (!evp.width || !evp.height) {
        console.log(`  - ${id} skipped (invalid viewport)`);
        results.push({
          id, screenId, screenName, viewport: evp, implementationRoute: route,
          url: joinUrl(config.frontendUrl, route),
          referenceScreenshot: entry.referenceScreenshot,
          actualScreenshot: null, diffScreenshot: null,
          status: "skipped", warnings: ["Invalid viewport dimensions"],
        });
        continue;
      }

      const refPath = resolveReferenceScreenshot(routeMapDir, entry.referenceScreenshot);
      if (!existsSync(refPath)) {
        warnings.push(`Missing reference screenshot for ${id}: ${refPath}`);
        console.log(`  - ${id} skipped (reference screenshot missing)`);
        results.push({
          id, screenId, screenName, viewport: evp, implementationRoute: route,
          url: joinUrl(config.frontendUrl, route), referenceScreenshot: entry.referenceScreenshot,
          actualScreenshot: null, diffScreenshot: null,
          status: "skipped", warnings: [`Reference screenshot not found: ${refPath}`],
        });
        continue;
      }

      const pageUrl = joinUrl(config.frontendUrl, route);
      console.log(`  [${id}] ${screenName} → ${pageUrl}`);

      try {
        await page.setViewportSize({ width: evp.width, height: evp.height }).catch(() => {});
        const resp = await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });

        await page.waitForLoadState("networkidle", { timeout: timeoutMs }).catch(() => {});

        try { await page.evaluate(() => document.fonts.ready); } catch (_) {}

        await page.addStyleTag({ content: DETERMINISTIC_CSS });
        await page.waitForTimeout(config.settleMs);

        const actualBuf = await page.screenshot({
          animations: "disabled",
          caret: "hide",
          scale: "css",
        });

        const refBuf = readFileSync(refPath);

        const actualOut = join(resultsDir, "actual", `${id}.png`);
        writeFileSync(actualOut, actualBuf);

        const cmp = compareScreenshots(actualBuf, refBuf, entry);

        let diffOut = null;
        if (cmp.diffBuf) {
          diffOut = join(resultsDir, "diff", `${id}.png`);
          writeFileSync(diffOut, cmp.diffBuf);
        }

        const status = cmp.passed ? "passed" : "failed";

        if (status === "passed") {
          console.log(`    \x1b[32m✓ passed\x1b[0m diff=${cmp.diffPixels} ratio=${cmp.diffPixelRatio.toFixed(6)}`);
        } else {
          const reason = cmp.reason || `diff=${cmp.diffPixels} ratio=${cmp.diffPixelRatio.toFixed(6)}`;
          console.log(`    \x1b[31m✗ failed\x1b[0m ${reason}`);
          if (cmp.actualWidth && cmp.refWidth) {
            console.log(`      actual: ${cmp.actualWidth}x${cmp.actualHeight}  ref: ${cmp.refWidth}x${cmp.refHeight}`);
          }
        }

        const entryWarnings = [];
        if (resp && !resp.ok()) {
          entryWarnings.push(`HTTP status ${resp.status()} for ${pageUrl}`);
        }

        results.push({
          id, screenId, screenName,
          viewport: { name: evp.name, width: evp.width, height: evp.height, deviceScaleFactor: evp.deviceScaleFactor || 1 },
          implementationRoute: route,
          url: pageUrl,
          referenceScreenshot: entry.referenceScreenshot,
          actualScreenshot: `actual/${id}.png`,
          diffScreenshot: cmp.diffBuf ? `diff/${id}.png` : null,
          status,
          diffPixels: cmp.diffPixels,
          diffPixelRatio: cmp.diffPixelRatio,
          maxDiffPixels: cmp.maxDiffPixels,
          maxDiffPixelRatio: cmp.maxDiffPixelRatio,
          threshold: cmp.threshold,
          warnings: entryWarnings,
        });
      } catch (err) {
        const msg = err.message || String(err);
        console.log(`    \x1b[33m! error\x1b[0m ${msg}`);
        warnings.push(`entry ${id}: ${msg}`);
        results.push({
          id, screenId, screenName,
          viewport: { name: evp.name, width: evp.width, height: evp.height, deviceScaleFactor: evp.deviceScaleFactor || 1 },
          implementationRoute: route,
          url: pageUrl,
          referenceScreenshot: entry.referenceScreenshot || null,
          actualScreenshot: null, diffScreenshot: null,
          status: "failed",
          warnings: [msg],
        });
      }
    }
  } finally {
    await browser.close();
  }

  const total = results.length;
  const passed = results.filter((r) => r.status === "passed").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const skipped = results.filter((r) => r.status === "skipped").length;

  const report = {
    version: 1,
    generated_at: isoNow(),
    project: { slug: config.project },
    frontend: { url: config.frontendUrl },
    route_map: relative(dirname(resultsDir), routeMapPath),
    summary: { total, passed, failed, skipped },
    results,
    warnings,
  };

  const jsonPath = writeComparisonReportJson(resultsDir, report);
  const mdPath = writeComparisonReportMd(resultsDir, report);

  console.log(`\n  Summary: ${passed} passed, ${failed} failed, ${skipped} skipped (${total} total)`);
  console.log(`\n  Report:`);
  console.log(`  ${mdPath}`);

  const exitCode = (config.failOnDiff && !config.updateActual && failed > 0) ? 1 : 0;
  if (exitCode !== 0) {
    console.log(`\n${failed} visual comparison${failed === 1 ? " has" : "s have"} failed.`);
    process.exit(exitCode);
  }
}

async function main() {
  const rawArgs = parseArgs(process.argv.slice(2));
  const config = resolveConfig(rawArgs);

  if (config.command === "discover") {
    await runDiscover(config);
  } else if (config.command === "capture") {
    await runCapture(config);
  } else if (config.command === "compare") {
    await runCompare(config);
  } else if (config.command === "all") {
    await runDiscover(config);
    await runCapture(config);
  }
}

main().catch((err) => {
  console.error("FATAL:", err.message);
  process.exit(1);
});
