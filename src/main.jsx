import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { Sky } from 'three/examples/jsm/objects/Sky.js'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import Lenis from 'lenis'
import 'lenis/dist/lenis.css'
import './styles.css'

gsap.registerPlugin(ScrollTrigger)

const BUILD_VERSION = '4.1.0-flight-volumes-city-quality'
const SINGLE_AIRCRAFT_URL = '/assets/facf-787-single.glb'
const SINGLE_AIRCRAFT_REMOTE_URL = import.meta.env.VITE_AIRCRAFT_MODEL_URL || ''

const DESTINATIONS = {
  UK: { label: 'London', tone: 0x8ca8bd, fog: 0xa5b4bf },
  USA: { label: 'New York', tone: 0x536c89, fog: 0x70859b },
  Egypt: { label: 'Giza', tone: 0xc79558, fog: 0xd4b47a },
  Pakistan: { label: 'K2', tone: 0x8fa8be, fog: 0xb6c5d2 },
  Malaysia: { label: 'Kuala Lumpur', tone: 0x5d7f85, fog: 0x779b9a }
}

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v))
const smoothstep = t => t * t * (3 - 2 * t)
const range = (p, a, b) => clamp((p - a) / (b - a))
const mix = (a, b, t) => a + (b - a) * t
const bell = (p,a,b) => Math.sin(clamp((p-a)/(b-a))*Math.PI)
const mixVec = (a, b, t) => a.clone().lerp(b, smoothstep(t))

function roundedBoxGeometry(w, h, d, r = 0.12) {
  const shape = new THREE.Shape()
  const x = -w / 2, y = -h / 2
  shape.moveTo(x + r, y)
  shape.lineTo(x + w - r, y)
  shape.quadraticCurveTo(x + w, y, x + w, y + r)
  shape.lineTo(x + w, y + h - r)
  shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  shape.lineTo(x + r, y + h)
  shape.quadraticCurveTo(x, y + h, x, y + h - r)
  shape.lineTo(x, y + r)
  shape.quadraticCurveTo(x, y, x + r, y)
  const g = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: r * .45, bevelThickness: r * .45 })
  g.center()
  return g
}



function roundedRectShape(w, h, r) {
  const shape = new THREE.Shape()
  const x = -w / 2, y = -h / 2
  shape.moveTo(x + r, y)
  shape.lineTo(x + w - r, y)
  shape.quadraticCurveTo(x + w, y, x + w, y + r)
  shape.lineTo(x + w, y + h - r)
  shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  shape.lineTo(x + r, y + h)
  shape.quadraticCurveTo(x, y + h, x, y + h - r)
  shape.lineTo(x, y + r)
  shape.quadraticCurveTo(x, y, x + r, y)
  return shape
}

function createAircraftWindowGeometry({ outerW=.78, outerH=1.05, innerW=.56, innerH=.80, depth=.12 } = {}) {
  const outer = roundedRectShape(outerW, outerH, Math.min(outerW, outerH) * .22)
  const hole = roundedRectShape(innerW, innerH, Math.min(innerW, innerH) * .24)
  outer.holes.push(hole)
  const frame = new THREE.ExtrudeGeometry(outer, { depth, bevelEnabled:true, bevelSegments:4, bevelSize:.025, bevelThickness:.025, curveSegments:16 })
  frame.center()
  const glassShape = roundedRectShape(innerW*.96, innerH*.96, Math.min(innerW, innerH) * .22)
  const glass = new THREE.ShapeGeometry(glassShape, 24)
  glass.center()
  return { frame, glass }
}

function createPlasticDetailMaps(seed=41, size=1024) {
  const rand = mulberry32(seed)
  const roughCanvas=document.createElement('canvas'); roughCanvas.width=roughCanvas.height=size
  const roughCtx=roughCanvas.getContext('2d'); const rough=roughCtx.createImageData(size,size)
  const normalCanvas=document.createElement('canvas'); normalCanvas.width=normalCanvas.height=size
  const normalCtx=normalCanvas.getContext('2d'); const normal=normalCtx.createImageData(size,size)
  for(let i=0;i<rough.data.length;i+=4){
    const n=(rand()-.5)
    const rv=Math.max(0,Math.min(255,170+Math.round(n*38)))
    rough.data[i]=rough.data[i+1]=rough.data[i+2]=rv;rough.data[i+3]=255
    const nx=Math.max(0,Math.min(255,128+Math.round(n*13)))
    const ny=Math.max(0,Math.min(255,128+Math.round((rand()-.5)*13)))
    normal.data[i]=nx;normal.data[i+1]=ny;normal.data[i+2]=252;normal.data[i+3]=255
  }
  roughCtx.putImageData(rough,0,0);normalCtx.putImageData(normal,0,0)
  const roughTex=new THREE.CanvasTexture(roughCanvas), normalTex=new THREE.CanvasTexture(normalCanvas)
  roughTex.wrapS=roughTex.wrapT=THREE.RepeatWrapping;roughTex.repeat.set(9,9);roughTex.colorSpace=THREE.NoColorSpace;roughTex.anisotropy=8
  normalTex.wrapS=normalTex.wrapT=THREE.RepeatWrapping;normalTex.repeat.set(12,12);normalTex.colorSpace=THREE.NoColorSpace;normalTex.anisotropy=8
  return {roughTex,normalTex}
}

function createRadar() {
  const g = new THREE.Group()
  g.name = 'FACF_Radar'
  const lineMat = new THREE.LineBasicMaterial({ color: 0x73b9d6, transparent: true, opacity: .34 })
  for (let r = 1.4; r <= 6.8; r += 1.35) {
    const pts = []
    for (let i = 0; i <= 128; i++) {
      const a = i / 128 * Math.PI * 2
      pts.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0))
    }
    g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat))
  }
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * Math.PI * 2
    g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,0,0), new THREE.Vector3(Math.cos(a)*7, Math.sin(a)*7, 0)]), lineMat))
  }
  const globe = new THREE.Mesh(new THREE.SphereGeometry(3.15, 28, 20), new THREE.MeshBasicMaterial({ color: 0x8fc8de, wireframe: true, transparent: true, opacity: .12 }))
  globe.rotation.x = .35
  globe.rotation.z = -.22
  g.add(globe)
  const beam = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,0,.05), new THREE.Vector3(6.8,0,.05)]), new THREE.LineBasicMaterial({ color: 0xd2effa, transparent: true, opacity: .75 }))
  beam.name = 'beam'
  g.add(beam)
  const dot = new THREE.Mesh(new THREE.SphereGeometry(.13, 16, 16), new THREE.MeshBasicMaterial({ color: 0xf4c783 }))
  dot.position.set(3.2, 1.8, .1)
  dot.name = 'signal'
  g.add(dot)
  const routePts = []
  for (let i = 0; i <= 64; i++) {
    const t = i / 64
    routePts.push(new THREE.Vector3(mix(3.2, -3.6, t), mix(1.8, -1.2, t) + Math.sin(t * Math.PI) * 1.6, .12))
  }
  const route = new THREE.Line(new THREE.BufferGeometry().setFromPoints(routePts), new THREE.LineBasicMaterial({ color: 0xf3c783, transparent: true, opacity: 0 }))
  route.name = 'route'
  g.add(route)
  return g
}

function createCabinFabricTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 1024
  const ctx = c.getContext('2d')
  const grad = ctx.createLinearGradient(0, 0, 1024, 1024)
  grad.addColorStop(0, '#172331')
  grad.addColorStop(.52, '#223448')
  grad.addColorStop(1, '#14202d')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, 1024, 1024)
  ctx.globalAlpha = .18
  for (let y = 0; y < 1024; y += 3) {
    ctx.fillStyle = y % 8 === 0 ? '#93a6b6' : '#05090e'
    ctx.fillRect(0, y, 1024, 1)
  }
  for (let x = 0; x < 1024; x += 4) {
    ctx.fillStyle = x % 10 === 0 ? '#8193a3' : '#05090e'
    ctx.fillRect(x, 0, 1, 1024)
  }
  ctx.globalAlpha = 1
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(2.2, 2.2)
  tex.anisotropy = 8
  return tex
}

function createCarpetTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 1024
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#11171d'
  ctx.fillRect(0, 0, 1024, 1024)
  const rand = mulberry32(321)
  const img = ctx.getImageData(0, 0, 1024, 1024)
  for (let i = 0; i < img.data.length; i += 4) {
    const n = Math.floor(rand() * 28)
    img.data[i] = 13 + n
    img.data[i + 1] = 18 + n
    img.data[i + 2] = 24 + n
    img.data[i + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(5, 28)
  tex.anisotropy = 8
  return tex
}

function createCabinShellGeometry() {
  const outerR = 3.08
  const innerR = 2.86
  const centerY = -3.48
  const start = THREE.MathUtils.degToRad(20)
  const end = THREE.MathUtils.degToRad(160)
  const shape = new THREE.Shape()
  const outer = []
  const inner = []
  for (let i = 0; i <= 40; i++) {
    const a = mix(start, end, i / 40)
    outer.push(new THREE.Vector2(Math.cos(a) * outerR, centerY + Math.sin(a) * outerR))
  }
  for (let i = 40; i >= 0; i--) {
    const a = mix(start, end, i / 40)
    inner.push(new THREE.Vector2(Math.cos(a) * innerR, centerY + Math.sin(a) * innerR))
  }
  shape.moveTo(outer[0].x, outer[0].y)
  outer.slice(1).forEach(p => shape.lineTo(p.x, p.y))
  inner.forEach(p => shape.lineTo(p.x, p.y))
  shape.closePath()
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 54, bevelEnabled: true, bevelSize: .025, bevelThickness: .025, bevelSegments: 2, steps: 1 })
  geo.translate(0, 0, -27)
  geo.computeVertexNormals()
  return geo
}

function createCabin() {
  const group = new THREE.Group()
  group.name = 'FACF_Cabin'

  const fabricTex = createCabinFabricTexture()
  const carpetTex = createCarpetTexture()
  const {roughTex:plasticRough,normalTex:plasticNormal}=createPlasticDetailMaps(51,1024)
  const shellMat = new THREE.MeshPhysicalMaterial({ color: 0xe4e6e7, roughness: .31, roughnessMap:plasticRough, normalMap:plasticNormal, normalScale:new THREE.Vector2(.055,.055), metalness: .012, clearcoat: .22, clearcoatRoughness: .31, envMapIntensity:1.18 })
  const lowerWallMat = new THREE.MeshPhysicalMaterial({ color: 0xcdd2d5, roughness: .39, roughnessMap:plasticRough, normalMap:plasticNormal, normalScale:new THREE.Vector2(.045,.045), metalness: .02, clearcoat: .11, clearcoatRoughness: .44, envMapIntensity:1.05 })
  const floorMat = new THREE.MeshPhysicalMaterial({ color: 0x11161c, map: carpetTex, roughness: .82, metalness: .015 })
  const seatShellMat = new THREE.MeshPhysicalMaterial({ color: 0x101820, roughness: .34, metalness: .08, clearcoat: .28, clearcoatRoughness: .34 })
  const seatFabricMat = new THREE.MeshPhysicalMaterial({ color: 0x203348, map: fabricTex, roughness: .7, metalness: .01, sheen: .34, sheenColor: new THREE.Color(0x71889c), sheenRoughness: .72 })
  const trimMat = new THREE.MeshPhysicalMaterial({ color: 0xb28a59, roughness: .28, metalness: .46, clearcoat: .18, clearcoatRoughness: .32 })
  const screenMat = new THREE.MeshPhysicalMaterial({ color: 0x041017, emissive: 0x1e7194, emissiveIntensity: 1.65, roughness: .14, metalness: .18, clearcoat: .55, clearcoatRoughness: .12 })
  const lightMat = new THREE.MeshStandardMaterial({ color: 0xfff3dc, emissive: 0xffd09b, emissiveIntensity: 3.1, roughness: .25 })
  const glassMat = new THREE.MeshPhysicalMaterial({ color: 0xa9d4e6, transmission: .98, transparent: true, opacity: .12, roughness: .018, metalness: 0, ior: 1.45, thickness: .025, side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 1.65 })

  const shell = new THREE.Mesh(createCabinShellGeometry(), shellMat)
  group.add(shell)

  const floor = new THREE.Mesh(new THREE.BoxGeometry(5.55, .16, 54), floorMat)
  floor.position.set(0, -5.56, 0)
  group.add(floor)
  const aisleRunner = new THREE.Mesh(new THREE.BoxGeometry(1.15, .018, 53.2), new THREE.MeshPhysicalMaterial({ color: 0x18222d, roughness: .86, metalness: .01 }))
  aisleRunner.position.set(0, -5.465, 0)
  group.add(aisleRunner)

  for (const side of [-1, 1]) {
    const lowerWall = new THREE.Mesh(new THREE.BoxGeometry(.15, 2.17, 54), lowerWallMat)
    lowerWall.position.set(side * 2.92, -4.31, 0)
    group.add(lowerWall)
    const sill = new THREE.Mesh(new THREE.BoxGeometry(.26, .15, 54), trimMat)
    sill.position.set(side * 2.82, -3.15, 0)
    group.add(sill)
  }

  const rows = []
  for (let z = 21.5; z >= -23; z -= 3.25) {
    for (const x of [-1.93, -.78, .78, 1.93]) rows.push([x, z])
  }
  const count = rows.length
  const dummy = new THREE.Object3D()
  const backShell = new THREE.InstancedMesh(roundedBoxGeometry(.94, 1.62, .24, .14), seatShellMat, count)
  const backPad = new THREE.InstancedMesh(roundedBoxGeometry(.79, 1.16, .10, .12), seatFabricMat, count)
  const cushion = new THREE.InstancedMesh(roundedBoxGeometry(.91, .25, .89, .12), seatFabricMat, count)
  const headrest = new THREE.InstancedMesh(roundedBoxGeometry(.69, .32, .15, .105), seatFabricMat, count)
  const screens = new THREE.InstancedMesh(new THREE.PlaneGeometry(.48, .285), screenMat, count)
  const armGeo = roundedBoxGeometry(.085, .12, .71, .035)
  const arms = new THREE.InstancedMesh(armGeo, seatShellMat, count * 2)
  let armIndex = 0
  rows.forEach(([x, z], i) => {
    dummy.position.set(x, -4.32, z); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); backShell.setMatrixAt(i, dummy.matrix)
    dummy.position.set(x, -4.29, z + .135); dummy.updateMatrix(); backPad.setMatrixAt(i, dummy.matrix)
    dummy.position.set(x, -5.11, z - .20); dummy.updateMatrix(); cushion.setMatrixAt(i, dummy.matrix)
    dummy.position.set(x, -3.57, z + .15); dummy.updateMatrix(); headrest.setMatrixAt(i, dummy.matrix)
    dummy.position.set(x, -4.43, z - .136); dummy.rotation.set(0, Math.PI, 0); dummy.updateMatrix(); screens.setMatrixAt(i, dummy.matrix)
    for (const dx of [-.48, .48]) {
      dummy.position.set(x + dx, -4.91, z - .22); dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); arms.setMatrixAt(armIndex++, dummy.matrix)
    }
  })
  group.add(backShell, backPad, cushion, headrest, screens, arms)

  const binGeo = roundedBoxGeometry(1.28, .55, 2.66, .16)
  const binCount = Math.floor(50 / 2.72) * 2
  const bins = new THREE.InstancedMesh(binGeo, shellMat, binCount)
  let bi = 0
  for (let z = 23; z >= -23; z -= 2.72) {
    for (const side of [-1, 1]) {
      dummy.position.set(side * 1.95, -1.45, z)
      dummy.rotation.set(0, 0, side * -.10)
      dummy.updateMatrix(); bins.setMatrixAt(bi++, dummy.matrix)
    }
  }
  group.add(bins)

  const lightStripGeo = new THREE.BoxGeometry(.07, .055, 2.55)
  const stripCount = Math.floor(49 / 2.7) * 2
  const strips = new THREE.InstancedMesh(lightStripGeo, lightMat, stripCount)
  let si = 0
  for (let z = 23; z >= -23; z -= 2.7) {
    for (const side of [-1, 1]) {
      dummy.position.set(side * 1.08, -.73, z); dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); strips.setMatrixAt(si++, dummy.matrix)
    }
  }
  group.add(strips)

  const {frame:windowGeo,glass:glassGeo}=createAircraftWindowGeometry({outerW:.79,outerH:1.08,innerW:.57,innerH:.82,depth:.11})
  const windowPositions = []
  for (let z = 21.5; z >= -23; z -= 2.1) for (const side of [-1, 1]) windowPositions.push([side, z])
  const frames = new THREE.InstancedMesh(windowGeo, shellMat, windowPositions.length)
  const glass = new THREE.InstancedMesh(glassGeo, glassMat, windowPositions.length)
  windowPositions.forEach(([side, z], i) => {
    dummy.position.set(side * 3.005, -2.52, z); dummy.rotation.set(0, side>0?Math.PI/2:-Math.PI/2, 0); dummy.scale.set(1,1,1); dummy.updateMatrix(); frames.setMatrixAt(i, dummy.matrix)
    dummy.position.set(side * 3.018, -2.52, z); dummy.rotation.set(0, side>0?Math.PI/2:-Math.PI/2, 0); dummy.updateMatrix(); glass.setMatrixAt(i, dummy.matrix)
  })
  group.add(frames, glass)

  const frontBulkhead = new THREE.Mesh(new THREE.BoxGeometry(5.52, 4.72, .14), shellMat)
  frontBulkhead.position.set(0, -3.10, 25.35)
  group.add(frontBulkhead)
  const doorway = new THREE.Mesh(roundedBoxGeometry(1.34, 2.92, .12, .22), new THREE.MeshBasicMaterial({ color: 0x080c11 }))
  doorway.position.set(0, -3.12, 25.29)
  group.add(doorway)

  const premiumLogo = new THREE.Mesh(new THREE.PlaneGeometry(.95, .16), new THREE.MeshBasicMaterial({ color: 0xd5b27f, transparent: true, opacity: .48, side: THREE.DoubleSide }))
  premiumLogo.position.set(0, -1.5, 25.16)
  group.add(premiumLogo)

  return group
}

