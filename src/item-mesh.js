// Builds the meshes named by a parsed gear description. Geometry types and sizes are already limited
// by gear-description.js; this file only turns that plain data into THREE objects. Each item owns the
// MeshStandardMaterials named in its file and disposes them with the meshes.
import * as THREE from 'three';

function bladeGeometry(spec) {
  const positions = [];
  const indices = [];
  const halfThick = spec.thickness * 0.5;
  for (let ring = 0; ring <= spec.segments; ring += 1) {
    const t = ring / spec.segments;
    const y = -spec.length * 0.5 + spec.length * t;
    const half = (spec.baseWidth + (spec.tipWidth - spec.baseWidth) * t) * 0.5;
    const groove = spec.fuller > 0 ? halfThick * Math.min(1, spec.fuller) * Math.sin(Math.PI * t) : 0;
    const z = halfThick - groove;
    positions.push(-half, y, z, half, y, z, half, y, -z, -half, y, -z);
  }
  for (let ring = 0; ring < spec.segments; ring += 1) {
    const a = ring * 4;
    const b = a + 4;
    for (let side = 0; side < 4; side += 1) {
      const next = (side + 1) % 4;
      indices.push(a + side, b + side, b + next, a + side, b + next, a + next);
    }
  }
  indices.push(0, 2, 1, 0, 3, 2);
  const tip = spec.segments * 4;
  indices.push(tip, tip + 1, tip + 2, tip, tip + 2, tip + 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function shieldGeometry(spec) {
  const geometry = new THREE.CylinderGeometry(spec.width * 0.5, spec.width * 0.5, spec.thickness, 24);
  geometry.rotateX(Math.PI / 2);
  if (spec.height !== spec.width) geometry.scale(1, spec.height / spec.width, 1);
  return geometry;
}

export function createItemGeometry(geometry) {
  switch (geometry.type) {
    case 'lathe':
      return new THREE.LatheGeometry(
        geometry.points.map(([radius, y]) => new THREE.Vector2(radius, y)),
        geometry.segments,
      );
    case 'torus':
      return new THREE.TorusGeometry(geometry.radius, geometry.tube, geometry.radialSegments, geometry.tubularSegments);
    case 'cylinder':
      return new THREE.CylinderGeometry(
        geometry.radiusTop,
        geometry.radiusBottom,
        geometry.height,
        geometry.radialSegments,
      );
    case 'sphere':
      return new THREE.SphereGeometry(geometry.radius, geometry.widthSegments, geometry.heightSegments);
    case 'box':
      return new THREE.BoxGeometry(geometry.width, geometry.height, geometry.depth);
    case 'cone':
      return new THREE.ConeGeometry(geometry.radius, geometry.height, geometry.radialSegments);
    case 'blade':
      return bladeGeometry(geometry);
    case 'shield':
      return shieldGeometry(geometry);
    case 'tube': {
      const { from, control, to } = geometry.curve;
      const curve = new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(from[0], from[1], from[2]),
        new THREE.Vector3(control[0], control[1], control[2]),
        new THREE.Vector3(to[0], to[1], to[2]),
      );
      return new THREE.TubeGeometry(curve, geometry.tubularSegments, geometry.radius, geometry.radialSegments, false);
    }
    default:
      throw new Error('Unsupported item geometry.');
  }
}

// View meshes never cast shadows. The held torch's point light is the only shadow caster, and that
// light is added by gear.js, not by a mesh in this file.
export function buildItemParts(description) {
  if (!description?.parsed) throw new Error('buildItemParts needs a parsed gear description.');
  const root = new THREE.Group();
  root.name = description.id;
  const geometries = [];
  const ownedMaterials = [];
  const byName = new Map();
  const surfaces = new Map();
  for (const [name, spec] of Object.entries(description.materials)) {
    const material = new THREE.MeshStandardMaterial({
      color: spec.color,
      roughness: spec.roughness,
      metalness: spec.metalness,
    });
    surfaces.set(name, material);
    ownedMaterials.push(material);
  }
  for (const part of description.parts) {
    let obj;
    if (part.type === 'group') {
      obj = new THREE.Group();
    } else {
      const geometry = createItemGeometry(part.geometry);
      geometries.push(geometry);
      obj = new THREE.Mesh(geometry, surfaces.get(part.material));
      obj.castShadow = false;
      obj.receiveShadow = false;
    }
    obj.name = part.name;
    obj.position.set(part.position[0], part.position[1], part.position[2]);
    if (part.rotation) obj.rotation.set(part.rotation.x, part.rotation.y, part.rotation.z);
    root.add(obj);
    byName.set(part.name, obj);
  }
  return { root, geometries, ownedMaterials, byName };
}

export function disposeItemParts(built) {
  if (!built || built.disposed) return;
  built.disposed = true;
  for (const geometry of built.geometries) geometry.dispose();
  for (const material of built.ownedMaterials) material.dispose();
}
