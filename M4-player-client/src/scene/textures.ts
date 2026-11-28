import * as THREE from "three";

export type TextureName =
  | "houseWall"
  | "aptWall"
  | "aptShop"
  | "glass"
  | "roofTile"
  | "roofFlat"
  | "grass"
  | "plaza"
  | "sidewalk"
  | "asphalt"
  | "door"
  | "metal";

const SIZE = 256;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

type Paint = (g: CanvasRenderingContext2D, r: () => number) => void;

function rect(g: CanvasRenderingContext2D, color: string, x: number, y: number, w: number, h: number): void {
  g.fillStyle = color;
  g.fillRect(x, y, w, h);
}

function speckle(g: CanvasRenderingContext2D, r: () => number, colors: string[], count: number, size: number): void {
  for (let i = 0; i < count; i++) {
    g.fillStyle = colors[Math.floor(r() * colors.length)];
    g.fillRect(r() * SIZE, r() * SIZE, size, size);
  }
}

function pane(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, frame: string): void {
  rect(g, frame, x - 6, y - 6, w + 12, h + 12);
  rect(g, "#3d5d78", x, y, w, h);
  rect(g, "#577c9b", x, y, w, h * 0.45);
  g.fillStyle = "rgba(255,255,255,0.22)";
  g.beginPath();
  g.moveTo(x + w * 0.15, y + h);
  g.lineTo(x + w * 0.55, y);
  g.lineTo(x + w * 0.75, y);
  g.lineTo(x + w * 0.35, y + h);
  g.fill();
  rect(g, frame, x + w / 2 - 3, y, 6, h);
  rect(g, frame, x, y + h * 0.42, w, 5);
}

