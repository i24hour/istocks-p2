import React from 'react'

interface LoaderProps {
  size?: number
}

// Simple green thin spinner
export default function Loader({ size = 40 }: LoaderProps) {
  return (
    <div
      aria-label="Loading"
      role="status"
      className="inline-block animate-spin rounded-full border-2 border-emerald-500 border-t-transparent"
      style={{ width: size, height: size }}
    >
      <span className="sr-only">Loading...</span>
    </div>
  )
}
