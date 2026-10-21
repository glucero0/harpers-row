import * as THREE from 'three';

// The dungeon is built at about 3.2 units per metre. Leg sizes below are in metres.
const UNIT = 3.2;

// Mouse-down decreases rotation.x, and that pitches the view down. 65° down is about -1.13 rad.
export const PITCH_UP = 1.256;
export const PITCH_DOWN = (65 * Math.PI) / 180;

const EYE_HEIGHT = 1.65;
const EYE_FORWARD = 0.15;
const STANCE = 0.16;
const BOOT_W = 0.11;
const BOOT_H = 0.10;
const BOOT_L = 0.24;
const BOOT_AHEAD = 0.25;
const HIP_Y = 0.86;
const HIP_Z = 0.02;
const THIGH_LEN = 0.46;
const THIGH_PITCH = 0.62;
const BOOT_TOP = BOOT_H;

const kneeDrop = Math.cos(THIGH_PITCH) * THIGH_LEN;
const kneeAhead = Math.sin(THIGH_PITCH) * THIGH_LEN;
const kneeY = HIP_Y - kneeDrop;
const kneeZ = HIP_Z + kneeAhead;
const shinDrop = BOOT_TOP - kneeY;
const shinAhead = EYE_FORWARD + BOOT_AHEAD - kneeZ;
const SHIN_LEN = Math.hypot(shinDrop, shinAhead);
const SHIN_PITCH = Math.atan2(shinAhead, -shinDrop);

export class PlayerBodyRig {
  constructor(camera, playerRoot) {
    this.camera = camera;
    this.playerRoot = playerRoot;

    this.FIRST_PERSON_LAYER = 1;
    this.SHADOW_ONLY_LAYER = 2;

    this.container = new THREE.Group();
    this.container.name = 'FirstPersonLegs';
    this.container.scale.setScalar(UNIT);
    // Meshes are authored facing +Z. The player walks toward -Z, so turn the rig around.
    this.container.rotation.y = Math.PI;
    this.playerRoot.add(this.container);

    this.initCameraConstraints();
    this.buildMaterials();
    this.buildLowerBody();
    this.setupLayerCulling();

    this.walkCycle = 0;
    this.isMoving = false;
  }

  initCameraConstraints() {
    this.camera.near = 0.05;
    this.camera.updateProjectionMatrix();

    // Eye socket ahead of the spine: (0, 1.65, 0.15) in metres. Forward here is -Z.
    // The camera's own position stays free for shake.
    const socket = this.camera.parent;
    if (socket) socket.position.set(0, EYE_HEIGHT * UNIT, -EYE_FORWARD * UNIT);

    this.camera.layers.enable(this.FIRST_PERSON_LAYER);

    this.minPitch = -PITCH_DOWN;
    this.maxPitch = PITCH_UP;
  }

  buildMaterials() {
    this.trousersMat = new THREE.MeshStandardMaterial({
      color: 0x1a1916,
      roughness: 0.86,
      metalness: 0.04,
    });
    this.trousersMat.userData.shared = true;

    this.bootsMat = new THREE.MeshStandardMaterial({
      color: 0x1c140e,
      roughness: 0.7,
      metalness: 0.08,
    });
    this.bootsMat.userData.shared = true;

    this.ironMat = new THREE.MeshStandardMaterial({
      color: 0x3a4048,
      roughness: 0.42,
      metalness: 0.72,
    });
    this.ironMat.userData.shared = true;
  }

  buildLowerBody() {
    this.leftLeg = this.createLeg(-1);
    this.rightLeg = this.createLeg(1);
    this.container.add(this.leftLeg.hip, this.rightLeg.hip);
  }

