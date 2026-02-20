// =======================================
// Helpers
// =======================================
const $ = sel => document.querySelector(sel);

const toUpper = s => (s || "").toUpperCase();
const cleanPunc = s =>
  toUpper(s).replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();

function uniquify(name, set) {
  if (!set.has(name)) { set.add(name); return name; }
  const extIdx = name.lastIndexOf(".");
  const base = extIdx >= 0 ? name.slice(0, extIdx) : name;
  const ext  = extIdx >= 0 ? name.slice(extIdx) : "";
  let i = 2;
  while (set.has(`${base} (${i})${ext}`)) i++;
  const unique = `${base} (${i})${ext}`;
  set.add(unique);
  return unique;
}

const dropzone = $("#dropzone");

// =======================================
// Drag + Drop
// =======================================
dropzone.addEventListener("dragover", e => {
  e.preventDefault();
  dropzone.style.opacity = 0.85;
});
dropzone.addEventListener("dragleave", () => {
  dropzone.style.opacity = 1;
});

dropzone.addEventListener("drop", async e => {
  e.preventDefault();
  dropzone.style.opacity = 1;

  const address = cleanPunc($("#address").value);
  const packType = $("#packType").value;

  if (!address) {
    alert("Enter the address.");
    return;
  }

  const file = e.dataTransfer.files[0];
  if (!file || !file.name.toLowerCase().endsWith(".pdf")) {
    alert("Please drop a single Inspection Checklist PDF.");
    return;
  }

  processChecklist(file, address, packType);
});

// =======================================
// Main processor
// =======================================
async function processChecklist(file, address, packType) {
  try {
    const arrayBuf = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: arrayBuf }).promise;

    const out = new JSZip();
    const used = new Set();

    // PAGE 1 — always saved
    const page1Blob = await extractPage(pdf, 1);
    let name1 = `${address} - INSPECTION CHECKLIST.pdf`;
    name1 = uniquify(name1, used);
    out.file(name1, page1Blob);

    // Counters
    let acMtwCount = 0;
    let bmdCount = 0;

    for (let i = 2; i <= pdf.numPages; i++) {
      const text = await extractText(pdf, i);
      if (!text.trim()) continue; // skip blank

      const pageBlob = await extractPage(pdf, i);
      let newName = "";

      // ================================
      // AC GOLD PACK LOGIC
      // ================================
      if (packType === "AC_GOLD") {

        if (text.includes("BMD WORKS REQUIRED")) {
          // ALWAYS unnumbered unless duplicates
          newName = `${address} - VOID BMD WORKS.pdf`;
        } else {
          acMtwCount++;
          newName = `${address} - AC GOLD MTW (${acMtwCount}).pdf`;
        }
      }

      // ================================
      // BMD PACK LOGIC
      // ================================
      else if (packType === "BMD_PACK") {

        if (text.includes("RECHARGE WORK")) {
          newName = `${address} - VOID RECHARGEABLE WORKS.pdf`;
        } else {
          // BMD pages ARE numbered
          bmdCount++;
          newName = `${address} - VOID BMD WORKS (${bmdCount}).pdf`;
        }
      }

      newName = uniquify(newName, used);
      out.file(newName, pageBlob);
    }

    const blob = await out.generateAsync({ type: "blob" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${address} - PROCESSED_CHECKLIST.zip`;
    a.click();

  } catch (err) {
    console.error(err);
    alert("Processing failed. Check the PDF file.");
  }
}

// =======================================
// Extract text from a page
// =======================================
async function extractText(pdf, pageNum) {
  const page = await pdf.getPage(pageNum);
  const content = await page.getTextContent();
  return content.items.map(i => i.str).join(" ").toUpperCase();
}

// =======================================
// Extract a page as a single-page PDF
// =======================================
async function extractPage(pdf, pageNum) {
  const page = await pdf.getPage(pageNum);
  const opList = await page.getOperatorList();

  // Minimal single page PDF generator
  // Using PDF.js internal API for canvas export fallback
  const viewport = page.getViewport({ scale: 1 });
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);

  await page.render({ canvasContext: ctx, viewport }).promise;

  return await new Promise(resolve => canvas.toBlob(resolve, "application/pdf"));
}
