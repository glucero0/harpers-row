import * as THREE from 'three';

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

function drawStone(ctx, width, height) {
  ctx.fillStyle = '#6d6862';
  ctx.fillRect(0, 0, width, height);
  const brickH = 64;
  const brickW = 128;
  for (let row = 0; row < height / brickH; row += 1) {
    const offset = row % 2 === 0 ? 0 : brickW / 2;
    for (let x = -brickW; x < width + brickW; x += brickW) {
      const shade = 112 + ((row * 13 + x / 8) % 5) * 7;
      ctx.fillStyle = `rgb(${shade + 22}, ${shade + 16}, ${shade + 8})`;
      ctx.fillRect(x + offset + 4, row * brickH + 4, brickW - 8, brickH - 8);
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fillRect(x + offset + 4, row * brickH + 4, brickW - 8, 7);
    }
  }
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

function drawBone(ctx, width, height) {
  ctx.fillStyle = '#d9d1c2';
  ctx.fillRect(0, 0, width, height);
  for (let i = 0; i < 80; i += 1) {
    const shade = 150 + Math.random() * 80;
    ctx.fillStyle = `rgba(${shade}, ${shade - 8}, ${shade - 20}, 0.45)`;
    ctx.beginPath();
    ctx.arc(Math.random() * width, Math.random() * height, 1 + Math.random() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
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

export function createMaterials() {
  const colorSpace = THREE.SRGBColorSpace;
  const stoneMap = canvasTexture(512, drawStone, colorSpace);
  const woodMap = canvasTexture(512, drawWood, colorSpace);
  const rockMap = canvasTexture(512, drawRock, colorSpace);
  const rockBump = canvasTexture(512, drawRockBump, THREE.NoColorSpace);
  const metalMap = canvasTexture(256, drawMetal, colorSpace);
  const boneMap = canvasTexture(256, drawBone, colorSpace);

  const wall = {
    stone: sharedSurface(stoneMap, 0xc8c2b8, 0.9, 0.04),
    wood: sharedSurface(woodMap, 0xd7b48a, 0.9, 0.04),
    cave: sharedSurface(rockMap, 0x8a8682, 0.96, 0.02, rockBump),
  };
  const floor = {
    stone: sharedSurface(stoneMap, 0x9a948c, 0.94, 0.04),
    wood: sharedSurface(woodMap, 0xb08968, 0.94, 0.04),
    cave: sharedSurface(rockMap, 0x6e6a66, 0.96, 0.02, rockBump),
  };
  const plank = sharedSurface(woodMap, 0xc09060, 0.75, 0.04);
  const ceiling = share(new THREE.MeshStandardMaterial({ color: 0x2a241e, roughness: 1 }));
  const ceilingCave = share(new THREE.MeshStandardMaterial({ color: 0x16181c, roughness: 1 }));
  const brazier = share(new THREE.MeshStandardMaterial({ color: 0x4a463f, roughness: 0.9 }));
  const bowl = share(new THREE.MeshStandardMaterial({ color: 0x2c2a28, roughness: 0.6, metalness: 0.4 }));
  const core = share(new THREE.MeshBasicMaterial({ color: 0xfff1c4 }));

  function surface(theme) {
    return wall[theme] || wall.stone;
  }

  function floorMaterial(theme) {
    return floor[theme] || floor.stone;
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
  const leather = share(new THREE.MeshStandardMaterial({
    color: 0x6a4632,
    roughness: 0.82,
    metalness: 0.04,
  }));
  const rust = share(new THREE.MeshStandardMaterial({
    color: 0x6d5848,
    roughness: 0.7,
    metalness: 0.35,
  }));
  const flame = share(new THREE.MeshBasicMaterial({ color: 0xffb15a }));
  const eye = share(new THREE.MeshBasicMaterial({ color: 0xb6ff7a }));
  const socket = share(new THREE.MeshStandardMaterial({ color: 0x1a1814, roughness: 1 }));

  const bone = share(new THREE.MeshStandardMaterial({
    map: boneMap,
    color: 0xe7dfd0,
    roughness: 0.8,
    metalness: 0.02,
  }));
  const boneHot = bone.clone();
  boneHot.emissive.setHex(0xfff4df);
  boneHot.emissiveIntensity = 0.7;
  boneHot.userData.shared = true;

  return {
    surface,
    floor: floorMaterial,
    plank,
    ceiling,
    ceilingCave,
    brazier,
    bowl,
    core,
    metal,
    armor,
    leather,
    rust,
    flame,
    eye,
    socket,
    bone,
    boneHot,
  };
}