function createWindowPortal() {
  const g = new THREE.Group()
  g.name = 'FACF_WindowPortal'
  const {roughTex,normalTex}=createPlasticDetailMaps(87,1024)
  const frameMat = new THREE.MeshPhysicalMaterial({ color: 0xe4e6e5, roughness: .29, roughnessMap:roughTex, normalMap:normalTex, normalScale:new THREE.Vector2(.05,.05), metalness: .015, clearcoat: .2, clearcoatRoughness: .33, envMapIntensity:1.25 })
  const revealMat = new THREE.MeshPhysicalMaterial({ color: 0x9fa5a8, roughness: .43, roughnessMap:roughTex, metalness: .035, envMapIntensity:.9 })
  const glassMat = new THREE.MeshPhysicalMaterial({ color: 0xa9d6e8, transmission: .99, transparent: true, opacity: .11, roughness: .015, ior: 1.47, thickness: .035, side: THREE.DoubleSide, depthWrite:false, envMapIntensity:1.7 })
  const {frame,glass}=createAircraftWindowGeometry({outerW:1.03,outerH:1.38,innerW:.70,innerH:1.01,depth:.16})
  const outer=new THREE.Mesh(frame,frameMat); outer.rotation.y=Math.PI/2
  const innerShape=roundedRectShape(.78,1.10,.17); const hole=roundedRectShape(.70,1.01,.16);innerShape.holes.push(hole)
  const revealGeo=new THREE.ExtrudeGeometry(innerShape,{depth:.20,bevelEnabled:true,bevelSegments:3,bevelSize:.02,bevelThickness:.02});revealGeo.center()
  const reveal=new THREE.Mesh(revealGeo,revealMat);reveal.rotation.y=Math.PI/2;reveal.position.x=-.10
  const pane=new THREE.Mesh(glass,glassMat);pane.rotation.y=Math.PI/2;pane.position.x=.095
  const ledge=new THREE.Mesh(roundedBoxGeometry(.32,.16,1.45,.055),revealMat);ledge.position.set(.02,-.79,0)
  g.add(reveal,outer,pane,ledge)
  g.position.set(3.03, -2.52, 1.0)
  return g
}

function mulberry32(seed) {
  return function() {
    let t = seed += 0x6D2B79F5
    t = Math.imul(t ^ t >>> 15, t | 1)
    t ^= t + Math.imul(t ^ t >>> 7, t | 61)
    return ((t ^ t >>> 14) >>> 0) / 4294967296
  }
}

function createCloudLayer({count, spreadX, spreadY, nearZ, farZ, size, opacity, seed, color = 0xffffff}) {
  const rand = mulberry32(seed)
  const pos = new Float32Array(count * 3)
  const sizes = new Float32Array(count)
  const seeds = new Float32Array(count)
  const softness = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (rand() - .5) * spreadX
    pos[i * 3 + 1] = (rand() - .5) * spreadY
    pos[i * 3 + 2] = mix(nearZ, farZ, rand())
    sizes[i] = size * (.72 + rand() * .72)
    seeds[i] = rand() * 100
    softness[i] = .72 + rand() * .25
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1))
  geo.setAttribute('aSoftness', new THREE.BufferAttribute(softness, 1))
  const baseColor = new THREE.Color(color)
  const shadow = baseColor.clone().multiplyScalar(.54).lerp(new THREE.Color(0x7d8996), .28)
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.NormalBlending,
    uniforms: {
      uTime: { value: 0 },
      uOpacity: { value: opacity },
      uColor: { value: baseColor },
      uShadow: { value: shadow },
      uDpr: { value: Math.min(2, window.devicePixelRatio || 1) }
    },
    vertexShader: `
      attribute float aSize;
      attribute float aSeed;
      attribute float aSoftness;
      varying float vSeed;
      varying float vSoftness;
      uniform float uDpr;
      void main() {
        vSeed = aSeed;
        vSoftness = aSoftness;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        float depthScale = 235.0 / max(18.0, -mvPosition.z);
        gl_PointSize = clamp(aSize * depthScale * uDpr, 18.0, 290.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform float uOpacity;
      uniform vec3 uColor;
      uniform vec3 uShadow;
      varying float vSeed;
      varying float vSoftness;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
      }
      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
                   mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
      }
      float fbm(vec2 p) {
        float value = 0.0;
        float amp = .54;
        for (int i = 0; i < 5; i++) {
          value += amp * noise(p);
          p = p * 2.03 + 11.17;
          amp *= .49;
        }
        return value;
      }
      void main() {
        vec2 uv = gl_PointCoord * 2.0 - 1.0;
        uv.x *= 1.08;
        float r = length(uv);
        float radial = 1.0 - smoothstep(.46, 1.02, r);
        vec2 drift = vec2(vSeed * .071 + uTime * .0045, vSeed * .113 - uTime * .0032);
        float broad = fbm(uv * 1.92 + drift);
        float detail = fbm(uv * 4.8 - drift * .72);
        float density = broad * .69 + detail * .31 + radial * .42;
        density = smoothstep(.49, .86, density) * radial;
        density *= mix(.84, 1.12, vSoftness);
        float rim = smoothstep(.94, .18, r);
        float light = clamp(.47 + uv.y * .18 - uv.x * .10 + detail * .19, .0, 1.0);
        vec3 col = mix(uShadow, uColor, light);
        col += vec3(.08, .065, .045) * pow(rim, 3.0);
        float alpha = density * uOpacity;
        if (alpha < .006) discard;
        gl_FragColor = vec4(col, alpha);
      }
    `
  })
  const points = new THREE.Points(geo, material)
  points.frustumCulled = false
  points.userData.baseOpacity = opacity
  points.userData.drift = .12 + (seed % 7) * .018
  points.userData.setOpacity = v => { material.uniforms.uOpacity.value = v }
  points.userData.setColor = (c, t = 1) => {
    material.uniforms.uColor.value.lerp(c, t)
    const sh = c.clone().multiplyScalar(.54).lerp(new THREE.Color(0x7d8996), .28)
    material.uniforms.uShadow.value.lerp(sh, t)
  }
  points.userData.setTime = v => { material.uniforms.uTime.value = v }
  points.userData.setDpr = v => { material.uniforms.uDpr.value = Math.min(2, v) }
  return points
}

function createVolumetricCloudField({
  cloudCount = 28,
  blobsPerCloud = 7,
  spreadX = 320,
  spreadY = 130,
  nearZ = -70,
  farZ = -620,
  scale = 24,
  opacity = .12,
  seed = 77,
  detail = 1,
  color = 0xf4f7f8
}) {
  const rand = mulberry32(seed)
  const total = cloudCount * blobsPerCloud
  const geometry = new THREE.IcosahedronGeometry(1, detail)
  const material = new THREE.MeshPhysicalMaterial({
    color,
    roughness: 1,
    metalness: 0,
    transparent: true,
    opacity,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    envMapIntensity: .28,
    vertexColors: true
  })
  const mesh = new THREE.InstancedMesh(geometry, material, total)
  mesh.name = `FACF_CloudVolume_${seed}`
  mesh.frustumCulled = false
  const dummy = new THREE.Object3D()
  const tint = new THREE.Color()
  let index = 0
  for (let c = 0; c < cloudCount; c++) {
    const cx = (rand() - .5) * spreadX
    const cy = (rand() - .46) * spreadY
    const cz = mix(nearZ, farZ, rand())
    const cloudScale = scale * (.62 + rand() * .9)
    const flatten = .34 + rand() * .22
    for (let b = 0; b < blobsPerCloud; b++) {
      const angle = rand() * Math.PI * 2
      const radius = cloudScale * Math.pow(rand(), .62) * .92
      const localScale = cloudScale * (.34 + rand() * .52)
      dummy.position.set(
        cx + Math.cos(angle) * radius,
        cy + (rand() - .5) * cloudScale * .44,
        cz + Math.sin(angle) * radius * 1.18
      )
      dummy.scale.set(
        localScale * (1.05 + rand() * .85),
        localScale * flatten * (.72 + rand() * .55),
        localScale * (.78 + rand() * .95)
      )
      dummy.rotation.set(rand() * .22, rand() * Math.PI, rand() * .18)
      dummy.updateMatrix()
      mesh.setMatrixAt(index, dummy.matrix)
      const shade = .78 + rand() * .24
      tint.setRGB(shade, shade * (.99 + rand() * .018), Math.min(1, shade * 1.025))
      mesh.setColorAt(index, tint)
      index++
    }
  }
  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  mesh.userData.baseOpacity = opacity
  mesh.userData.phase = rand() * Math.PI * 2
  mesh.userData.speed = 2.2 + rand() * 2.8
  mesh.userData.setOpacity = value => { material.opacity = value }
  mesh.userData.setColor = (value, t = 1) => { material.color.lerp(value, t) }
  mesh.userData.dispose = () => { geometry.dispose(); material.dispose() }
  return mesh
}

