import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ARCHETYPES } from '../constants'

type Props = {
  value: string
  onChange: (archetypeId: string) => void
  disabled?: boolean
}

export function ArchetypePicker({ value, onChange, disabled }: Props) {
  return (
    <Select value={value} onValueChange={(next) => next && onChange(next)} disabled={disabled}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Choose an archetype" />
      </SelectTrigger>
      <SelectContent>
        {ARCHETYPES.map((archetype) => (
          <SelectItem key={archetype.id} value={archetype.id}>
            {archetype.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
