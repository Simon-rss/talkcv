import { PDFDocument, PDFName, PDFString, StandardFonts, rgb } from "pdf-lib";
import { publishedSiteUrl, siteQrDataUrl } from "./site-qr.mjs";

export type StampPosition = "top-right" | "bottom-right" | "header-bar";

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(",");
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(b64, "base64"));
  }
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

/**
 * Stamps a lossless "Scan to Ask AI" QR badge with a clickable URI annotation
 * onto page 1 of the user's original PDF entirely in memory.
 */
export async function stampPdfWithTalkCvQr(
  pdfBytes: Uint8Array,
  slug: string,
  position: StampPosition = "top-right",
): Promise<Uint8Array> {
  const cleanSlug = slug.trim().toLowerCase();
  if (!cleanSlug) throw new Error("A valid site handle is required.");

  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const pages = doc.getPages();
  if (pages.length === 0) throw new Error("The PDF has no pages.");

  const page = pages[0];
  const { width, height } = page.getSize();
  const qrDataUrl = await siteQrDataUrl(cleanSlug);
  const qrImage = await doc.embedPng(dataUrlToBytes(qrDataUrl));
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fontRegular = await doc.embedFont(StandardFonts.Helvetica);

  const canonicalUrl = publishedSiteUrl(cleanSlug);
  const shortUrl = `mytalkcv.com/u/${cleanSlug}`.slice(0, 34);
  const margin = 16;

  let boxX: number;
  let boxY: number;
  let boxW: number;
  let boxH: number;

  if (position === "header-bar") {
    boxW = Math.min(268, Math.max(190, width - margin * 2));
    boxH = 54;
    boxX = width - boxW - margin;
    boxY = height - boxH - margin;
  } else {
    boxW = 186;
    boxH = 62;
    boxX = width - boxW - margin;
    boxY = position === "bottom-right" ? margin : height - boxH - margin;
  }

  // Crisp white card with subtle border
  page.drawRectangle({
    x: boxX,
    y: boxY,
    width: boxW,
    height: boxH,
    color: rgb(1, 1, 1),
    borderColor: rgb(0.84, 0.86, 0.9),
    borderWidth: 1,
  });

  // Accent bar on the left edge
  page.drawRectangle({
    x: boxX,
    y: boxY,
    width: 3.5,
    height: boxH,
    color: rgb(0, 0.44, 0.89),
  });

  const qrSize = boxH - 12;
  const qrX = boxX + 9;
  const qrY = boxY + 6;
  page.drawImage(qrImage, {
    x: qrX,
    y: qrY,
    width: qrSize,
    height: qrSize,
  });

  const textX = qrX + qrSize + 8;
  page.drawText("SCAN TO ASK AI", {
    x: textX,
    y: boxY + boxH - 18,
    size: 8.5,
    font: fontBold,
    color: rgb(0, 0.44, 0.89),
  });
  page.drawText("Interactive CV & JD Fit", {
    x: textX,
    y: boxY + boxH - 31,
    size: 7.5,
    font: fontRegular,
    color: rgb(0.22, 0.25, 0.3),
  });
  page.drawText(shortUrl, {
    x: textX,
    y: boxY + 11,
    size: 7,
    font: fontRegular,
    color: rgb(0.42, 0.45, 0.5),
  });

  // Add clickable URI link annotation over the entire badge
  const linkAnnot = doc.context.obj({
    Type: "Annot",
    Subtype: "Link",
    Rect: [boxX, boxY, boxX + boxW, boxY + boxH],
    Border: [0, 0, 0],
    A: {
      Type: "Action",
      S: "URI",
      URI: PDFString.of(canonicalUrl),
    },
  });
  const linkRef = doc.context.register(linkAnnot);
  const existingAnnots = page.node.Annots();
  if (existingAnnots) {
    existingAnnots.push(linkRef);
  } else {
    page.node.set(PDFName.of("Annots"), doc.context.obj([linkRef]));
  }

  return doc.save();
}
