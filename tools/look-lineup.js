/**
 * A lineup of the bot looks, side by side, built from the same head geometry the colony uses.
 *
 * Only the head, its fittings and a plain stand-in body are drawn: the colony's real bot is a rigged,
 * animated body with the same head parts attached, and none of that matters for choosing a head.
 * Open /tools/look-lineup.html on the dev server. `?yaw=` turns them (radians).
 */
import * as THREE from 'three'
import { LOOKS } from '../src/agents/looks.js'
import { helmetGeometry, visorGeometry, screenGeometry } from '../src/agents/model.js'

const R = 0.48
const params = new URLSearchParams(location.search)
const yaw = Number(params.get('yaw') ?? -0.55)

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio))
renderer.setSize(innerWidth, innerHeight)
renderer.toneMapping = THREE.ACESFilmicToneMapping
document.body.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x0b0f1a)
scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x1a1d29, 1.5))
const sun = new THREE.DirectionalLight(0xfff2dd, 2.6)
sun.position.set(3, 5, 4)
scene.add(sun)
const ground = new THREE.Mesh(new THREE.CircleGeometry(4.2, 64), new THREE.MeshStandardMaterial({ color: 0x2a2e3b, roughness: 1 }))
ground.rotation.x = -Math.PI / 2
scene.add(ground)

function faceTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 256
  const g = c.getContext('2d')
  g.fillStyle = '#070b16'
  g.fillRect(0, 0, 256, 256)
  g.fillStyle = '#7fe9ff'
  g.shadowColor = '#7fe9ff'
  g.shadowBlur = 24
  for (const x of [88, 168]) {
    g.beginPath()
    g.ellipse(x, 116, 14, 22, 0, 0, Math.PI * 2)
    g.fill()
  }
  g.lineWidth = 8
  g.strokeStyle = '#7fe9ff'
  g.lineCap = 'round'
  g.beginPath()
  g.arc(128, 150, 30, 0.25 * Math.PI, 0.75 * Math.PI)
  g.stroke()
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

const face = faceTexture()
const glass = new THREE.MeshPhysicalMaterial({ color: 0x9fb8d8, transparent: true, opacity: 0.22, roughness: 0.05, metalness: 0, clearcoat: 1 })

function bot(look) {
  const tone = new THREE.Color(look.suit[0])
  const suit = new THREE.MeshStandardMaterial({ color: tone, roughness: 0.45, metalness: 0.05 })
  const g = new THREE.Group()
  const at = (mesh, x, y, z) => (mesh.position.set(x, y, z), g.add(mesh), mesh)

  const headY = 0.86
  const helmet = new THREE.Mesh(helmetGeometry(R, look), new THREE.MeshStandardMaterial({ color: tone, vertexColors: true, roughness: 0.34, metalness: 0.03 }))
  at(helmet, 0, headY, 0)
  at(new THREE.Mesh(visorGeometry(R, look), glass), 0, headY, 0)
  at(new THREE.Mesh(screenGeometry(R, look), new THREE.MeshBasicMaterial({ map: face })), 0, headY, 0)

  if (look.antenna) {
    const h = R * look.antenna.height
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.035, R * 0.046, h, 8), suit)
    const top = headY + R * look.head.scale[1] * 0.875
    at(mast, R * 0.16, top + h / 2, -R * 0.05)
    at(new THREE.Mesh(new THREE.SphereGeometry(R * 0.105, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffb35c })), R * 0.16, top + h, -R * 0.05)
  }
  at(new THREE.Mesh(new THREE.BoxGeometry(R * 0.9, R * 0.98, R * 0.55), suit), 0, 0.42, -0.3)
  at(new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.28, 6, 14), suit), 0, 0.42, 0)
  for (const s of [-1, 1]) {
    at(new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.3, 6, 10), suit), s * 0.12, 0.14, 0)
    const arm = at(new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.26, 6, 10), suit), s * 0.34, 0.44, 0.02)
    arm.rotation.z = s * 0.18
  }
  g.rotation.y = yaw
  return g
}

const looks = Object.values(LOOKS)
const xs = looks.map((_, i) => (i - (looks.length - 1) / 2) * 1.75)
looks.forEach((look, i) => {
  const b = bot(look)
  b.position.x = xs[i]
  scene.add(b)
  const label = document.createElement('div')
  label.className = 'label'
  label.style.left = `${((i + 0.5) / looks.length) * 100}%`
  label.innerHTML = `<b>${look.name}</b><span>${look.blurb}</span>`
  document.body.appendChild(label)
})

const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.1, 50)
function fit() {
  renderer.setSize(innerWidth, innerHeight)
  camera.aspect = innerWidth / innerHeight
  // Stay wide enough for the whole row on a narrow window.
  const width = 1.75 * looks.length + 0.6
  const dist = Math.max(5.2, (width / 2) / Math.tan((camera.fov * camera.aspect * Math.PI) / 360))
  camera.position.set(0, 1.5, dist)
  camera.lookAt(0, 0.62, 0)
  camera.updateProjectionMatrix()
}
addEventListener('resize', fit)
fit()
renderer.setAnimationLoop(() => renderer.render(scene, camera))
