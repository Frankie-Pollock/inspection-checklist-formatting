// =====================================================
// VOID Inspection Checklist Processor — Part 2
// CONVERTS EACH PAGE USING REAL PDF PAGE COPYING
// =====================================================

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
  const result = `${base} (${i})${ext}`;
  set.add(result);
  return result;
}

const dropzone = $("#dropzone");

// Drag events
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
    alert("Enter the ADDRESS first.");
    return;
  }

  const file = e.dataTransfer.files[0];
  if (!file || !file.name.toLowerCase().endsWith(".pdf")) {
    alert("Please drop a valid PDF.");
    return;
  }

  processChecklist(file, address, packType);
});

async function processChecklist(file, address, packType) {
  try {
    const arrayBuf = await file.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuf);

    // PDF.js document (for text extraction)
    const jsDoc = await pdfjsLib.getDocument({ data: uint8 }).promise;

    // pdf-lib document (for true PDF page copying)
    const srcDoc = await PDFLib.PDFDocument.load(uint8);

    const out = new JSZip();
    const used = new Set();

    // ---- PAGE 1 ALWAYS SAVED ----
    const page1Blob = await savePageAsPdf(srcDoc, 0);
    let name1 = `${address} - INSPECTION CHECKLIST.pdf`;
    name1 = uniquify(name1, used);
    out.file(name1, page1Blob);

    let acGoldMtwCount = 0;
    let bmdCount = 0;

    for (let i = 2; i <= jsDoc.numPages; i++) {
      const text = await extractPageText(jsDoc, i);
      if (!text.trim()) continue; // skip blank pages

      let filename = "";
      const pageBlob = await savePageAsPdf(srcDoc, i - 1);

      if (packType === "AC_GOLD") {
        if (text.includes("BMD WORKS REQUIRED")) {
          filename = `${address} - VOID BMD WORKS.pdf`;
        } else {
          acGoldMtwCount++;
          filename = `${address} - AC GOLD MTW (${acGoldMtwCount}).pdf`;
        }
      }

      else if (packType === "BMD_PACK") {
        if (text.includes("RECHARGE WORK")) {
          filename = `${address} - VOID RECHARGEABLE WORKS.pdf`;
        } else {
          bmdCount++;
          filename = `${address} - VOID BMD WORKS (${bmdCount}).pdf`;
        }
      }

      filename = uniquify(filename, used);
      out.file(filename, pageBlob);
    }

    const zipBlob = await out.generateAsync({ type: "blob" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(zipBlob);
    a.download = `${address} - PROCESSED_CHECKLIST.zip`;
    a.click();

  } catch (err) {
    console.error(err);
    alert("Failed to process PDF. The file may be corrupted or protected.");
  }
}

// -------- TEXT EXTRACTION (PDF.js) --------
async function extractPageText(jsDoc, pageNum) {
  const page = await jsDoc.getPage(pageNum);
  const content = await page.getTextContent();
  return content.items.map(i => i.str).join(" ").toUpperCase();
}

// -------- PAGE COPYING (REAL PDF via pdf-lib) --------
async function savePageAsPdf(srcDoc, pageIndex) {
  const newDoc = await PDFLib.PDFDocument.create();
  const [copiedPage] = await newDoc.copyPages(srcDoc, [pageIndex]);
  newDoc.addPage(copiedPage);
  const bytes = await newDoc.save({ useObjectStreams: false });
  return new Blob([bytes], { type: "application/pdf" });
}
