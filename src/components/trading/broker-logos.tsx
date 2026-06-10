import { cn } from '@/lib/utils'

type LogoProps = { className?: string }

const BROKER_LOGO_ASSETS = {
  angelOne: { src: '/brokers/angel-one.svg', alt: 'Angel One' },
  dhan: { src: '/brokers/dhan.svg', alt: 'Dhan' },
  groww: { src: '/brokers/groww.png', alt: 'Groww' },
  zerodha: { src: '/brokers/zerodha.svg', alt: 'Zerodha' },
} as const

function BrokerLogoImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  return (
    <div
      className={cn(
        'flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white p-1.5',
        className,
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} className="h-full w-full object-contain" loading="lazy" decoding="async" />
    </div>
  )
}

export function AngelOneLogo({ className }: LogoProps) {
  const { src, alt } = BROKER_LOGO_ASSETS.angelOne
  return <BrokerLogoImage src={src} alt={alt} className={className} />
}

export function DhanLogo({ className }: LogoProps) {
  const { src, alt } = BROKER_LOGO_ASSETS.dhan
  return <BrokerLogoImage src={src} alt={alt} className={className} />
}

export function GrowwLogo({ className }: LogoProps) {
  const { src, alt } = BROKER_LOGO_ASSETS.groww
  return <BrokerLogoImage src={src} alt={alt} className={className} />
}

export function ZerodhaLogo({ className }: LogoProps) {
  const { src, alt } = BROKER_LOGO_ASSETS.zerodha
  return <BrokerLogoImage src={src} alt={alt} className={className} />
}