function createAirflowStreaks(count = 90, seed = 211) {
  const rand = mulberry32(seed)
  const positions = new Float32Array(count * 6)
  for (let i = 0; i < count; i++) {
    const x = (rand() - .5) * 85
    const y = (rand() - .5) * 42
    const z = -25 - rand() * 260
    const len = 4 + rand() * 18
    positions[i * 6] = x
    positions[i * 6 + 1] = y
    positions[i * 6 + 2] = z
    positions[i * 6 + 3] = x * .985
    positions[i * 6 + 4] = y * .985
    positions[i * 6 + 5] = z + len
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const material = new THREE.LineBasicMaterial({ color: 0xddeef6, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })
  const lines = new THREE.LineSegments(geometry, material)
  lines.frustumCulled = false
  lines.userData.setOpacity = value => { material.opacity = value }
  return lines
}

function createInstrumentTexture(index=0) {
  const c=document.createElement('canvas'); c.width=512; c.height=320
  const ctx=c.getContext('2d')
  const grad=ctx.createLinearGradient(0,0,0,320); grad.addColorStop(0,'#07131b'); grad.addColorStop(1,'#02080d'); ctx.fillStyle=grad; ctx.fillRect(0,0,512,320)
  ctx.strokeStyle='rgba(100,210,245,.75)'; ctx.lineWidth=3; ctx.strokeRect(10,10,492,300)
  ctx.font='700 18px Arial'; ctx.fillStyle='#8edaf5'; ctx.fillText(index%2?'NAV':'PFD',24,38)
  ctx.strokeStyle='#5ac3e8'; ctx.lineWidth=2
  if(index%2===0){
    ctx.beginPath(); ctx.arc(256,175,88,0,Math.PI*2); ctx.stroke();
    ctx.strokeStyle='#7fe17e'; ctx.beginPath(); ctx.moveTo(150,175);ctx.lineTo(362,175);ctx.stroke()
    ctx.fillStyle='#e8b66a';ctx.fillRect(246,98,20,24)
    ctx.fillStyle='#d9eef6';ctx.font='16px Arial';ctx.fillText('34000',400,55);ctx.fillText('M .82',400,80)
  } else {
    ctx.strokeStyle='#43b9dd'; ctx.beginPath(); ctx.moveTo(80,250);ctx.quadraticCurveTo(210,80,430,150);ctx.stroke()
    for(let i=0;i<8;i++){ctx.fillStyle=i%2?'#e8b66a':'#6fd1ee';ctx.beginPath();ctx.arc(80+i*48,240-i*15,4,0,Math.PI*2);ctx.fill()}
  }
  const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;tex.anisotropy=4;return tex
}

function createCockpitScreenGlow() {
  const g=new THREE.Group(); g.name='FACF_CockpitScreens'
  const xs=[-1.02,-.36,.36,1.02]
  xs.forEach((x,i)=>{
    const mat=new THREE.MeshBasicMaterial({map:createInstrumentTexture(i),toneMapped:false})
    const screen=new THREE.Mesh(new THREE.PlaneGeometry(.56,.36),mat)
    screen.position.set(x,.88,-1.82)
    screen.rotation.x=-.06
    g.add(screen)
  })
  return g
}


function createCockpitFallback() {
  const g=new THREE.Group();g.name='FACF_CockpitFallback'
  const shell=new THREE.MeshPhysicalMaterial({color:0x555b61,roughness:.52,metalness:.05})
  const dark=new THREE.MeshPhysicalMaterial({color:0x171c21,roughness:.44,metalness:.14})
  const glass=new THREE.MeshPhysicalMaterial({color:0x82acc0,roughness:.06,transmission:.68,transparent:true,opacity:.34,depthWrite:false})
  const floor=new THREE.Mesh(new THREE.BoxGeometry(3.0,.08,2.8),dark);floor.position.set(0,.05,-1.45);g.add(floor)
  const dash=new THREE.Mesh(roundedBoxGeometry(2.8,.62,.48,.09),dark);dash.position.set(0,.82,-2.0);g.add(dash)
  const pedestal=new THREE.Mesh(roundedBoxGeometry(.62,.72,1.25,.08),dark);pedestal.position.set(0,.4,-1.1);g.add(pedestal)
  for(const x of [-.62,.62]){
    const seat=new THREE.Group();const back=new THREE.Mesh(roundedBoxGeometry(.54,.88,.18,.08),dark);back.position.y=.55;const base=new THREE.Mesh(roundedBoxGeometry(.58,.16,.56,.07),dark);base.position.set(0,.12,-.04);seat.add(back,base);seat.position.set(x,.05,-.55);g.add(seat)
  }
  const left=new THREE.Mesh(new THREE.PlaneGeometry(1.2,.82),glass);left.position.set(-.7,1.35,-2.72);left.rotation.x=-.16;g.add(left)
  const right=left.clone();right.position.x=.7;g.add(right)
  const frameH=new THREE.Mesh(new THREE.BoxGeometry(2.95,.08,.08),shell);frameH.position.set(0,1.78,-2.67);g.add(frameH)
  const frameV=new THREE.Mesh(new THREE.BoxGeometry(.09,1.0,.08),shell);frameV.position.set(0,1.34,-2.68);g.add(frameV)
  const overhead=new THREE.Mesh(roundedBoxGeometry(2.2,.15,.85,.06),dark);overhead.position.set(0,1.88,-1.55);g.add(overhead)
  g.add(createCockpitScreenGlow())
  return g
}

function createExteriorDetails() {
  const g = new THREE.Group()
  g.name = 'FACF_ExteriorDetails'
  const redMat = new THREE.MeshBasicMaterial({ color: 0xff3157, toneMapped: false })
  const greenMat = new THREE.MeshBasicMaterial({ color: 0x55ff9b, toneMapped: false })
  const whiteMat = new THREE.MeshBasicMaterial({ color: 0xeaf8ff, toneMapped: false })
  const red = new THREE.Mesh(new THREE.SphereGeometry(.12, 18, 18), redMat); red.position.set(-29.7, -3.0, -2.8); g.add(red)
  const green = new THREE.Mesh(new THREE.SphereGeometry(.12, 18, 18), greenMat); green.position.set(29.7, -3.0, -2.8); g.add(green)
  const tail = new THREE.Mesh(new THREE.SphereGeometry(.10, 16, 16), whiteMat); tail.position.set(0, -1.2, -28.2); g.add(tail)
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(.095, 14, 14), redMat); beacon.position.set(0, .05, 2.2); beacon.name = 'FACF_Beacon'; g.add(beacon)
  return g
}

function createLandingGear() {
  const root=new THREE.Group();root.name='FACF_LandingGear';root.visible=false
  const metal=new THREE.MeshPhysicalMaterial({color:0xa5adb2,roughness:.27,metalness:.86,envMapIntensity:1.4})
  const darkMetal=new THREE.MeshPhysicalMaterial({color:0x394047,roughness:.38,metalness:.65})
  const rubber=new THREE.MeshPhysicalMaterial({color:0x090b0d,roughness:.82,metalness:.02})
  const doorMat=new THREE.MeshPhysicalMaterial({color:0xd7dbdd,roughness:.28,metalness:.14,clearcoat:.3,clearcoatRoughness:.25})
  const wheelGeo=new THREE.CylinderGeometry(.38,.38,.28,24,1,false);wheelGeo.rotateZ(Math.PI/2)
  const smallWheelGeo=new THREE.CylinderGeometry(.28,.28,.22,20,1,false);smallWheelGeo.rotateZ(Math.PI/2)
  const strutGeo=new THREE.CylinderGeometry(.105,.125,2.75,16)
  const bogieGeo=new THREE.BoxGeometry(.22,.18,1.55)
  const groups=[];const wheels=[];const doors=[]
  for(const side of [-1,1]){
    const g=new THREE.Group();g.position.set(side*3.05,-3.5,8.6)
    const strut=new THREE.Mesh(strutGeo,metal);strut.position.y=-1.36;g.add(strut)
    const brace=new THREE.Mesh(new THREE.CylinderGeometry(.065,.075,1.7,12),darkMetal);brace.position.set(-side*.32,-1.32,-.45);brace.rotation.z=side*.28;g.add(brace)
    const bogie=new THREE.Mesh(bogieGeo,darkMetal);bogie.position.y=-2.78;g.add(bogie)
    for(const z of [-.58,.58]) for(const x of [-.24,.24]){const w=new THREE.Mesh(wheelGeo,rubber);w.position.set(x,-2.88,z);g.add(w);wheels.push(w)}
    const door=new THREE.Mesh(new THREE.BoxGeometry(.08,1.15,1.9),doorMat);door.position.set(-side*.62,-.35,0);g.add(door);doors.push({mesh:door,side})
    g.userData.side=side;groups.push(g);root.add(g)
  }
  const nose=new THREE.Group();nose.position.set(0,-3.6,25.9)
  const noseStrut=new THREE.Mesh(new THREE.CylinderGeometry(.075,.09,2.15,14),metal);noseStrut.position.y=-1.05;nose.add(noseStrut)
  for(const x of [-.18,.18]){const w=new THREE.Mesh(smallWheelGeo,rubber);w.position.set(x,-2.15,0);nose.add(w);wheels.push(w)}
  const noseDoorL=new THREE.Mesh(new THREE.BoxGeometry(.06,1.1,.62),doorMat);noseDoorL.position.set(-.38,-.25,0);nose.add(noseDoorL);doors.push({mesh:noseDoorL,side:-1})
  const noseDoorR=noseDoorL.clone();noseDoorR.position.x=.38;nose.add(noseDoorR);doors.push({mesh:noseDoorR,side:1})
  root.add(nose)
  root.userData.main=groups;root.userData.nose=nose;root.userData.wheels=wheels;root.userData.doors=doors
  return root
}

function updateLandingGear(gear,p,dt) {
  const deploy=smoothstep(range(p,.875,.938))
  const doorOpen=smoothstep(range(deploy,0,.34))*(1-smoothstep(range(deploy,.72,1)))
  gear.visible=p>.855 && p<.997
  gear.userData.main.forEach(g=>{
    g.rotation.x=mix(1.18,0,deploy)
    g.position.y=mix(-3.15,-3.5,deploy)
  })
  gear.userData.nose.rotation.x=mix(-1.02,0,deploy)
  gear.userData.nose.position.y=mix(-3.2,-3.6,deploy)
  gear.userData.doors.forEach(({mesh,side})=>{mesh.rotation.z=side*doorOpen*.95})
  const spin=smoothstep(range(p,.958,.985))*dt*28
  gear.userData.wheels.forEach(w=>{w.rotation.x+=spin})
}

function createTouchdownSmoke() {
  const count = 56, rand = mulberry32(121), pos = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) { pos[i * 3] = (rand() - .5) * 5; pos[i * 3 + 1] = rand() * 2; pos[i * 3 + 2] = (rand() - .5) * 7 }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  const c = document.createElement('canvas'); c.width = c.height = 128
  const ctx = c.getContext('2d'); const g = ctx.createRadialGradient(64, 64, 3, 64, 64, 62)
  g.addColorStop(0, 'rgba(255,255,255,.8)'); g.addColorStop(.38, 'rgba(230,235,238,.42)'); g.addColorStop(1, 'rgba(210,216,220,0)')
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128)
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace
  const mat = new THREE.PointsMaterial({ color: 0xcfd5d8, size: 1.9, map: tex, transparent: true, opacity: 0, depthWrite: false, alphaTest: .008 })
  const smoke = new THREE.Points(geo, mat); smoke.position.set(0, -5.55, -56); smoke.frustumCulled = false; return smoke
}

