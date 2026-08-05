'use client'

import { useRef, memo, useEffect, useCallback, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Stars, useTexture } from '@react-three/drei'
import * as THREE from 'three'
import Atmosphere from './Atmosphere'
import CountryBorders from './CountryBorders'
import Graticule from './Graticule'
import ConnectionArc from './ConnectionArc'
import CountryMarker from './CountryMarker'

export function latLonToVector3(
  lat: number,
  lon: number,
  radius: number = 1.2
): [number, number, number] {
  const phi = (90 - lat) * (Math.PI / 180)
  const theta = (lon + 180) * (Math.PI / 180)
  const x = -(radius * Math.sin(phi) * Math.cos(theta))
  const z = radius * Math.sin(phi) * Math.sin(theta)
  const y = radius * Math.cos(phi)
  return [x, y, z]
}

interface GlobeConnection {
  source: { lat: number; lon: number }
  target: { lat: number; lon: number }
  type: string
}

interface GlobeMarker {
  lat: number
  lon: number
  name: string
  count: number
}

const EarthSphere = memo(function EarthSphere() {
  const [dayMap, nightMap] = useTexture([
    '/textures/earth-blue-marble.jpg',
    '/textures/earth-night-2k.jpg',
  ])
  const { gl } = useThree()

  // Anisotropic filtering. Zoomed out the globe is small and mipmaps suffice,
  // but at minDistance 1.8 the surface is viewed at a grazing angle where
  // trilinear filtering smears texels into mush. Cheapest visible quality win
  // available on the textures we already ship — no new assets.
  useEffect(() => {
    const max = gl.capabilities.getMaxAnisotropy()
    for (const t of [dayMap, nightMap]) {
      t.anisotropy = max
      t.colorSpace = THREE.SRGBColorSpace
      t.needsUpdate = true
    }
  }, [dayMap, nightMap, gl])

  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        dayTexture: { value: dayMap },
        nightTexture: { value: nightMap },
        sunDirection: { value: new THREE.Vector3(1, 0.3, 0.8).normalize() },
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vNormal;
        varying vec3 vWorldPosition;

        void main() {
          vUv = uv;
          vNormal = normalize(normalMatrix * normal);
          vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D dayTexture;
        uniform sampler2D nightTexture;
        uniform vec3 sunDirection;

        varying vec2 vUv;
        varying vec3 vNormal;
        varying vec3 vWorldPosition;

        void main() {
          vec3 worldNormal = normalize(vWorldPosition);
          vec3 viewDir = normalize(cameraPosition - vWorldPosition);
          float sunDot = dot(worldNormal, sunDirection);

          // Smooth day/night transition
          float dayFactor = smoothstep(-0.15, 0.25, sunDot);

          vec3 dayColor = texture2D(dayTexture, vUv).rgb;
          vec3 nightColor = texture2D(nightTexture, vUv).rgb;

          float dayLum = dot(dayColor, vec3(0.299, 0.587, 0.114));

          // Detect water: oceans read dark + blue in the blue-marble map
          float blueness = dayColor.b - max(dayColor.r, dayColor.g);
          float water = smoothstep(0.0, 0.06, blueness) * (1.0 - smoothstep(0.16, 0.34, dayLum));

          // Specular sun-glint on water (Blinn-Phong) — a moving highlight that
          // makes the oceans feel alive as the globe turns.
          vec3 halfDir = normalize(sunDirection + viewDir);
          float spec = pow(max(dot(worldNormal, halfDir), 0.0), 190.0);
          vec3 glint = vec3(1.0, 0.96, 0.86) * spec * water * dayFactor * 0.55;

          // Terrain relief, derived rather than downloaded.
          //
          // Sampling luminance either side of the fragment approximates a height
          // gradient, which perturbs the normal enough to catch light on ridges
          // and shade valleys. A real normal map would be better, but it is
          // another multi-megabyte asset on a page already shipping 2MB of
          // imagery. Land only — the ocean is flat, and perturbing it would
          // fight the specular glint computed above.
          float texel = 1.0 / 2048.0;
          float hL = dot(texture2D(dayTexture, vUv - vec2(texel, 0.0)).rgb, vec3(0.299, 0.587, 0.114));
          float hR = dot(texture2D(dayTexture, vUv + vec2(texel, 0.0)).rgb, vec3(0.299, 0.587, 0.114));
          float hD = dot(texture2D(dayTexture, vUv - vec2(0.0, texel)).rgb, vec3(0.299, 0.587, 0.114));
          float hU = dot(texture2D(dayTexture, vUv + vec2(0.0, texel)).rgb, vec3(0.299, 0.587, 0.114));
          vec3 relief = normalize(vec3((hL - hR) * 2.2, (hD - hU) * 2.2, 1.0));
          float land = 1.0 - water;
          float terrain = mix(1.0, 0.72 + 0.55 * max(dot(relief, normalize(vec3(sunDirection.xy, 1.0))), 0.0), land * dayFactor);
          dayColor *= terrain;

          // Day shading (slightly darkened for the surveillance look)
          dayColor *= 0.72 + 0.28 * dayFactor;

          // Warm, boosted night city lights
          nightColor *= 1.9;
          nightColor.r *= 1.06;
          nightColor.g *= 1.01;

          // Blend day geography with night city lights
          vec3 color = mix(nightColor, dayColor, dayFactor);
          color += glint;

          // Atmospheric rim on the earth's limb — cool scatter brightening
          float rim = 1.0 - max(dot(viewDir, worldNormal), 0.0);
          color += vec3(0.30, 0.48, 0.90) * pow(rim, 3.8) * (0.35 + 0.65 * dayFactor) * 0.42;

          // Subtle blue tint in dark areas (surveillance aesthetic)
          vec3 blueTint = vec3(0.04, 0.07, 0.14);
          color += blueTint * (1.0 - dayLum) * 0.35;

          gl_FragColor = vec4(color, 1.0);
        }
      `,
    })
  }, [dayMap, nightMap])

  return (
    <mesh material={material}>
      <sphereGeometry args={[1.2, 128, 128]} />
    </mesh>
  )
})

useTexture.preload('/textures/earth-blue-marble.jpg')
useTexture.preload('/textures/earth-night-2k.jpg')

const GlobeOverlays = memo(function GlobeOverlays({
  connections,
  markers,
  onMarkerClick,
}: {
  connections: GlobeConnection[]
  markers: GlobeMarker[]
  onMarkerClick?: (marker: GlobeMarker) => void
}) {
  return (
    <>
      {markers.map((marker) => (
        <CountryMarker
          key={`marker-${marker.lat}-${marker.lon}`}
          lat={marker.lat}
          lon={marker.lon}
          name={marker.name}
          count={marker.count}
          onClick={() => onMarkerClick?.(marker)}
        />
      ))}
      {connections.map((conn, i) => (
        <ConnectionArc
          key={`arc-${i}`}
          source={conn.source}
          target={conn.target}
          type={conn.type}
        />
      ))}
    </>
  )
})

/**
 * Selected-entity marker.
 *
 * Was three concentric rings pulsing at different rates — a radar ping, which
 * on a static screenshot reads as a sound wave rather than a selection. It also
 * competed with the connection arcs for attention in the same colour.
 *
 * Now a targeting reticle: a fixed crosshair with corner brackets and a single
 * slow expanding pulse. Brackets are geometry rather than animation, so the
 * selection stays legible when the frame is paused, which is how it will be
 * seen in a screenshot or a deck.
 */
function HQMarker({ lat, lon }: { lat: number; lon: number }) {
  const pulseRef = useRef<THREE.Mesh>(null)
  const groupRef = useRef<THREE.Group>(null)
  const position = useMemo(() => latLonToVector3(lat, lon, 1.212), [lat, lon])

  /** Four L-shaped corner brackets, drawn as line segments. */
  const brackets = useMemo(() => {
    const r = 0.055      // bracket distance from centre
    const arm = 0.022    // arm length
    const pts: number[] = []
    for (const [sx, sy] of [[1, 1], [-1, 1], [-1, -1], [1, -1]] as const) {
      const x = r * sx
      const y = r * sy
      // Horizontal arm, then vertical arm, forming the corner.
      pts.push(x, y, 0, x - arm * sx, y, 0)
      pts.push(x, y, 0, x, y - arm * sy, 0)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    return g
  }, [])

  /** Crosshair ticks, leaving the centre clear so the core dot stays readable. */
  const crosshair = useMemo(() => {
    const inner = 0.026
    const outer = 0.04
    const pts = [
      inner, 0, 0, outer, 0, 0,
      -inner, 0, 0, -outer, 0, 0,
      0, inner, 0, 0, outer, 0,
      0, -inner, 0, 0, -outer, 0,
    ]
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    return g
  }, [])

  useFrame(({ camera, clock }) => {
    // Billboard, so the reticle reads as an overlay rather than something
    // painted onto the terrain at an angle.
    groupRef.current?.lookAt(camera.position)

    if (pulseRef.current) {
      // One slow pulse, not three competing ones. Fades as it expands so it
      // reads as a ping outward rather than a throb.
      const t = (clock.getElapsedTime() % 2.6) / 2.6
      const scale = 1 + t * 2.4
      pulseRef.current.scale.set(scale, scale, scale)
      ;(pulseRef.current.material as THREE.MeshBasicMaterial).opacity = 0.5 * (1 - t) ** 2
    }
  })

  return (
    <group ref={groupRef} position={position} renderOrder={11}>
      {/* Expanding ping */}
      <mesh ref={pulseRef}>
        <ringGeometry args={[0.03, 0.034, 48]} />
        <meshBasicMaterial color="#C8102E" transparent opacity={0.5} side={THREE.DoubleSide} depthWrite={false} depthTest={false} />
      </mesh>

      {/* Fixed inner ring */}
      <mesh>
        <ringGeometry args={[0.024, 0.028, 48]} />
        <meshBasicMaterial color="#C8102E" transparent opacity={0.85} side={THREE.DoubleSide} depthWrite={false} depthTest={false} />
      </mesh>

      {/* Core */}
      <mesh>
        <circleGeometry args={[0.009, 20]} />
        <meshBasicMaterial color="#FF3B52" depthWrite={false} depthTest={false} />
      </mesh>

      <lineSegments geometry={crosshair}>
        <lineBasicMaterial color="#C8102E" transparent opacity={0.75} depthWrite={false} depthTest={false} />
      </lineSegments>

      <lineSegments geometry={brackets}>
        <lineBasicMaterial color="#C8102E" transparent opacity={0.9} depthWrite={false} depthTest={false} />
      </lineSegments>
    </group>
  )
}

// Camera controller that works WITH OrbitControls by directly positioning the camera
// and calling controls.update() to sync OrbitControls' internal state
function CameraController({
  focusTarget,
  groupRef,
}: {
  focusTarget?: { lat: number; lon: number }
  groupRef: React.RefObject<THREE.Group | null>
}) {
  const { camera, controls } = useThree()
  const targetCameraPos = useRef(new THREE.Vector3(0, 0, 4.8))
  const isAnimating = useRef(false)
  const isAutoRotating = useRef(true)
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const disableOrbitControls = useCallback(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctrl = controls as any
    if (ctrl) ctrl.enabled = false
  }, [controls])

  const enableOrbitControls = useCallback(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctrl = controls as any
    if (ctrl) ctrl.enabled = true
  }, [controls])

  const syncOrbitControls = useCallback(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctrl = controls as any
    if (ctrl && ctrl.update) {
      // Sync OrbitControls internal state to match our camera position
      ctrl.target.set(0, 0, 0)
      ctrl.update()
    }
  }, [controls])

  useEffect(() => {
    if (resumeTimer.current) clearTimeout(resumeTimer.current)

    if (!focusTarget) {
      // Zoom back out
      targetCameraPos.current.set(0, 0, 4.8)
      isAnimating.current = true
      isAutoRotating.current = true

      // Re-enable orbit controls after zoom-out animation
      resumeTimer.current = setTimeout(() => {
        enableOrbitControls()
        isAnimating.current = false
      }, 2000)
      return
    }

    // Calculate camera position looking at the target on the globe surface
    // Position camera along the vector from globe center through the target point
    const [x, y, z] = latLonToVector3(focusTarget.lat, focusTarget.lon, 2.4)
    targetCameraPos.current.set(x, y, z)

    // Disable OrbitControls so we have full control during animation
    disableOrbitControls()
    isAnimating.current = true
    isAutoRotating.current = false

    // Re-enable OrbitControls after animation settles (user can then manually rotate)
    resumeTimer.current = setTimeout(() => {
      syncOrbitControls()
      enableOrbitControls()
      isAnimating.current = false

      // Resume auto-rotate much later
      resumeTimer.current = setTimeout(() => {
        isAutoRotating.current = true
      }, 30000)
    }, 3000)

    return () => {
      if (resumeTimer.current) clearTimeout(resumeTimer.current)
    }
  }, [focusTarget, disableOrbitControls, enableOrbitControls, syncOrbitControls])

  useFrame((_, delta) => {
    const group = groupRef.current
    if (!group) return

    if (isAnimating.current) {
      // Smoothly lerp camera to target position
      camera.position.lerp(targetCameraPos.current, delta * 1.8)
      camera.lookAt(0, 0, 0)

      // Ease globe rotation to 0 so we see the correct hemisphere
      group.rotation.x = THREE.MathUtils.lerp(group.rotation.x, 0, delta * 2)
      group.rotation.y = THREE.MathUtils.lerp(group.rotation.y, 0, delta * 2)

      // Sync orbit controls to keep them in sync with our animation
      syncOrbitControls()
    } else if (isAutoRotating.current && !focusTarget) {
      group.rotation.y += delta * 0.035
    }
  })

  return null
}

export default function Globe({
  connections = [],
  markers = [],
  onMarkerClick,
  focusTarget,
}: {
  connections?: GlobeConnection[]
  markers?: GlobeMarker[]
  onMarkerClick?: (marker: GlobeMarker) => void
  focusTarget?: { lat: number; lon: number }
}) {
  const groupRef = useRef<THREE.Group>(null)

  return (
    <>
      {/* Layered starfield for depth */}
      <Stars radius={100} depth={60} count={6000} factor={3.5} saturation={0} fade speed={0.4} />
      <Stars radius={200} depth={80} count={2500} factor={6} saturation={0.05} fade speed={0.2} />

      <CameraController focusTarget={focusTarget} groupRef={groupRef} />

      <group ref={groupRef}>
        <EarthSphere />
        {/* Vector cartography over the imagery — the part that stays crisp at
            any zoom, unlike coastlines baked into the texture. */}
        <Graticule />
        <CountryBorders />
        <Atmosphere />
        <GlobeOverlays
          connections={connections}
          markers={markers}
          onMarkerClick={onMarkerClick}
        />
        {focusTarget && (
          <HQMarker lat={focusTarget.lat} lon={focusTarget.lon} />
        )}
      </group>
    </>
  )
}
