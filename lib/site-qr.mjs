import QRCode from "qrcode";

export function publishedSiteUrl(slug) {
  return `https://talkcv.renss.top/u/${encodeURIComponent(slug)}`;
}

export function siteQrDataUrl(slug) {
  return QRCode.toDataURL(publishedSiteUrl(slug), { width: 360, margin: 4, errorCorrectionLevel: "M" });
}
