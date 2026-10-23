import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { PROP_TYPES, createPropField, propSpec } from './props.js';

const materials = {
  stone: new THREE.MeshStandardMaterial(),
  wood: new THREE.MeshStandardMaterial(),
  cave: new THREE.MeshStandardMaterial(),
  bone: new THREE.MeshStandardMaterial(),
  dark: new THREE.MeshStandardMaterial(),
  scrub: new THREE.MeshStandardMaterial(),
};
const resolve = (key) => materials[key];

let field;
let parent;

afterEach(() => {
  field?.dispose();
  field = null;
});

function build(items, options) {
  parent = new THREE.Group();
  field = createPropField(parent, resolve, items, options);
  return field;
}

describe('the prop kit', () => {
  it('covers every prop and scenery type the generator writes', () => {
    for (const type of [
      'casket', 'urn', 'shelf', 'bone-pile', 'rubble', 'stalagmite', 'broken-pillar', 'barrel', 'plank-pile', 'crate',
      'broken-statue', 'fallen-column', 'scrub', 'boulder', 'gravestone', 'standing-stone', 'cart-wreck',
      'campfire-ashes', 'supply-crate', 'signpost',
    ]) {
      expect(PROP_TYPES).toContain(type);
    }
  });

  it('gives every type a mesh that is indexed, normalled and uv-mapped, with solid circles of sensible size', () => {
    for (const type of PROP_TYPES) {
      const spec = propSpec(type, 'stone');
      const geometry = spec.build();
      expect(geometry.index, type).not.toBeNull();
      expect(geometry.getAttribute('position').count, type).toBeGreaterThan(8);
      expect(geometry.getAttribute('normal').count, type).toBe(geometry.getAttribute('position').count);
      expect(geometry.getAttribute('uv').count, type).toBe(geometry.getAttribute('position').count);
      for (const value of geometry.getAttribute('position').array) expect(Number.isFinite(value), type).toBe(true);
      for (const [, , radius] of spec.solid) {
        expect(radius, type).toBeGreaterThan(0);
        expect(radius, type).toBeLessThan(3);
      }
      geometry.dispose();
    }
  });

  it('draws an unknown type as rubble instead of dropping it', () => {
    expect(propSpec('never-heard-of-it', 'stone').kitType).toBe('rubble');
  });

  it('draws rubble as cave rock in a cave and as masonry elsewhere', () => {
    expect(propSpec('rubble', 'cave').material).toBe('cave');
    expect(propSpec('rubble', 'stone').material).toBe('stone');
  });
});

describe('createPropField', () => {
  const item = (extra = {}) => ({ type: 'barrel', theme: 'wood', x: 10, y: 0, z: 20, rotationY: 0, scale: 1, roomId: 'a', ...extra });

  it('draws many props of many types in one batch per material', () => {
    build([item(), item({ x: 14 }), item({ type: 'crate' }), item({ type: 'urn', theme: 'stone' }), item({ type: 'urn', theme: 'stone', x: 3 })]);
    expect(field.meshes.map((mesh) => mesh.name).sort()).toEqual(['props-stone', 'props-wood']);
    expect(parent.children).toHaveLength(2);
    expect(field.count).toBe(5);
  });

  it('shows a room\'s props only while that room is active', () => {
    build([item({ roomId: 'a' }), item({ roomId: 'b', x: 30 })]);
    const mesh = field.meshes[0];
    const visible = () => [0, 1].map((id) => mesh.getVisibleAt(id));
    expect(visible()).toEqual([false, false]);
    field.showRooms(new Set(['a']));
    expect(visible()).toEqual([true, false]);
    field.showRooms(new Set(['a', 'b']));
    expect(visible()).toEqual([true, true]);
    field.showRooms(new Set());
    expect(visible()).toEqual([false, false]);
  });

  it('always draws a prop that belongs to no room', () => {
    build([item({ roomId: null })]);
    expect(field.meshes[0].getVisibleAt(0)).toBe(true);
  });

  it('places solid props as colliders on the story they stand on, turned and scaled with them', () => {
    build([item({ type: 'crate', x: 10, z: 20, y: 10, scale: 2 })]);
    expect(field.colliders).toEqual([{ x: 10, z: 20, radius: 3, story: 1 }]);

    field.dispose();
    build([item({ type: 'casket', x: 0, z: 0, rotationY: Math.PI / 2, scale: 1 })]);
    const [first, second] = field.colliders;
    // A quarter turn swings the casket's two circles from the x axis onto the z axis.
    expect(first.x).toBeCloseTo(0, 5);
    expect(first.z).toBeCloseTo(1.2, 5);
    expect(second.x).toBeCloseTo(0, 5);
    expect(second.z).toBeCloseTo(-1.2, 5);
    expect(first.story).toBe(0);
  });

  it('lets the player walk through props with no solid part', () => {
    build([item({ type: 'scrub', theme: 'outdoor' }), item({ type: 'campfire-ashes', theme: 'outdoor' })]);
    expect(field.colliders).toEqual([]);
  });

  it('survives bad numbers: a zero scale or a missing rotation falls back to 1 and 0', () => {
    build([item({ scale: 0, rotationY: undefined })]);
    expect(field.colliders[0].radius).toBeGreaterThan(0);
    expect(Number.isFinite(field.colliders[0].x)).toBe(true);
  });

  it('builds an empty field without error', () => {
    build([]);
    expect(field.meshes).toEqual([]);
    expect(() => field.showRooms(new Set(['a']))).not.toThrow();
  });

  it('dispose() removes the meshes and is idempotent', () => {
    build([item()]);
    expect(parent.children).toHaveLength(1);
    field.dispose();
    expect(parent.children).toHaveLength(0);
    expect(() => field.dispose()).not.toThrow();
  });
});
