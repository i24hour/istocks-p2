import { NextRequest, NextResponse } from 'next/server';
import { niftyStreamer } from '@/lib/nifty-stream';

// Prevent Vercel from caching this route
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs'; // WebSocket requries Node.js runtime, not Edge

export async function GET(req: NextRequest) {
    const encoder = new TextEncoder();

    const customReadable = new ReadableStream({
        start(controller) {
            console.log('🔌 [SSE] Client connected to Nifty Stream');

            // Send initial connection message
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'connected' })}\n\n`));

            // Callback to push data to client
            const onTick = (price: number, timestamp: string) => {
                const data = JSON.stringify({ price, timestamp });
                try {
                    controller.enqueue(encoder.encode(`data: ${data}\n\n`));
                } catch (e) {
                    // If controller is closed, unsubscribe handled by cleanup mostly/
                    console.error('SSE Error:', e);
                }
            };

            // Subscribe to streamer
            const unsubscribe = niftyStreamer.subscribe(onTick);

            // Handle stream close (connection drop)
            // Note: In Next.js App Router, detecting close inside ReadableStream is tricky but garbage collection helps.
            // We rely on the client closing connection or Vercel timeout (max duration).

            // Cleanup function when stream is cancelled
            req.signal.addEventListener('abort', () => {
                console.log('🔌 [SSE] Client disconnected');
                unsubscribe();
            });
        }
    });

    return new NextResponse(customReadable, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
        },
    });
}
