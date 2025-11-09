// ColeActivos - Verificador de Patentes (versión 100% funcional en línea)
// Usa Puppeteer para consultar apps.mtt.cl y devuelve ok:true si dice "colectivo" en Tipo de Servicio

import express from "express";
import cors from "cors";
import puppeteer from "puppeteer";

const app = express();
app.use(cors());

app.get("/", (req, res) => res.send("✅ ColeActivos backend operativo"));

app.get("/api/verificar-patente", async (req, res) => {
  const raw = (req.query.patente || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^[A-Z0-9]{5,8}$/.test(raw)) {
    return res.json({ ok: false, tipo: "invalida", patente: raw });
  }

  let browser;
  const t0 = Date.now();

  try {
    browser = await puppeteer.launch({
      headless: "new",
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
    await page.goto("https://apps.mtt.cl/consultaweb", { waitUntil: "domcontentloaded", timeout: 30000 });

    // Escribir patente
    await page.type('input[type="text"]', raw);
    await page.keyboard.press("Enter");

    // Esperar texto relevante
    await page.waitForFunction(() =>
      document.body.innerText.includes("Tipo de Servicio") ||
      document.body.innerText.includes("no existen resultados"), { timeout: 20000 }
    );

    const text = await page.evaluate(() => document.body.innerText.toLowerCase());
    const esColectivo = text.includes("colectivo");
    const noEncontrado = text.includes("no existen resultados");

    let tipo = "otro";
    if (esColectivo) tipo = "colectivo";
    else if (noEncontrado) tipo = "no-encontrado";
    else if (text.includes("taxi")) tipo = "taxi";

    res.json({ ok: esColectivo, tipo, patente: raw, ms: Date.now() - t0 });
  } catch (err) {
    res.json({ ok: false, tipo: "error", detalle: err.message });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor activo en puerto ${PORT}`));