function createAsphaltTexture() {
  const size = 1024
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#101419'
  ctx.fillRect(0, 0, size, size)
  const rand = mulberry32(802)
  const img = ctx.getImageData(0, 0, 1024, 1024)
  for (let i = 0; i < img.data.length; i += 4) {
    const n = Math.round((rand() - .5) * 26)
    img.data[i] = Math.max(6, 17 + n)
    img.data[i + 1] = Math.max(8, 21 + n)
    img.data[i + 2] = Math.max(10, 25 + n)
    img.data[i + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  ctx.globalAlpha = .25
  for (let i = 0; i < 80; i++) {
    ctx.strokeStyle = rand() > .5 ? '#273039' : '#080b0e'
    ctx.lineWidth = .5 + rand() * 1.8
    ctx.beginPath()
    const x = rand() * size, y = rand() * size
    ctx.moveTo(x, y)
    ctx.lineTo(x + (rand() - .5) * 260, y + (rand() - .5) * 40)
    ctx.stroke()
  }
  ctx.globalAlpha = 1
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(2.5, 26)
  tex.anisotropy = 8
  return tex
}

function createRunway() {
  const g = new THREE.Group()
  const asphalt = createAsphaltTexture()
  const tarmacMat = new THREE.MeshPhysicalMaterial({ color: 0x15191e, map: asphalt, roughness: .48, metalness: .08, clearcoat: .11, clearcoatRoughness: .62, envMapIntensity: .86 })
  const tarmac = new THREE.Mesh(new THREE.BoxGeometry(48, .2, 620), tarmacMat)
  tarmac.position.set(0, -6.2, -220)
  g.add(tarmac)

  const shoulderMat = new THREE.MeshPhysicalMaterial({ color: 0x090c10, roughness: .72, metalness: .03 })
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Mesh(new THREE.BoxGeometry(10, .16, 620), shoulderMat)
    shoulder.position.set(side * 29, -6.24, -220)
    g.add(shoulder)
  }

  const dashGeo = new THREE.BoxGeometry(.52, .025, 6)
  const dashMat = new THREE.MeshPhysicalMaterial({ color: 0xf1f2ed, roughness: .48, metalness: .02, emissive: 0x252522, emissiveIntensity: .07 })
  const dashes = new THREE.InstancedMesh(dashGeo, dashMat, 25)
  const dummy = new THREE.Object3D()
  for (let i = 0, z = 45; i < 25; i++, z -= 15) {
    dummy.position.set(0, -6.07, z); dummy.updateMatrix(); dashes.setMatrixAt(i, dummy.matrix)
  }
  g.add(dashes)

  const edgeLineGeo = new THREE.BoxGeometry(.16, .022, 610)
  const edgeLineMat = new THREE.MeshBasicMaterial({ color: 0xe5e8e8 })
  for (const side of [-1, 1]) {
    const line = new THREE.Mesh(edgeLineGeo, edgeLineMat)
    line.position.set(side * 21.5, -6.075, -220)
    g.add(line)
  }

  const lampCount = 110
  const lampGeo = new THREE.BufferGeometry()
  const pos = new Float32Array(lampCount * 3)
  const col = new Float32Array(lampCount * 3)
  let k = 0
  for (const side of [-1, 1]) for (let z = 58; z > -350 && k < lampCount; z -= 7.5, k++) {
    pos[k * 3] = side * 23.5; pos[k * 3 + 1] = -5.72; pos[k * 3 + 2] = z
    const cc = new THREE.Color(side < 0 ? 0x77bdff : 0xf3fbff)
    col[k * 3] = cc.r; col[k * 3 + 1] = cc.g; col[k * 3 + 2] = cc.b
  }
  lampGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  lampGeo.setAttribute('color', new THREE.BufferAttribute(col, 3))
  const lamps = new THREE.Points(lampGeo, new THREE.PointsMaterial({ size: .25, vertexColors: true, transparent: true, opacity: .96, depthWrite: false, blending: THREE.AdditiveBlending }))
  g.add(lamps)
  g.userData.surfaceY = -6.10
  return g
}

function createFacadeTexture(seed = 1, warm = false) {
  const c = document.createElement('canvas')
  const scale = window.innerWidth < 700 ? .5 : 1
  c.width = Math.round(512 * scale)
  c.height = Math.round(1024 * scale)
  const ctx = c.getContext('2d')
  const rand = mulberry32(seed)
  const W = c.width, H = c.height
  const bg = ctx.createLinearGradient(0, 0, W, H)
  bg.addColorStop(0, warm ? '#786b5c' : '#5d6a72')
  bg.addColorStop(.52, warm ? '#9a8a75' : '#7d8b93')
  bg.addColorStop(1, warm ? '#61574d' : '#4b565d')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)
  for (let x = 0; x < W; x += 42 * scale) {
    ctx.fillStyle = 'rgba(15,22,28,.27)'
    ctx.fillRect(x, 0, 5 * scale, H)
  }
  for (let y = 28 * scale; y < H; y += 46 * scale) {
    for (let x = 14 * scale; x < W; x += 42 * scale) {
      const lit = rand() > .73
      ctx.fillStyle = lit ? (warm ? 'rgba(255,218,157,.78)' : 'rgba(188,224,239,.62)') : 'rgba(8,18,24,.68)'
      ctx.fillRect(x, y, 22 * scale, 27 * scale)
      ctx.fillStyle = 'rgba(255,255,255,.08)'
      ctx.fillRect(x + 2 * scale, y + 2 * scale, 18 * scale, 2 * scale)
    }
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(1.2, 2.2)
  tex.anisotropy = 8
  return tex
}

function createTerrainTexture(key, seed = 1) {
  const c = document.createElement('canvas')
  const size = window.innerWidth < 700 ? 512 : 1024
  c.width = c.height = size
  const ctx = c.getContext('2d')
  const rand = mulberry32(seed)
  const palettes = {
    Pakistan: ['#4b565d', '#6e7a80', '#8d999e'],
    Egypt: ['#9f7447', '#c39158', '#d5ad75'],
    UK: ['#435547', '#667466', '#7f897c'],
    Malaysia: ['#294b42', '#42695d', '#6f8572'],
    USA: ['#303a40', '#48565d', '#657078']
  }
  const pal = palettes[key] || palettes.USA
  ctx.fillStyle = pal[0]
  ctx.fillRect(0, 0, 1024, 1024)
  for (let i = 0; i < 7000; i++) {
    const a = .025 + rand() * .09
    ctx.fillStyle = rand() > .55 ? `${pal[1]}${Math.floor(a * 255).toString(16).padStart(2,'0')}` : `${pal[2]}${Math.floor(a * 180).toString(16).padStart(2,'0')}`
    const x = rand() * size, y = rand() * size
    const w = 1 + rand() * 7, h = 1 + rand() * 3
    ctx.fillRect(x, y, w, h)
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(3.2, 3.2)
  tex.anisotropy = 8
  return tex
}

function createTerrainWorld(key) {
  const group = new THREE.Group()
  group.name = `world-${key}`
  const groundY = 0
  const facadeCool = createFacadeTexture(91 + key.length * 13, false)
  const facadeWarm = createFacadeTexture(31 + key.length * 19, true)
  const groundTex = createTerrainTexture(key, 71 + key.length * 7)
  const waterMat = new THREE.MeshPhysicalMaterial({ color: 0x31586f, roughness: .17, metalness: .16, clearcoat: .62, clearcoatRoughness: .12, envMapIntensity: 1.25 })
  const buildingMat = new THREE.MeshPhysicalMaterial({ color: 0xaeb8bd, map: facadeCool, roughness: .38, metalness: .24, clearcoat: .12, clearcoatRoughness: .32, envMapIntensity: 1.12, emissive: 0x11171b, emissiveMap: facadeCool, emissiveIntensity: .11 })
  const warmBuildingMat = new THREE.MeshPhysicalMaterial({ color: 0xc0ae94, map: facadeWarm, roughness: .48, metalness: .09, clearcoat: .08, emissive: 0x21180e, emissiveMap: facadeWarm, emissiveIntensity: .07 })

  const addCityInfrastructure = (width, depth, seed = 1, warm = false) => {
    const rand = mulberry32(seed)
    const roadMat = new THREE.MeshPhysicalMaterial({ color: 0x171c20, roughness: .92, metalness: .02, envMapIntensity: .35 })
    const laneMat = new THREE.MeshBasicMaterial({ color: warm ? 0xd9b46f : 0xbad8e8, transparent: true, opacity: .25, depthWrite: false })
    const roadGroup = new THREE.Group()
    const xRoads = 8
    const zRoads = 12
    for (let i = 0; i < xRoads; i++) {
      const x = mix(-width * .48, width * .48, i / (xRoads - 1)) + (rand() - .5) * 5
      const road = new THREE.Mesh(new THREE.BoxGeometry(3.8 + rand() * 2.6, .13, depth), roadMat)
      road.position.set(x, groundY + .03, -62 - depth / 2)
      roadGroup.add(road)
      const lane = new THREE.Mesh(new THREE.BoxGeometry(.11, .02, depth), laneMat)
      lane.position.set(x, groundY + .105, -62 - depth / 2)
      roadGroup.add(lane)
    }
    for (let i = 0; i < zRoads; i++) {
      const z = -62 - mix(0, depth, i / (zRoads - 1)) + (rand() - .5) * 4
      const road = new THREE.Mesh(new THREE.BoxGeometry(width, .13, 3.8 + rand() * 2.4), roadMat)
      road.position.set(0, groundY + .03, z)
      roadGroup.add(road)
      const lane = new THREE.Mesh(new THREE.BoxGeometry(width, .02, .11), laneMat)
      lane.position.set(0, groundY + .105, z)
      roadGroup.add(lane)
    }
    group.add(roadGroup)

    const lightCount = Math.round((width + depth) * .7)
    const positions = new Float32Array(lightCount * 3)
    const colors = new Float32Array(lightCount * 3)
    const c = new THREE.Color()
    for (let i = 0; i < lightCount; i++) {
      const alongX = rand() > .5
      if (alongX) {
        positions[i*3] = (rand() - .5) * width
        positions[i*3+2] = -62 - Math.round(rand() * (zRoads - 1)) * depth / (zRoads - 1)
      } else {
        positions[i*3] = mix(-width * .48, width * .48, Math.round(rand() * (xRoads - 1)) / (xRoads - 1))
        positions[i*3+2] = -62 - rand() * depth
      }
      positions[i*3+1] = groundY + .48 + rand() * .22
      c.setHex(rand() > .42 ? (warm ? 0xffc778 : 0xd6efff) : 0xffe0a1)
      colors[i*3] = c.r; colors[i*3+1] = c.g; colors[i*3+2] = c.b
    }
    const lightsGeo = new THREE.BufferGeometry()
    lightsGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    lightsGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    const lights = new THREE.Points(lightsGeo, new THREE.PointsMaterial({ size: .34, vertexColors: true, transparent: true, opacity: .78, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }))
    group.add(lights)
  }

  const addCity = (count, width, depth, maxH, seed = 1, material = buildingMat) => {
    const rand = mulberry32(seed)
    const lowMat = material.clone(); lowMat.vertexColors = true
    const tallMat = material.clone(); tallMat.vertexColors = true; tallMat.roughness = Math.max(.22, (tallMat.roughness || .4) - .08)
    const roundMat = material.clone(); roundMat.vertexColors = true; roundMat.metalness = Math.max(roundMat.metalness || 0, .18); roundMat.clearcoat = Math.max(roundMat.clearcoat || 0, .18)
    const low = new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1,2,4,2), lowMat, count)
    const tall = new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1,2,6,2), tallMat, count)
    const round = new THREE.InstancedMesh(new THREE.CylinderGeometry(.5,.5,1,12,2), roundMat, Math.ceil(count * .22))
    const dummy = new THREE.Object3D()
    const tint = new THREE.Color()
    let li = 0, ti = 0, ri = 0
    const cols = Math.max(8, Math.round(Math.sqrt(count * width / Math.max(depth,1))))
    const rows = Math.max(10, Math.round(count / cols))
    for (let i = 0; i < count; i++) {
      const col = i % cols
      const row = Math.floor(i / cols) % rows
      const nx = cols <= 1 ? .5 : col / (cols - 1)
      const nz = rows <= 1 ? .5 : row / (rows - 1)
      const x = mix(-width * .46, width * .46, nx) + (rand() - .5) * Math.max(2, width / cols * .28)
      const z = -68 - mix(0, depth * .94, nz) + (rand() - .5) * Math.max(2, depth / rows * .24)
      const centrality = 1 - clamp(Math.abs(x) / (width * .5))
      const downtown = .52 + centrality * .9 + (1 - nz) * .22
      const isRound = rand() > .86 && ri < round.count
      const isTall = !isRound && rand() < clamp(.22 + centrality * .34, .2, .62)
      const h = (isTall || isRound ? 18 : 6) + rand() * maxH * (isTall || isRound ? downtown : .36 + downtown * .22)
      const sx = (isTall || isRound ? 3.2 : 4.8) + rand() * (isTall || isRound ? 5.8 : 10.5)
      const sz = (isTall || isRound ? 3.2 : 4.6) + rand() * (isTall || isRound ? 5.8 : 10.5)
      dummy.position.set(x, groundY + h / 2, z)
      dummy.scale.set(sx, h, sz)
      dummy.rotation.set(0, (rand() - .5) * .035, 0)
      dummy.updateMatrix()
      const brightness = .78 + rand() * .24
      const coolShift = rand() * .06
      tint.setRGB(brightness * (1 - coolShift*.35), brightness * (1 - coolShift*.12), Math.min(1, brightness * (1 + coolShift)))
      if (isRound) { round.setMatrixAt(ri, dummy.matrix); round.setColorAt(ri, tint); ri++ }
      else if (isTall) { tall.setMatrixAt(ti, dummy.matrix); tall.setColorAt(ti, tint); ti++ }
      else { low.setMatrixAt(li, dummy.matrix); low.setColorAt(li, tint); li++ }
    }
    low.count = li; tall.count = ti; round.count = ri
    low.instanceMatrix.needsUpdate = true; tall.instanceMatrix.needsUpdate = true; round.instanceMatrix.needsUpdate = true
    if (low.instanceColor) low.instanceColor.needsUpdate = true
    if (tall.instanceColor) tall.instanceColor.needsUpdate = true
    if (round.instanceColor) round.instanceColor.needsUpdate = true
    group.add(low, tall, round)
  }

  if (key === 'Pakistan') {
    const geo = new THREE.PlaneGeometry(700, 700, 110, 110)
    geo.rotateX(-Math.PI / 2)
    const p = geo.attributes.position
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i)
      const k2 = 150 * Math.exp(-((x - 18) ** 2) / 3600 - ((z + 210) ** 2) / 5200)
      const ridge1 = 56 * Math.exp(-((x + 95) ** 2) / 12800 - ((z + 235) ** 2) / 15000)
      const ridge2 = 44 * Math.exp(-((x - 120) ** 2) / 16000 - ((z + 265) ** 2) / 18000)
      const strata = 8 * Math.sin(x * .063) * Math.cos(z * .052) + 5 * Math.sin((x + z) * .082)
      p.setY(i, Math.max(0, k2 + ridge1 + ridge2 + strata))
    }
    geo.computeVertexNormals()
    const terrain = new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({ color: 0x78858b, map: groundTex, roughness: .91, metalness: 0, envMapIntensity: .72 }))
    terrain.position.y = groundY - 20
    group.add(terrain)
    const summit = new THREE.Mesh(new THREE.ConeGeometry(56, 104, 16, 3), new THREE.MeshPhysicalMaterial({ color: 0xe8eff2, roughness: .78, clearcoat: .04 }))
    summit.position.set(18, 96, -210)
    summit.rotation.y = .24
    group.add(summit)
  } else if (key === 'Egypt') {
    const geo = new THREE.PlaneGeometry(700, 700, 92, 92)
    geo.rotateX(-Math.PI / 2)
    const p = geo.attributes.position
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i)
      p.setY(i, 2.8 * Math.sin(x * .031) + 2.2 * Math.sin(z * .041) + 1.6 * Math.sin((x + z) * .018))
    }
    geo.computeVertexNormals()
    const desert = new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({ color: 0xc99c63, map: groundTex, roughness: .94, envMapIntensity: .66 }))
    desert.position.y = groundY - 5
    group.add(desert)
    const sand = new THREE.MeshPhysicalMaterial({ color: 0xd7ae78, roughness: .87, clearcoat: .025 })
    ;[[0,-145,48],[-78,-205,35],[68,-220,31]].forEach(([x,z,size], idx) => {
      const py = new THREE.Mesh(new THREE.ConeGeometry(size, size * .82, 4, 1), sand)
      py.rotation.y = Math.PI / 4 + idx * .025
      py.position.set(x, groundY + size * .41, z)
      group.add(py)
    })
  } else if (key === 'USA') {
    const water = new THREE.Mesh(new THREE.PlaneGeometry(720,720), waterMat)
    water.rotation.x = -Math.PI / 2
    water.position.y = groundY - .8
    group.add(water)
    const island = new THREE.Mesh(new THREE.BoxGeometry(195, 2.6, 430, 8,1,12), new THREE.MeshPhysicalMaterial({ color: 0x39454b, map: groundTex, roughness: .82 }))
    island.position.set(0, groundY, -210)
    group.add(island)
    addCityInfrastructure(168, 350, 190, false)
    addCity(285, 168, 350, 105, 19)
    const towerMat = new THREE.MeshPhysicalMaterial({ color: 0xbac9cf, roughness: .2, metalness: .54, clearcoat: .38, clearcoatRoughness: .15, envMapIntensity: 1.55 })
    const tower = new THREE.Mesh(new THREE.BoxGeometry(12.5, 153, 12.5, 4,8,4), towerMat)
    tower.position.set(12, 76.5, -220)
    group.add(tower)
    const spire = new THREE.Mesh(new THREE.CylinderGeometry(.55, 1.6, 52, 20), towerMat)
    spire.position.set(12, 179, -220)
    group.add(spire)
  } else if (key === 'UK') {
    const land = new THREE.Mesh(new THREE.PlaneGeometry(680,680), new THREE.MeshPhysicalMaterial({ color: 0x66736a, map: groundTex, roughness: .89 }))
    land.rotation.x = -Math.PI / 2
    group.add(land)
    const river = new THREE.Mesh(new THREE.PlaneGeometry(42, 570, 4, 20), waterMat)
    river.rotation.x = -Math.PI / 2
    river.rotation.z = .12
    river.position.y = .07
    river.position.z = -180
    group.add(river)
    addCityInfrastructure(300, 390, 91, true)
    addCity(235, 300, 390, 52, 9, warmBuildingMat)
    const tower = new THREE.Group()
    const stone = new THREE.MeshPhysicalMaterial({ color: 0xb5a17e, map: facadeWarm, roughness: .57, metalness: .04, clearcoat: .05 })
    const body = new THREE.Mesh(new THREE.BoxGeometry(9.5, 53, 9.5, 3,8,3), stone); body.position.y = 26.5
    const clock = new THREE.Mesh(new THREE.BoxGeometry(11.5, 12, 11.5, 3,2,3), new THREE.MeshPhysicalMaterial({ color: 0xc9bb9a, roughness: .48, clearcoat: .08 })); clock.position.y = 59
    const roof = new THREE.Mesh(new THREE.ConeGeometry(6.2, 21, 4, 2), new THREE.MeshPhysicalMaterial({ color: 0x4d4941, roughness: .68, metalness: .08 })); roof.rotation.y = Math.PI / 4; roof.position.y = 75.5
    tower.add(body, clock, roof); tower.position.set(18, groundY, -135); group.add(tower)
    const parliament = new THREE.Mesh(new THREE.BoxGeometry(62, 13, 18, 8,3,4), stone); parliament.position.set(-14, 6.5, -128); group.add(parliament)
  } else if (key === 'Malaysia') {
    const land = new THREE.Mesh(new THREE.PlaneGeometry(680,680), new THREE.MeshPhysicalMaterial({ color: 0x40665a, map: groundTex, roughness: .88 }))
    land.rotation.x = -Math.PI / 2
    group.add(land)
    addCityInfrastructure(285, 370, 271, true)
    addCity(250, 285, 370, 70, 27)
    const metal = new THREE.MeshPhysicalMaterial({ color: 0xb8ccd3, roughness: .16, metalness: .72, clearcoat: .36, clearcoatRoughness: .16, envMapIntensity: 1.7 })
    for (const x of [-9, 9]) {
      const tower = new THREE.Group()
      for (let i = 0; i < 8; i++) {
        const seg = new THREE.Mesh(new THREE.CylinderGeometry(3.9 - i * .19, 5.25 - i * .17, 11.5, 28), metal)
        seg.position.y = 5.75 + i * 10.7
        tower.add(seg)
      }
      const spire = new THREE.Mesh(new THREE.CylinderGeometry(.38, 1.3, 31, 16), metal)
      spire.position.y = 102
      tower.add(spire)
      tower.position.set(x, groundY, -150)
      group.add(tower)
    }
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(17.5, 2.7, 3.2, 4,2,2), metal); bridge.position.set(0, 53, -150); group.add(bridge)
  }

  const windowYMap = { USA: -176, Pakistan: -145, Malaysia: -104, UK: -72, Egypt: -38 }
  group.userData.windowPosition = new THREE.Vector3(20, windowYMap[key] ?? -60, 1)
  group.userData.externalPosition = new THREE.Vector3(0, -92, -360)
  group.userData.windowRotation = -Math.PI / 2
  group.userData.externalRotation = 0
  group.userData.windowScale = key === 'USA' ? .74 : key === 'Pakistan' ? .78 : .82
  return group
}

