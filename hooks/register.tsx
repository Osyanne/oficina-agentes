import { atom, read, update } from 'claude-code'
import type { Color, Register, StateDollar } from 'claude-code'

import type { Activity, Agent, Call, Office } from '../types'

const MAIN = 'main'
const CHARACTERS = ['🧑‍💼', '👩‍💻', '🧑‍🔬', '👨‍🔧', '🧑‍🎨', '👩‍🚀', '🕵️', '🧙']

const agents = atom({ plugin: 'oficina-agentes', key: 'agents' } as const, {} as Office)
const isHidden = atom({ plugin: 'oficina-agentes', key: 'isHidden' } as const, false)

const keyOf = (agentId: string | undefined) => agentId ?? MAIN

const shorten = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text

function newAgent(office: Office, id: string, name?: string): Agent {
  const isMain = id === MAIN
  const coworkers = Object.values(office).filter(agent => !agent.isMain).length

  return {
    id,
    name: name ?? (isMain ? 'Claude' : `agente ${id.slice(0, 6)}`),
    isMain,
    seat: isMain ? 0 : coworkers + 1,
    activity: 'thinking',
    calls: [],
  }
}

// Cambia un agente; si aún no está en la oficina, entra con un nombre provisional.
const patch = (id: string, change: (agent: Agent) => Partial<Agent>) => (office: Office): Office => {
  const agent = office[id] ?? newAgent(office, id)

  return { ...office, [id]: { ...agent, ...change(agent) } }
}

const dropFinished = (office: Office): Office =>
  Object.fromEntries(
    Object.entries(office).filter(
      ([, agent]) => agent.isMain || (agent.activity !== 'done' && agent.activity !== 'failed'),
    ),
  )

// Un hook que observa no debe romper nunca la llamada que observa.
async function edit($: StateDollar, change: (office: Office) => Office) {
  try {
    await update($, agents, change)
  } catch {
    // El dibujo se queda como estaba; la sesión sigue.
  }
}

function detailOf(args: Record<string, unknown>): string | null {
  const text = (name: string) => (typeof args[name] === 'string' ? (args[name] as string) : undefined)
  const path = text('file_path') ?? text('notebook_path') ?? text('path')
  if (path !== undefined) return path.split(/[\\/]/).pop() ?? path
  const url = text('url')
  if (url !== undefined) return url.replace(/^https?:\/\//, '').split('/')[0] ?? url
  const said = text('description') ?? text('command') ?? text('pattern') ?? text('query')
  return said === undefined ? null : shorten(said.replace(/\s+/g, ' ').trim(), 40)
}

function toolLabel(tool: string): string {
  if (/^(Read|Glob|Grep|LS)$/.test(tool)) return '📖 leyendo'
  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(tool)) return '✏️ escribiendo'
  if (/^(Bash|PowerShell)$/.test(tool)) return '⌨️ en la terminal'
  if (/^(WebSearch|WebFetch)$/.test(tool)) return '🌐 buscando en la web'
  if (tool === 'Agent' || tool === 'Task') return '📣 delegando'
  if (tool.startsWith('mcp__')) return `🔌 ${tool.split('__')[1] ?? 'mcp'}`
  return `🔧 ${tool}`
}

const RESTING: Record<Activity, string> = {
  idle: '☕ esperando tu mensaje',
  thinking: '💭 pensando',
  done: '✅ terminado',
  failed: '❌ no terminó',
}

const COLORS: Record<Activity, Color> = {
  idle: 'subtle',
  thinking: 'claude',
  done: 'success',
  failed: 'error',
}

