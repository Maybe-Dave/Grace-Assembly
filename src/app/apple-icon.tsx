import { ImageResponse } from 'next/og'

export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#FDFBF7',
          borderRadius: '38px',
          border: '3px solid rgba(107, 66, 38, 0.2)',
        }}
      >
        <svg
          width="120"
          height="120"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Cross */}
          <path
            d="M12 2.5V21.5"
            stroke="#A8763E"
            strokeWidth="2.4"
            strokeLinecap="round"
          />
          <path
            d="M7.5 7.5H16.5"
            stroke="#A8763E"
            strokeWidth="2.4"
            strokeLinecap="round"
          />
          {/* Arch */}
          <path
            d="M4.5 21C4.5 13.5 8 6.5 12 5C16 6.5 19.5 13.5 19.5 21"
            stroke="#1F2A24"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* Inner Portal */}
          <path
            d="M8.5 21C8.5 16.5 10 13.5 12 13.5C14 13.5 15.5 16.5 15.5 21"
            stroke="#A8763E"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      </div>
    ),
    { ...size }
  )
}