  createLeg(worldSide) {
    const hip = new THREE.Group();
    // The rig is yawed 180°, so world +X is local -X.
    hip.position.set(-worldSide * STANCE, HIP_Y, HIP_Z);

    const thigh = new THREE.Mesh(new THREE.BoxGeometry(0.12, THIGH_LEN, 0.14), this.trousersMat);
    thigh.name = 'thigh';
    thigh.rotation.x = THIGH_PITCH;
    thigh.position.set(0, -kneeDrop / 2, kneeAhead / 2);
    thigh.castShadow = true;
    thigh.receiveShadow = true;
    hip.add(thigh);

    const knee = new THREE.Group();
    knee.position.set(0, -kneeDrop, kneeAhead);
    hip.add(knee);

    const shin = new THREE.Mesh(new THREE.BoxGeometry(0.09, SHIN_LEN, 0.11), this.trousersMat);
    shin.name = 'shin';
    shin.rotation.x = SHIN_PITCH;
    shin.position.set(
      0,
      -Math.cos(SHIN_PITCH) * SHIN_LEN / 2,
      Math.sin(SHIN_PITCH) * SHIN_LEN / 2,
    );
    shin.castShadow = true;
    shin.receiveShadow = true;
    knee.add(shin);

    const bootGroup = new THREE.Group();
    bootGroup.name = 'boot';
    bootGroup.position.set(
      0,
      -Math.cos(SHIN_PITCH) * SHIN_LEN,
      Math.sin(SHIN_PITCH) * SHIN_LEN,
    );

    const boot = new THREE.Mesh(new THREE.BoxGeometry(BOOT_W, BOOT_H, BOOT_L), this.bootsMat);
    boot.position.set(0, -BOOT_H / 2, 0);
    boot.castShadow = true;
    boot.receiveShadow = true;
    bootGroup.add(boot);

    const collar = new THREE.Mesh(new THREE.BoxGeometry(BOOT_W + 0.012, 0.016, 0.12), this.ironMat);
    collar.position.set(0, -0.012, -0.02);
    bootGroup.add(collar);

    const sole = new THREE.Mesh(new THREE.BoxGeometry(BOOT_W + 0.01, 0.012, BOOT_L + 0.01), this.ironMat);
    sole.position.set(0, -BOOT_H + 0.006, 0);
    bootGroup.add(sole);

    knee.add(bootGroup);
    return { hip, knee, bootGroup };
  }

  setupLayerCulling() {
    this.container.traverse((node) => {
      if (node.isMesh) node.layers.set(this.FIRST_PERSON_LAYER);
    });

    const headOrTorso = this.playerRoot.getObjectByName('playerUpperBody');
    if (headOrTorso) {
      headOrTorso.traverse((node) => {
        if (node.isMesh) node.layers.set(this.SHADOW_ONLY_LAYER);
      });
    }
  }

  update(delta, velocity) {
    const speed = velocity ? velocity.length() : 0;
    this.isMoving = speed > 0.1;

    if (this.isMoving) {
      this.walkCycle += delta * speed * 4.5;

      const swingAngle = Math.sin(this.walkCycle) * 0.42;
      this.leftLeg.hip.rotation.x = swingAngle;
      this.rightLeg.hip.rotation.x = -swingAngle;

      this.leftLeg.knee.rotation.x = swingAngle < 0 ? -swingAngle * 0.7 : 0;
      this.rightLeg.knee.rotation.x = -swingAngle < 0 ? swingAngle * 0.7 : 0;
    } else {
      this.leftLeg.hip.rotation.x = THREE.MathUtils.damp(this.leftLeg.hip.rotation.x, 0, 8, delta);
      this.rightLeg.hip.rotation.x = THREE.MathUtils.damp(this.rightLeg.hip.rotation.x, 0, 8, delta);
      this.leftLeg.knee.rotation.x = THREE.MathUtils.damp(this.leftLeg.knee.rotation.x, 0, 8, delta);
      this.rightLeg.knee.rotation.x = THREE.MathUtils.damp(this.rightLeg.knee.rotation.x, 0, 8, delta);
    }
  }
}