// Lo que se ve de un agente: su llamada más reciente en curso, o su estado.
function look(agent: Agent): { label: string; color: Color; detail: string | null } {
  const call = agent.calls.at(-1)

  if (call === undefined) {
    return { label: RESTING[agent.activity], color: COLORS[agent.activity], detail: null }
  }

  const others = agent.calls.length > 1 ? ` (+${agent.calls.length - 1})` : ''

  return call.isWaiting
    ? { label: `✋ esperando tu permiso · ${call.tool}${others}`, color: 'permission', detail: call.detail }
    : { label: `${toolLabel(call.tool)}${others}`, color: 'suggestion', detail: call.detail }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // Una recarga en caliente vuelve a pasar por aquí: la oficina que ya hay se queda.
    await edit($, office =>
      office[MAIN] !== undefined ? office : { ...office, [MAIN]: { ...newAgent(office, MAIN), activity: 'idle' } },
    )

    try {
      await $.command.register({
        name: 'oficina',
        description: 'Muestra u oculta la oficina de agentes encima del prompt.',
      })
    } catch {
      // Sin comando la banda sigue funcionando.
    }

    return next(e)
  })

  on('command.run', { command: 'oficina' }, async $ => {
    const hidden = await update($, isHidden, value => !value)

    return { text: hidden ? 'Oficina oculta. /oficina la vuelve a mostrar.' : 'Oficina visible.' }
  })

  on('turn.start', async ($, e, next) => {
    const id = keyOf(e.agentId)
    await edit($, office =>
      patch(id, () => ({ activity: 'thinking', calls: [] }))(id === MAIN ? dropFinished(office) : office),
    )

    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)
    const agentId = spawned.agentId

    if (agentId !== undefined) {
      const name = shorten(e.name || e.description || e.subagentType, 28)
      // Si el subagente ya actuó antes de volver aquí, conserva lo que hace y solo recibe su nombre.
      await edit($, patch(agentId, () => ({ name })))
    }

    return spawned
  })

  on('tool.call', async ($, e, next) => {
    const id = keyOf(e.agentId)
    const call: Call = {
      id: e.tool_use_id,
      tool: String(e.tool),
      detail: detailOf(e as unknown as Record<string, unknown>),
      isWaiting: false,
    }
    // Quien llama a una herramienta está trabajando: al acabar, vuelve a pensar.
    await edit($, patch(id, agent => ({ activity: 'thinking', calls: [...agent.calls, call] })))

    try {
      return await next(e)
    } finally {
      await edit($, office =>
        office[id] === undefined
          ? office
          : patch(id, agent => ({ calls: agent.calls.filter(running => running.id !== call.id) }))(office),
      )
    }
  })

  on('classic.PermissionRequest', async ($, e, next) => {
    const id = keyOf(e.agent_id)
    await edit($, office => {
      const calls = office[id]?.calls ?? []
      const asking = calls.findLastIndex(running => running.tool === e.tool_name && !running.isWaiting)

      return asking === -1
        ? office
        : patch(id, () => ({
            calls: calls.map((running, index) => (index === asking ? { ...running, isWaiting: true } : running)),
          }))(office)
    })

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const id = keyOf(e.agentId)
    const activity: Activity = id === MAIN ? 'idle' : e.reason === 'answer' ? 'done' : 'failed'
    await edit($, patch(id, () => ({ activity, calls: [] })))

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, isHidden))) {
      return next(e)
    }

    const crew = Object.values(await read($, agents)).sort((a, b) => a.seat - b.seat)
    const hasCoworkers = crew.some(agent => !agent.isMain)

    if (!e.props.isWorking && !hasCoworkers) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)
    const room = Math.max(1, e.props.maxRows - 1)
    const shown = crew.length > room ? crew.slice(0, room - 1) : crew
    const rest = crew.length - shown.length

    return (
      <Box flexDirection="column">
        <Text dimColor>🏢 Oficina · {crew.length === 1 ? '1 agente' : `${crew.length} agentes`}</Text>
        {shown.map(agent => {
          const { label, color, detail } = look(agent)

          return (
            <Box key={`agente-${agent.id}`} gap={1}>
              <Text>{CHARACTERS[agent.seat % CHARACTERS.length]}</Text>
              <Text bold wrap="truncate">
                {agent.name}
              </Text>
              <Text color={color}>{label}</Text>
              {detail !== null ? (
                <Text dimColor wrap="truncate">
                  {detail}
                </Text>
              ) : null}
            </Box>
          )
        })}
        {rest > 0 ? <Text dimColor>+{rest} más</Text> : null}
      </Box>
    )
  })
}
