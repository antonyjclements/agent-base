import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { Particles } from '../src/agents/particles.js'
import { PLANETS, createTerrain } from '../src/world/planet.js'
import { createGrass } from '../src/world/grass.js'
import { Sky } from '../src/world/sky.js'
import { weatherVisual } from '../src/world/environment.js'

const settings = { particleBudget: 900, shadowSize: 0, get(key) { return ({ particles: 'low', clouds: true, stars: false, ibl: false, iblIntensity: 1 })[key] } }
// @spec:WS-005, WS-008
test('WS5/WS8: rain uses streaks, respects surfaces and capacity; particles off stops spawning', () => {
  const scene = new THREE.Scene(), p = new Particles(scene,settings), camera = new THREE.PerspectiveCamera()
  camera.position.set(0,10,0)
  const e = { enabled: true, condition: 'rain', precipitation: 1, season: 'winter' }
  for (let i=0;i<1000;i++) p.ambient(0.1,camera,PLANETS.moon,0,()=>4,e)
  assert.ok(p.dust.count > 0); assert.ok(p.dust.count <= p.dust.capacity * 0.8 + 1)
  assert.equal(p.dust.streak[0],1); assert.ok(Math.abs(p.dust.floor[0] - 4.04) < 1e-5)
  assert.equal(p.dust.weather[0],1)
  assert.ok(p.dust.material.fragmentShader.includes('vStreak'))
  p.setEnabled(false); const count = p.dust.count; p.ambient(1,camera,PLANETS.moon,0,()=>4,e); assert.equal(p.dust.count,count)
  p.setEnabled(true); assert.doesNotThrow(() => p.weld(0,1,0,new THREE.Color(0xffffff),0)); assert.doesNotThrow(() => p.cheer(0,1,0,new THREE.Color(0xffffff),0))
  assert.equal(p.glow.weather[0],0)
  p.dispose(); assert.equal(scene.children.length,0)
})

// @spec:WS-008
test('precipitation visibility flags survive compaction without enlarging work effects', () => {
  const p = new Particles(new THREE.Scene(), settings), pool = p.dust
  pool.spawn(0, 2, 0, 0, 0, 0, 1, 1, 1, 0.1, 0.01)
  pool.spawn(0, 3, 0, 0, 0, 0, 1, 1, 1, 0.1, 10, 0, 0, 0, false, true)
  pool.update(0.1)
  assert.equal(pool.count, 1)
  assert.equal(pool.geometry.attributes.aWeather.array[0], 1)
  assert.equal(pool.geometry.attributes.aStreak.array[0], 0)
  p.step(0, 0, 0, new THREE.Color('white'))
  assert.equal(pool.weather[1], 0)
  p.dispose()
})

// @spec:WS-008
test('overcast changes the visible horizon and bounce light and off restores the original sky', () => {
  const sky = new Sky(new THREE.Scene(), settings)
  sky.setPlanet(PLANETS.terra); sky.setTime(0.5)
  const horizon = sky.domeUniforms.uHorizon.value.clone(), sun = sky.sun.intensity, hemi = sky.hemi.intensity
  const disc = sky.domeUniforms.uDisc.value
  sky.setEnvironment({ enabled: true, ...weatherVisual('cloudy') })
  const changed = sky.domeUniforms.uHorizon.value
  assert.ok(Math.hypot(changed.r - horizon.r, changed.g - horizon.g, changed.b - horizon.b) > 0.1)
  assert.ok(sky.sun.intensity < sun * 0.8)
  assert.ok(sky.hemi.intensity < hemi)
  assert.ok(sky.domeUniforms.uDisc.value < disc * 0.5)
  const overcast = sky.domeUniforms.uHorizon.value.clone()
  sky.setTime(0.5)
  assert.deepEqual(sky.domeUniforms.uHorizon.value, overcast, 'weather does not compound each frame')
  sky.setEnvironment({ enabled: false })
  assert.deepEqual(sky.domeUniforms.uHorizon.value, horizon)
  assert.equal(sky.sun.intensity, sun); assert.equal(sky.hemi.intensity, hemi)
  assert.equal(sky.domeUniforms.uDisc.value, disc)
  sky.dispose()
})
// @spec:WS-008
test('WS8: vegetation season tint restores its original uniform values', () => {
  const grass = createGrass({ planet: PLANETS.terra, heightAt: () => 1, blocked: () => false, density: 0.01, quality: 'low' })
  const root = grass.uniforms.uRoot.value.clone(), tip = grass.uniforms.uTip.value.clone()
  grass.setSeasonTint(new THREE.Color(0xffffff),0.5); assert.notDeepEqual(grass.uniforms.uRoot.value,root)
  const seasonRoot = grass.uniforms.uRoot.value.clone()
  grass.setSeasonTint(new THREE.Color(0xffffff),0.5,1)
  assert.ok(grass.uniforms.uRoot.value.r > seasonRoot.r)
  grass.setSeasonTint(new THREE.Color(0xffffff),0); assert.deepEqual(grass.uniforms.uRoot.value,root); assert.deepEqual(grass.uniforms.uTip.value,tip)
  grass.dispose()
})

// @spec:WS-005, WS-008
test('snow cover updates terrain uniforms without changing geometry and preserves island clipping', () => {
  for (const planet of [PLANETS.terra, PLANETS.moon, PLANETS.sky, PLANETS.beach]) {
    const terrain = createTerrain(planet, 'low'), geometry = terrain.geometry
    const positions = geometry.attributes.position.array.slice()
    const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader }
    terrain.material.onBeforeCompile(shader)
    assert.equal(shader.uniforms.uSnowCover.value, 0)
    terrain.userData.setSnowCover(0.6)
    assert.equal(shader.uniforms.uSnowCover.value, 0.6)
    terrain.userData.setSnowCover(3); assert.equal(shader.uniforms.uSnowCover.value, 1)
    terrain.userData.setSnowCover(0); assert.equal(shader.uniforms.uSnowCover.value, 0)
    assert.equal(terrain.geometry, geometry)
    assert.deepEqual(geometry.attributes.position.array, positions)
    if (planet.shape === 'sky') assert.ok(shader.fragmentShader.includes('uSkyCells'))
    terrain.geometry.dispose(); terrain.material.dispose()
  }
})
