import type { LucideIcon } from 'lucide-react'
import { LineChart, Briefcase, Bot, FlaskConical, PieChart, CreditCard, Info } from 'lucide-react'

export type AppNavItem = {
  name: string
  url: string
  icon: LucideIcon
  badge?: string
}

/** Primary app routes shown in the header nav and Trading Agent sidebar. */
export const APP_NAV_ITEMS: AppNavItem[] = [
  { name: 'Stocks', url: '/stocks', icon: LineChart },
  { name: 'Sangraha', url: '/sangraha', icon: Briefcase, badge: 'NEW' },
  { name: 'Trading Agent', url: '/database-chat', icon: Bot },
  { name: 'Experts', url: '/experts', icon: FlaskConical },
  { name: 'Holding', url: '/holdings', icon: PieChart },
  { name: 'Pricing', url: '/pricing', icon: CreditCard },
  { name: 'About', url: '/about', icon: Info },
]
