// =====================================================
// VOID Inspection Checklist Processor — Part 2
// Generates REAL PDFs per page using pdf-lib
// Dependencies loaded in index.html BEFORE this file:
//   • window.pdfjsLib (from pdf.mjs + pdf.worker.mjs)
//   • window.JSZip     (from jszip.min.js)
//   • window.PDFLib    (from pdf-lib.min.js)
// =====================================================

// ---------- Helpers ----------
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

// Quick dependency guard (helps debug if a lib didn't load)
(function sanityChecks() {
  const missing = [];
  if (!window.pdfjsLib) missing.push("pdfjsLib (pdf.mjs)");
  if (!window.JSZip)    missing.push("JSZip (jszip.min.js)");
  if (!window.PDFLib)   missing.push("PDFLib (pdf-lib.min.js)");
  if (missing.length) {
    const msg = `Missing dependencies: ${missing.join(", ")}.\n` +
                `Ensure these scripts are included BEFORE script.js.`;
    console.error(msg);
    alert(msg);
  }
})();

// ---------- UI (drag & drop) ----------
const dropzone = $("#dropzone");

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
    alert("Enter the address first.");
    return;
  }

  const file = e.dataTransfer.files[0];
  if (!file || !file.name.toLowerCase().endsWith(".pdf")) {
    alert("Please drop a single Inspection Checklist PDF.");
    return;
  }

  await processChecklist(file, address, packType);
});

// ---------- Processing pipeline ----------
async function processChecklist(file, address, packType) {
  try {
    // Read original PDF bytes once (for both PDF.js and pdf-lib)
    const srcBytes = new Uint8Array(await file.arrayBuffer());

    // PDF.js: for page count + text extraction
    const jsDoc = await window.pdfjsLib.getDocument({ data: srcBytes }).promise;

    // pdf-lib: for true PDF page extraction (vector-safe)
    const srcDoc = await window.PDFLib.PDFDocument.load(srcBytes);

    const outZip = new JSZip();
    const usedNames = new Set();

    // --- PAGE 1: Always export as checklist (even if blank) ---
    const page1Blob = await exportSinglePageBlob(srcDoc, 0); // zero-based index
    let name1 = `${address} - INSPECTION CHECKLIST.pdf`;
    name1 = uniquify(name1, usedNames);
    outZip.file(name1, page1Blob);

    // Counters for numbering
    let acGoldMtw = 0; // AC GOLD MTW (1..n)
    let bmdCount  = 0; // BMD PACK: BMD WORKS (1..n)
    // Recharge is unnumbered unless duplicates → handled by uniquify

    // --- PAGES 2..N: process only text pages ---
    for (let pageNum = 2; pageNum <= jsDoc.numPages; pageNum++) {
      const textUpper = await extractTextUpper(jsDoc, pageNum);
      if (!textUpper.trim()) continue; // skip blank (no text items)

      // Build proper single-page PDF via pdf-lib (copy page from source)
      const pageBlob = await exportSinglePageBlob(srcDoc, pageNum - 1); // zero-based

      let outName = "";

      if (packType === "AC_GOLD") {
        // If the page contains BMD WORKS REQUIRED → BMD Works (unnumbered)
        if (textUpper.includes("BMD WORKS REQUIRED")) {
          outName = `${address} - VOID BMD WORKS.pdf`; // unnumbered unless duplicate
        } else {
          // Otherwise it's AC GOLD MTW and numbered
          acGoldMtw++;
          outName = `${address} - AC GOLD MTW (${acGoldMtw}).pdf`;
        }
      } else if (packType === "BMD_PACK") {
        // If page contains RECHARGE WORK → Recharge (unnumbered unless duplicate)
        if (textUpper.includes("RECHARGE WORK")) {
          outName = `${address} - VOID RECHARGEABLE WORKS.pdf`;
        } else {
          // Otherwise BMD Works and numbered
          bmdCount++;
          outName = `${address} - VOID BMD WORKS (${bmdCount}).pdf`;
        }
      } else {
        // Fallback (shouldn't hit)
        outName = `${address} - PAGE ${pageNum}.pdf`;
      }

      outName = uniquify(outName, usedNames);
      outZip.file(outName, pageBlob);
    }

    // --- Package as ZIP and download ---
    const outBlob = await outZip.generateAsync({ type: "blob" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(outBlob);
    a.download = `${address} - PROCESSED_CHECKLIST.zip`;
    a.click();

  } catch (err) {
    console.error(err);
    alert("Processing failed. Check the PDF and that libraries are loaded.");
  }
}

// ---------- Text extraction (blank detection) ----------
async function extractTextUpper(jsDoc, pageNum) {
  const page = await jsDoc.getPage(pageNum);
  const content = await page.getTextContent();
  return content.items.map(i => i.str).join(" ").toUpperCase();
}

// ---------- Real single-page PDF export via pdf-lib ----------
async function exportSinglePageBlob(srcDoc, zeroBasedIndex) {
  // Create a brand new PDF and copy one page from the source
  const newDoc = await window.PDFLib.PDFDocument.create();
  const [copied] = await newDoc.copyPages(srcDoc, [zeroBasedIndex]);
  newDoc.addPage(copied);

  const bytes = await newDoc.save({ useObjectStreams: false });
  return new Blob([bytes], { type: "application/pdf" });
}
