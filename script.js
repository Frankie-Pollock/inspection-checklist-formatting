// =====================================================
// VOID Inspection Checklist Processor — Part 2
// Robust version with header check + vector→raster fallback
// Requires: pdf.js (module), pdf.worker.js, jszip.min.js, pdf-lib.min.js
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

// ---------- Drag & drop ----------
const dropzone = $("#dropzone");
dropzone.addEventListener("dragover", e => { e.preventDefault(); dropzone.style.opacity = 0.85; });
dropzone.addEventListener("dragleave", () => { dropzone.style.opacity = 1; });
dropzone.addEventListener("drop", async e => {
  e.preventDefault();
  dropzone.style.opacity = 1;

  const address = cleanPunc($("#address").value);
  const packType = $("#packType").value;
  if (!address) return alert("Enter the ADDRESS first.");

  const file = e.dataTransfer.files && e.dataTransfer.files[0];
  if (!file) return alert("Please drop a PDF file from your computer (not a link).");

  if (!file.name.toLowerCase().endsWith(".pdf") && !String(file.type).toLowerCase().includes("pdf")) {
    return alert("That does not look like a PDF file. Please drop a .pdf.");
  }

  await processChecklist(file, address, packType);
});

// ---------- Main pipeline ----------
async function processChecklist(file, address, packType) {
  try {
    const srcBytes = new Uint8Array(await file.arrayBuffer());

    // 1) Header sanity check
    const header = new TextDecoder("ascii").decode(srcBytes.subarray(0, 8));
    if (!header.startsWith("%PDF-")) {
      console.warn("Header bytes:", header, srcBytes.subarray(0, 16));
      alert("The dropped file is not a standard PDF (no %PDF- header). Try saving the PDF to disk and drop it from File Explorer.");
      return;
    }

    // 2) Open with PDF.js for text extraction
    const jsDoc = await pdfjsLib.getDocument({ data: srcBytes }).promise;

    // 3) Try vector page copy via pdf-lib
    let srcDoc, useRasterFallback = false;
    try {
      srcDoc = await PDFLib.PDFDocument.load(srcBytes);
    } catch (err) {
      console.warn("pdf-lib failed to load PDF vector data. Falling back to raster:", err);
      useRasterFallback = true;
    }

    const out = new JSZip();
    const used = new Set();

    // ---- PAGE 1 ALWAYS SAVED ----
    let page1Blob;
    if (useRasterFallback) {
      page1Blob = await savePageAsPdfRaster(jsDoc, 1);
    } else {
      page1Blob = await savePageAsPdfVector(srcDoc, 0);
    }
    out.file(uniquify(`${address} - INSPECTION CHECKLIST.pdf`, used), page1Blob);

    // Counters for numbering
    let acGoldMtwCount = 0;
    let bmdCount = 0;

    // ---- PAGES 2..N: only pages with text ----
    for (let p = 2; p <= jsDoc.numPages; p++) {
      const text = await extractPageText(jsDoc, p);
      if (!text.trim()) continue; // skip blank

      const textUpper = text.toUpperCase();
      let outName = "";

      if ($("#packType").value === "AC_GOLD") {
        if (textUpper.includes("BMD WORKS REQUIRED")) {
          outName = `${address} - VOID BMD WORKS.pdf`;      // unnumbered unless duplicate
        } else {
          acGoldMtwCount++;
          outName = `${address} - AC GOLD MTW (${acGoldMtwCount}).pdf`;
        }
      } else { // BMD_PACK
        if (textUpper.includes("RECHARGE WORK")) {
          outName = `${address} - VOID RECHARGEABLE WORKS.pdf`;  // unnumbered unless duplicate
        } else {
          bmdCount++;
          outName = `${address} - VOID BMD WORKS (${bmdCount}).pdf`;
        }
      }

      const pageBlob = useRasterFallback
        ? await savePageAsPdfRaster(jsDoc, p)
        : await savePageAsPdfVector(srcDoc, p - 1);

      out.file(uniquify(outName, used), pageBlob);
    }

    // ---- ZIP & download ----
    const zipBlob = await out.generateAsync({ type: "blob" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(zipBlob);
    a.download = `${address} - PROCESSED_CHECKLIST.zip`;
    a.click();

  } catch (err) {
    console.error(err);
    alert("Failed to process PDF. The file may be corrupted, password-protected, or blocked by the browser. Try saving locally and re-dropping.");
  }
}

// ---------- Text extraction (PDF.js) ----------
async function extractPageText(jsDoc, pageNum) {
  const page = await jsDoc.getPage(pageNum);
  const content = await page.getTextContent();
  return content.items.map(i => i.str).join(" ");
}

// ---------- PAGE SAVE (VECTOR) — copy page inside pdf-lib ----------
async function savePageAsPdfVector(srcDoc, zeroBasedIndex) {
  const newDoc = await PDFLib.PDFDocument.create();
  const [copied] = await newDoc.copyPages(srcDoc, [zeroBasedIndex]);
  newDoc.addPage(copied);
  const bytes = await newDoc.save({ useObjectStreams: false });
  return new Blob([bytes], { type: "application/pdf" });
}

// ---------- PAGE SAVE (RASTER) — render with PDF.js and embed PNG ----------
async function savePageAsPdfRaster(jsDoc, pageNum) {
  const page = await jsDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale: 2 }); // good quality
  const cvs = document.createElement("canvas");
  const ctx = cvs.getContext("2d");
  cvs.width = Math.floor(viewport.width);
  cvs.height = Math.floor(viewport.height);
  await page.render({ canvasContext: ctx, viewport }).promise;

  // Canvas → PNG bytes
  const pngBytes = await new Promise(resolve => {
    cvs.toBlob(b => {
      const fr = new FileReader();
      fr.onload = () => resolve(new Uint8Array(fr.result));
      fr.readAsArrayBuffer(b);
    }, "image/png");
  });

  const pdfDoc = await PDFLib.PDFDocument.create();
  const img = await pdfDoc.embedPng(pngBytes);
  const pg = pdfDoc.addPage([img.width, img.height]);
  pg.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
  const out = await pdfDoc.save({ useObjectStreams: false });
  return new Blob([out], { type: "application/pdf" });
}
