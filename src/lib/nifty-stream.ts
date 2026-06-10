// SSE streaming is now handled by EC2 server
// This file is kept as a stub to prevent build errors

type NiftyCallback = (price: number, timestamp: string) => void;

class NiftyStreamer {
    public subscribe(callback: NiftyCallback) {
        // No-op - SSE is deprecated, EC2 polling is used instead
        console.warn('[NiftyStream] SSE is deprecated. Using EC2 polling instead.');
        return () => { };
    }
}

export const niftyStreamer = new NiftyStreamer();
