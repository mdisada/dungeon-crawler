import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  AGENT_ROLE_LABELS,
  CURATED_TEXT_MODELS,
  expandTiers,
  ROLES_BY_TIER,
  tiersFromMap,
  type ModelTier,
} from '../model-routing'

interface Props {
  modelMap: Record<string, string>
  onChange: (modelMap: Record<string, string>) => void
}

// TWO SEATS, NOT FOURTEEN ROWS. Which tier a role belongs to is an architectural decision, not a
// user preference: every role is either "code validates this" or "nothing downstream can fix
// this", and that assignment was settled by measurement - see the tiering note in
// model-routing.ts and the narrator A/B recorded there. Asking the user to re-make that judgement
// fourteen times mostly invited them to break it once.
//
// What IS worth choosing is which model sits in each seat, because that moves with price and
// availability. So: pick two, and the split applies itself.
const TIER_COPY: Record<ModelTier, { title: string; blurb: string }> = {
  primary: {
    title: 'Primary model',
    blurb: 'Open-ended writing a player reads directly, or that everything downstream inherits. ' +
      'Nothing later can repair a weak answer here.',
  },
  secondary: {
    title: 'Secondary model',
    blurb: 'Work the surrounding code validates - schema-constrained, lint-gated or menu-picking. ' +
      'A cheap model is enough because a wrong answer gets caught.',
  },
}

export function ModelMapSection({ modelMap, onChange }: Props) {
  const { primary, secondary, custom } = tiersFromMap(modelMap)

  const setTier = (tier: ModelTier, model: string) => {
    onChange(expandTiers(tier === 'primary' ? model : primary, tier === 'secondary' ? model : secondary))
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">Model map</h2>
        <Button type="button" variant="outline" size="sm" onClick={() => onChange({})}>
          Reset to defaults
        </Button>
      </div>

      {/* A stored per-role map cannot be shown as two seats. Say so BEFORE a change overwrites it -
          the user cannot recover a setting this screen silently flattened. */}
      {custom && (
        <p className="text-sm text-amber-600 dark:text-amber-500">
          This account has per-role overrides these two choices cannot represent. Changing either
          one replaces them with the standard split.
        </p>
      )}

      <div className="flex flex-col gap-5">
        {(['primary', 'secondary'] as const).map((tier) => (
          <div key={tier} className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor={`model-tier-${tier}`} className="text-base">
                {TIER_COPY[tier].title}
              </Label>
              <Select
                value={tier === 'primary' ? primary : secondary}
                onValueChange={(value) => setTier(tier, value as string)}
              >
                <SelectTrigger id={`model-tier-${tier}`} className="w-64">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CURATED_TEXT_MODELS.map((model) => (
                    <SelectItem key={model} value={model}>
                      {model}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-sm text-muted-foreground">{TIER_COPY[tier].blurb}</p>
            <p className="text-xs text-muted-foreground">
              {ROLES_BY_TIER[tier].map((role) => AGENT_ROLE_LABELS[role]).join(' · ')}
            </p>
          </div>
        ))}
      </div>
    </section>
  )
}