const PAINTS: Record<TextureName, Paint> = {
  houseWall: (g, r) => {
    rect(g, "#f4f1ea", 0, 0, SIZE, SIZE);
    speckle(g, r, ["#ebe6dc", "#f9f7f2", "#e7e1d6"], 900, 2);
    pane(g, 78, 70, 100, 112, "#ffffff");
    rect(g, "#d9d2c4", 66, 186, 124, 10);
    rect(g, "#e2dccf", 0, 246, SIZE, 10);
  },
  aptWall: (g, r) => {
    rect(g, "#f3efe7", 0, 0, SIZE, SIZE);
    speckle(g, r, ["#ebe5da", "#f8f5ef"], 700, 2);
    pane(g, 40, 54, 176, 128, "#f7f7f5");
    rect(g, "#c9c4ba", 24, 192, 208, 14);
    g.fillStyle = "#8b9098";
    for (let x = 30; x < 230; x += 14) g.fillRect(x, 160, 4, 34);
    rect(g, "#8b9098", 24, 156, 208, 6);
    rect(g, "#ddd7cb", 0, 244, SIZE, 12);
  },
  aptShop: (g, r) => {
    rect(g, "#e9e4da", 0, 0, SIZE, SIZE);
    speckle(g, r, ["#dfd9cd", "#f1ede5"], 500, 2);
    rect(g, "#3c3f46", 12, 40, 232, 200);
    rect(g, "#4f7391", 22, 50, 212, 160);
    rect(g, "#6b8fae", 22, 50, 212, 60);
    g.fillStyle = "rgba(255,255,255,0.18)";
    g.fillRect(40, 50, 26, 160);
    g.fillRect(150, 50, 14, 160);
    rect(g, "#3c3f46", 124, 50, 8, 190);
    rect(g, "#2f3238", 12, 210, 232, 30);
  },
  glass: (g) => {
    rect(g, "#3f6987", 0, 0, SIZE, SIZE);
    rect(g, "#5d88a8", 0, 0, SIZE, 120);
    g.fillStyle = "rgba(255,255,255,0.14)";
    g.beginPath();
    g.moveTo(0, 200);
    g.lineTo(120, 0);
    g.lineTo(170, 0);
    g.lineTo(50, 200);
    g.fill();
    g.fillStyle = "#c9d3dc";
    g.fillRect(0, 0, SIZE, 8);
    g.fillRect(0, 0, 8, SIZE);
    g.fillRect(124, 0, 4, SIZE);
  },
  roofTile: (g) => {
    rect(g, "#ffffff", 0, 0, SIZE, SIZE);
    for (let row = 0; row < 8; row++) {
      const y = row * 32;
      const off = row % 2 ? 16 : 0;
      for (let x = -32 + off; x < SIZE + 32; x += 32) {
        g.fillStyle = "#d9d9d9";
        g.beginPath();
        g.ellipse(x + 16, y + 24, 15, 10, 0, 0, Math.PI);
        g.fill();
        rect(g, "#e9e9e9", x + 2, y, 28, 22);
      }
      rect(g, "#b8b8b8", 0, y + 30, SIZE, 2);
    }
  },
  roofFlat: (g, r) => {
    rect(g, "#a7abb1", 0, 0, SIZE, SIZE);
    speckle(g, r, ["#9a9ea5", "#b4b8be", "#8f949b", "#bfc2c7"], 2600, 2);
    rect(g, "#8d9198", 0, 0, SIZE, 4);
  },
  grass: (g, r) => {
    rect(g, "#86b85a", 0, 0, SIZE, SIZE);
    speckle(g, r, ["#7aad50", "#92c464", "#6fa247", "#9bcb6c"], 3200, 3);
  },
  plaza: (g, r) => {
    rect(g, "#d8d2c6", 0, 0, SIZE, SIZE);
    for (let y = 0; y < SIZE; y += 32) {
      for (let x = 0; x < SIZE; x += 64) {
        const off = (y / 32) % 2 ? 32 : 0;
        const shade = 200 + Math.floor(r() * 24);
        g.fillStyle = `rgb(${shade + 14},${shade + 8},${shade - 4})`;
        g.fillRect(x + off + 2, y + 2, 60, 28);
      }
    }
  },
  sidewalk: (g, r) => {
    rect(g, "#b9b4aa", 0, 0, SIZE, SIZE);
    for (let y = 0; y < SIZE; y += 64) {
      for (let x = 0; x < SIZE; x += 64) {
        const shade = 196 + Math.floor(r() * 18);
        g.fillStyle = `rgb(${shade},${shade - 4},${shade - 12})`;
        g.fillRect(x + 2, y + 2, 60, 60);
      }
    }
  },
  asphalt: (g, r) => {
    rect(g, "#43474e", 0, 0, SIZE, SIZE);
    speckle(g, r, ["#3c4047", "#4a4e55", "#383b41", "#50545b"], 4200, 2);
  },
  door: (g) => {
    rect(g, "#7a4b2e", 0, 0, SIZE, SIZE);
    rect(g, "#5d3820", 0, 0, SIZE, 12);
    rect(g, "#5d3820", 0, 0, 12, SIZE);
    rect(g, "#5d3820", SIZE - 12, 0, 12, SIZE);
    rect(g, "#8b5a39", 40, 30, 176, 80);
    rect(g, "#8b5a39", 40, 136, 176, 90);
    rect(g, "#9fc1d6", 70, 46, 116, 48);
    rect(g, "#e1c16e", 196, 128, 14, 14);
  },
  metal: (g, r) => {
    rect(g, "#eeeeee", 0, 0, SIZE, SIZE);
    for (let x = 0; x < SIZE; x += 32) rect(g, "#d6d6d6", x, 0, 6, SIZE);
    speckle(g, r, ["#e4e4e4", "#f6f6f6"], 600, 2);
  },
};

const cache = new Map<TextureName, THREE.Texture | null>();

export function texture(name: TextureName): THREE.Texture | null {
  if (cache.has(name)) return cache.get(name)!;
  if (typeof document === "undefined") {
    cache.set(name, null);
    return null;
  }
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const g = canvas.getContext("2d")!;
  PAINTS[name](g, rng(name.length * 7919 + name.charCodeAt(0)));
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  cache.set(name, t);
  return t;
}
