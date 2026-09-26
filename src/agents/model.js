import * as THREE from 'three'
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'
import { LOOKS, DEFAULT_LOOK } from './looks.js'

// All dimensions are relative to the rig's helmet radius. These accessories remain merged and
// instanced: rounder silhouettes do not add per-agent draw calls.
export const VISOR_OPENING = Math.asin(0.76)
export const SCREEN_RADIUS = 0.69
export const SCREEN_DEPTH = 0.46
export const SCREEN_BULGE = 0.09

const lookOf = (look) => look ?? LOOKS[DEFAULT_LOOK]

/**
 * The head's silhouette. Each point of a sphere is pushed out along its own ray until it lies on a
 * superellipsoid (|x|^n + |y|^n + |z|^n = 1), then the whole is stretched. Every part that touches
 * the opening (shell, cavity wall, seal, glass, screen) goes through the same function, so their
 * seams still close exactly. With boxiness 2 and no stretch it changes nothing.
 */
function shaper(head) {
  const { boxiness: n, scale: [sx, sy, sz] } = head
  const neutral = n === 2 && sx === 1 && sy === 1 && sz === 1
  const shape = (geo) => {
    if (neutral) return geo
    const pos = geo.attributes.position
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i)
      const round = Math.hypot(x, y, z)
      const boxy = (Math.abs(x) ** n + Math.abs(y) ** n + Math.abs(z) ** n) ** (1 / n)
      const k = boxy > 1e-9 ? round / boxy : 1
      pos.setXYZ(i, x * k * sx, y * k * sy, z * k * sz)
    }
    pos.needsUpdate = true
    return geo
  }
  shape.neutral = neutral
  return shape
}

function colored(geo, hex) {
  const c = new THREE.Color(hex), colors = new Float32Array(geo.attributes.position.count * 3)
  for (let i = 0; i < colors.length; i += 3) c.toArray(colors, i)
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return geo
}

function merge(parts, smooth) {
  // Flatten for merging, then weld identical attributes back into shared vertices.
  const flat = parts.map(g => g.index ? g.toNonIndexed() : g)
  const combined = mergeGeometries(flat, false)
  combined.deleteAttribute('uv')
  const merged = mergeVertices(combined, 1e-5)
  combined.dispose()
  for (const g of new Set([...parts, ...flat])) g.dispose()
  // A reshaped head has stale normals. Recomputing after the weld smooths across the seams of a
  // single part, while parts that differ in colour (shell, cavity, seal) stay separate vertices and
  // keep their hard edges.
  if (smooth) merged.computeVertexNormals()
  return merged
}

/** What is bolted to the sides of the head, as merged, vertex-coloured geometry. */
function fittings(R, head, style) {
  const [sx, sy] = head.scale
  const flank = R * sx
  const out = []
  if (style === 'discs') {
    // One flat-faced cylinder per ear. Only the very edge is softly rounded.
    const earRadius = R * 0.21, earHalfDepth = R * 0.055, edgeRadius = R * 0.009
    const earProfile = [new THREE.Vector2(0, -earHalfDepth)]
    for (let i = 0; i <= 4; i++) {
      const angle = i / 4 * Math.PI / 2
      earProfile.push(new THREE.Vector2(earRadius - edgeRadius + edgeRadius * Math.sin(angle),
        -earHalfDepth + edgeRadius * (1 - Math.cos(angle))))
    }
    for (let i = 0; i <= 4; i++) {
      const angle = i / 4 * Math.PI / 2
      earProfile.push(new THREE.Vector2(earRadius - edgeRadius + edgeRadius * Math.cos(angle),
        earHalfDepth - edgeRadius + edgeRadius * Math.sin(angle)))
    }
    earProfile.push(new THREE.Vector2(0, earHalfDepth))
    for (const side of [-1, 1]) {
      const ear = new THREE.LatheGeometry(earProfile, 32)
      ear.rotateZ(-side * Math.PI / 2); ear.translate(side * R, 0, -R * 0.06)
      out.push(colored(ear, 0xf4f5f7))
    }
  } else if (style === 'lamps') {
    // A boxy work lamp on each flank, with a darker lens on its face.
    for (const side of [-1, 1]) {
      const body = new THREE.BoxGeometry(R * 0.2, R * 0.3, R * 0.34)
      body.translate(side * (flank * 0.98 + R * 0.06), R * 0.02, R * 0.08)
      out.push(colored(body, 0xffffff))
      const lens = new THREE.BoxGeometry(R * 0.05, R * 0.2, R * 0.24)
      lens.translate(side * (flank * 0.98 + R * 0.17), R * 0.02, R * 0.08)
      out.push(colored(lens, 0x39465c))
    }
  } else if (style === 'dish') {
    // A shallow radar dish on a short stem, on the left flank and tilted up at the sky.
    const profile = [[0, 0], [0.07, 0.004], [0.17, 0.028], [0.3, 0.09], [0.34, 0.14], [0.315, 0.14], [0.27, 0.095], [0.16, 0.045], [0.07, 0.02], [0, 0.016]]
      .map(([r, y]) => new THREE.Vector2(r * R, y * R))
    const dish = new THREE.LatheGeometry(profile, 28)
    dish.rotateZ(Math.PI / 2 + 0.45)
    dish.translate(-(flank * 0.96 + R * 0.2), R * 0.16, 0)
    out.push(colored(dish, 0xffffff))
    const stem = new THREE.CylinderGeometry(R * 0.035, R * 0.035, R * 0.2, 8)
    stem.rotateZ(Math.PI / 2)
    stem.translate(-(flank * 0.96 + R * 0.06), R * 0.04, 0)
    out.push(colored(stem, 0x69768b))
  }
  // 'none' adds nothing.
  void sy
  return out
}

