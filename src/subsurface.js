import * as THREE from 'three';

const DIRECT_LIGHT = 'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );';

function applySubsurfaceScattering(material, options = {}) {
  const sssColor = options.color || new THREE.Color(0xff4422);
  const thickness = options.thickness !== undefined ? options.thickness : 0.5;
  const power = options.power !== undefined ? options.power : 2.0;
  const scale = options.scale !== undefined ? options.scale : 1.5;
  const distortion = options.distortion !== undefined ? options.distortion : 0.2;

  material.userData.sssUniforms = {
    uSssColor: { value: sssColor },
    uSssThickness: { value: thickness },
    uSssPower: { value: power },
    uSssScale: { value: scale },
    uSssDistortion: { value: distortion },
    flash_amount: { value: options.flashAmount ?? 0 },
  };

  material.customProgramCacheKey = () => 'forward-sss-wrap-flash';

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, material.userData.sssUniforms);

    shader.fragmentShader = `
      uniform vec3 uSssColor;
      uniform float uSssThickness;
      uniform float uSssPower;
      uniform float uSssScale;
      uniform float uSssDistortion;
      uniform float flash_amount;
    ${shader.fragmentShader}`;

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      `#include <dithering_fragment>
      gl_FragColor.rgb = mix( gl_FragColor.rgb, vec3( 1.0 ), flash_amount );`,
    );

    const sssDirectChunk = `
      vec3 sssLightDir = directLight.direction;
      vec3 sssNormal = geometryNormal * -uSssDistortion + sssLightDir;
      float sssDot = pow(clamp(dot(-geometryViewDir, sssNormal), 0.0, 1.0), uSssPower) * uSssScale;
      vec3 sssBleed = sssDot * uSssColor * directLight.color * uSssThickness;
      float wrap = 0.35;
      float NdotL = clamp((dot(geometryNormal, directLight.direction) + wrap) / (1.0 + wrap), 0.0, 1.0);
      vec3 diffuseWrap = NdotL * directLight.color * uSssColor * 0.4;
      RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
      reflectedLight.directDiffuse += sssBleed;
      reflectedLight.directDiffuse += diffuseWrap;
    `;

    if (!shader.fragmentShader.includes(DIRECT_LIGHT)) return;
    shader.fragmentShader = shader.fragmentShader.replace(DIRECT_LIGHT, sssDirectChunk);
  };

  material.needsUpdate = true;
  return material;
}

export { applySubsurfaceScattering };
