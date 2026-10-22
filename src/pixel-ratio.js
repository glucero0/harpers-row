// Uncapped devicePixelRatio on 2.5K/3K laptop panels shades several times more fragments than
// the window's CSS size. Integrated GPUs (ARM and Intel) drop below 60 fps when that happens,
// so the renderer never goes above this cap. Applied from main.js at startup and on every resize.
export const MAX_PIXEL_RATIO = 1.5;

export function cappedPixelRatio(devicePixelRatio) {
  const ratio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return Math.min(ratio, MAX_PIXEL_RATIO);
}
