import { networkInterfaces } from "node:os";
import QRCode from "qrcode";

/** The IPv4 address of the main computer on the local network (Wi-Fi). */
export function lanAddress(): string {
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family === "IPv4" && !a.internal) return a.address;
    }
  }
  return "127.0.0.1";
}

/** The address a phone opens. The QR code holds exactly this text. */
export function joinUrl(host: string, port: number, code: string): string {
  return `http://${host}:${port}/?code=${code}`;
}

export function qrSvg(text: string): Promise<string> {
  return QRCode.toString(text, { type: "svg", margin: 1 });
}

export function qrTerminal(text: string): Promise<string> {
  return QRCode.toString(text, { type: "terminal", small: true });
}
