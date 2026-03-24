# HP Wellness — Label Generator

METRC thermal label generator. Upload a QR PDF, fill in the fields, download print-ready 2.25×1" labels.

---

## Deploy to Netlify (one time)

1. Push this folder to a new GitHub repo
2. Go to [netlify.com](https://netlify.com) → **Add new site → Import from Git**
3. Select your repo
4. Build settings are auto-detected from `netlify.toml` — no changes needed
5. Click **Deploy site**

That's it. Share the Netlify URL with your team.

---

## Local dev (optional)

```bash
npm install
npm run dev
# → open http://localhost:8888
```

Requires: Node.js 18+, Netlify CLI (`npm install -g netlify-cli`)

---

## How to use

1. Open the app URL
2. Fill in: Strain Name, Unit Weight, Total Weight, THC%, Exp Date, Lot#
3. Upload the METRC QR PDF (one QR per page)
4. Click **Generate Labels**
5. PDF downloads — one 2.25×1" label per QR code, ready to print

---

## File structure

```
hp-label-generator/
├── public/
│   └── index.html              ← the form UI
├── netlify/
│   └── functions/
│       └── generate-labels.js  ← PDF generation logic
├── netlify.toml
├── package.json
└── README.md
```

## Updating label content

All label logic lives in `netlify/functions/generate-labels.js`.  
The form fields map directly to the label — no code changes needed for new runs, just fill the form.

If you need to change label **size or layout**, edit the constants at the top of `generate-labels.js`:

```js
const LABEL_W_IN = 2.25;  // width in inches
const LABEL_H_IN = 1.0;   // height in inches
```
# hp-metrc-label-maker
