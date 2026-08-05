'use client'

import { useEffect, useState, useMemo, memo } from 'react'
import * as THREE from 'three'
import { latLonToVector3 } from './Globe'

/**
 * Administrative borders drawn as vector linework over the imagery.
 *
 * This is the single thing that separates a cartographic globe from a textured
 * ball: crisp boundaries that stay sharp at any zoom, rather than coastlines
 * baked into a JPEG that blur as you approach. Natural Earth 110m, public
 * domain, slimmed to 149KB by dropping interior rings and rounding coordinates
 * to two decimals — about 1km at the equator, well under a pixel at this scale.
 *
 * Rendered slightly above the surface so the lines never z-fight with the
 * sphere, and drawn as one merged LineSegments so 287 rings cost one draw call
 * rather than 287.
 */

const BORDER_RADIUS = 1.203 // sphere is 1.2; sit just proud of it

interface BorderData {
  rings: Array<Array<[number, number]>>
}

const CountryBorders = memo(function CountryBorders({
  color = '#4a9eff',
  opacity = 0.28,
}: {
  color?: string
  opacity?: number
}) {
  const [data, setData] = useState<BorderData | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/geo/borders.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        // Borders are decoration: a failed fetch must leave the globe intact.
        if (!cancelled && d?.rings) setData(d)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const geometry = useMemo(() => {
    if (!data) return null
    const positions: number[] = []

    for (const ring of data.rings) {
      for (let i = 0; i < ring.length; i++) {
        // Close the loop by wrapping the last segment back to the first point.
        const [lon1, lat1] = ring[i]
        const [lon2, lat2] = ring[(i + 1) % ring.length]

        // Natural Earth stores [lon, lat]; our projection takes (lat, lon).
        const a = latLonToVector3(lat1, lon1, BORDER_RADIUS)
        const b = latLonToVector3(lat2, lon2, BORDER_RADIUS)

        // A segment spanning the antimeridian would otherwise draw a chord
        // straight through the planet.
        if (Math.abs(lon2 - lon1) > 180) continue

        positions.push(a[0], a[1], a[2], b[0], b[1], b[2])
      }
    }

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    return geo
  }, [data])

  const material = useMemo(
    () =>
      new THREE.LineBasicMaterial({
        color: new THREE.Color(color),
        transparent: true,
        opacity,
        // Lines on the far side of the globe would otherwise show through.
        depthWrite: false,
      }),
    [color, opacity]
  )

  useEffect(() => {
    return () => {
      geometry?.dispose()
      material.dispose()
    }
  }, [geometry, material])

  if (!geometry) return null
  return <lineSegments geometry={geometry} material={material} renderOrder={1} />
})

export default CountryBorders
