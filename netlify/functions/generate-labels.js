const { PDFDocument, rgb, StandardFonts } = require("pdf-lib");

// ── Label size (inches) — edit here or send from the form ────────────────────
const DEFAULT_W_IN = 2.25;
const DEFAULT_H_IN = 1.0;
const PTS = 72;

const NOIR = rgb(0.216, 0.122, 0.114);

// ── multipart parser ─────────────────────────────────────────────────────────
async function parseMultipart(event) {
  const Busboy = require("busboy");
  return new Promise((resolve, reject) => {
    const fields = {};
    const files  = {};
    const bb = Busboy({ headers: { "content-type": event.headers["content-type"] } });
    bb.on("field", (name, val) => { fields[name] = val; });
    bb.on("file",  (name, stream) => {
      const chunks = [];
      stream.on("data", (d) => chunks.push(d));
      stream.on("end",  ()  => { files[name] = Buffer.concat(chunks); });
    });
    bb.on("finish", () => resolve({ fields, files }));
    bb.on("error",  (e) => reject(e));
    const body = event.isBase64Encoded
      ? Buffer.from(event.body, "base64")
      : Buffer.from(event.body);
    bb.write(body);
    bb.end();
  });
}

// ── draw one label ───────────────────────────────────────────────────────────
async function drawLabel(page, fonts, embeddedQr, data, W, H) {
  const { bold } = fonts;
  const PAD = 0.05 * PTS;

  const {
    productName, unitWeight, totalWeight, totalThc, totalCbd,
    expDate, lotNumber,
  } = data;

  // White bg
  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: rgb(1,1,1) });

  // QR
  const qrSize = H - 2 * PAD;
  if (embeddedQr) {
    page.drawPage(embeddedQr, { x: PAD, y: PAD, width: qrSize, height: qrSize });
  }

  const textX   = PAD + qrSize + PAD * 2.5;
  const nameSize = 7.2;
  const keySize  = 5.0;
  const valSize  = 5.5;
  const rowH     = 7.0;

  // Product name (always shown)
  page.drawText(productName || "—", {
    x: textX, y: H - PAD - nameSize,
    size: nameSize, font: bold, color: NOIR,
  });

  // THC mg/g
  let thcDisplay = null;
  if (totalThc) {
    const pct  = parseFloat(totalThc.replace("%", "")) || 0;
    const mgG  = Math.round(pct * 10 * 100) / 100;
    thcDisplay = [`${totalThc}`, `${mgG}mg/g`];
  }

  // Lot# split if long
  let lotLines = null;
  if (lotNumber) {
    if (lotNumber.length > 14) {
      const mid     = Math.floor(lotNumber.length / 2);
      const splitAt = lotNumber.lastIndexOf("-", mid + 3);
      const idx     = splitAt > 0 ? splitAt : mid;
      lotLines = [lotNumber.slice(0, idx), lotNumber.slice(idx)];
    } else {
      lotLines = [lotNumber];
    }
  }

  // Only include rows where value exists
  const rows = [
    unitWeight  ? ["Unit Wt:",  [unitWeight]]            : null,
    totalWeight ? ["Total Wt:", [totalWeight]]            : null,
    thcDisplay  ? ["THC:",      thcDisplay]               : null,
    totalCbd    ? ["CBD:",      [totalCbd]]               : null,
    expDate     ? ["Exp:",      [expDate]]                : null,
    lotLines    ? ["Lot#:",     lotLines]                 : null,
  ].filter(Boolean);

  let curY = H - PAD - 18;

  for (const [label, lines] of rows) {
    // Key
    page.drawText(label, {
      x: textX, y: curY,
      size: keySize, font: bold, color: NOIR,
    });
    // First value line
    page.drawText(lines[0], {
      x: textX + 20, y: curY,
      size: valSize, font: bold, color: NOIR,
    });
    curY -= rowH;
    // Second value line (if any)
    if (lines[1]) {
      page.drawText(lines[1], {
        x: textX + 20, y: curY,
        size: valSize, font: bold, color: NOIR,
      });
      curY -= rowH;
    }
  }
}

// ── handler ──────────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

  try {
    const { fields, files } = await parseMultipart(event);

    const labelW = parseFloat(fields.labelWidth)  || DEFAULT_W_IN;
    const labelH = parseFloat(fields.labelHeight) || DEFAULT_H_IN;
    const W = labelW * PTS;
    const H = labelH * PTS;

    // Trim all fields — empty string = treat as absent
    const data = {
      productName: (fields.productName || "").trim(),
      unitWeight:  (fields.unitWeight  || "").trim(),
      totalWeight: (fields.totalWeight || "").trim(),
      totalThc:    (fields.totalThc    || "").trim(),
      totalCbd:    (fields.totalCbd    || "").trim(),
      expDate:     (fields.expDate     || "").trim(),
      lotNumber:   (fields.lotNumber   || "").trim(),
    };

    const qrPdfBytes = files.qrPdf;
    if (!qrPdfBytes) return { statusCode: 400, body: "Missing QR PDF" };

    const qrSource = await PDFDocument.load(qrPdfBytes);
    const pageCount = qrSource.getPageCount();

    const outDoc = await PDFDocument.create();
    const bold    = await outDoc.embedFont(StandardFonts.HelveticaBold);
    const fonts   = { bold };

    for (let i = 0; i < pageCount; i++) {
      const [embeddedQr] = await outDoc.embedPdf(qrSource, [i]);
      const page = outDoc.addPage([W, H]);
      await drawLabel(page, fonts, embeddedQr, data, W, H);
    }

    const pdfBytes = await outDoc.save();
    const b64 = Buffer.from(pdfBytes).toString("base64");
    const slug = (data.productName || "labels").replace(/\s+/g, "_");

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="hp_labels_${slug}.pdf"`,
      },
      body: b64,
      isBase64Encoded: true,
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: `Error: ${err.message}` };
  }
};
