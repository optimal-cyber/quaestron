'use client'

import { useRef, useState, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import { latLonToVector3 } from './Globe'

const _targetScale = new THREE.Vector3()

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
  const meshRef = useRef<THREE.Mesh>(null)
  const [hovered, setHovered] = useState(false)
  const position = useMemo(() => latLonToVector3(lat, lon, 1.22), [lat, lon])
  // Logarithmic scaling so large counts (500+) don't dominate
  const size = 0.012 + Math.log10(Math.max(count, 1)) * 0.008

  useFrame((_, delta) => {
    if (meshRef.current) {
      const scale = hovered ? 1.5 : 1
      _targetScale.set(scale, scale, scale)
      meshRef.current.scale.lerp(_targetScale, delta * 8)
    }
  })

  return (
    <group position={position}>
      <mesh
        ref={meshRef}
        onClick={onClick}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
      >
        <sphereGeometry args={[size, 16, 16]} />
        <meshBasicMaterial
          color={hovered ? '#C8102E' : '#4A7C9B'}
          transparent
          opacity={0.9}
        />
      </mesh>

      {/* Glow ring */}
      <mesh>
        <ringGeometry args={[size * 1.2, size * 1.8, 32]} />
        <meshBasicMaterial
          color="#4A7C9B"
          transparent
          opacity={hovered ? 0.4 : 0.15}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Tooltip on hover */}
      {hovered && (
        <Html
          position={[0, 0.06, 0]}
          center
          style={{ pointerEvents: 'none' }}
        >
          <div className="bg-surface/95 border border-border rounded px-2 py-1 whitespace-nowrap backdrop-blur-sm">
            <div className="text-[12px] font-mono text-foreground">{name}</div>
            <div className="text-[11px] font-mono text-muted">{count} entities</div>
          </div>
        </Html>
      )}
    </group>
  )
}
