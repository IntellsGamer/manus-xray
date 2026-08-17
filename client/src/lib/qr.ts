import QRCode from "qrcode";

export function buildQrDataUrl(value: string) {
  return QRCode.toDataURL(value, {
    width: 320,
    margin: 1,
    errorCorrectionLevel: "M",
    color: { dark: "#0f172a", light: "#ffffff" },
  });
}
