import * as THREE from "three";

const textureCache = new Map<string, THREE.CanvasTexture>();

/**
 * Generate a building facade texture with windows baked in.
 * This avoids z-fighting from overlapping plane geometries.
 */
export function createFacadeTexture(
  wallColor: string,
  windowColor: string,
  windowRows: number,
  windowCols: number,
  style: "grid" | "bands" | "sparse" | "columns" | "industrial"
): THREE.CanvasTexture {
  const key = `${wallColor}-${windowColor}-${windowRows}-${windowCols}-${style}`;
  const cached = textureCache.get(key);
  if (cached) return cached;

  const w = 256;
  const h = 256;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;

  // Wall base
  ctx.fillStyle = wallColor;
  ctx.fillRect(0, 0, w, h);

  // Subtle wall texture noise
  for (let i = 0; i < 800; i++) {
    const x = Math.random() * w;
    const y = Math.random() * h;
    ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.08})`;
    ctx.fillRect(x, y, 2, 2);
  }

  const padX = w * 0.08;
  const padY = h * 0.06;
  const areaW = w - padX * 2;
  const areaH = h - padY * 2;

  if (style === "grid") {
    // Regular grid of windows
    const gapX = areaW / windowCols;
    const gapY = areaH / windowRows;
    const winW = gapX * 0.55;
    const winH = gapY * 0.5;

    for (let r = 0; r < windowRows; r++) {
      for (let c = 0; c < windowCols; c++) {
        const x = padX + c * gapX + (gapX - winW) / 2;
        const y = padY + r * gapY + (gapY - winH) / 2;
        // Window frame
        ctx.fillStyle = "rgba(0,0,0,0.3)";
        ctx.fillRect(x - 1, y - 1, winW + 2, winH + 2);
        // Window glass
        ctx.fillStyle = windowColor;
        ctx.fillRect(x, y, winW, winH);
        // Reflection highlight
        ctx.fillStyle = "rgba(255,255,255,0.15)";
        ctx.fillRect(x + 1, y + 1, winW * 0.4, winH * 0.3);
      }
    }
  } else if (style === "bands") {
    // Horizontal window bands (glass tower style)
    const bandH = areaH / windowRows;
    for (let r = 0; r < windowRows; r++) {
      const y = padY + r * bandH + bandH * 0.25;
      const bh = bandH * 0.45;
      // Glass band
      ctx.fillStyle = windowColor;
      ctx.fillRect(padX, y, areaW, bh);
      // Mullion lines
      ctx.strokeStyle = "rgba(0,0,0,0.2)";
      ctx.lineWidth = 1;
      const mullions = Math.max(3, windowCols);
      for (let m = 0; m <= mullions; m++) {
        const mx = padX + (areaW / mullions) * m;
        ctx.beginPath();
        ctx.moveTo(mx, y);
        ctx.lineTo(mx, y + bh);
        ctx.stroke();
      }
      // Reflection
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      ctx.fillRect(padX, y, areaW, bh * 0.3);
    }
  } else if (style === "sparse") {
    // Small scattered windows (warehouse/industrial)
    const gapX = areaW / windowCols;
    const gapY = areaH / windowRows;
    const winW = gapX * 0.35;
    const winH = gapY * 0.3;

    for (let r = 0; r < windowRows; r++) {
      for (let c = 0; c < windowCols; c++) {
        const x = padX + c * gapX + (gapX - winW) / 2;
        const y = padY + r * gapY + (gapY - winH) / 2;
        ctx.fillStyle = "rgba(0,0,0,0.2)";
        ctx.fillRect(x - 1, y - 1, winW + 2, winH + 2);
        ctx.fillStyle = windowColor;
        ctx.fillRect(x, y, winW, winH);
      }
    }
    // Loading dock at bottom
    const dockW = areaW * 0.4;
    const dockH = areaH * 0.12;
    ctx.fillStyle = "rgba(40,40,35,0.8)";
    ctx.fillRect(w / 2 - dockW / 2, h - padY - dockH, dockW, dockH);
  } else if (style === "columns") {
    // Classical columns (library style)
    const colW = areaW / (windowCols * 2 + 1);
    for (let c = 0; c < windowCols; c++) {
      const x = padX + (c * 2 + 1) * colW;
      // Column
      ctx.fillStyle = "rgba(255,255,240,0.3)";
      ctx.fillRect(x, padY, colW, areaH);
      // Column highlight
      ctx.fillStyle = "rgba(255,255,255,0.15)";
      ctx.fillRect(x + colW * 0.1, padY, colW * 0.3, areaH);
    }
    // Pediment line
    ctx.fillStyle = "rgba(180,170,150,0.5)";
    ctx.fillRect(padX * 0.5, padY - 4, w - padX, 4);
    ctx.fillRect(padX * 0.5, h - padY, w - padX, 4);
  } else if (style === "industrial") {
    // Steel frame windows (factory style)
    const gapX = areaW / windowCols;
    const gapY = areaH / windowRows;
    // Horizontal steel beams
    for (let r = 0; r <= windowRows; r++) {
      const y = padY + r * gapY;
      ctx.fillStyle = "rgba(100,100,100,0.5)";
      ctx.fillRect(padX * 0.5, y - 2, areaW + padX, 4);
    }
    // Vertical steel beams
    for (let c = 0; c <= windowCols; c++) {
      const x = padX + c * gapX;
      ctx.fillStyle = "rgba(100,100,100,0.4)";
      ctx.fillRect(x - 1.5, padY, 3, areaH);
    }
    // Windows between beams
    for (let r = 0; r < windowRows; r++) {
      for (let c = 0; c < windowCols; c++) {
        const x = padX + c * gapX + 4;
        const y = padY + r * gapY + 4;
        ctx.fillStyle = windowColor;
        ctx.fillRect(x, y, gapX - 8, gapY - 8);
      }
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  textureCache.set(key, texture);
  return texture;
}

/**
 * Generate a roof texture.
 */
export function createRoofTexture(color: string): THREE.CanvasTexture {
  const key = `roof-${color}`;
  const cached = textureCache.get(key);
  if (cached) return cached;

  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = color;
  ctx.fillRect(0, 0, size, size);

  // AC units / rooftop details
  ctx.fillStyle = "rgba(80,80,80,0.5)";
  ctx.fillRect(size * 0.6, size * 0.2, size * 0.25, size * 0.25);
  ctx.fillRect(size * 0.1, size * 0.6, size * 0.2, size * 0.15);

  const texture = new THREE.CanvasTexture(canvas);
  textureCache.set(key, texture);
  return texture;
}
