// TEMPORARY shared helper, extracted from uw-window-fetch.js's proven login flow.
// Once the gamma-history/gamma-forward scrapers fold into the daily OI capture
// pipeline (uw:daily), this can be removed in favor of that pipeline's own session
// handling — this module exists only to avoid tripling the same login logic while
// these scrapers are still standalone scripts.
const fs = require('fs');
const path = require('path');
const STATE_FILE = path.join(__dirname, '..', 'auth_state.json');
const DEBUG_DIR = path.join(__dirname, '..', 'debug');

// Dumps a screenshot + the page HTML so a failed CI run leaves evidence of
// *why* the login didn't take (bot-challenge page, 2FA prompt, changed
// selectors, etc.) instead of just the generic "Email still not found"
// error. Never throws - a failure here shouldn't mask the real error.
async function captureDebugState(p, label) {
  try {
    if (!fs.existsSync(DEBUG_DIR)) fs.mkdirSync(DEBUG_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const base = path.join(DEBUG_DIR, `${stamp}_${label}`);
    await p.screenshot({ path: `${base}.png`, fullPage: true });
    fs.writeFileSync(`${base}.html`, await p.content());
    console.log(`Debug capture saved: ${base}.png / .html`);
  } catch (e) {
    console.log(`Debug capture failed (non-fatal): ${e.message}`);
  }
}

// CI containers check out fresh with no auth_state.json (gitignored, never
// persisted between runs), so every job used to hit the login form cold via
// UW_EMAIL/UW_PASSWORD. Optional escape hatch: seed a session captured
// locally instead of resubmitting the form. Not currently wired up to any
// CircleCI env var (the actual intermittent-failure cause turned out to be
// a hydration race in checkUserLoggedIn below, not UW blocking the login -
// see the retry loop in ensureLoggedIn), but left here in case a real
// auth block shows up later.
if (!fs.existsSync(STATE_FILE) && process.env.UW_AUTH_STATE_B64) {
  fs.writeFileSync(STATE_FILE, Buffer.from(process.env.UW_AUTH_STATE_B64, 'base64'));
  console.log(`Seeded ${STATE_FILE} from UW_AUTH_STATE_B64.`);
}

async function checkUserLoggedIn(p, userEmail) {
  try {
    await p.goto("https://unusualwhales.com/settings", { waitUntil: "networkidle", timeout: 20000 });
    const html = await p.content();
    if (html.toLowerCase().includes(userEmail)) return true;
  } catch (e) {
    console.log("Settings page check failed/timed out, checking homepage fallback...");
  }
  try {
    await p.goto("https://unusualwhales.com/", { waitUntil: "networkidle", timeout: 20000 });
    const html = await p.content();
    return html.toLowerCase().includes(userEmail);
  } catch (e) {
    return false;
  }
}

async function ensureLoggedIn(p, ctx) {
  const userEmail = process.env.UW_EMAIL ? process.env.UW_EMAIL.toLowerCase() : "fsuar813@gmail.com";
  let loggedIn = await checkUserLoggedIn(p, userEmail);
  if (!loggedIn) {
    console.log(`User ${userEmail} is NOT logged in. Attempting automatic login...`);
    await p.goto('https://unusualwhales.com/login', { waitUntil: 'networkidle', timeout: 30000 });
    const emailInput = p.locator('input[type="email"], input[name="email"], input[placeholder*="@"], input[placeholder*="email"], input[placeholder*="Address"]').first();
    const passwordInput = p.locator('input[type="password"], input[name="password"], input[placeholder*="password"]').first();

    await emailInput.waitFor({ state: 'visible', timeout: 15000 });
    await emailInput.fill(process.env.UW_EMAIL);
    await passwordInput.fill(process.env.UW_PASSWORD);

    const loginButton = p.getByRole('button', { name: 'Sign in', exact: true });
    await loginButton.click();

    console.log("Submitting login form... Waiting for redirect...");
    await p.waitForURL('**/unusualwhales.com/**', { timeout: 20000 });
    await p.waitForLoadState('networkidle');
    await p.waitForTimeout(3000);

    await captureDebugState(p, 'post-submit-redirect');

    await ctx.storageState({ path: STATE_FILE });
    console.log(`Session state updated and saved to ${STATE_FILE}`);

    loggedIn = await checkUserLoggedIn(p, userEmail);
    // The check reads the email out of the settings/homepage HTML right
    // after `networkidle` fires, but `networkidle` only means the network
    // went quiet - it doesn't guarantee the account info has hydrated into
    // the DOM yet. That gap is what actually causes the intermittent
    // failures (this same script succeeds on most other runs with no
    // credential/environment change), not UW blocking the login. Retry a
    // few times with a pause before giving up, instead of failing the whole
    // job on what's likely just a slow render.
    for (let attempt = 1; !loggedIn && attempt <= 3; attempt++) {
      console.log(`Login not yet confirmed (attempt ${attempt}/3), waiting for hydration and rechecking...`);
      await p.waitForTimeout(4000);
      loggedIn = await checkUserLoggedIn(p, userEmail);
    }
    if (!loggedIn) {
      await captureDebugState(p, 'final-check-failed');
      throw new Error("Email still not found after login attempt");
    }
  }
  console.log(`Session verified! User ${userEmail} is logged in.`);
}

module.exports = { ensureLoggedIn, checkUserLoggedIn, STATE_FILE, DEBUG_DIR };