function createDestinationWorld(key) {
  return createTerrainWorld(key)
}

function createMicroNormalMap(seed = 17) {
  const c = document.createElement('canvas')
  c.width = c.height = 512
  const ctx = c.getContext('2d')
  const rand = mulberry32(seed)
  const img = ctx.createImageData(512, 512)
  for (let i = 0; i < img.data.length; i += 4) {
    const nx = 128 + Math.round((rand() - .5) * 20)
    const ny = 128 + Math.round((rand() - .5) * 20)
    img.data[i] = nx
    img.data[i + 1] = ny
    img.data[i + 2] = 247 + Math.round(rand() * 8)
    img.data[i + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(14, 14)
  tex.colorSpace = THREE.NoColorSpace
  tex.anisotropy = 8
  return tex
}

function createMicroRoughnessMap(seed = 23) {
  const c = document.createElement('canvas')
  c.width = c.height = 512
  const ctx = c.getContext('2d')
  const rand = mulberry32(seed)
  const img = ctx.createImageData(512, 512)
  for (let i = 0; i < img.data.length; i += 4) {
    const n = 150 + Math.round((rand() - .5) * 34)
    img.data[i] = img.data[i + 1] = img.data[i + 2] = n
    img.data[i + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(12, 12)
  tex.colorSpace = THREE.NoColorSpace
  tex.anisotropy = 8
  return tex
}

function tuneExteriorModel(model, maxAniso = 4) {
  const microNormal = createMicroNormalMap()
  const microRoughness = createMicroRoughnessMap()
  const materials = []
  const seen = new Set()

  const improve = (mat, objectName = '') => {
    if (!mat) return mat
    const name = `${mat.name || ''} ${objectName || ''}`.toLowerCase()
    const isGlass = /glass|window|windscreen|cockpit/.test(name)
    const isRubber = /rubber|tire|tyre|wheel/.test(name)
    const isMetal = /fan|blade|engine|gear|strut|metal|chrome|nacelle/.test(name)
    const isLight = /light|beacon|nav/.test(name)

    if (mat.map) {
      const img = mat.map.image
      const lowRes = !!img && Math.max(img.width || 0, img.height || 0) > 0 && Math.max(img.width || 0, img.height || 0) <= 512
      // Small baked atlases are the main source of the blurry, game-like look in close hero shots.
      // Keep them only where they carry functional detail. Clean fuselage paint is sharper than a 256 px livery.
      if (lowRes && !isGlass && !isRubber && !isMetal && !isLight) {
        mat.map = null
        mat.color?.setHex?.(0xe9edf0)
      } else {
        mat.map.colorSpace = THREE.SRGBColorSpace
        mat.map.anisotropy = maxAniso
        mat.map.minFilter = THREE.LinearMipmapLinearFilter
        mat.map.magFilter = THREE.LinearFilter
        mat.map.generateMipmaps = true
      }
    }
    if (mat.emissiveMap) {
      mat.emissiveMap.colorSpace = THREE.SRGBColorSpace
      mat.emissiveMap.anisotropy = maxAniso
    }
    if (mat.normalMap) mat.normalMap.anisotropy = maxAniso
    if (mat.roughnessMap) mat.roughnessMap.anisotropy = maxAniso

    if (isGlass) {
      mat.transparent = true
      mat.opacity = Math.min(mat.opacity ?? 1, .76)
      mat.roughness = .045
      mat.metalness = .04
      if ('transmission' in mat) mat.transmission = .34
      mat.depthWrite = true
      mat.envMapIntensity = 1.75
    } else if (isRubber) {
      mat.color?.multiplyScalar(.36)
      mat.roughness = .78
      mat.metalness = .015
      mat.envMapIntensity = .5
    } else if (isMetal) {
      mat.roughness = Math.min(mat.roughness ?? .5, .28)
      mat.metalness = Math.max(mat.metalness ?? 0, .62)
      mat.envMapIntensity = 1.58
      if (!mat.normalMap) { mat.normalMap = microNormal; mat.normalScale = new THREE.Vector2(.055, .055) }
    } else {
      mat.roughness = Math.min(Math.max(mat.roughness ?? .42, .22), .46)
      mat.metalness = Math.min(Math.max(mat.metalness ?? .06, .06), .24)
      mat.envMapIntensity = 1.42
      if (!mat.normalMap) { mat.normalMap = microNormal; mat.normalScale = new THREE.Vector2(.035, .035) }
      if (!mat.roughnessMap) mat.roughnessMap = microRoughness
    }
    if ('clearcoat' in mat && !isGlass && !isRubber) {
      mat.clearcoat = isMetal ? .22 : .42
      mat.clearcoatRoughness = isMetal ? .22 : .20
    }
    if (isLight && mat.emissive) {
      mat.emissiveIntensity = Math.max(mat.emissiveIntensity || 0, 2.2)
    }
    mat.needsUpdate = true
    if (!seen.has(mat.uuid)) { seen.add(mat.uuid); materials.push(mat) }
    return mat
  }

  model.traverse(o => {
    if (!o.isMesh) return
    o.castShadow = false
    o.receiveShadow = false
    if (Array.isArray(o.material)) o.material.forEach(m => improve(m, o.name))
    else improve(o.material, o.name)
  })
  return { materials, microNormal, microRoughness }
}

function tuneCockpitModel(model, maxAniso = 4) {
  const exactTints = {
    'Side_Display':0x0d1217,'ModeControl_Panel1':0x383b3d,'Console_Glay':0x6b6b6e,'material_0':0x8c8c8f,
    'Overhed_Panel':0x99999c,'SidePanel':0x8c8c8f,'pedestal_main':0x9e9ea1,'pedestal_01':0x9e9ea1,
    'DreamLiner_LOGO1':0x8c8c8f,'Interior_White':0x616164,'Pedestal_White':0xc7c7c7
  }
  const screenMeshes=['group_18.026','group_18.022','group_18.023','group_18.027']
  const screenIndex=new Map(screenMeshes.map((n,i)=>[n,i]))
  const mats=[]
  const micro=createMicroNormalMap(83)
  model.traverse(o=>{
    if(!o.isMesh)return
    const objectName=(o.name||'')
    let mat=o.material
    if(!mat)return
    const materialName=mat.name||''
    const key=materialName.toLowerCase()
    if(materialName==='HMD'||/hmd/i.test(objectName)){o.visible=false;return}
    if(/glass|window|_787_glass/i.test(`${materialName} ${objectName}`)){o.visible=false;return}
    if(screenIndex.has(objectName)){
      mat=mat.clone()
      const tex=createInstrumentTexture(screenIndex.get(objectName));tex.anisotropy=maxAniso
      mat.map=tex;mat.emissiveMap=tex;mat.color.setHex(0xffffff);mat.emissive.setHex(0xffffff);mat.emissiveIntensity=1.08;mat.roughness=.08;mat.metalness=.05;mat.toneMapped=false;mat.needsUpdate=true
      o.material=mat;mats.push(mat);return
    }
    if(materialName==='Main_Display'){
      mat=mat.clone();mat.map=null;mat.color.setHex(0x0a0e12);mat.emissive.setHex(0x06131b);mat.emissiveIntensity=.36;mat.roughness=.12;mat.metalness=.08;o.material=mat
    }
    if(exactTints[materialName]!==undefined)mat.color?.setHex(exactTints[materialName])
    else if(/black|pedestal|console|panel/i.test(key))mat.color?.setHex(0x171b1f)
    else if(/white|shell|interior/i.test(key))mat.color?.setHex(0x666b70)
    mat.side=THREE.DoubleSide
    mat.envMapIntensity=1.08
    if(mat.map){mat.map.anisotropy=maxAniso;mat.map.colorSpace=THREE.SRGBColorSpace;mat.map.minFilter=THREE.LinearMipmapLinearFilter}
    if(mat.roughness!==undefined)mat.roughness=Math.max(.26,Math.min(.58,mat.roughness||.42))
    if(!mat.normalMap&&!/seat/i.test(key)){mat.normalMap=micro;mat.normalScale=new THREE.Vector2(.032,.032)}
    if('clearcoat'in mat){mat.clearcoat=Math.max(mat.clearcoat||0,.09);mat.clearcoatRoughness=.34}
    mat.needsUpdate=true;mats.push(mat)
  })
  return [...new Set(mats)]
}

function tuneUnifiedAircraft(model, maxAniso = 8) {
  const materials = []
  const seen = new Set()
  const microNormal = createMicroNormalMap(141)
  const microRoughness = createMicroRoughnessMap(149)
  microNormal.anisotropy = maxAniso
  microRoughness.anisotropy = maxAniso

  model.traverse(o => {
    if (!o.isMesh || !o.material) return
    o.castShadow = false
    o.receiveShadow = false
    const list = Array.isArray(o.material) ? o.material : [o.material]
    list.forEach(mat => {
      if (!mat) return
      const key = `${mat.name || ''} ${o.name || ''}`.toLowerCase()
      const isGlass = /glass|window|windscreen|windshield/.test(key)
      const isScreen = /screen|display|instrument|panel light/.test(key)
      const isRubber = /tire|tyre|rubber/.test(key)
      const isMetal = /engine|fan|blade|nacelle|gear|strut|chrome|metal/.test(key)
      const isPaint = /fuselage|body|paint|wing|tail|stabilizer|stabiliser|door|fairing/.test(key)

      ;['map','normalMap','roughnessMap','metalnessMap','emissiveMap','aoMap'].forEach(prop => {
        const tex = mat[prop]
        if (!tex) return
        tex.anisotropy = maxAniso
        tex.minFilter = THREE.LinearMipmapLinearFilter
        tex.magFilter = THREE.LinearFilter
        tex.generateMipmaps = true
        if (prop === 'map' || prop === 'emissiveMap') tex.colorSpace = THREE.SRGBColorSpace
      })

      if (isGlass) {
        mat.transparent = true
        mat.opacity = Math.min(mat.opacity ?? 1, .72)
        mat.roughness = Math.min(mat.roughness ?? .12, .035)
        mat.metalness = Math.min(mat.metalness ?? 0, .04)
        if ('transmission' in mat) mat.transmission = Math.max(mat.transmission ?? 0, .72)
        if ('ior' in mat) mat.ior = 1.47
        if ('thickness' in mat) mat.thickness = Math.max(mat.thickness || 0, .035)
        mat.depthWrite = false
        mat.side = THREE.FrontSide
        mat.envMapIntensity = Math.max(mat.envMapIntensity || 1, 1.75)
      } else if (isScreen) {
        if (mat.emissive) mat.emissiveIntensity = Math.max(mat.emissiveIntensity || 0, 1.25)
        mat.roughness = Math.min(mat.roughness ?? .3, .18)
      } else if (isRubber) {
        mat.roughness = Math.max(mat.roughness ?? .6, .78)
        mat.metalness = 0
        mat.envMapIntensity = .5
      } else if (isMetal) {
        mat.roughness = Math.min(Math.max(mat.roughness ?? .28, .16), .34)
        mat.metalness = Math.max(mat.metalness ?? 0, .56)
        mat.envMapIntensity = Math.max(mat.envMapIntensity || 1, 1.62)
        if (!mat.normalMap) {
          mat.normalMap = microNormal
          mat.normalScale = new THREE.Vector2(.048, .048)
        }
      } else {
        mat.roughness = Math.max(.16, Math.min(.58, mat.roughness ?? .36))
        mat.metalness = Math.min(Math.max(mat.metalness ?? .04, .025), .2)
        mat.envMapIntensity = Math.max(mat.envMapIntensity || 1, isPaint ? 1.64 : 1.18)
        if (isPaint && !mat.normalMap) {
          mat.normalMap = microNormal
          mat.normalScale = new THREE.Vector2(.028, .028)
        }
        if (isPaint && !mat.roughnessMap) mat.roughnessMap = microRoughness
        if ('clearcoat' in mat && isPaint) {
          mat.clearcoat = Math.max(mat.clearcoat || 0, .62)
          mat.clearcoatRoughness = Math.min(mat.clearcoatRoughness ?? .3, .16)
        } else if ('clearcoat' in mat) {
          mat.clearcoat = Math.max(mat.clearcoat || 0, .18)
          mat.clearcoatRoughness = Math.min(mat.clearcoatRoughness ?? .38, .3)
        }
      }
      mat.needsUpdate = true
      if (!seen.has(mat.uuid)) { seen.add(mat.uuid); materials.push(mat) }
    })
  })
  materials.userData = { microNormal, microRoughness }
  return materials
}

function App() {
  const canvasRef = useRef(null)
  const worldRef = useRef(null)
  const [destination, setDestination] = useState('Pakistan')
  const destinationRef = useRef('Pakistan')
  const [loading, setLoading] = useState(true)
  const [loadProgress, setLoadProgress] = useState(0)
  const [webglFailed, setWebglFailed] = useState(false)
  const [searchMessage, setSearchMessage] = useState('')

  const chooseDestination = key => {
    destinationRef.current = key
    setDestination(key)
    window.dispatchEvent(new CustomEvent('facf-destination', { detail: key }))
  }

  useEffect(() => {
    destinationRef.current = destination
  }, [destination])

  useEffect(() => {
    if (!canvasRef.current) return
    const canvas = canvasRef.current
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const isMobile = window.innerWidth < 700
    const isTablet = window.innerWidth < 1050
    let renderer
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: !isMobile, alpha: false, powerPreference: 'high-performance', stencil: false })
    } catch (err) {
      setWebglFailed(true)
      setLoading(false)
      return
    }

    const maxDpr = Math.min(window.devicePixelRatio || 1, isMobile ? 1.28 : isTablet ? 1.5 : 1.75)
    const minDpr = isMobile ? .9 : 1
    let currentDpr = maxDpr
    renderer.setPixelRatio(currentDpr)
    renderer.setSize(window.innerWidth, window.innerHeight)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.02
    renderer.shadowMap.enabled = false

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x05080c)
    scene.fog = new THREE.FogExp2(0x9ab2bf, .00125)
    const camera = new THREE.PerspectiveCamera(44, window.innerWidth / window.innerHeight, .035, 2400)
    camera.position.set(0, 0, 9)

    const pmrem = new THREE.PMREMGenerator(renderer)
    pmrem.compileEquirectangularShader()
    const envScene = new THREE.Scene()
    const envSky = new Sky()
    envSky.scale.setScalar(1200)
    const envU = envSky.material.uniforms
    envU.turbidity.value = 6.2
    envU.rayleigh.value = 1.35
    envU.mieCoefficient.value = .0055
    envU.mieDirectionalG.value = .84
    const envSun = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(81), THREE.MathUtils.degToRad(225))
    envU.sunPosition.value.copy(envSun)
    envScene.add(envSky)
    const envTarget = pmrem.fromScene(envScene, .025)
    scene.environment = envTarget.texture
    scene.environmentIntensity = 1.18
    envSky.geometry.dispose()
    envSky.material.dispose()
    pmrem.dispose()

    const sky = new Sky()
    sky.scale.setScalar(1800)
    scene.add(sky)
    const skyU = sky.material.uniforms
    skyU.turbidity.value = 6.5
    skyU.rayleigh.value = 1.45
    skyU.mieCoefficient.value = .006
    skyU.mieDirectionalG.value = .86
    const sunVector = new THREE.Vector3()

    const composer = new EffectComposer(renderer)
    composer.setPixelRatio(Math.min(currentDpr, isMobile ? 1.0 : 1.3))
    composer.addPass(new RenderPass(scene, camera))
    const gtaoPass = new GTAOPass(scene, camera, Math.max(1, Math.floor(window.innerWidth * .72)), Math.max(1, Math.floor(window.innerHeight * .72)))
    gtaoPass.blendIntensity = .42
    gtaoPass.updateGtaoMaterial({ radius:.18, distanceExponent:1.25, thickness:.82, scale:.82, samples:8, distanceFallOff:.92, screenSpaceRadius:true })
    gtaoPass.updatePdMaterial({ lumaPhi:8, depthPhi:2.2, normalPhi:3.2, radius:3, radiusExponent:1, rings:2, samples:8 })
    gtaoPass.enabled = false
    composer.addPass(gtaoPass)
    const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), isMobile ? .13 : .24, .55, .94)
    composer.addPass(bloom)
    const outputPass = new OutputPass()
    composer.addPass(outputPass)

    const hemi = new THREE.HemisphereLight(0xc9d9e3, 0x17202a, 1.02)
    const sun = new THREE.DirectionalLight(0xffd0a0, 3.8)
    sun.position.set(90, 52, 55)
    const coolFill = new THREE.DirectionalLight(0x8eb9d7, .74)
    coolFill.position.set(-72, 18, -64)
    const warmRim = new THREE.DirectionalLight(0xffb873, .92)
    warmRim.position.set(-28, 12, 88)
    const cockpitGlow = new THREE.PointLight(0x63bce6, 2.3, 16)
    const warm = new THREE.PointLight(0xffc77d, 1.8, 30)
    cockpitGlow.position.set(0, -1.7, 29.4)
    warm.position.set(0, -1.2, 8)
    scene.add(hemi, sun, coolFill, warmRim, cockpitGlow, warm)

    const radar = createRadar()
    radar.position.z = -4
    scene.add(radar)

    const cloudsNear = createCloudLayer({count:isMobile?38:68,spreadX:190,spreadY:76,nearZ:-28,farZ:-220,size:isMobile?20:28,opacity:.16,seed:7,color:0xfff3e7})
    const cloudsMid = createCloudLayer({count:isMobile?48:86,spreadX:320,spreadY:130,nearZ:-100,farZ:-520,size:isMobile?32:46,opacity:.14,seed:21,color:0xf2f5f7})
    const cloudsFar = createCloudLayer({count:isMobile?60:112,spreadX:640,spreadY:220,nearZ:-280,farZ:-1200,size:isMobile?56:78,opacity:.11,seed:39,color:0xe8eef2})
    const cloudVolumeNear = createVolumetricCloudField({cloudCount:isMobile?12:22,blobsPerCloud:isMobile?5:8,spreadX:250,spreadY:110,nearZ:-50,farZ:-280,scale:isMobile?15:19,opacity:isMobile?.095:.115,seed:107,detail:isMobile?0:1,color:0xf6f5f1})
    const cloudVolumeMid = createVolumetricCloudField({cloudCount:isMobile?14:28,blobsPerCloud:isMobile?5:8,spreadX:480,spreadY:180,nearZ:-210,farZ:-720,scale:isMobile?25:34,opacity:isMobile?.075:.095,seed:131,detail:isMobile?0:1,color:0xecf2f5})
    const cloudVolumeFar = createVolumetricCloudField({cloudCount:isMobile?16:32,blobsPerCloud:isMobile?4:7,spreadX:820,spreadY:260,nearZ:-560,farZ:-1450,scale:isMobile?42:58,opacity:isMobile?.055:.07,seed:167,detail:0,color:0xe3ebef})
    const airflow = createAirflowStreaks(isMobile ? 42 : 92)
    scene.add(cloudVolumeFar, cloudsFar, cloudVolumeMid, cloudsMid, cloudVolumeNear, cloudsNear, airflow)

    const aircraftRoot = new THREE.Group()
    aircraftRoot.name = 'FACF_AircraftRoot'
    scene.add(aircraftRoot)
    const aircraftVisual = new THREE.Group()
    aircraftVisual.name = 'FACF_SingleAircraftVisual'
    aircraftRoot.add(aircraftVisual)

    const runway = createRunway()
    runway.visible = false
    scene.add(runway)
    const touchdownSmoke=createTouchdownSmoke()
    scene.add(touchdownSmoke)

    const worlds = {}
    Object.keys(DESTINATIONS).forEach(key => {
      worlds[key] = createDestinationWorld(key)
      worlds[key].visible = false
      scene.add(worlds[key])
    })

    const starGeo = new THREE.BufferGeometry()
    const starCount = isMobile ? 420 : 900
    const starPos = new Float32Array(starCount * 3)
    const randStars = mulberry32(99)
    for (let i=0;i<starCount;i++) {
      starPos[i*3]=(randStars()-.5)*760
      starPos[i*3+1]=(randStars()-.5)*300
      starPos[i*3+2]=-randStars()*1100
    }
    starGeo.setAttribute('position',new THREE.BufferAttribute(starPos,3))
    const stars = new THREE.Points(starGeo,new THREE.PointsMaterial({color:0xe6f1ff,size:.26,transparent:true,opacity:0,depthWrite:false}))
    scene.add(stars)

    const layout = {
      noseZ: 31.4,
      tailZ: -31.4,
      centerY: -3.18,
      cockpitEyeY: -1.95,
      cockpitEyeZ: 27.2,
      aircraftBox: new THREE.Box3(new THREE.Vector3(-30,-6,-32), new THREE.Vector3(30,3,32)),
      runwaySurfaceY: runway.userData.surfaceY ?? -6.10
    }
    let camStates = []
    const rebuildCameraStates = () => {
      const nose = layout.noseZ
      const cy = layout.centerY
      const eyeY = cy + 1.22
      const eyeZ = nose - 4.1
      const cabinFrontZ = nose - 10.5
      const cabinMidZ = nose - 23.0
      const windowZ = nose - 31.0
      layout.cockpitEyeY = eyeY
      layout.cockpitEyeZ = eyeZ
      camStates = [
        {p:0,pos:[0,0,9],tar:[0,0,0],fov:44},
        {p:.055,pos:[0,cy+2.0,nose+51],tar:[0,cy+.2,nose-5],fov:35},
        {p:.14,pos:[0,cy+1.4,nose+29],tar:[0,cy+.35,nose-4],fov:32},
        {p:.215,pos:[0,cy+1.25,nose+13],tar:[0,cy+.85,nose-2],fov:39},
        {p:.252,pos:[0,cy+1.18,nose+3.6],tar:[0,cy+.9,nose-2.4],fov:46},
        {p:.282,pos:[0,eyeY,eyeZ],tar:[0,eyeY-.12,nose-8],fov:53},
        {p:.322,pos:[0,eyeY-.05,eyeZ-1.0],tar:[0,cy+.25,cabinFrontZ],fov:56},
        {p:.37,pos:[0,cy+.45,cabinFrontZ],tar:[0,cy+.25,cabinMidZ],fov:57},
        {p:.455,pos:[0,cy+.42,cabinMidZ+5],tar:[0,cy+.28,cabinMidZ-11],fov:58},
        {p:.545,pos:[1.15,cy+.46,windowZ],tar:[2.95,cy+.5,windowZ],fov:51},
        {p:.605,pos:[1.85,cy+.47,windowZ],tar:[8.2,cy+.12,windowZ],fov:47},
        {p:.655,pos:[2.72,cy+.40,windowZ],tar:[11.5,cy-.2,windowZ],fov:49},
        {p:.69,pos:[8.5,cy+.1,windowZ+.2],tar:[16,cy-.2,windowZ-2],fov:51},
        {p:.73,pos:[38,14,38],tar:[0,2,-16],fov:43},
        {p:.805,pos:[34,10,33],tar:[0,2,-27],fov:43},
        {p:.875,pos:[24,5,29],tar:[0,1.5,-34],fov:46},
        {p:.92,pos:[5,-4.7,8],tar:[0,-4.9,-8],fov:57},
        {p:.952,pos:[14,-1,42],tar:[0,.5,-58],fov:47},
        {p:.977,pos:[8,-5.0,-8],tar:[0,-5.4,-58],fov:50},
        {p:1,pos:[0,-5.0,-40],tar:[0,-5.2,-125],fov:47}
      ]
    }
    rebuildCameraStates()

    let exteriorLoaded = false
    let exteriorReady = false
    let exteriorMaterials = []
    let aircraftModel = null
    const bootStartedAt = performance.now()
    let assetReady = false
    let firstFrameRendered = false
    let loaderDismissScheduled = false
    const dismissLoaderIfReady = () => {
      if (!assetReady || !firstFrameRendered || loaderDismissScheduled) return
      loaderDismissScheduled = true
      const remaining = Math.max(0, 1800 - (performance.now() - bootStartedAt))
      window.setTimeout(() => setLoading(false), remaining)
    }
    const manager = new THREE.LoadingManager()
    manager.onProgress = (_url, loaded, total) => setLoadProgress(Math.round((loaded / Math.max(total, 1)) * 100))
    const modelLoader = new GLTFLoader(manager)
    const maxAniso = Math.min(12, renderer.capabilities.getMaxAnisotropy())

    const standardizeSingleAircraft = model => {
      const wrapper = new THREE.Group()
      wrapper.name = 'FACF_787_SINGLE_INTEGRATED'
      const axisFix = new THREE.Group()
      axisFix.name = 'FACF_AxisFix'
      axisFix.add(model)
      wrapper.add(axisFix)
      model.updateMatrixWorld(true)
      let box = new THREE.Box3().setFromObject(model)
      let size = box.getSize(new THREE.Vector3())
      const longest = size.x >= size.y && size.x >= size.z ? 'x' : size.y >= size.x && size.y >= size.z ? 'y' : 'z'
      if (longest === 'x') axisFix.rotation.y = Math.PI / 2
      else if (longest === 'y') axisFix.rotation.x = Math.PI / 2
      axisFix.updateMatrixWorld(true)
      box = new THREE.Box3().setFromObject(wrapper)
      size = box.getSize(new THREE.Vector3())
      const targetLength = 62.8
      const scale = targetLength / Math.max(size.z, .001)
      wrapper.scale.setScalar(scale)
      wrapper.updateMatrixWorld(true)
      box = new THREE.Box3().setFromObject(wrapper)
      let center = box.getCenter(new THREE.Vector3())
      wrapper.position.set(-center.x, -3.18 - center.y, -center.z)
      wrapper.updateMatrixWorld(true)
      box = new THREE.Box3().setFromObject(wrapper)

      // Detect which longitudinal end carries the taller tail and ensure the opposite end is the nose (+Z).
      const sample = { minMaxY: -Infinity, maxMaxY: -Infinity }
      const zMin = box.min.z, zMax = box.max.z, edge = (zMax-zMin) * .16
      wrapper.traverse(o => {
        if (!o.isMesh || !o.geometry?.attributes?.position) return
        const a = o.geometry.attributes.position
        const v = new THREE.Vector3()
        for (let i=0;i<a.count;i+=Math.max(1,Math.floor(a.count/1600))) {
          v.fromBufferAttribute(a,i).applyMatrix4(o.matrixWorld)
          if (v.z < zMin + edge) sample.minMaxY = Math.max(sample.minMaxY, v.y)
          if (v.z > zMax - edge) sample.maxMaxY = Math.max(sample.maxMaxY, v.y)
        }
      })
      if (sample.maxMaxY > sample.minMaxY + .75) {
        wrapper.rotation.y = Math.PI
        wrapper.updateMatrixWorld(true)
        box = new THREE.Box3().setFromObject(wrapper)
        center = box.getCenter(new THREE.Vector3())
        wrapper.position.x -= center.x
        wrapper.position.z -= center.z
        wrapper.updateMatrixWorld(true)
        box = new THREE.Box3().setFromObject(wrapper)
      }
      return { wrapper, box }
    }

    const mountSingleAircraft = gltf => {
      const model = gltf.scene
      aircraftModel = model
      const { wrapper, box } = standardizeSingleAircraft(model)
      layout.aircraftBox.copy(box)
      layout.noseZ = box.max.z
      layout.tailZ = box.min.z
      layout.centerY = box.getCenter(new THREE.Vector3()).y
      rebuildCameraStates()
      exteriorMaterials = tuneUnifiedAircraft(wrapper, maxAniso)
      aircraftVisual.clear()
      aircraftVisual.add(wrapper)
      exteriorLoaded = true
      exteriorReady = true
      assetReady = true
      setLoadProgress(100)
      dismissLoaderIfReady()
    }
    modelLoader.load(SINGLE_AIRCRAFT_URL, mountSingleAircraft, undefined, localErr => {
      if (!SINGLE_AIRCRAFT_REMOTE_URL) {
        console.error('[FACF] Local aircraft is missing and no VITE_AIRCRAFT_MODEL_URL fallback is configured.', localErr)
        setWebglFailed(true)
        setLoading(false)
        return
      }
      console.warn('[FACF] Local single aircraft is not cached yet; loading the configured fallback URL.', localErr)
      modelLoader.load(SINGLE_AIRCRAFT_REMOTE_URL, mountSingleAircraft, undefined, err => {
        console.error('[FACF] Required single integrated aircraft model failed to load.', err)
        setWebglFailed(true)
        setLoading(false)
      })
    })

    const disposeGroup = root => {
      root.traverse(o => {
        o.geometry?.dispose?.()
        if (o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material]
          mats.forEach(m => {
            ;['map','normalMap','roughnessMap','metalnessMap','emissiveMap','aoMap'].forEach(k => m[k]?.dispose?.())
            m.dispose?.()
          })
        }
      })
    }

    const scrollRoot = document.querySelector('.scroll-root')
    const topbar = document.querySelector('.topbar')
    const transitionWash = document.querySelector('.transition-wash')
    const lenis = new Lenis({ lerp: prefersReduced ? 1 : .085, smoothWheel: !prefersReduced, wheelMultiplier:.92 })
    lenis.on('scroll', ScrollTrigger.update)
    const lenisTick = time => lenis.raf(time * 1000)
    gsap.ticker.add(lenisTick)
    gsap.ticker.lagSmoothing(0)

    let targetProgress = 0
    ScrollTrigger.create({
      trigger: scrollRoot,
      start: 'top top',
      end: 'bottom bottom',
      onUpdate: self => { targetProgress = self.progress }
    })

    const tempTar = new THREE.Vector3()
    const tmpPos = new THREE.Vector3()
    const tmpRot = new THREE.Euler()
    function sampleCamera(p) {
      let a = camStates[0], b = camStates[camStates.length-1]
      for (let i=0;i<camStates.length-1;i++) {
        if (p >= camStates[i].p && p <= camStates[i+1].p) { a=camStates[i]; b=camStates[i+1]; break }
      }
      const t = range(p,a.p,b.p)
      return {
        pos: mixVec(new THREE.Vector3(...a.pos), new THREE.Vector3(...b.pos), t),
        tar: mixVec(new THREE.Vector3(...a.tar), new THREE.Vector3(...b.tar), t),
        fov: mix(a.fov,b.fov,smoothstep(t))
      }
    }

    let visualProgress = 0
    let activeWorldKey = destinationRef.current
    let pendingWorldKey = null
    let destinationTransition = 1
    const route = radar.getObjectByName('route')
    const beam = radar.getObjectByName('beam')
    const signal = radar.getObjectByName('signal')

    function updateAircraftState(p) {
      const pos=tmpPos.set(0,0,0)
      const rot=tmpRot.set(0,0,0)
      let sc=1
      const groundContactY = layout.runwaySurfaceY - layout.aircraftBox.min.y + .015
      if(p<.15){
        const t=range(p,.05,.15);pos.set(0,mix(2,0,t),mix(-18,0,t));sc=mix(.86,1,t);rot.set(0,mix(0,.015,t),0)
      }else if(p<.64){
        pos.set(0,0,0);rot.set(0,0,0)
      }else if(p<.76){
        const t=range(p,.64,.76);pos.set(0,mix(0,4,t),mix(0,-24,t));rot.set(mix(0,-.012,t),Math.PI+mix(0,.035,t),mix(0,.025,t))
      }else if(p<.91){
        const t=range(p,.76,.91);pos.set(0,mix(4,1.5,t),mix(-24,-34,t));rot.set(mix(-.012,-.035,t),Math.PI+.018,mix(.025,.055,t))
      }else if(p<.965){
        const t=smoothstep(range(p,.91,.965));
        const approachY=mix(1.5,groundContactY+.72,t)
        pos.set(0,approachY,mix(-34,-62,t));rot.set(mix(-.035,.018,t),Math.PI,mix(.055,0,t))
      }else if(p<.982){
        const t=smoothstep(range(p,.965,.982));
        // Flare settles the lowest point of the SAME aircraft model onto the runway surface.
        pos.set(0,mix(groundContactY+.72,groundContactY,t),mix(-62,-82,t));rot.set(mix(.018,0,t),Math.PI,0)
      }else{
        const t=range(p,.982,1);pos.set(0,groundContactY,mix(-82,-170,t));rot.set(0,Math.PI,0);sc=mix(1,.94,t)
      }
      // Hard runway safety clamp: no part of the scaled aircraft can pass below tarmac.
      const minAllowedY = layout.runwaySurfaceY - layout.aircraftBox.min.y * sc + .01
      if (p >= .965) pos.y = Math.max(pos.y, minAllowedY)
      aircraftRoot.position.copy(pos);aircraftRoot.rotation.copy(rot);aircraftRoot.scale.setScalar(sc)
    }

    function updateWorld(p, dt) {
      const radarP = range(p,0,.055)
      radar.visible = p < .074
      sky.visible = p > .043
      radar.scale.setScalar(mix(1,2.7,radarP))
      radar.position.z = mix(-4,-18,radarP)
      if (beam) beam.rotation.z += dt * 1.55
      if (route) route.material.opacity = smoothstep(range(p,.017,.05)) * (1-radarP*.82)
      if (signal) signal.scale.setScalar(1 + Math.sin(performance.now()*.0085)*.2)

      updateAircraftState(p)
      const flightTime = performance.now() * .001
      const heroFlight = smoothstep(range(p,.055,.11)) * (1-smoothstep(range(p,.205,.235)))
      const cruiseFlight = smoothstep(range(p,.68,.72)) * (1-smoothstep(range(p,.90,.93)))
      const flightMotion = clamp(heroFlight + cruiseFlight, 0, 1)
      if (!prefersReduced && flightMotion > .001) {
        const bank = Math.sin(flightTime * .44) * .014 + Math.sin(flightTime * .91) * .004
        const pitch = Math.sin(flightTime * .58 + .8) * .0055
        aircraftRoot.position.x += Math.sin(flightTime * .31) * .32 * flightMotion
        aircraftRoot.position.y += (Math.sin(flightTime * .52) * .14 + Math.sin(flightTime * 1.23) * .025) * flightMotion
        aircraftRoot.rotation.z += bank * flightMotion
        aircraftRoot.rotation.x += pitch * flightMotion
      }
      aircraftRoot.visible = p > .038 && p < .996
      const cockpitPhase = p >= .245 && p < .35
      const cabinPhase = p >= .335 && p < .665
      const windowPhase = p >= .50 && p < .665
      const inInterior = cockpitPhase || cabinPhase
      // One single integrated aircraft stays mounted throughout the entire journey.
      aircraftVisual.visible = exteriorLoaded
      const handoffMask = 0
      if(transitionWash) transitionWash.style.opacity='0'

      if (pendingWorldKey) {
        destinationTransition = Math.min(1,destinationTransition + dt*.82)
        if (destinationTransition >= .48 && activeWorldKey !== pendingWorldKey) activeWorldKey = pendingWorldKey
        if (destinationTransition >= 1) pendingWorldKey = null
      }
      const destinationMask = pendingWorldKey ? Math.sin(destinationTransition*Math.PI) : 0
      const exitMask = Math.sin(range(p,.625,.69)*Math.PI)
      const cloudMask = Math.max(destinationMask, exitMask, handoffMask)
      const destActive = p > .485 && p < .85
      const worldMove = smoothstep(range(p,.63,.705))
      Object.entries(worlds).forEach(([key, world]) => {
        world.visible = destActive && key === activeWorldKey
        if (world.visible) {
          world.position.copy(world.userData.windowPosition).lerp(world.userData.externalPosition,worldMove)
          world.rotation.y = mix(world.userData.windowRotation,world.userData.externalRotation,worldMove)
          world.scale.setScalar(mix(world.userData.windowScale || .82, 1.08, worldMove))
        }
      })

      const chosenForAtmosphere = activeWorldKey
      const cloudTintMap = { UK:0xe6eef3, USA:0xdce8f0, Egypt:0xffddb1, Pakistan:0xecf5fb, Malaysia:0xd6e8e4 }
      const cloudTint = new THREE.Color(cloudTintMap[chosenForAtmosphere] || 0xf2f5f7)
      cloudsNear.userData.setColor(cloudTint, Math.min(1, dt * 1.4))
      cloudsMid.userData.setColor(cloudTint, Math.min(1, dt * 1.1))
      cloudsFar.userData.setColor(cloudTint, Math.min(1, dt * .8))
      cloudVolumeNear.userData.setColor(cloudTint, Math.min(1, dt * .72))
      cloudVolumeMid.userData.setColor(cloudTint, Math.min(1, dt * .54))
      cloudVolumeFar.userData.setColor(cloudTint, Math.min(1, dt * .36))
      const destFog = new THREE.Color(DESTINATIONS[chosenForAtmosphere].fog)
      const nightFog = new THREE.Color(0x142033)
      const neutralFog = new THREE.Color(0xa8bdc7)
      const fogTarget = p > .84 ? nightFog : destActive ? destFog : neutralFog
      scene.fog.color.lerp(fogTarget, Math.min(1, dt * 2.4))
      scene.fog.density = mix(scene.fog.density, p > .84 ? .0020 : (p > .48 && p < .665 ? .00042 : .0010), Math.min(1, dt * 2.2))

      const windowCloudPhase = smoothstep(range(p, .44, .52)) * (1 - smoothstep(range(p, .64, .71)))
      const cloudYaw = -Math.PI / 2 * windowCloudPhase
      cloudsNear.rotation.y = cloudYaw
      cloudsMid.rotation.y = cloudYaw
      cloudsFar.rotation.y = cloudYaw
      cloudVolumeNear.rotation.y = cloudYaw
      cloudVolumeMid.rotation.y = cloudYaw
      cloudVolumeFar.rotation.y = cloudYaw
      const interiorFactor = inInterior ? .014 : p < .05 ? .018 : p < .84 ? .085 : .13
      const nearOp = clamp(interiorFactor + cloudMask * .66, 0, .72)
      const midOp = clamp(interiorFactor * .78 + cloudMask * .46, 0, .58)
      const farOp = clamp(interiorFactor * .55 + cloudMask * .28, 0, .38)
      cloudsNear.userData.setOpacity(nearOp)
      cloudsMid.userData.setOpacity(midOp)
      cloudsFar.userData.setOpacity(farOp)
      cloudVolumeNear.userData.setOpacity(clamp(nearOp * .58 + .035, .025, .18))
      cloudVolumeMid.userData.setOpacity(clamp(midOp * .54 + .028, .02, .14))
      cloudVolumeFar.userData.setOpacity(clamp(farOp * .5 + .018, .014, .09))
      const cloudTime = performance.now() * .001
      cloudsNear.userData.setTime(cloudTime)
      cloudsMid.userData.setTime(cloudTime * .72)
      cloudsFar.userData.setTime(cloudTime * .46)
      const exteriorFlight = smoothstep(range(p,.055,.20)) * (1-smoothstep(range(p,.215,.25))) + smoothstep(range(p,.665,.72)) * (1-smoothstep(range(p,.91,.945)))
      const windowFlight = smoothstep(range(p,.47,.54)) * (1-smoothstep(range(p,.64,.69)))
      const flowSpeed = 2.5 + exteriorFlight * 20 + windowFlight * 10
      cloudsNear.position.z += dt * flowSpeed
      cloudsMid.position.z += dt * (1.2 + exteriorFlight * 7 + windowFlight * 4)
      cloudsFar.position.z += dt * (.42 + exteriorFlight * 2.3)
      cloudVolumeNear.position.z += dt * (1.6 + exteriorFlight * 11 + windowFlight * 7)
      cloudVolumeMid.position.z += dt * (.7 + exteriorFlight * 4.4 + windowFlight * 2.5)
      cloudVolumeFar.position.z += dt * (.22 + exteriorFlight * 1.35)
      if (cloudsNear.position.z > 130) cloudsNear.position.z = -140
      if (cloudsMid.position.z > 170) cloudsMid.position.z = -220
      if (cloudsFar.position.z > 220) cloudsFar.position.z = -380
      if (cloudVolumeNear.position.z > 180) cloudVolumeNear.position.z = -260
      if (cloudVolumeMid.position.z > 240) cloudVolumeMid.position.z = -460
      if (cloudVolumeFar.position.z > 320) cloudVolumeFar.position.z = -760
      const flowOpacity = prefersReduced ? 0 : clamp(exteriorFlight * .095 + windowFlight * .035, 0, .095)
      airflow.userData.setOpacity(flowOpacity)
      airflow.position.z += dt * (18 + exteriorFlight * 95)
      if (airflow.position.z > 145) airflow.position.z = -120

      const dusk = smoothstep(range(p,.79,.95))
      const elevation = mix(9,-5,dusk)
      const phi = THREE.MathUtils.degToRad(90-elevation)
      const theta = THREE.MathUtils.degToRad(225)
      sunVector.setFromSphericalCoords(1,phi,theta)
      skyU.sunPosition.value.copy(sunVector)
      skyU.rayleigh.value = mix(1.45,.38,dusk)
      skyU.turbidity.value = mix(6.5,3.0,dusk)
      sun.position.copy(sunVector).multiplyScalar(120)
      sun.intensity = mix(3.8,.12,dusk)
      hemi.intensity = mix(1.02,.24,dusk)
      coolFill.intensity = mix(.74,.23,dusk)
      warmRim.intensity = mix(.92,.08,dusk)
      warm.intensity = cabinPhase ? 2.05 : .25
      cockpitGlow.intensity = cockpitPhase ? 2.8 : .15
      stars.material.opacity = smoothstep(range(p,.82,.94))*.84
      gtaoPass.enabled = !isMobile && inInterior && currentDpr >= minDpr + .12
      bloom.strength = p>.90 ? (isMobile?.2:.42) : (isMobile?.11:.22)
      renderer.toneMappingExposure = mix(1.03,.71,dusk)
      runway.visible = p > .875
      const smokePulse = Math.sin(range(p,.958,.985)*Math.PI)
      touchdownSmoke.material.opacity = clamp(smokePulse*.34,0,.34)
      touchdownSmoke.scale.setScalar(mix(.75,1.6,range(p,.958,.985)))
      if (topbar) {
        const enclosed = smoothstep(range(p,.225,.285)) * (1-smoothstep(range(p,.62,.69)))
        topbar.style.opacity = String(mix(1,.18,enclosed))
        topbar.style.transform = `translateY(${mix(0,-6,enclosed)}px)`
      }
    }

    const pointer = new THREE.Vector2()
    const onPointer = e => {
      pointer.x = (e.clientX / window.innerWidth) * 2 - 1
      pointer.y = -(e.clientY / window.innerHeight) * 2 + 1
    }
    window.addEventListener('pointermove', onPointer, { passive:true })

    let raf=0
    let last=performance.now()
    let qualityMs=0, qualityFrames=0, lastQualityCheck=last
    const applyDpr = dpr => {
      currentDpr = dpr
      renderer.setPixelRatio(currentDpr)
      renderer.setSize(window.innerWidth, window.innerHeight, false)
      composer.setPixelRatio(Math.min(currentDpr, isMobile ? 1.0 : 1.3))
      composer.setSize(window.innerWidth, window.innerHeight)
      cloudsNear.userData.setDpr(currentDpr)
      cloudsMid.userData.setDpr(currentDpr)
      cloudsFar.userData.setDpr(currentDpr)
    }

    function frame(now) {
      const dt = Math.min(.05,(now-last)/1000)
      last=now
      visualProgress = THREE.MathUtils.damp(visualProgress,targetProgress,prefersReduced?20:7.5,dt)
      updateWorld(visualProgress,dt)
      const s = sampleCamera(visualProgress)
      const follow = prefersReduced ? 1 : 1-Math.exp(-dt*8.5)
      camera.position.lerp(s.pos,follow)
      tempTar.lerp(s.tar,prefersReduced?1:1-Math.exp(-dt*9.2))
      if (visualProgress > .665 && visualProgress < .84) {
        camera.position.x += pointer.x * .32
        camera.position.y += pointer.y * .12
      }
      if (!prefersReduced) {
        const exteriorCam = smoothstep(range(visualProgress,.055,.11)) * (1-smoothstep(range(visualProgress,.205,.235))) + smoothstep(range(visualProgress,.68,.72)) * (1-smoothstep(range(visualProgress,.90,.93)))
        if (exteriorCam > .001) {
          const cameraTime = now * .001
          camera.position.x += Math.sin(cameraTime * .47) * .055 * exteriorCam
          camera.position.y += Math.sin(cameraTime * .73 + .4) * .035 * exteriorCam
          tempTar.x += Math.sin(cameraTime * .31) * .025 * exteriorCam
          tempTar.y += Math.sin(cameraTime * .52) * .018 * exteriorCam
        }
      }
      camera.fov = mix(camera.fov,s.fov,follow)
      camera.updateProjectionMatrix()
      camera.lookAt(tempTar)
      try {
        composer.render()
        if (!firstFrameRendered) {
          firstFrameRendered = true
          dismissLoaderIfReady()
        }
      } catch (renderError) {
        console.error('[FACF] WebGL render loop failed.', renderError)
        setWebglFailed(true)
        setLoading(false)
        cancelAnimationFrame(raf)
        return
      }

      qualityMs += dt*1000; qualityFrames++
      if(now-lastQualityCheck>2200 && qualityFrames>20){
        const avg=qualityMs/qualityFrames
        let next=currentDpr
        if(avg>20.5 && currentDpr>minDpr+.02) next=Math.max(minDpr,currentDpr-.12)
        else if(avg<14.5 && currentDpr<maxDpr-.02) next=Math.min(maxDpr,currentDpr+.08)
        if(avg>22.5 && gtaoPass.enabled) gtaoPass.enabled=false
        if(avg>23 && bloom.enabled) bloom.enabled=false
        else if(avg<14 && !isMobile && !bloom.enabled && currentDpr>=maxDpr-.12) bloom.enabled=true
        if(Math.abs(next-currentDpr)>.03) applyDpr(next)
        qualityMs=0;qualityFrames=0;lastQualityCheck=now
      }
      raf=requestAnimationFrame(frame)
    }
    raf=requestAnimationFrame(frame)

    const onResize=()=>{
      camera.aspect=window.innerWidth/window.innerHeight
      camera.updateProjectionMatrix()
      applyDpr(Math.min(currentDpr,Math.min(window.devicePixelRatio||1,window.innerWidth<700?1.28:1.75)))
      ScrollTrigger.refresh()
    }
    window.addEventListener('resize',onResize)

    const onDestination=e=>{
      destinationRef.current=e.detail
      pendingWorldKey=e.detail
      destinationTransition=0
    }
    window.addEventListener('facf-destination',onDestination)

    const onVisibility=()=>{ if(document.hidden) lenis.stop(); else lenis.start() }
    document.addEventListener('visibilitychange',onVisibility)

    worldRef.current={ scene, camera, renderer }
    return()=>{
      cancelAnimationFrame(raf)
      window.removeEventListener('resize',onResize)
      window.removeEventListener('pointermove',onPointer)
      window.removeEventListener('facf-destination',onDestination)
      document.removeEventListener('visibilitychange',onVisibility)
      ScrollTrigger.getAll().forEach(t=>t.kill())
      gsap.ticker.remove(lenisTick)
      lenis.destroy()
      composer.dispose()
      envTarget.dispose()
      renderer.dispose()
      scene.traverse(o=>{
        if(o.geometry)o.geometry.dispose?.()
        if(o.material){
          const mats=Array.isArray(o.material)?o.material:[o.material]
          mats.forEach(m=>{m.map?.dispose?.();m.dispose?.()})
        }
      })
    }
  },[])
  const handleSearch = e => {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const safe = ['UK','USA','Egypt','Pakistan','Malaysia']
    const selected = String(form.get('destination') || '')
    const d = safe.includes(selected) ? selected : destination
    setSearchMessage(`Routes to ${DESTINATIONS[d].label} are ready to compare.`)
  }

  return <>
    <canvas ref={canvasRef} className="world-canvas" aria-hidden="true" />
    <div className="noise" aria-hidden="true" />
    <header className="topbar">
      <a className="brand" href="#top" aria-label="FindACheapFlight home"><span>FACF</span><small>FindACheapFlight</small></a>
      <nav><a href="#search">Search</a><a href="#destinations">Destinations</a><a href="#deals">Deals</a><a href="#footer">About</a></nav>
    </header>

    {loading && !webglFailed && <div className="loader" role="status" aria-live="polite">
      <div className="loader-ring"><div className="sweep"/><div className="blip"/></div>
      <p>ACQUIRING ROUTE</p><strong>{Math.max(loadProgress, 12)}%</strong>
    </div>}

    <main id="top" className="scroll-root">
      <section className="beat hero-beat" aria-label="FindACheapFlight introduction">
        <div className="hero-copy"><span className="eyebrow">FLIGHT SEARCH. REIMAGINED.</span><h1>FindACheapFlight</h1><p>The World Is Closer Than You Think</p><span className="scroll-cue">Scroll to board <b>↓</b></span></div>
      </section>
      <section className="beat cockpit-beat" aria-hidden="true" />
      <section className="beat cabin-beat" aria-hidden="true" />
      <section id="destinations" className="beat destination-beat">
        <div className="destination-ui glass-panel">
          <span className="eyebrow">SEAT 12A · 41,000 FT</span>
          <h2>Where would you like to go?</h2>
          <div className="destination-grid">
            {Object.keys(DESTINATIONS).map(key=><button key={key} className={destination===key?'active':''} aria-pressed={destination===key} onClick={()=>chooseDestination(key)}><span>{key}</span><small>{DESTINATIONS[key].label}</small></button>)}
          </div>
          <div className="selection-line"><i/><span>Window view</span><b>{DESTINATIONS[destination].label}</b></div>
        </div>
      </section>
      <section className="beat exterior-beat" aria-hidden="true" />
      <section id="search" className="beat search-beat">
        <div className="search-shell glass-panel">
          <div className="search-head"><span className="eyebrow">YOUR ROUTE IS READY</span><h2>Search the journey you just chose.</h2></div>
          <form onSubmit={handleSearch}>
            <label>Origin<input name="origin" defaultValue="London" autoComplete="off" /></label>
            <label>Destination<select name="destination" value={destination} onChange={e=>chooseDestination(e.target.value)}>{Object.keys(DESTINATIONS).map(k=><option key={k} value={k}>{DESTINATIONS[k].label}</option>)}</select></label>
            <label>Departure<input name="departure" type="date" /></label>
            <label>Return<input name="return" type="date" /></label>
            <label>Passengers<select name="passengers" defaultValue="1"><option>1</option><option>2</option><option>3</option><option>4</option><option>5</option></select></label>
            <label>Cabin class<select name="cabin" defaultValue="Economy"><option>Economy</option><option>Premium Economy</option><option>Business</option><option>First</option></select></label>
            <button className="search-btn" type="submit">Search Flights <span>↗</span></button>
          </form>
          {searchMessage && <p className="search-message" role="status">{searchMessage}</p>}
          <div id="deals" className="deals">
            {[['London','Islamabad','£438'],['Manchester','New York','£362'],['London','Cairo','£219'],['Birmingham','Kuala Lumpur','£491'],['Manchester','Lahore','£447']].map((d,i)=><article key={d[0]+d[1]} style={{'--i':i}}><span>{d[0]}</span><i>→</i><b>{d[1]}</b><strong>{d[2]}</strong></article>)}
          </div>
        </div>
      </section>
      <section className="beat descent-beat" aria-hidden="true" />
      <section className="beat landing-beat" aria-hidden="true" />
      <footer id="footer" className="beat footer-beat">
        <div className="footer-grid">
          <div><span className="eyebrow">ARRIVAL · FACF</span><h2>FindACheapFlight</h2><p>The route ends here. The next one starts with a search.</p></div>
          <div><h3>Explore</h3><a href="#search">Flight Search</a><a href="#destinations">Destinations</a><a href="#deals">Deals</a><a href="#top">About</a></div>
          <div><h3>Legal</h3><a href="#footer">Privacy</a><a href="#footer">Terms</a><a href="#footer">Contact</a></div>
          <form className="newsletter" onSubmit={e=>{e.preventDefault();setSearchMessage('Deal alerts are enabled.')}}><h3>Deal alerts</h3><label><span>Email address</span><input type="email" required/><button type="submit">Join</button></label></form>
        </div>
        <div className="footer-bottom"><span>© 2026 FindACheapFlight</span><span>Route: {DESTINATIONS[destination].label}</span><span>Built for immersive flight discovery</span></div>
      </footer>
    </main>

    {webglFailed && <div className="fallback"><h1>FindACheapFlight</h1><p>Your browser cannot start the cinematic 3D experience, but flight search remains available.</p><a href="#search">Search Flights</a></div>}
  </>
}

class WorldErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error) {
    return { error }
  }
  componentDidCatch(error, info) {
    console.error('[FACF] Application startup failed.', error, info)
  }
  render() {
    if (this.state.error) {
      return <div className="fatal-fallback" role="alert">
        <span>FACF</span>
        <h1>The cinematic scene could not start.</h1>
        <p>The page hit a runtime error before WebGL finished booting. Reload to retry the experience.</p>
        <button type="button" onClick={() => window.location.reload()}>Reload experience</button>
      </div>
    }
    return this.props.children
  }
}

createRoot(document.getElementById('root')).render(<WorldErrorBoundary><App /></WorldErrorBoundary>)
