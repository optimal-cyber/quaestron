'use client'

import { useRef, useState, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import { latLonToVector3 } from './Globe'

/**
 * Country marker.
 *
 * Previously a translucent sphere sitting proud of the surface, which read as a
 * soft blob rather than a data point — 72 of them looked like condensation on
 * the globe. Now a flat billboarded disc with a crisp bright edge: a filled
 * core for presence, a ring for definition, and a faint halo for glow.
 *
 * Flat rather than spherical because a sphere shades itself, so its apparent
 * brightness varied with where it sat on the globe — markers near the limb
 * looked dimmer than identical ones at the centre, implying a difference in the
 * data that did not exist.
 */

const _target = new THREE.Vector3()
const _camDir = new THREE.Vector3()

export default function CountryMarker({
  lat,
  lon,
  name,
  count,
  onClick,
}: {
  lat: number
  lon: number
  name: string
  count: number
  onClick?: () => void
}) {
  const groupRef = useRef<THREE.Group>(null)
  const [hovered, setHovered] = useState(false)

  const position = useMemo(() => latLonToVector3(lat, lon, 1.208), [lat, lon])
  const normal = useMemo(
    () => new THREE.Vector3(position[0], position[1], position[2]).normalize(),
    [position]
  )

  /**
   * Logarithmic and deliberately narrow: 1 entity to 404 spans roughly 2.5x in
   * radius, not 400x. Linear scaling would make the US a continent-sized blot
   * and leave every other country invisible.
   */
  const size = useMemo(() => 0.007 + Math.log10(Math.max(count, 1)) * 0.0052, [count])

  useFrame(({ camera }, delta) => {
    const g = groupRef.current
    if (!g) return

    // Billboard toward the camera so the disc is always a circle, never an
    // ellipse foreshortened by its position on the sphere.
    g.lookAt(camera.position)

    // Fade markers on the far hemisphere rather than letting them punch through
    // the planet. Depth testing alone makes them pop at the limb.
    _camDir.copy(camera.position).normalize()
    const visible = THREE.MathUtils.smoothstep(normal.dot(_camDir), -0.05, 0.25)

    const scale = (hovered ? 1.45 : 1) * (0.85 + 0.15 * visible)
    _target.set(scale, scale, scale)
    g.scale.lerp(_target, delta * 10)

    for (const child of g.children) {
      const mat = (child as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined
      if (mat && 'opacity' in mat) {
        mat.opacity = ((mat.userData?.base as number) ?? 1) * visible
      }
    }
    g.visible = visible > 0.02
  })

  const color = hovered ? '#C8102E' : '#5FA8D3'

  return (
    <group ref={groupRef} position={position}>
      {/* Outer halo — soft glow without blooming the whole marker */}
      <mesh position={[0, 0, -0.0006]}>
        <circleGeometry args={[size * 2.1, 24]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.1}
          userData={{ base: 0.1 }}
          depthWrite={false}
        />
      </mesh>

      {/* Filled core — presence, and the click/hover target */}
      <mesh
        onClick={onClick}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
      >
        <circleGeometry args={[size, 24]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.5}
          userData={{ base: 0.5 }}
          depthWrite={false}
        />
      </mesh>

      {/* Bright edge — keeps the shape legible over bright desert and dark ocean */}
      <mesh position={[0, 0, 0.0006]}>
        <ringGeometry args={[size * 0.96, size * 1.16, 32]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.95}
          userData={{ base: 0.95 }}
          depthWrite={false}
        />
      </mesh>

      {hovered && (
        <Html position={[0, size * 3, 0]} center style={{ pointerEvents: 'none' }}>
          <div className="bg-surface/95 border border-border rounded px-2 py-1 whitespace-nowrap backdrop-blur-sm">
            <div className="text-[10px] font-mono text-foreground">{name}</div>
            <div className="text-[9px] font-mono text-muted">{count} entities</div>
          </div>
        </Html>
      )}
    </group>
  )
}
