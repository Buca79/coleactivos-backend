// ColeActivos – Backend 100% operativo en Render (sin instalar Chrome)
// Usa puppeteer-core + @sparticuz/chromium (binario empaquetado para serverless)

import express from "express";
import cors from "cors";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

const app = express();
app.use(cors());

app.get("/", (_req, res) => res.send("✅ ColeActivos backend operativo (chromium serverless)"));

function normPatente(p) {
  return (p || "").toString().trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

async function lanzarNavegador() {
  // Config recomendado por @sparticuz/chromium para Node en serverless (Render)
  const executablePath = await chromium.executablePath();

  return puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath,                 // <- sin Chrome del sistema
    headless: chromium.headless,    // true en serverless
    ignoreHTTPSErrors: true
  });
}

async function evaluarPatente(page, patente) {
  // 1) Ir a la página
  await page.goto("https://apps.mtt.cl/consultaweb", {
    waitUntil: "domcontentloaded",
    timeout: 60000
  });

  // 2) Buscar primer input visible y escribir la patente
  await page.waitForSelector('input[type="text"]', { timeout: 15000 });
  await page.type('input[type="text"]', patente, { delay: 40 });

  // 3) Enviar (si hay botón visible de Buscar, clic; si no, Enter)
  const clicked = await page.$$eval(
    'input[type="submit"],button[type="submit"],input[value*="Buscar"],button',
    els => {
      const btn = els.find(e => e && e.offsetParent !== null && /buscar/i.test(e.innerText || e.value || ""));
      if (btn) { btn.click(); return true; }
      return false;
    }
  );
  if (!clicked) await page.keyboard.press("Enter");

  // 4) Esperar contenido útil
  await page.waitForFunction(() => {
    const t = document.body.innerText.toLowerCase();
    return t.includes("tipo de servicio") ||
           t.includes("no existen resultados") ||
           t.includes("no se encontraron") ||
           t.length > 3500;
  }, { timeout: 60000 });

  // 5) Analizar texto
  const texto = (await page.evaluate(() => document.body.innerText)).toLowerCase();

  // Señales
  const tieneTipo = texto.includes("tipo de servicio");
  const esColectivo = texto.includes("colectivo");
  const noResultados = texto.includes("no existen resultados") || texto.includes("no se encontraron");

  let tipo = "otro";
  let ok = false;

  if (tieneTipo && esColectivo) { tipo = "colectivo"; ok = true; }
  else if (noResultados) { tipo = "no-encontrado"; }
  else if (texto.includes("taxi")) { tipo = "taxi"; }
  else if (texto.includes("bus")) { tipo = "bus"; }

  return { ok, tipo, rawTextLen: texto.length };
}

app.get("/api/verificar-patente", async (req, res) => {
  const patente = normPatente(req.query.patente);
  if (!/^[A-Z0-9]{5,8}$/.test(patente)) {
    return res.json({ ok: false, tipo: "invalida", patente });
  }

  const t0 = Date.now();
  let browser;

  try {
    browser = await lanzarNavegador();
    const page = await browser.newPage();

    // user-agent decente y headers en español
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"
    );
    await page.setExtraHTTPHeaders({ "Accept-Language": "es-CL,es;q=0.9,en;q=0.8" });

    // Un intento + un reintento suave si el primero no encuentra “tipo de servicio”
    const r1 = await evaluarPatente(page, patente);
    let resultado = r1;

    if (!r1.ok && r1.tipo === "otro") {
      // pequeño backoff y reintento (el sitio a veces tarda)
      await page.waitForTimeout(1800);
      resultado = await evaluarPatente(page, patente);
    }

    return res.json({
      ok: resultado.ok,
      tipo: resultado.tipo,
      patente,
      ms: Date.now() - t0
    });
  } catch (err) {
    return res.json({ ok: false, tipo: "error", detalle: String(err), ms: Date.now() - t0 });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor activo en puerto ${PORT}`));
