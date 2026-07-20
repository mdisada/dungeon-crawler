import type { LucideIcon } from 'lucide-react'

import { TabsTab } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface SidebarIconTabProps {
  value: string
  label: string
  icon: LucideIcon
}

/** Icon-only sidebar tab: the tooltip carries the label, aria-label keeps it accessible. */
export function SidebarIconTab({ value, label, icon: Icon }: SidebarIconTabProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <TabsTab value={value} aria-label={label}>
            <Icon className="size-4" />
          </TabsTab>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
