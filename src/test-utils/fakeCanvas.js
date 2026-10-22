// jsdom implements `<canvas>` as a plain element but does not implement 2D pixel rendering unless the
// native `canvas` package is installed, which this project deliberately avoids as a devDependency (it
// compiles native code and is unnecessary: none of our specs need to inspect actual pixels, only that
// `createMaterials()` can run without throwing while it builds procedural textures).
//
// `installFakeCanvas()` stubs `HTMLCanvasElement.prototype.getContext('2d')` with a no-op 2D context
// that implements every drawing call `materials.js` makes (fillRect, strokeStyle, ellipse, gradients,
// createImageData/putImageData, ...). Call the returned function to restore the original.
export function installFakeCanvas() {
  if (typeof globalThis.ImageData === 'undefined') {
    globalThis.ImageData = class ImageData {
      constructor(dataOrWidth, widthOrHeight, maybeHeight) {
        if (dataOrWidth instanceof Uint8ClampedArray) {
          this.data = dataOrWidth;
          this.width = widthOrHeight;
          this.height = maybeHeight;
        } else {
          this.width = dataOrWidth;
          this.height = widthOrHeight;
          this.data = new Uint8ClampedArray(this.width * this.height * 4);
        }
      }
    };
  }

  const makeGradient = () => ({ addColorStop() {} });
  const fakeContext = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    fillRect() {},
    strokeRect() {},
    clearRect() {},
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    bezierCurveTo() {},
    quadraticCurveTo() {},
    ellipse() {},
    arc() {},
    rect() {},
    stroke() {},
    fill() {},
    save() {},
    restore() {},
    translate() {},
    rotate() {},
    scale() {},
    setTransform() {},
    createLinearGradient: () => makeGradient(),
    createRadialGradient: () => makeGradient(),
    createImageData: (width, height) => new ImageData(width, height),
    getImageData: (x, y, width, height) => new ImageData(width, height),
    putImageData() {},
    measureText: () => ({ width: 0 }),
  };

  const proto = globalThis.HTMLCanvasElement.prototype;
  const original = proto.getContext;
  proto.getContext = function getContext(type, ...rest) {
    if (type === '2d') return fakeContext;
    return original ? original.call(this, type, ...rest) : null;
  };

  return function restoreFakeCanvas() {
    proto.getContext = original;
  };
}
