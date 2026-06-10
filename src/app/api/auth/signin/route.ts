import { NextResponse } from 'next/server'

// Redirect /api/auth/signin to our custom login page
export async function GET(request: Request) {
  const url = new URL(request.url)
  const callbackUrl = url.searchParams.get('callbackUrl') || '/'
  
  return NextResponse.redirect(
    new URL(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`, url.origin)
  )
}
