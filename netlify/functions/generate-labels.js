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
    const files = {};
    const bb = Busboy({ headers: { "content-type": event.headers["content-type"] } });
    bb.on("field", (name, val) => { fields[name] = val; });
    bb.on("file", (name, stream) => {
      const chunks = [];
      stream.on("data", (d) => chunks.push(d));
      stream.on("end", () => { files[name] = Buffer.concat(chunks); });
    });
    bb.on("finish", () => resolve({ fields, files }));
    bb.on("error", (e) => reject(e));
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

  // Margins: small outer pad, slightly more between QR and text column
  const PAD = 0.05 * PTS;   // ~3.6pt outer margin
  const GAP = PAD * 2;      // gap between QR and text block

  const {
    productName, unitWeight, totalWeight, totalThc, totalCbd,
    totalThcPackage, expDate, lotNumber,
  } = data;

  // White background
  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: rgb(1, 1, 1) });

  // QR — square, vertically centered with PAD margins
  const qrSize = H - 2 * PAD;
  if (embeddedQr) {
    page.drawPage(embeddedQr, { x: PAD, y: PAD, width: qrSize, height: qrSize });
  }

  // Text column spans QR right-edge+GAP → label right edge - PAD
  const textX = PAD + qrSize + GAP;
  const textRight = W - PAD;          // right boundary for text

  const nameSize = 7.2;
  const keySize = 5.0;
  const valSize = 5.5;
  const rowH = 7.2;                // slightly more breathing room between rows

  // ── Product name ──────────────────────────────────────────────────────────
  page.drawText(productName || "—", {
    x: textX, y: H - PAD - nameSize,
    size: nameSize, font: bold, color: NOIR,
    maxWidth: textRight - textX,
  });

  // ── THC display lines: "19.17%"  and  "191.7 mg/g" ───────────────────────
  let thcDisplay = null;
  if (totalThc) {
    const pct = parseFloat(totalThc.replace(/[^\d.]/g, "")) || 0;
    const mgG = Math.round(pct * 10 * 100) / 100;
    thcDisplay = [`${totalThc}`, `${mgG} mg/g`];
  }

  // ── Lot# — split if too long ───────────────────────────────────────────────
  let lotLines = null;
  if (lotNumber) {
    if (lotNumber.length > 14) {
      const mid = Math.floor(lotNumber.length / 2);
      const splitAt = lotNumber.lastIndexOf("-", mid + 3);
      const idx = splitAt > 0 ? splitAt : mid;
      lotLines = [lotNumber.slice(0, idx), lotNumber.slice(idx)];
    } else {
      lotLines = [lotNumber];
    }
  }

  // ── Build row list (only non-empty values) ────────────────────────────────
  const rows = [
    unitWeight ? ["Unit Wt: ", [unitWeight]] : null,
    totalWeight ? ["Total Wt: ", [totalWeight]] : null,
    thcDisplay ? ["THC: ", thcDisplay] : null,
    totalCbd ? ["CBD: ", [totalCbd]] : null,
    totalThcPackage ? ["THC/pkg: ", [totalThcPackage]] : null,
    expDate ? ["Exp: ", [expDate]] : null,
    lotLines ? ["Lot#: ", lotLines] : null,
  ].filter(Boolean);

  let curY = H - PAD - 18;

  for (const [label, lines] of rows) {
    // Dynamically measure the key so value never overlaps
    const keyW = bold.widthOfTextAtSize(label, keySize);

    // Key label
    page.drawText(label, {
      x: textX, y: curY,
      size: keySize, font: bold, color: NOIR,
    });

    // First value line — starts immediately after key measurement
    page.drawText(lines[0], {
      x: textX + keyW, y: curY,
      size: valSize, font: bold, color: NOIR,
      maxWidth: textRight - (textX + keyW),
    });
    curY -= rowH;

    // Second value line (e.g. mg/g line under THC%, or wrapped lot#)
    if (lines[1]) {
      page.drawText(lines[1], {
        x: textX + keyW, y: curY,
        size: valSize, font: bold, color: NOIR,
        maxWidth: textRight - (textX + keyW),
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

    const labelW = parseFloat(fields.labelWidth) || DEFAULT_W_IN;
    const labelH = parseFloat(fields.labelHeight) || DEFAULT_H_IN;
    const W = labelW * PTS;
    const H = labelH * PTS;

    // Trim all fields — empty string = treat as absent
    const data = {
      productName: (fields.productName || "").trim(),
      unitWeight: (fields.unitWeight || "").trim(),
      totalWeight: (fields.totalWeight || "").trim(),
      totalThc: (fields.totalThc || "").trim(),
      totalCbd: (fields.totalCbd || "").trim(),
      totalThcPackage: (fields.totalThcPackage || "").trim(),
      expDate: (fields.expDate || "").trim(),
      lotNumber: (fields.lotNumber || "").trim(),
    };

    const qrPdfBytes = files.qrPdf;
    if (!qrPdfBytes) return { statusCode: 400, body: "Missing QR PDF" };

    const qrSource = await PDFDocument.load(qrPdfBytes);
    const pageCount = qrSource.getPageCount();

    const outDoc = await PDFDocument.create();
    const bold = await outDoc.embedFont(StandardFonts.HelveticaBold);
    const fonts = { bold };

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