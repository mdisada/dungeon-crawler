export type Provider = 'openrouter' | 'local'

export interface UserSettings {
  userId: string
  provider: Provider
  modelMap: Record<string, string>
  ttsModel: string
  imageModel: string
  embeddingModel: string
  byokLocalStorage: boolean
  updatedAt: string
}

export type WorkerStatusLevel = 'green' | 'yellow' | 'red'

export interface WorkerStatus {
  lastHeartbeatAt: string | null
}
