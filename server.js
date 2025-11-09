// ColeActivos – Backend 100% funcional en Render (Puppeteer + Chrome local)

import express from "express";
import cors from "cors";
import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";

const app = express();
app.use(cors());

app.get("/", (_req, res) => res.send("✅ ColeActivos backend operativo (Render fixed)"));

async function findLocalChrome() {
  const base = path.join(process.cwd(), "chromium");
  try {
    const dirs = await fs.promises.readdir(base, { withFileTypes: true });
    for (const d of dirs) {
      if (d.isDirectory() && d.name.startsWith("linux-")) {
        const file = path.join(base, d.name, "chrome-linux64", "chrome");
        try {
          await fs.promises.access(file, fs.constants.X_OK);
          console.log("Usando Chrome local:", file);
          return file;
        } catch {}
      }
    }
  } catch {}
  return puppeteer.executablePath();
}

app.get("/api/verificar-patente", async (req, res) => {
  const patente = (req.query.patente || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^[A-Z0-9]{5,8}$/.test(patente))
    return res.json({ ok: false, tipo: "invalida", patente });

  let browser;
  const t0 = Date.now();

  try {
    const executablePath = await findLocalChrome();

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
    await page.goto("https://apps.mtt.cl/consultaweb", {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    await page.type('input[type="text"]', patente);
    await page.keyboard.press("Enter");

    await page.waitForFunction(
      () => {
        const t = document.body.innerText.toLowerCase();
        return t.includes("tipo de servicio") || t.includes("no existen resultados");
      },
      { timeout: 60000 }
    );

    const txt = await page.evaluate(() => document.body.innerText.toLowerCase());
    const esColectivo = txt.includes("colectivo");
    const noEncontrado = txt.includes("no existen resultados");

    let tipo = "otro";
    if (esColectivo) tipo = "colectivo";
    else if (noEncontrado) tipo = "no-encontrado";
    else if (txt.includes("taxi")) tipo = "taxi";

    res.json({ ok: esColectivo, tipo, patente, ms: Date.now() - t0 });
  } catch (err) {
    res.json({ ok: false, tipo: "error", detalle: String(err), ms: Date.now() - t0 });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor activo en puerto ${PORT}`));
