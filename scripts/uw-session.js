// TEMPORARY shared helper, extracted from uw-window-fetch.js's proven login flow.
// Once the gamma-history/gamma-forward scrapers fold into the daily OI capture
// pipeline (uw:daily), this can be removed in favor of that pipeline's own session
// handling — this module exists only to avoid tripling the same login logic while
// these scrapers are still standalone scripts.
const STATE_FILE = require('path').join(__dirname, '..', 'auth_state.json');

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

    await ctx.storageState({ path: STATE_FILE });
    console.log(`Session state updated and saved to ${STATE_FILE}`);

    loggedIn = await checkUserLoggedIn(p, userEmail);
    if (!loggedIn) throw new Error("Email still not found after login attempt");
  }
  console.log(`Session verified! User ${userEmail} is logged in.`);
}

module.exports = { ensureLoggedIn, checkUserLoggedIn, STATE_FILE };
