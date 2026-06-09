const { chromium } = require('playwright');
const fs = require('fs');

const STATE_FILE = 'auth_state.json';

(async () => {
  if (!fs.existsSync(STATE_FILE)) {
    console.error("Error: No se encontró la sesión (auth_state.json). Primero debes iniciar sesión.");
    process.exit(1);
  }

  const browser = await chromium.launch({ 
    headless: false,
    args: [
      '--start-maximized',
      '--disable-features=Translate'
    ]
  });
  
  const context = await browser.newContext({ 
    viewport: null, 
    storageState: STATE_FILE 
  });
  
  const page = await context.newPage();

  console.log("Cargando el inicio de Unusual Whales...");
  // Si inicia sesión correctamente, la ruta base '/' funciona como dashboard o portal central
  await page.goto('https://unusualwhales.com/');

  // Esperamos a que la página termine de cargar bien
  await page.waitForLoadState('networkidle');

  console.log("Capturando HTML...");
  const html = await page.content();

  fs.writeFileSync('uw.html', html);
  console.log('Snapshot guardado en uw.html');

  await browser.close();
})();