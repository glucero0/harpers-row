import * as THREE from 'three';
import { applyRuinShader, createRuinField } from './ruin-material.js';
import { applySubsurfaceScattering } from './subsurface.js';

function drawLeather(ctx, width, height) {
  ctx.fillStyle = '#5c3b2a';
  ctx.fillRect(0, 0, width, height);
  for (let row = 0; row < 28; row += 1) {
    const y = (row / 28) * height;
    ctx.strokeStyle = `rgba(20, 10, 6, ${0.15 + (row % 3) * 0.05})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y + Math.sin(row * 1.7) * 6);
    ctx.stroke();
  }
  for (let speck = 0; speck < 80; speck += 1) {
    const x = hash2(speck, 3) * width;
    const y = hash2(speck, 9) * height;
    ctx.fillStyle = 'rgba(18, 9, 5, 0.35)';
    ctx.fillRect(x, y, 3 + hash2(speck, 1) * 8, 2);
  }
  ctx.fillStyle = 'rgba(12, 7, 4, 0.45)';
  ctx.fillRect(0, 0, width, 10);
  ctx.fillRect(0, height - 12, width, 12);
}

function drawChain(ctx, width, height) {
  ctx.fillStyle = '#2a2e32';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = '#7d868e';
  ctx.lineWidth = 2;
  const step = 18;
  for (let y = 0; y < height + step; y += step) {
    for (let x = 0; x < width + step; x += step) {
      const ox = (Math.floor(y / step) % 2) * step * 0.5;
      ctx.beginPath();
      ctx.ellipse(x + ox, y, 6, 4, 0.4, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.fillStyle = 'rgba(8, 8, 8, 0.35)';
  ctx.fillRect(0, height - 16, width, 16);
}

function canvasTexture(size, draw, colorSpace) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  draw(canvas.getContext('2d'), size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}

function blockTone(col, row) {
  const n = hash2(col, row);
  const base = 96 + Math.floor(n * 48);
  return [base + 18, base + 12, base + 4];
}

function stoneCourse(x, y, width, height) {
  const cols = 4;
  const rows = 6;
  const brickW = width / cols;
  const brickH = height / rows;
  const row = Math.floor(y / brickH) % rows;
  const stagger = (row % 2) * 0.5;
  let along = x / brickW - stagger;
  along = ((along % cols) + cols) % cols;
  const col = Math.floor(along);
  const fy = (y % brickH) / brickH;
  return { col, row, fx: along - col, fy };
}

function drawStone(ctx, width, height) {
  const image = ctx.createImageData(width, height);
  const data = image.data;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const { col, row, fx, fy } = stoneCourse(x + 0.5, y + 0.5, width, height);
      const edge = Math.min(fx, 1 - fx, fy, 1 - fy);
      const mortar = Math.min(1, Math.max(0, (0.1 - edge) / 0.06));
      const [baseR, baseG, baseB] = blockTone(col + 2, row + 3);
      const grit = hash2(col * 17 + Math.floor(fx * 24), row * 13 + Math.floor(fy * 24)) - 0.5;
      let red = baseR + grit * 16;
      let green = baseG + grit * 14;
      let blue = baseB + grit * 10;
      const pit = hash2(col * 5 + (x % 9), row * 3 + (y % 7));
      if (pit > 0.82 && mortar < 0.2) {
        red *= 0.72;
        green *= 0.7;
        blue *= 0.68;
      }
      red = red * (1 - mortar) + 62 * mortar;
      green = green * (1 - mortar) + 56 * mortar;
      blue = blue * (1 - mortar) + 48 * mortar;
      const index = (y * width + x) * 4;
      data[index] = Math.max(0, Math.min(255, red));
      data[index + 1] = Math.max(0, Math.min(255, green));
      data[index + 2] = Math.max(0, Math.min(255, blue));
      data[index + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}

function drawStoneHeight(ctx, width, height) {
  const image = ctx.createImageData(width, height);
  const data = image.data;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const { col, row, fx, fy } = stoneCourse(x + 0.5, y + 0.5, width, height);
      const edge = Math.min(fx, 1 - fx, fy, 1 - fy);
      const mortar = Math.min(1, Math.max(0, (0.11 - edge) / 0.07));
      const grit = (hash2(col * 17 + Math.floor(fx * 24), row * 13 + Math.floor(fy * 24)) - 0.5) * 24;
      const block = 150 + hash2(col, row) * 36 + grit;
      const shade = Math.max(0, Math.min(255, block * (1 - mortar) + 42 * mortar));
      const index = (y * width + x) * 4;
      data[index] = shade;
      data[index + 1] = shade;
      data[index + 2] = shade;
      data[index + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}

function drawWood(ctx, width, height) {
  ctx.fillStyle = '#5c3b28';
  ctx.fillRect(0, 0, width, height);
  const plank = 72;
  for (let x = 0; x < width; x += plank) {
    const tone = 92 + ((x / plank) % 4) * 12;
    ctx.fillStyle = `rgb(${tone + 48}, ${tone + 4}, ${tone - 36})`;
    ctx.fillRect(x + 2, 0, plank - 4, height);
    ctx.strokeStyle = 'rgba(48, 26, 12, 0.35)';
    ctx.lineWidth = 2;
    for (let y = 10; y < height; y += 9) {
      ctx.beginPath();
      ctx.moveTo(x + 8, y);
      ctx.bezierCurveTo(x + 24, y + 3, x + 46, y - 3, x + plank - 8, y + 1);
      ctx.stroke();
    }
    if ((x / plank) % 2 === 0) {
      ctx.fillStyle = 'rgba(36, 18, 8, 0.4)';
      ctx.beginPath();
      ctx.ellipse(x + plank * 0.55, height * 0.38, 9, 6, 0.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawRock(ctx, width, height) {
  ctx.fillStyle = '#3e3c39';
  ctx.fillRect(0, 0, width, height);
  for (let i = 0; i < 90; i += 1) {
    const x = Math.random() * width;
    const y = Math.random() * height;
    const gray = 62 + Math.random() * 55;
    ctx.fillStyle = `rgba(${gray + 6}, ${gray + 2}, ${gray - 4}, 0.62)`;
    ctx.beginPath();
    ctx.ellipse(x, y, 18 + Math.random() * 70, 12 + Math.random() * 36, Math.random() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(18, 16, 14, 0.55)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 20; i += 1) {
    ctx.beginPath();
    let x = Math.random() * width;
    let y = Math.random() * height;
    ctx.moveTo(x, y);
    for (let step = 0; step < 4; step += 1) {
      x += (Math.random() - 0.5) * 90;
      y += (Math.random() - 0.5) * 46;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

function drawRockBump(ctx, width, height) {
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, width, height);
  for (let i = 0; i < 120; i += 1) {
    const shade = Math.floor(Math.random() * 255);
    ctx.fillStyle = `rgb(${shade}, ${shade}, ${shade})`;
    ctx.beginPath();
    ctx.ellipse(
      Math.random() * width,
      Math.random() * height,
      8 + Math.random() * 40,
      6 + Math.random() * 24,
      Math.random() * 3,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
}

function drawMetal(ctx, width, height) {
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#e3e9ee');
  gradient.addColorStop(0.45, '#8d98a3');
  gradient.addColorStop(1, '#d0d7de');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = 'rgba(255,255,255,0.28)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 16; i += 1) {
    const y = (i / 16) * height;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y + Math.sin(i) * 4);
    ctx.stroke();
  }
}

function hash2(ix, iy) {
  let n = Math.imul(ix, 374761393) + Math.imul(iy, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  n ^= n >>> 16;
  return (n >>> 0) / 4294967295;
}

function fade(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function valueNoise(x, y) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = fade(x - x0);
  const ty = fade(y - y0);
  const v00 = hash2(x0, y0);
  const v10 = hash2(x0 + 1, y0);
  const v01 = hash2(x0, y0 + 1);
  const v11 = hash2(x0 + 1, y0 + 1);
  const a = v00 + (v10 - v00) * tx;
  const b = v01 + (v11 - v01) * tx;
  return a + (b - a) * ty;
}

function fbm(x, y, octaves) {
  let value = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let total = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    value += amplitude * valueNoise(x * frequency, y * frequency);
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return value / total;
}

function smoothstep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function mix(a, b, t) {
  return a + (b - a) * t;
}

function wrapIndex(index, period) {
  const span = period | 0;
  return ((index % span) + span) % span;
}

function periodicValueNoise(x, y, period) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = fade(x - x0);
  const ty = fade(y - y0);
  const v00 = hash2(wrapIndex(x0, period), wrapIndex(y0, period));
  const v10 = hash2(wrapIndex(x0 + 1, period), wrapIndex(y0, period));
  const v01 = hash2(wrapIndex(x0, period), wrapIndex(y0 + 1, period));
  const v11 = hash2(wrapIndex(x0 + 1, period), wrapIndex(y0 + 1, period));
  const a = v00 + (v10 - v00) * tx;
  const b = v01 + (v11 - v01) * tx;
  return a + (b - a) * ty;
}

function periodicFbm(u, v, octaves, period) {
  let value = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let total = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    const span = period * frequency;
    value += amplitude * periodicValueNoise(u * span, v * span, span);
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return value / total;
}

function channel(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

const SOIL_UMBER = [92, 62, 36];
const SOIL_TAN = [186, 142, 78];
const SOIL_GRAY = [154, 140, 118];
const SOIL_CLAY = [168, 72, 40];
const PEBBLE_LIGHT = [142, 132, 116];
const PEBBLE_WARM = [124, 108, 84];
const PEBBLE_DARK = [72, 68, 62];

// One repeat of this map is DIRT_TILE_METRES of ground. Frequencies are integer periods so the
// tile meets itself at the edge. Stones are a light scatter of gravel, not a cobble surface.
function dirtSurfaces(size) {
  const color = new Uint8ClampedArray(size * size * 4);
  const bump = new Uint8ClampedArray(size * size * 4);
  const rough = new Uint8ClampedArray(size * size * 4);
  const cells = 20;
  const grid = new Array(cells * cells);
  for (let cy = 0; cy < cells; cy += 1) {
    for (let cx = 0; cx < cells; cx += 1) {
      if (hash2(cx + 17, cy + 41) > 0.42) continue;
      const jx = hash2(cx + 3, cy + 9);
      const jy = hash2(cx + 13, cy + 27);
      const spin = hash2(cx + 5, cy + 19) * Math.PI;
      const tone = hash2(cx + 11, cy + 2);
      const chip = hash2(cx + 2, cy + 6) > 0.86;
      const radius = chip
        ? 11 + hash2(cx + 8, cy + 23) * 7
        : 3.5 + hash2(cx + 8, cy + 23) * 5.5;
      const squash = 0.58 + hash2(cx + 29, cy + 4) * 0.32;
      grid[cy * cells + cx] = {
        x: ((cx + 0.18 + jx * 0.64) / cells) * size,
        y: ((cy + 0.18 + jy * 0.64) / cells) * size,
        rx: radius,
        ry: radius * squash,
        cos: Math.cos(spin),
        sin: Math.sin(spin),
        tone,
      };
    }
  }

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const v = y / size;
      const blot = smoothstep(0.22, 0.78, periodicFbm(u + 0.17, v + 0.41, 4, 5));
      const mottling = smoothstep(0.28, 0.74, periodicFbm(u + 2.3, v + 1.05, 3, 8));
      const clayAmt = smoothstep(0.55, 0.82, periodicFbm(u + 4.1, v + 3.2, 3, 4));
      let red = mix(SOIL_UMBER[0], SOIL_TAN[0], blot);
      let green = mix(SOIL_UMBER[1], SOIL_TAN[1], blot);
      let blue = mix(SOIL_UMBER[2], SOIL_TAN[2], blot);
      red = mix(red, SOIL_GRAY[0], mottling * 0.7);
      green = mix(green, SOIL_GRAY[1], mottling * 0.7);
      blue = mix(blue, SOIL_GRAY[2], mottling * 0.7);
      red = mix(red, SOIL_CLAY[0], clayAmt * 0.62);
      green = mix(green, SOIL_CLAY[1], clayAmt * 0.62);
      blue = mix(blue, SOIL_CLAY[2], clayAmt * 0.62);
      const grit = periodicValueNoise(u * 48, v * 48, 48) - 0.5;
      const gritFine = periodicValueNoise(u * 96 + 4, v * 96 + 7, 96) - 0.5;
      red += grit * 20 + gritFine * 9;
      green += grit * 15 + gritFine * 7;
      blue += grit * 9 + gritFine * 4;

      let height = 0.46 + grit * 0.05 + gritFine * 0.025;
      let roughness = 1;
      let hitD = 1.4;
      let hitLx = 0;
      let hitLy = 0;
      let hitRx = 1;
      let hitRy = 1;
      let hitTone = 0;
      const cellX = Math.floor(u * cells) % cells;
      const cellY = Math.floor(v * cells) % cells;
      for (let oy = -1; oy <= 1; oy += 1) {
        for (let ox = -1; ox <= 1; ox += 1) {
          const stone = grid[((cellY + oy + cells) % cells) * cells + ((cellX + ox + cells) % cells)];
          if (!stone) continue;
          let dx = x + 0.5 - stone.x;
          let dy = y + 0.5 - stone.y;
          if (dx > size * 0.5) dx -= size;
          else if (dx < -size * 0.5) dx += size;
          if (dy > size * 0.5) dy -= size;
          else if (dy < -size * 0.5) dy += size;
          const lx = dx * stone.cos + dy * stone.sin;
          const ly = -dx * stone.sin + dy * stone.cos;
          const d = (lx * lx) / (stone.rx * stone.rx) + (ly * ly) / (stone.ry * stone.ry);
          if (d < hitD) {
            hitD = d;
            hitLx = lx;
            hitLy = ly;
            hitRx = stone.rx;
            hitRy = stone.ry;
            hitTone = stone.tone;
          }
        }
      }

      if (hitD < 1.32) {
        const nx = hitLx / hitRx;
        const ny = hitLy / hitRy;
        const light = Math.max(-1, Math.min(1, -(nx * 0.72 + ny * 0.56)));
        const lump = periodicValueNoise(u * 36 + 3.1, v * 36 + 8.4, 36);
        const edge = 0.72 + lump * 0.34;
        if (hitD < edge) {
          const pebble = hitTone < 0.34 ? PEBBLE_LIGHT : hitTone < 0.7 ? PEBBLE_WARM : PEBBLE_DARK;
          const blend = 1 - smoothstep(edge * 0.72, edge, hitD);
          red = mix(red, pebble[0] + light * 14, blend);
          green = mix(green, pebble[1] + light * 11, blend);
          blue = mix(blue, pebble[2] + light * 8, blend);
          height = mix(height, 0.58 + (1 - Math.min(1, Math.sqrt(hitD / edge))) * 0.28, blend);
          roughness = mix(roughness, 0.75, blend);
        } else if (hitD < edge + 0.22) {
          const away = Math.max(0, nx * 0.72 + ny * 0.56);
          const shadow = (1 - smoothstep(edge, edge + 0.2, hitD)) * away * 0.38;
          red *= 1 - shadow;
          green *= 1 - shadow;
          blue *= 1 - shadow;
          height -= shadow * 0.08;
        }
      }

      const index = (y * size + x) * 4;
      color[index] = channel(red);
      color[index + 1] = channel(green);
      color[index + 2] = channel(blue);
      color[index + 3] = 255;
      const bumpByte = channel(height * 255);
      bump[index] = bumpByte;
      bump[index + 1] = bumpByte;
      bump[index + 2] = bumpByte;
      bump[index + 3] = 255;
      const roughByte = channel(roughness * 255);
      rough[index] = roughByte;
      rough[index + 1] = roughByte;
      rough[index + 2] = roughByte;
      rough[index + 3] = 255;
    }
  }
  return { color, bump, rough };
}

const BONE_PARCHMENT = [0xdc, 0xd2, 0xb8];
const BONE_SOOT = [0xbf, 0xb5, 0x9b];
const BONE_PIT = [0x6a, 0x61, 0x50];

function boneSurfaces(size) {
  const color = new Uint8ClampedArray(size * size * 4);
  const bump = new Uint8ClampedArray(size * size * 4);
  const ao = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const v = y / size;
      const warpX = fbm(u * 3 + 4.2, v * 3 + 1.7, 3);
      const warpY = fbm(u * 3 + 8.8, v * 3 + 2.4, 3);
      const nx = u * 7.5 + warpX * 1.35;
      const ny = v * 7.5 + warpY * 1.35;
      const stain = fbm(u * 2.1 + 1.2, v * 2.1 + 0.4, 4);
      const pores = smoothstep(0.68, 0.86, fbm(nx * 1.8 + 12, ny * 1.8 + 3, 4));
      const grain = valueNoise(nx * 3.4 + 20, ny * 3.4 + 9);
      const crack = 1 - smoothstep(0.012, 0.04, Math.abs(grain - 0.63));
      const grit = fbm(nx * 5.5, ny * 5.5, 2);
      const crevice = Math.min(1, pores * 0.8 + crack);
      let red = mix(BONE_PARCHMENT[0], BONE_SOOT[0], stain);
      let green = mix(BONE_PARCHMENT[1], BONE_SOOT[1], stain);
      let blue = mix(BONE_PARCHMENT[2], BONE_SOOT[2], stain);
      red = mix(red, BONE_PIT[0], crevice);
      green = mix(green, BONE_PIT[1], crevice);
      blue = mix(blue, BONE_PIT[2], crevice);
      const gritShade = (grit - 0.5) * 16;
      red += gritShade;
      green += gritShade * 0.92;
      blue += gritShade * 0.75;
      const height = 0.58 + (grit - 0.5) * 0.2 + (stain - 0.5) * 0.08 - pores * 0.36 - crack * 0.72;
      const occlusion = 1 - pores * 0.55 - crack * 0.82;
      const index = (y * size + x) * 4;
      color[index] = red;
      color[index + 1] = green;
      color[index + 2] = blue;
      color[index + 3] = 255;
      const bumpByte = Math.min(255, Math.max(0, Math.round(height * 255)));
      bump[index] = bumpByte;
      bump[index + 1] = bumpByte;
      bump[index + 2] = bumpByte;
      bump[index + 3] = 255;
      const aoByte = Math.min(255, Math.max(0, Math.round(occlusion * 255)));
      ao[index] = aoByte;
      ao[index + 1] = aoByte;
      ao[index + 2] = aoByte;
      ao[index + 3] = 255;
    }
  }
  return { color, bump, ao };
}

function imageTexture(pixels, size, colorSpace) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  canvas.getContext('2d').putImageData(new ImageData(pixels, size, size), 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}

function textured(map, repeatX, repeatY, params) {
  const clone = map.clone();
  clone.needsUpdate = true;
  clone.wrapS = THREE.RepeatWrapping;
  clone.wrapT = THREE.RepeatWrapping;
  clone.repeat.set(repeatX, repeatY);
  clone.anisotropy = 8;
  return new THREE.MeshStandardMaterial({ map: clone, ...params });
}

// Disposes a material and every texture it owns (map, bumpMap, aoMap, emissiveMap, etc.), the same
// generic property-walk used for scene meshes elsewhere in the codebase. Safe to call more than once:
// THREE's `.dispose()` is itself idempotent.
function disposeMaterial(material) {
  if (!material) return;
  Object.keys(material).forEach((key) => {
    const value = material[key];
    if (value && typeof value === 'object' && typeof value.dispose === 'function') {
      value.dispose();
    }
  });
  material.dispose();
}

function sharedSurface(map, color, roughness, metalness, bump) {
  const material = new THREE.MeshStandardMaterial({
    map,
    color,
    roughness,
    metalness,
    bumpMap: bump || null,
    bumpScale: bump ? 0.35 : 0,
  });
  material.userData.shared = true;
  return material;
}

// World size of one dirt-texture repeat. Ground UVs are metres divided by this.
// Four metres keeps gravel a few centimetres across without a postage-stamp repeat underfoot.
export const DIRT_TILE_METRES = 4;

export function createMaterials() {
  const colorSpace = THREE.SRGBColorSpace;
  const stoneMap = canvasTexture(512, drawStone, colorSpace);
  const stoneHeight = canvasTexture(256, drawStoneHeight, THREE.NoColorSpace);
  const dirtSize = 512;
  const dirtField = dirtSurfaces(dirtSize);
  const dirtMap = imageTexture(dirtField.color, dirtSize, colorSpace);
  const dirtBump = imageTexture(dirtField.bump, dirtSize, THREE.NoColorSpace);
  const dirtRough = imageTexture(dirtField.rough, dirtSize, THREE.NoColorSpace);
  const woodMap = canvasTexture(512, drawWood, colorSpace);
  const rockMap = canvasTexture(512, drawRock, colorSpace);
  const rockBump = canvasTexture(512, drawRockBump, THREE.NoColorSpace);
  const metalMap = canvasTexture(256, drawMetal, colorSpace);
  const boneSize = 256;
  const boneField = boneSurfaces(boneSize);
  const boneMap = imageTexture(boneField.color, boneSize, colorSpace);
  const boneBump = imageTexture(boneField.bump, boneSize, THREE.NoColorSpace);
  const boneAo = imageTexture(boneField.ao, boneSize, THREE.NoColorSpace);

  const ruin = createRuinField(stoneHeight);
  const wall = {
    stone: applyRuinShader(sharedSurface(stoneMap, 0x8d877e, 0.92, 0.04, stoneHeight), ruin),
    wood: sharedSurface(woodMap, 0xd7b48a, 0.9, 0.04),
    cave: sharedSurface(rockMap, 0x8a8682, 0.96, 0.02, rockBump),
  };
  const floor = {
    stone: applyRuinShader(sharedSurface(stoneMap, 0x6f6a63, 0.96, 0.03, stoneHeight), ruin),
    wood: sharedSurface(woodMap, 0xb08968, 0.94, 0.04),
    cave: sharedSurface(rockMap, 0x6e6a66, 0.96, 0.02, rockBump),
  };
  const ceilings = {
    stone: applyRuinShader(sharedSurface(stoneMap, 0x4e4a44, 0.98, 0.02, stoneHeight), ruin),
    wood: sharedSurface(woodMap, 0x6a4530, 0.96, 0.03),
    cave: sharedSurface(rockMap, 0x2e2c2a, 0.98, 0.02, rockBump),
  };
  const plank = sharedSurface(woodMap, 0xc09060, 0.75, 0.04);
  const dirt = sharedSurface(dirtMap, 0x8a6a48, 1, 0, dirtBump);
  dirt.bumpScale = 0.18;
  dirt.roughnessMap = dirtRough;
  const ceiling = ceilings.stone;
  const ceilingCave = ceilings.cave;
  wall.stone.bumpMap = null;
  floor.stone.bumpMap = null;
  ceilings.stone.bumpMap = null;
  const brazier = share(new THREE.MeshStandardMaterial({ color: 0x4a463f, roughness: 0.9 }));
  const bowl = share(new THREE.MeshStandardMaterial({ color: 0x2c2a28, roughness: 0.6, metalness: 0.4 }));
  const core = share(new THREE.MeshBasicMaterial({ color: 0xfff1c4 }));

  function surface(theme) {
    return wall[theme] || wall.stone;
  }

  function floorMaterial(theme) {
    return floor[theme] || floor.stone;
  }

  function ceilingMaterial(theme) {
    return ceilings[theme] || ceilings.stone;
  }

  function share(material) {
    material.userData.shared = true;
    return material;
  }

  const metal = share(textured(metalMap, 1, 2, {
    color: 0xd5dde4,
    roughness: 0.32,
    metalness: 0.88,
  }));
  const armor = share(textured(metalMap, 1, 1, {
    color: 0x8d98a4,
    roughness: 0.4,
    metalness: 0.82,
  }));
  const leatherMap = canvasTexture(256, drawLeather, colorSpace);
  const chainMap = canvasTexture(256, drawChain, colorSpace);
  const leather = share(new THREE.MeshStandardMaterial({
    map: leatherMap,
    color: 0xc4a090,
    roughness: 0.84,
    metalness: 0.02,
  }));
  const chain = share(new THREE.MeshStandardMaterial({
    map: chainMap,
    color: 0xb7c0c6,
    roughness: 0.48,
    metalness: 0.72,
  }));
  const iron = share(new THREE.MeshStandardMaterial({
    color: 0x2a2724,
    roughness: 0.42,
    metalness: 0.84,
  }));
  const gold = share(new THREE.MeshStandardMaterial({
    color: 0xe2b34a,
    emissive: 0x5a3810,
    emissiveIntensity: 0.38,
    roughness: 0.08,
    metalness: 0.98,
  }));
  const ember = share(new THREE.MeshStandardMaterial({
    color: 0x2a0c06,
    emissive: 0xff5a18,
    emissiveIntensity: 0.42,
    roughness: 1,
  }));
  const rust = share(new THREE.MeshStandardMaterial({
    color: 0x6d5848,
    roughness: 0.7,
    metalness: 0.35,
  }));
  const flame = share(new THREE.MeshBasicMaterial({ color: 0xffb15a }));
  const eye = share(new THREE.MeshBasicMaterial({ color: 0xb6ff7a }));
  const socket = share(new THREE.MeshStandardMaterial({ color: 0x070605, roughness: 1, metalness: 0 }));

  const bone = share(new THREE.MeshPhysicalMaterial({
    map: boneMap,
    color: 0xffffff,
    roughness: 0.92,
    metalness: 0,
    bumpMap: boneBump,
    bumpScale: 0.1,
    aoMap: boneAo,
    aoMapIntensity: 1.15,
    specularIntensity: 0.07,
    specularColor: 0x8a8172,
  }));
  const boneScatter = {
    color: new THREE.Color(0xd8c09a),
    thickness: 0.28,
    power: 2.4,
    scale: 2,
    distortion: 0.22,
  };
  bone.flatShading = false;
  applySubsurfaceScattering(bone, boneScatter);
  const boneHot = bone.clone();
  boneHot.emissive.setHex(0xff6a4a);
  boneHot.emissiveIntensity = 0.55;
  boneHot.userData.shared = true;
  applySubsurfaceScattering(boneHot, {
    color: boneScatter.color.clone(),
    thickness: boneScatter.thickness,
    power: boneScatter.power,
    scale: boneScatter.scale,
    distortion: boneScatter.distortion,
  });
  const boneFlash = bone.clone();
  boneFlash.userData.shared = true;
  applySubsurfaceScattering(boneFlash, {
    color: boneScatter.color.clone(),
    thickness: boneScatter.thickness,
    power: boneScatter.power,
    scale: boneScatter.scale,
    distortion: boneScatter.distortion,
    flashAmount: 1,
  });

  // A private, transparent twin of a material, so one skeleton's bones can fade without touching the
  // shared ones. The twin owns no textures (it reuses the originals), so only the material is disposed.
  function fadeVariant(source) {
    const twin = source.clone();
    twin.userData = { shared: true };
    if (source.userData.sssUniforms) {
      applySubsurfaceScattering(twin, {
        color: boneScatter.color.clone(),
        thickness: boneScatter.thickness,
        power: boneScatter.power,
        scale: boneScatter.scale,
        distortion: boneScatter.distortion,
        flashAmount: source.userData.sssUniforms.flash_amount.value,
      });
    }
    twin.transparent = true;
    twin.opacity = 1;
    return twin;
  }

  // Every material this factory created, kept for dispose(). `fadeVariant()` clones created later
  // (per living skeleton) are each entity's own responsibility, not this shared material set's.
  const ownedMaterials = [
    wall.stone, wall.wood, wall.cave,
    floor.stone, floor.wood, floor.cave,
    ceilings.stone, ceilings.wood, ceilings.cave,
    plank, dirt, brazier, bowl, core,
    metal, armor, leather, chain, iron, gold, ember, rust, flame, eye, socket,
    bone, boneHot, boneFlash,
  ];
  let disposed = false;

  return {
    fadeVariant,
    surface,
    floor: floorMaterial,
    ceilingFor: ceilingMaterial,
    plank,
    dirt,
    ceiling,
    ceilingCave,
    ruin,
    brazier,
    bowl,
    core,
    metal,
    armor,
    leather,
    chain,
    iron,
    gold,
    ember,
    rust,
    flame,
    eye,
    socket,
    bone,
    boneHot,
    boneFlash,
    // Disposes every material and texture this factory created, including the heightmap texture
    // (`stoneHeight`) that only survives via the ruin shader's uniform once the per-material bumpMap
    // reference is cleared above. Per docs/ARCHITECTURE.md this factory owns teardown of its own
    // resources; it does not need to be called during normal play since materials live for the app's
    // session, but it exists so areas/themes can be rebuilt and so tests can assert no leaks. Idempotent.
    dispose() {
      if (disposed) return;
      disposed = true;
      ownedMaterials.forEach(disposeMaterial);
      stoneHeight.dispose();
    },
  };
}
