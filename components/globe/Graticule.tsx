'use client'

import { useMemo, useEffect, memo } from 'react'
import * as THREE from 'three'
import { latLonToVector3 } from './Globe'

/**
 * Lat/lon graticule.
 *
 * Purely generated — no asset, no fetch. It reads as instrumentation rather
 * than decoration, which is the point: a grid tells a viewer the globe is a
 * coordinate system being measured, not a picture of Earth.
 *
 * The equator and prime meridian are drawn brighter than the rest, because an
 * evenly-weighted grid reads as noise while two emphasized axes read as a
 * reference frame.
 */

const RADIUS = 1.202
/** Degrees between grid lines. 15 gives 24 meridians and 11 parallels. */
const STEP = 15
/** Points per line. 90 keeps curves smooth without meaningful vertex cost. */
const SEGMENTS = 90

function buildGraticule(emphasized: boolean): THREE.BufferGeometry {
  const positions: number[] = []

  const push = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const a = latLonToVector3(lat1, lon1, RADIUS)
    const b = latLonToVector3(lat2, lon2, RADIUS)
    positions.push(a[0], a[1], a[2], b[0], b[1], b[2])
  }

  // Meridians (constant longitude), stopping short of the poles where they converge.
  for (let lon = -180; lon < 180; lon += STEP) {
    const isPrime = lon === 0
    if (isPrime !== emphasized) continue
    for (let i = 0; i < SEGMENTS; i++) {
      const lat1 = -90 + (180 * i) / SEGMENTS
      const lat2 = -90 + (180 * (i + 1)) / SEGMENTS
      push(lat1, lon, lat2, lon)
    }
  }

  // Parallels (constant latitude).
  for (let lat = -75; lat <= 75; lat += STEP) {
    const isEquator = lat === 0
    if (isEquator !== emphasized) continue
    for (let i = 0; i < SEGMENTS; i++) {
      const lon1 = -180 + (360 * i) / SEGMENTS
      const lon2 = -180 + (360 * (i + 1)) / SEGMENTS
      push(lat, lon1, lat, lon2)
    }
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  return geo
}

const Graticule = memo(function Graticule({
  color = '#3d7ab8',
  opacity = 0.12,
}: {
  color?: string
  opacity?: number
}) {
  const [minor, major] = useMemo(() => [buildGraticule(false), buildGraticule(true)], [])

  const [minorMat, majorMat] = useMemo(
    () => [
      new THREE.LineBasicMaterial({
        color: new THREE.Color(color),
        transparent: true,
        opacity,
        depthWrite: false,
      }),
      new THREE.LineBasicMaterial({
        color: new THREE.Color(color),
        transparent: true,
        opacity: Math.min(1, opacity * 2.6),
        depthWrite: false,
      }),
    ],
    [color, opacity]
  )

  useEffect(() => {
    return () => {
      minor.dispose()
      major.dispose()
      minorMat.dispose()
      majorMat.dispose()
    }
  }, [minor, major, minorMat, majorMat])

  return (
    <>
      <lineSegments geometry={minor} material={minorMat} renderOrder={1} />
      <lineSegments geometry={major} material={majorMat} renderOrder={1} />
    </>
  )
})

export default Graticule
