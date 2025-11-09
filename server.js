// ColeActivos - Verificador de Patentes (100% funcional en Render)
// Consulta apps.mtt.cl usando Puppeteer y responde si es colectivo/taxi

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

    await page.type('input[type="text"]', raw);
    await page.keyboard.press("Enter");

    await page.waitForFunction(() =>
      document.body.innerText.includes("Tipo de Servicio") ||
      document.body.innerText.includes("no existen resultados"), { timeout: 20000 }
    );

    const text = await page.evaluate(() => document.body.innerText.toLowerCase());

    const esColectivo = text.includes("colectivo") || text.includes("taxi");
    const noEncontrado = text.includes("no existen resultados");

    let tipo = "otro";
    if (esColectivo) tipo = text.includes("colectivo") ? "colectivo" : "taxi";
    else if (noEncontrado) tipo = "no-encontrado";

    res.json({ ok: esColectivo, tipo, patente: raw, ms: Date.now() - t0 });
  } catch (err) {
    res.json({ ok: false, tipo: "error", detalle: err.message });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor activo en puerto ${PORT}`));