export function helmetGeometry(R, look) {
  const { head, ears } = lookOf(look)
  const shape = shaper(head)
  const shell = new THREE.SphereGeometry(R, 32, 18, 0, Math.PI * 2, VISOR_OPENING, Math.PI - VISOR_OPENING)
  shell.rotateX(Math.PI / 2)
  const parts = [shape(colored(shell, 0xffffff))]
  const front = Math.cos(VISOR_OPENING) * R, back = SCREEN_DEPTH * R
  const wall = new THREE.CylinderGeometry(R * 0.76, R * SCREEN_RADIUS, front - back, 32, 1, true)
  wall.rotateX(Math.PI / 2); wall.translate(0, 0, (front + back) / 2)
  // The cavity is viewed from inside its wall, not from outside a cylinder.
  const ix = wall.index.array, normals = wall.attributes.normal
  for (let i = 0; i < ix.length; i += 3) [ix[i], ix[i + 1]] = [ix[i + 1], ix[i]]
  for (let i = 0; i < normals.count; i++) normals.setXYZ(i, -normals.getX(i), -normals.getY(i), -normals.getZ(i))
  parts.push(shape(colored(wall, 0x182033)))
  const seal = new THREE.TorusGeometry(R * 0.76, R * 0.012, 4, 40)
  seal.translate(0, 0, front)
  parts.push(shape(colored(seal, 0x69768b)))
  parts.push(...fittings(R, head, ears))
  return merge(parts, !shape.neutral)
}

export function visorGeometry(R, look) {
  const shape = shaper(lookOf(look).head)
  const cap = new THREE.SphereGeometry(R * 1.012, 32, 10, 0, Math.PI * 2, 0, VISOR_OPENING)
  cap.rotateX(Math.PI / 2)
  // A rolled glass edge supplies a little actual thickness and a grazing reflection.
  // Merge into the existing visor draw; no second transparent pane or scene pass.
  const edge = new THREE.TorusGeometry(R * 0.742, R * 0.016, 8, 48)
  edge.translate(0, 0, R * 0.694)
  shape(cap); shape(edge)
  const geometry = mergeGeometries([cap, edge], false)
  cap.dispose(); edge.dispose()
  if (shape.neutral) return geometry
  geometry.deleteAttribute('uv')
  const welded = mergeVertices(geometry, 1e-5)
  geometry.dispose()
  welded.computeVertexNormals()
  return welded
}

export function screenGeometry(R, look) {
  // Concentric rings give the display a shallow convex surface, with UVs projected
  // onto its face. The rim still meets the cavity exactly; only the centre bulges.
  // The UVs come from the unshaped disc, so the face art keeps its layout on a squarer head.
  const shape = shaper(lookOf(look).head)
  const segments = 48, rings = 8, positions = [], uvs = [], indices = []
  for (let ring = 0; ring <= rings; ring++) {
    const radius = ring / rings
    for (let i = 0; i <= segments; i++) {
      const angle = i / segments * Math.PI * 2
      const x = Math.cos(angle) * radius, y = Math.sin(angle) * radius
      positions.push(x * R * SCREEN_RADIUS, y * R * SCREEN_RADIUS,
        R * (SCREEN_DEPTH + SCREEN_BULGE * (1 - radius * radius)))
      uvs.push(x * 0.5 + 0.5, y * 0.5 + 0.5)
      if (ring < rings && i < segments) {
        const a = ring * (segments + 1) + i, b = a + segments + 1
        if (ring > 0) indices.push(a, b, a + 1)
        indices.push(b, b + 1, a + 1)
      }
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  shape(geometry)
  geometry.computeVertexNormals()
  return geometry
}
