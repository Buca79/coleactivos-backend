// ColeActivos – Verificador de Patentes (versión mejorada para casos dinámicos MTT)

import express from "express";
import cors from "cors";
import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";

const app = express();
app.use(cors());

app.get("/", (_req, res) => res.send("✅ ColeActivos backend operativo"));

async function resolveChromePath() {
  try {
    const p = await puppeteer.executablePath();
    if (p) return p;
  } catch {}
  const base = (process.env.PUPPETEER_CACHE_DIR || "/opt/render/.cache/puppeteer") + "/chrome";
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

app.get("/api/verificar-patente", async (req, res) => {
  const patente = (req.query.patente || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^[A-Z0-9]{5,8}$/.test(patente))
    return res.json({ ok: false, tipo: "invalida", patente });

  const t0 = Date.now();
  let browser;

  try {
    const executablePath = await resolveChromePath();
    if (!executablePath)
      return res.json({ ok: false, tipo: "error", detalle: "Chrome no encontrado" });

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
    await page.goto("https://apps.mtt.cl/consultaweb", { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.type('input[type="text"]', patente, { delay: 50 });
    await page.keyboard.press("Enter");

    // Esperar explícitamente a que aparezca “Tipo de Servicio” o “no existen resultados”
    await page.waitForFunction(() => {
      const t = document.body.innerText.toLowerCase();
      return t.includes("tipo de servicio") || t.includes("no existen resultados") || t.includes("vehículo");
    }, { timeout: 60000 });

    // Esperar un poco más para permitir que cargue completamente
    await page.waitForTimeout(2000);

    const text = await page.evaluate(() => document.body.innerText);
    const low = text.toLowerCase();

    let tipo = "otro";
    let ok = false;

    if (low.includes("tipo de servicio") && low.includes("colectivo")) {
      tipo = "colectivo";
      ok = true;
    } else if (low.includes("no existen resultados")) {
      tipo = "no-encontrado";
    } else if (low.includes("taxi")) {
      tipo = "taxi";
    } else if (low.includes("bus")) {
      tipo = "bus";
    }

    res.json({ ok, tipo, patente, ms: Date.now() - t0 });
  } catch (err) {
    res.json({ ok: false, tipo: "error", detalle: String(err), ms: Date.now() - t0 });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor activo en puerto ${PORT}`));
