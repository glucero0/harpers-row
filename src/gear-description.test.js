import assert from 'node:assert/strict';
import { test } from 'vitest';
import swordFile from '../content/gear/sword.json';
import torchFile from '../content/gear/torch.json';
import {
  GearDescriptionError,
  gearCatalog,
  leftGear,
  maceDescription,
  parseGearDescription,
  rightGear,
  torchDescription,
} from './gear-description.js';

test('the catalog holds a torch and a shield on the left and the other weapons on the right', () => {
  assert.deepEqual(leftGear.map((item) => item.id), ['torch', 'shield']);
  assert.deepEqual(rightGear.map((item) => item.id), ['sword', 'mace', 'dagger', 'hammer', 'spear', 'axe', 'bow']);
  assert.equal(gearCatalog.length, 9);
  assert.equal(torchDescription.hand, 'left');
  assert.equal(torchDescription.parent, 'leftHandSocket');
  assert.equal(maceDescription.hand, 'right');
  assert.equal(maceDescription.combat.damage, 18.0358);
  assert.equal(maceDescription.grip.restRotation.z, 25 * Math.PI / 180);
});

test('the torch tip carries the shared campfire flame', () => {
  const tip = torchDescription.parts.find((part) => part.name === 'TorchTipSocket');
  assert.equal(tip.type, 'group');
  assert.equal(tip.position[1], 0.6144);
  assert.equal(tip.fire.preset, 'campfire_flames');
  assert.equal(tip.fire.light.color, '#e4e7ea');
  assert.equal(tip.fire.light.intensity, 3.2);
  assert.equal(tip.fire.light.distance, 8);
  assert.deepEqual(tip.fire.quads, { fire: 27, smoke: 10, embers: 8 });
  assert.equal(torchDescription.combat, null);
});

test('a sword that claims the left hand is rejected', () => {
  const data = structuredClone(swordFile);
  data.hand = 'left';
  data.parent = 'leftHandSocket';
  assert.throws(() => parseGearDescription(data), GearDescriptionError);
});

test('unknown geometry and a foreign prototype are rejected', () => {
  const geometry = structuredClone(swordFile);
  geometry.parts[0].geometry.type = 'CylinderGeometry';
  assert.throws(() => parseGearDescription(geometry), GearDescriptionError);

  const polluted = structuredClone(torchFile);
  Object.setPrototypeOf(polluted, { admin: true });
  assert.throws(() => parseGearDescription(polluted), GearDescriptionError);
});

test('a shader string on a part is not copied onto the description', () => {
  const data = structuredClone(torchFile);
  data.parts[0].fragmentShader = 'EVIL_SHADER';
  const parsed = parseGearDescription(data);
  assert.equal(parsed.parts[0].fragmentShader, undefined);
  assert.equal(JSON.stringify(parsed).includes('EVIL_SHADER'), false);
});
