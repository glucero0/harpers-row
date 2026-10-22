import * as THREE from 'three';

const RUIN_KEY = 'ruin-masonry-1';

const VERTEX_PRELUDE = `#include <common>
varying vec3 vRuinWorld;
varying vec3 vRuinNormal;
uniform float ruinChipAmp;
float ruinHash(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
float ruinNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = ruinHash(i);
  float n100 = ruinHash(i + vec3(1.0, 0.0, 0.0));
  float n010 = ruinHash(i + vec3(0.0, 1.0, 0.0));
  float n110 = ruinHash(i + vec3(1.0, 1.0, 0.0));
  float n001 = ruinHash(i + vec3(0.0, 0.0, 1.0));
  float n101 = ruinHash(i + vec3(1.0, 0.0, 1.0));
  float n011 = ruinHash(i + vec3(0.0, 1.0, 1.0));
  float n111 = ruinHash(i + vec3(1.0, 1.0, 1.0));
  float nx00 = mix(n000, n100, f.x);
  float nx10 = mix(n010, n110, f.x);
  float nx01 = mix(n001, n101, f.x);
  float nx11 = mix(n011, n111, f.x);
  return mix(mix(nx00, nx10, f.y), mix(nx01, nx11, f.y), f.z);
}
`;

const VERTEX_DISPLACE = `#include <begin_vertex>
#ifdef USE_BATCHING
  mat4 ruinModel = modelMatrix * batchingMatrix;
#else
  mat4 ruinModel = modelMatrix;
#endif
vec3 ruinBefore = (ruinModel * vec4(transformed, 1.0)).xyz;
vec3 ruinOff = vec3(ruinNoise(ruinBefore * 0.47) - 0.5) * ruinChipAmp * 0.08;
mat3 ruinRot = mat3(ruinModel);
transformed += vec3(
  dot(vec3(ruinRot[0][0], ruinRot[1][0], ruinRot[2][0]), ruinOff),
  dot(vec3(ruinRot[0][1], ruinRot[1][1], ruinRot[2][1]), ruinOff),
  dot(vec3(ruinRot[0][2], ruinRot[1][2], ruinRot[2][2]), ruinOff)
);
vRuinWorld = (ruinModel * vec4(transformed, 1.0)).xyz;
vRuinNormal = normalize(mat3(ruinModel) * objectNormal);
`;

const FRAGMENT_PRELUDE = `#include <common>
varying vec3 vRuinWorld;
varying vec3 vRuinNormal;
uniform vec3 ruinTorchPos;
uniform float ruinTorchPower;
uniform float ruinFogLift;
uniform sampler2D ruinHeight;
uniform float ruinScale;
float ruinHash3(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
float ruinNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = ruinHash3(i);
  float n100 = ruinHash3(i + vec3(1.0, 0.0, 0.0));
  float n010 = ruinHash3(i + vec3(0.0, 1.0, 0.0));
  float n110 = ruinHash3(i + vec3(1.0, 1.0, 0.0));
  float n001 = ruinHash3(i + vec3(0.0, 0.0, 1.0));
  float n101 = ruinHash3(i + vec3(1.0, 0.0, 1.0));
  float n011 = ruinHash3(i + vec3(0.0, 1.0, 1.0));
  float n111 = ruinHash3(i + vec3(1.0, 1.0, 1.0));
  float nx00 = mix(n000, n100, f.x);
  float nx10 = mix(n010, n110, f.x);
  float nx01 = mix(n001, n101, f.x);
  float nx11 = mix(n011, n111, f.x);
  return mix(mix(nx00, nx10, f.y), mix(nx01, nx11, f.y), f.z);
}
float ruinHeightAt(vec2 uv) {
  return texture2D(ruinHeight, uv).r;
}
float ruinTriHeight(vec3 pos, vec3 normal) {
  vec3 blend = pow(abs(normal), vec3(4.0));
  blend /= max(0.0001, blend.x + blend.y + blend.z);
  float hx = ruinHeightAt(pos.zy);
  float hy = ruinHeightAt(pos.xz);
  float hz = ruinHeightAt(pos.xy);
  return hx * blend.x + hy * blend.y + hz * blend.z;
}
vec3 ruinTriColor(sampler2D tex, vec3 pos, vec3 normal) {
  vec3 blend = pow(abs(normal), vec3(4.0));
  blend /= max(0.0001, blend.x + blend.y + blend.z);
  vec3 cx = texture2D(tex, pos.zy).rgb;
  vec3 cy = texture2D(tex, pos.xz).rgb;
  vec3 cz = texture2D(tex, pos.xy).rgb;
  return cx * blend.x + cy * blend.y + cz * blend.z;
}
`;

