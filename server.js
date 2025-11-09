// ColeActivos – Verificador de Patentes (Render + Puppeteer correcto)
// Busca “colectivo” específicamente en el “Tipo de Servicio” del MTT.
// Endpoints:
//   GET /                 -> ping
//   GET /api/verificar-patente?patente=XXXXXX  -> { ok, tipo, patente, ms, detalle? }

import express from "express";
import cors from "cors";
import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";

const app = express();
app.use(cors());

app.get("/", (_req, res) => res.send("✅ ColeActivos backend operativo"));

/* ---------- helpers ---------- */

// Intenta ubicar el Chrome instalado por `npx puppeteer browsers install chrome`
async function resolveChromePath() {
  try {
    const p = await puppeteer.executablePath(); // v22+ devuelve el bin si está instalado
    if (p) return p;
  } catch {}
  const cacheDir = process.env.PUPPETEER_CACHE_DIR || "/opt/render/.cache/puppeteer";
  const base = path.join(cacheDir, "chrome");
  try {
    const dirs = await fs.promises.readdir(base, { withFileTypes: true });
    for (const d of dirs) {
      if (d.isDirectory() && d.name.startsWith("linux-")) {
        const candidate = path.join(base, d.name, "chrome-linux64", "chrome");
        try {
          await fs.promises.access(candidate, fs.constants.X_OK);
          return candidate;
        } catch {}
      }
    }
  } catch {}
  return null;
}

function normalizaPatente(x = "") {
  return x.toString().trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/* ---------- API ---------- */

app.get("/api/verificar-patente", async (req, res) => {
  const raw = normalizaPatente(req.query.patente);
  if (!/^[A-Z0-9]{5,8}$/.test(raw)) {
    return res.json({ ok: false, tipo: "invalida", patente: raw });
  }

  const t0 = Date.now();
  let browser;

  try {
    const executablePath = await resolveChromePath();
    if (!executablePath) {
      return res.json({
        ok: false,
        tipo: "error",
        detalle: "Chrome no encontrado. Verifica Build Command y PUPPETEER_CACHE_DIR."
      });
    }

    browser = await puppeteer.launch({
      headless: "new",
      executablePath,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--no-zygote",
        "--single-process"
      ]
    });

    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"
    );
    await page.setExtraHTTPHeaders({ "Accept-Language": "es-CL,es;q=0.9" });

    // 1) Ir a la página principal
    await page.goto("https://apps.mtt.cl/consultaweb", {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    // 2) Escribir la patente en el primer input de texto visible
    await page.waitForSelector('input[type="text"]', { timeout: 15000 });
    await page.focus('input[type="text"]');
    await page.keyboard.type(raw, { delay: 50 });

    // 3) Enviar: click en botón Buscar si existe, si no Enter
    const clicked = await page.$$eval(
      'input[type="submit"],button[type="submit"],input[value*="Buscar"],button:has-text("Buscar")',
      els => {
        const b = els.find(e => e && e.offsetParent !== null);
        if (b) { b.click(); return true; }
        return false;
      }
    );
    if (!clicked) await page.keyboard.press("Enter");

    // 4) Esperar a que aparezca contenido útil
    await page.waitForFunction(() => {
      const t = document.body.innerText.toLowerCase();
      return t.includes("tipo de servicio") || t.includes("no existen resultados") || t.length > 4000;
    }, { timeout: 30000 }).catch(() => {});

    // 5) Analizar sólo por "Tipo de Servicio"
    const txt = await page.evaluate(() => document.body.innerText.toLowerCase());

    const esColectivo = txt.includes("tipo de servicio") && txt.includes("colectivo");
    const noEncontrado = txt.includes("no existen resultados") || txt.includes("no se encontraron");

    let tipo = "otro";
    if (esColectivo) tipo = "colectivo";
    else if (noEncontrado) tipo = "no-encontrado";
    else if (txt.includes("taxi")) tipo = "taxi";
    else if (txt.includes("bus")) tipo = "bus";

    return res.json({ ok: esColectivo, tipo, patente: raw, ms: Date.now() - t0 });
  } catch (err) {
    return res.json({ ok: false, tipo: "error", detalle: String(err), ms: Date.now() - t0 });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
});

/* ---------- servidor ---------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor activo en puerto ${PORT}`));
