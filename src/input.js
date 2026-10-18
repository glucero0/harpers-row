const LOOK_SPEED = 0.0022;
const DEADZONE = 0.15;

function deadzone(value) {
  const magnitude = Math.abs(value);
  if (magnitude < DEADZONE) return 0;
  return Math.sign(value) * ((magnitude - DEADZONE) / (1 - DEADZONE));
}

export function createInput(canvas) {
  const keys = new Set();
  let pointerLocked = false;
  let blockMouse = false;
  let attackQueued = false;
  let mouseYaw = 0;
  let mousePitch = 0;
  let ignoreLook = 0;
  let padWasAttack = false;
  let padWasPause = false;

  function onKeyDown(event) {
    if (event.repeat) return;
    if (event.code === 'KeyK') attackQueued = true;
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyK'].includes(event.code)) {
      event.preventDefault();
    }
    keys.add(event.code);
  }

  function onKeyUp(event) {
    keys.delete(event.code);
  }

  function onMouseDown(event) {
    if (document.pointerLockElement !== canvas) return;
    if (event.button === 0) attackQueued = true;
    if (event.button === 2) blockMouse = true;
  }

  function onMouseUp(event) {
    if (event.button === 2) blockMouse = false;
  }

  function onMouseMove(event) {
    if (document.pointerLockElement !== canvas) return;
    if (ignoreLook > 0) {
      ignoreLook -= 1;
      return;
    }
    mouseYaw -= event.movementX * LOOK_SPEED;
    mousePitch -= event.movementY * LOOK_SPEED;
  }

  function onLockChange() {
    pointerLocked = document.pointerLockElement === canvas;
    if (!pointerLocked) blockMouse = false;
    ignoreLook = 2;
  }

  function onBlur() {
    keys.clear();
    blockMouse = false;
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mouseup', onMouseUp);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('blur', onBlur);
  document.addEventListener('pointerlockchange', onLockChange);
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());

  function poll() {
    let moveX = 0;
    let moveY = 0;
    if (keys.has('KeyW')) moveY -= 1;
    if (keys.has('KeyS')) moveY += 1;
    if (keys.has('KeyA')) moveX -= 1;
    if (keys.has('KeyD')) moveX += 1;

    let stickX = 0;
    let stickY = 0;
    let lookStickX = 0;
    let lookStickY = 0;
    let gamepadConnected = false;
    let padAttack = false;
    let padBlock = false;
    let padPause = false;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const pad of pads) {
      if (!pad) continue;
      gamepadConnected = true;
      moveX += deadzone(pad.axes[0] || 0);
      moveY += deadzone(pad.axes[1] || 0);
      lookStickX = deadzone(pad.axes[2] || 0);
      lookStickY = deadzone(pad.axes[3] || 0);
      const leftTrigger = pad.buttons[6];
      const rightTrigger = pad.buttons[7];
      const start = pad.buttons[9];
      if (leftTrigger && (leftTrigger.pressed || leftTrigger.value > 0.45)) padBlock = true;
      if (rightTrigger && (rightTrigger.pressed || rightTrigger.value > 0.45)) padAttack = true;
      if (start && start.pressed) padPause = true;
      break;
    }

    const magnitude = Math.hypot(moveX, moveY);
    if (magnitude > 1) {
      moveX /= magnitude;
      moveY /= magnitude;
    }

    const attack = attackQueued || (padAttack && !padWasAttack);
    const pausePressed = padPause && !padWasPause;
    attackQueued = false;
    padWasAttack = padAttack;
    padWasPause = padPause;
    const frame = {
      moveX,
      moveY,
      mouseYaw,
      mousePitch,
      lookStickX,
      lookStickY,
      attack,
      block: blockMouse || padBlock,
      pointerLocked,
      gamepadConnected,
      pausePressed,
    };
    mouseYaw = 0;
    mousePitch = 0;
    return frame;
  }

  return {
    poll,
    requestLook() {
      if (document.pointerLockElement !== canvas) canvas.requestPointerLock();
    },
    releaseLook() {
      if (document.pointerLockElement === canvas) document.exitPointerLock();
    },
  };
}
