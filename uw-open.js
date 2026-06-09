require('dotenv').config();
const { chromium } = require('playwright');
const fs = require('fs');

const STATE_FILE = 'auth_state.json';

(async () => {
  const browser = await chromium.launch({
    headless: false,
    args: [
      '--start-maximized',           // Abre el navegador maximizado
      '--disable-features=Translate' // Desactiva el popup de Google Translate
    ]
  });

  // Si pasamos el argumento --login en la terminal, forzamos el inicio de sesión
  const forceLogin = process.argv.includes('--login');
  const hasState = fs.existsSync(STATE_FILE);

  let context;
  
  if (hasState && !forceLogin) {
    console.log("Sesión encontrada. Cargando navegador con sesión previa...");
    context = await browser.newContext({ viewport: null, storageState: STATE_FILE });
  } else {
    console.log("Iniciando contexto nuevo sin sesión previa...");
    context = await browser.newContext({ viewport: null });
  }

  const page = await context.newPage();

  if (!hasState || forceLogin) {
    console.log("Abriendo el navegador y cargando la página de login...");
    await page.goto('https://unusualwhales.com/login');

    console.log(`Sitio cargado. Insertando credenciales de forma segura para: ${process.env.UW_EMAIL}`);

    try {
      const emailInput = page.getByPlaceholder('name@address.com');
      const passwordInput = page.getByPlaceholder('Enter your password');

      await emailInput.waitFor({ state: 'visible', timeout: 10000 });

      await emailInput.fill(process.env.UW_EMAIL);
      await passwordInput.fill(process.env.UW_PASSWORD);
      
      console.log("Credenciales inyectadas desde el archivo .env");
      
      const loginButton = page.getByRole('button', { name: 'Sign in', exact: true });
      await loginButton.click();
      
      console.log("Iniciando sesión... Esperando a que cargue la página principal. POR FAVOR NO CIERRES EL NAVEGADOR.");
      
      try {
        // Esperamos a que la URL cambie (salga del login)
        await page.waitForURL('**/unusualwhales.com/**', { timeout: 15000 });
        await page.waitForTimeout(2000); 
      } catch (e) {
        // Ignoramos si hay timeout, igual intentamos guardar
      }
      
      // Guardamos el estado (cookies y localStorage) para la próxima vez
      await context.storageState({ path: STATE_FILE });
      console.log(`Sesión guardada exitosamente en el archivo oculto ${STATE_FILE}.`);
      
    } catch (error) {
      console.log("Error de Playwright:", error.message);
    }
  } else {
    console.log("Yendo a la página principal ya con la sesión iniciada...");
    await page.goto('https://unusualwhales.com');
  }

  console.log("El script ha terminado, el navegador queda abierto...");
  
  // No cerramos el browser automáticamente para que puedas usarlo
  // await browser.close();
})();