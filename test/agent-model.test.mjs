import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { helmetGeometry, visorGeometry, screenGeometry, SCREEN_DEPTH, SCREEN_BULGE, SCREEN_RADIUS } from '../src/agents/model.js'
import { LOOKS } from '../src/agents/looks.js'

// The plain sphere: what a head is before it is reshaped. It is not one of the shipped looks.
const SPHERE = { head: { boxiness: 2, scale: [1, 1, 1] }, ears: 'discs' }
const radius = 0.48
const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })

const hit = (geometry, from) =>
  new THREE.Raycaster(from, new THREE.Vector3(0, 0, -1)).intersectObject(new THREE.Mesh(geometry, material))[0]?.distance

test('the circular helmet opening exposes a recessed curved screen behind separate glass', () => {
  const geometries = [visorGeometry(radius, SPHERE), screenGeometry(radius, SPHERE), helmetGeometry(radius, SPHERE)]
  const distances = geometries.map((geometry) => hit(geometry, new THREE.Vector3(0, 0, 2)))
  assert.ok(distances.every(Number.isFinite))
  assert.ok(distances[0] + 0.15 < distances[1], 'real air gap between window and screen')
  assert.ok(distances[1] < distances[2], 'shell must not cover the face opening')
  const p = geometries[1].attributes.position
  for (let i = 0; i < p.count; i++) {
    const r = Math.hypot(p.getX(i), p.getY(i))
    const expectedZ = radius * (SCREEN_DEPTH + SCREEN_BULGE * (1 - (r / (radius * SCREEN_RADIUS)) ** 2))
    assert.ok(Math.abs(p.getZ(i) - expectedZ) < 1e-7)
    // Across the opening, the curved tube must remain behind the glass, ahead of the
    // rear shell, and joined to the cavity at its perimeter.
    if (r < radius * SCREEN_RADIUS * 0.98) {
      // Offset from exact shared triangle seams to avoid ray/edge roundoff.
      const glassDistance = hit(geometries[0], new THREE.Vector3(p.getX(i), p.getY(i) + 1e-6, 2))
      assert.ok(glassDistance + 0.075 < 2 - p.getZ(i), 'curved screen stays inside its protective glass')
    }
  }
  for (const geometry of geometries) {
    for (const attribute of Object.values(geometry.attributes)) assert.ok([...attribute.array].every(Number.isFinite))
    geometry.dispose()
  }
})

for (const look of Object.values(LOOKS)) {
  test(`${look.name}: the screen sits behind glass, inside a shell that leaves the opening clear`, () => {
    const geometries = [visorGeometry(radius, look), screenGeometry(radius, look), helmetGeometry(radius, look)]
    const distances = geometries.map((geometry) => hit(geometry, new THREE.Vector3(0, 0, 2)))
    assert.ok(distances.every(Number.isFinite), 'a ray down the middle meets glass, screen and shell')
    assert.ok(distances[0] + 0.1 < distances[1], 'real air gap between window and screen')
    assert.ok(distances[1] < distances[2], 'shell must not cover the face opening')
    // Every point of the screen is looked at through the glass, however square the head is.
    const p = geometries[1].attributes.position
    for (let i = 0; i < p.count; i++) {
      const glassDistance = hit(geometries[0], new THREE.Vector3(p.getX(i), p.getY(i) + 1e-6, 2))
      assert.ok(Number.isFinite(glassDistance), 'the glass covers the whole screen')
      assert.ok(glassDistance + 0.05 < 2 - p.getZ(i), 'the screen stays behind its glass')
    }
    for (const geometry of geometries) {
      for (const attribute of Object.values(geometry.attributes)) assert.ok([...attribute.array].every(Number.isFinite))
      geometry.dispose()
    }
  })

  test(`${look.name}: the head stays close to the size that the camera, picking and badges expect`, () => {
    const geometry = helmetGeometry(radius, look)
    geometry.computeBoundingBox()
    const size = geometry.boundingBox.getSize(new THREE.Vector3())
    assert.ok(size.x > 1.6 * radius && size.x < 3.0 * radius, `width ${(size.x / radius).toFixed(2)}R`)
    assert.ok(size.y > 1.4 * radius && size.y < 2.5 * radius, `height ${(size.y / radius).toFixed(2)}R`)
    assert.ok(size.z > 1.6 * radius && size.z < 2.4 * radius, `depth ${(size.z / radius).toFixed(2)}R`)
    geometry.computeBoundingSphere()
    assert.ok(geometry.boundingSphere.radius < 1.6 * radius, 'nothing juts far out of the head')
    geometry.dispose()
  })

  test(`${look.name}: every vertex has a usable normal`, () => {
    const geometry = helmetGeometry(radius, look)
    const n = geometry.attributes.normal
    for (let i = 0; i < n.count; i++) {
      const len = Math.hypot(n.getX(i), n.getY(i), n.getZ(i))
      assert.ok(Math.abs(len - 1) < 1e-3, `normal ${i} has length ${len}`)
    }
    geometry.dispose()
  })
}