const MAP_CHUNK = `
#ifdef USE_MAP
  vec3 ruinSampled = ruinTriColor(map, vRuinWorld * ruinScale, vRuinNormal);
  float ruinShade = ruinNoise(vRuinWorld * 0.16);
  ruinSampled *= 0.9 + ruinShade * 0.16;
  diffuseColor.rgb *= ruinSampled;
#endif
`;

const ROUGH_CHUNK = `
float roughnessFactor = roughness;
roughnessFactor = clamp(roughnessFactor + (ruinNoise(vRuinWorld * 0.2) - 0.5) * 0.1, 0.55, 1.0);
`;

const NORMAL_CHUNK = `#include <normal_fragment_begin>
{
  vec3 ruinPos = vRuinWorld * ruinScale;
  float h0 = ruinTriHeight(ruinPos, vRuinNormal);
  float hx = ruinTriHeight(ruinPos + vec3(0.04, 0.0, 0.0), vRuinNormal);
  float hy = ruinTriHeight(ruinPos + vec3(0.0, 0.04, 0.0), vRuinNormal);
  float hz = ruinTriHeight(ruinPos + vec3(0.0, 0.0, 0.04), vRuinNormal);
  vec3 ruinGrad = vec3(h0 - hx, h0 - hy, h0 - hz);
  normal = normalize(normal + ruinGrad * 1.6);
}
`;

const FOG_CHUNK = `
#ifdef USE_FOG
  float ruinHeightFog = exp(-max(vRuinWorld.y, 0.0) * 0.11);
  float fogFactor;
  #ifdef FOG_EXP2
    fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth * (0.45 + ruinHeightFog * ruinFogLift));
  #else
    fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
  #endif
  vec3 ruinToTorch = vRuinWorld - ruinTorchPos;
  float ruinTorchDist = length(ruinToTorch);
  float ruinAtten = ruinTorchPower / (1.0 + 0.085 * ruinTorchDist * ruinTorchDist);
  gl_FragColor.rgb += vec3(1.0, 0.58, 0.24) * ruinAtten * 0.55;
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, clamp(fogFactor, 0.0, 1.0));
#endif
`;

export function createRuinField(heightMap) {
  const torchPos = new THREE.Vector3();
  const uniforms = {
    ruinTorchPos: { value: torchPos },
    ruinTorchPower: { value: 0 },
    ruinFogLift: { value: 2.6 },
    ruinChipAmp: { value: 1 },
    ruinHeight: { value: heightMap },
    ruinScale: { value: 0.22 },
  };
  return {
    uniforms,
    sync(state) {
      const x = Number(state?.x);
      const y = Number(state?.y);
      const z = Number(state?.z);
      torchPos.set(Number.isFinite(x) ? x : 0, Number.isFinite(y) ? y : 0, Number.isFinite(z) ? z : 0);
      const power = Number(state?.power);
      uniforms.ruinTorchPower.value = Number.isFinite(power) ? Math.max(0, Math.min(3, power)) : 0;
      const lift = Number(state?.fogLift);
      uniforms.ruinFogLift.value = Number.isFinite(lift) ? lift : 1.2;
    },
  };
}

export function applyRuinShader(material, field) {
  material.customProgramCacheKey = () => RUIN_KEY;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.ruinTorchPos = field.uniforms.ruinTorchPos;
    shader.uniforms.ruinTorchPower = field.uniforms.ruinTorchPower;
    shader.uniforms.ruinFogLift = field.uniforms.ruinFogLift;
    shader.uniforms.ruinChipAmp = field.uniforms.ruinChipAmp;
    shader.uniforms.ruinHeight = field.uniforms.ruinHeight;
    shader.uniforms.ruinScale = field.uniforms.ruinScale;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', VERTEX_PRELUDE)
      .replace('#include <begin_vertex>', VERTEX_DISPLACE);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', FRAGMENT_PRELUDE)
      .replace('#include <map_fragment>', MAP_CHUNK)
      .replace('#include <roughnessmap_fragment>', ROUGH_CHUNK)
      .replace('#include <normal_fragment_begin>', NORMAL_CHUNK)
      .replace('#include <fog_fragment>', FOG_CHUNK);
  };
  return material;
}
