export type Activity = 'idle' | 'thinking' | 'done' | 'failed'

export type Call = {
  id: string
  tool: string
  detail: string | null
  isWaiting: boolean
}

export type Agent = {
  id: string
  name: string
  isMain: boolean
  seat: number
  activity: Activity
  calls: Call[]
}

export type Office = Record<string, Agent>

declare module 'claude-code' {
  interface PluginState {
    'oficina-agentes': { agents: Office; isHidden: boolean }
  }
}
