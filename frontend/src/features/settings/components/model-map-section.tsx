import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  AGENT_ROLE_LABELS,
  CURATED_TEXT_MODELS,
  resolveModel,
  SYSTEM_DEFAULT_MODEL_MAP,
  type AgentRole,
} from '../model-routing'

interface Props {
  modelMap: Record<string, string>
  onChange: (modelMap: Record<string, string>) => void
}

const AGENT_ROLES = Object.keys(SYSTEM_DEFAULT_MODEL_MAP) as AgentRole[]

export function ModelMapSection({ modelMap, onChange }: Props) {
  const setRoleModel = (role: AgentRole, model: string) => {
    onChange({ ...modelMap, [role]: model })
  }

  const resetToDefaults = () => onChange({})

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">Model map</h2>
        <Button type="button" variant="outline" size="sm" onClick={resetToDefaults}>
          Reset to defaults
        </Button>
      </div>
      <div className="flex flex-col gap-3">
        {AGENT_ROLES.map((role) => (
          <div key={role} className="flex items-center justify-between gap-4">
            <Label className="flex-1">{AGENT_ROLE_LABELS[role]}</Label>
            <Select value={resolveModel(role, modelMap)} onValueChange={(value) => setRoleModel(role, value as string)}>
              <SelectTrigger className="w-64">
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
        ))}
      </div>
    </section>
  )
}
