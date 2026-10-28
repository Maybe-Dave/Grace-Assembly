import React from 'react'

export interface GraceAssemblyMarkProps {
  className?: string
  size?: number
  crossColor?: string
  archColor?: string
  alt?: string
}

/**
 * Grace Assembly Official Brand Mark
 * 
 * Thoughtful iconography combining:
 * 1. The Elevated Cross: Grace, redemption, and foundation of faith.
 * 2. The Soaring Sanctuary Arch: Gathering, fellowship, and vaulted cathedral sacred space.
 * 3. The Open Altar Portal: Open threshold of welcome for every person and family.
 */
export default function GraceAssemblyMark({
  className = '',
  size = 22,
  crossColor = '#A8763E',
  archColor = '#1F2A24',
}: GraceAssemblyMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`shrink-0 ${className}`}
      aria-hidden="true"
    >
      {/* Central Grace Cross (Vertical Stem) */}
      <path
        d="M12 2.5V21.5"
        stroke={crossColor}
        strokeWidth="2.2"
        strokeLinecap="round"
      />

      {/* Central Grace Cross (Horizontal Beam) */}
      <path
        d="M7.5 7.5H16.5"
        stroke={crossColor}
        strokeWidth="2.2"
        strokeLinecap="round"
      />

      {/* Cathedral Sanctuary Arch (The Assembly Gathering) */}
      <path
        d="M4.5 21C4.5 13.5 8 6.5 12 5C16 6.5 19.5 13.5 19.5 21"
        stroke={archColor}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Inner Altar Portal / Welcoming Open Doorway */}
      <path
        d="M8.5 21C8.5 16.5 10 13.5 12 13.5C14 13.5 15.5 16.5 15.5 21"
        stroke={crossColor}
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  )
}
