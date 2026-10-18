import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const SURFACES = ['terminal', 'desktop'] as const

const bandProps = (isWorking: boolean) => ({
  hasSurvey: false,
  isWorking,
  maxRows: 6,
  bodyColumns: 100,
  scroll: { offset: 0, bodyRows: 6 },
  view: {},
})

async function rowText($: Engine, surface: (typeof SURFACES)[number], agentId: string, isWorking = true) {
  const ui = await $.ui.mount({
    plugin: 'oficina-agentes',
    surface,
    component: 'AbovePrompt',
    props: bandProps(isWorking),
  })
  const row = await ui.find({ key: `agente-${agentId}` })
  await ui.unmount()

  return row?.text
}

function engineBottom(on: On) {
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'sub-1' }))
}

const SPAWN = {
  tool_use_id: 'toolu_spawn',
  prompt: 'busca los tests',
  description: 'Explorador de tests',
  subagentType: 'Explore',
  provider: { plugin: 'engine', tier: 'core' },
  parentModel: 'claude-opus-5-5',
  background: false,
  fork: false,
} as const

const startSession = ($: Engine) => $.session.start({ cwd: '/proyecto', surface: 'terminal', isInteractive: true })

test('el jefe sale leyendo mientras corre un Read y vuelve a pensar al acabar', async ($, on) => {
  engineBottom(on)
  let reached = () => {}
  let release = () => {}
  const atTool = new Promise<void>(resolve => (reached = resolve))
  const gate = new Promise<void>(resolve => (release = resolve))
  on('tool.call', async () => {
    reached()
    await gate

    return { result: 'contenido' } as never
  })

  await startSession($)
  const call = $.tool.call({ tool: 'Read', file_path: 'C:/proyecto/notas.md' })
  await atTool

  for (const surface of SURFACES) {
    const text = await rowText($, surface, 'main')
    expect(text).toContain('leyendo')
    expect(text).toContain('notas.md')
  }

  release()
  await call

  for (const surface of SURFACES) {
    expect(await rowText($, surface, 'main')).toContain('pensando')
  }
})

test('un subagente entra en la oficina, termina y se va con el siguiente mensaje', async ($, on) => {
  engineBottom(on)
  await startSession($)
  await $.agent.spawn(SPAWN)

  for (const surface of SURFACES) {
    const text = await rowText($, surface, 'sub-1', false)
    expect(text).toContain('Explorador de tests')
    expect(text).toContain('pensando')
  }

  await $.turn.complete({
    answer: 'listo',
    durationMs: 10,
    isAborted: false,
    turnId: 't-sub',
    agentId: 'sub-1',
    reason: 'answer',
  })

  for (const surface of SURFACES) {
    expect(await rowText($, surface, 'sub-1', false)).toContain('terminado')
  }

  await $.turn.start({ text: 'otra cosa', turnId: 't-2' })

  for (const surface of SURFACES) {
    expect(await rowText($, surface, 'sub-1')).toBeUndefined()
    expect(await rowText($, surface, 'main')).toContain('pensando')
  }
})

test('con dos herramientas en paralelo, la que acaba primero no esconde la que sigue', async ($, on) => {
  engineBottom(on)
  const release: Record<string, () => void> = {}
  let started = 0
  let bothStarted = () => {}
  const atBoth = new Promise<void>(resolve => (bothStarted = resolve))
  on('tool.call', async (_$, e) => {
    await new Promise<void>(resolve => {
      release[String(e.tool)] = resolve
      started += 1
      if (started === 2) bothStarted()
    })

    return { result: 'ok' } as never
  })

  await startSession($)
  const read = $.tool.call({ tool: 'Read', file_path: 'C:/proyecto/a.md' })
  const grep = $.tool.call({ tool: 'Grep', pattern: 'TODO' })
  await atBoth

  for (const surface of SURFACES) {
    const text = await rowText($, surface, 'main')
    expect(text).toContain('TODO')
    expect(text).toContain('(+1)')
  }

  release.Grep?.()
  await grep

  for (const surface of SURFACES) {
    const text = await rowText($, surface, 'main')
    expect(text).toContain('a.md')
    expect(text).not.toContain('(+1)')
  }

  release.Read?.()
  await read
})

test('una recarga (session.start de nuevo) no vacía la oficina', async ($, on) => {
  engineBottom(on)
  await startSession($)
  await $.agent.spawn(SPAWN)
  await startSession($)

  for (const surface of SURFACES) {
    expect(await rowText($, surface, 'sub-1', false)).toContain('Explorador de tests')
  }
})

test('si el subagente actúa antes de que vuelva agent.spawn, conserva lo que hace', async ($, on) => {
  engineBottom(on)
  let release = () => {}
  const gate = new Promise<void>(resolve => (release = resolve))
  let reached = () => {}
  const atTool = new Promise<void>(resolve => (reached = resolve))
  on('tool.call', async () => {
    reached()
    await gate

    return { result: 'ok' } as never
  })

  await startSession($)
  // El motor pone agentId en las llamadas de un subagente; aquí lo hacemos a mano.
  const fromSubagent = { tool: 'Bash' as const, command: 'npm test', agentId: 'sub-1' }
  const call = $.tool.call(fromSubagent)
  await atTool
  await $.agent.spawn(SPAWN)

  for (const surface of SURFACES) {
    const text = await rowText($, surface, 'sub-1')
    expect(text).toContain('Explorador de tests')
    expect(text).toContain('en la terminal')
  }

  release()
  await call
})

test('sin trabajo ni subagentes la banda deja dibujar al motor', async ($, on) => {
  engineBottom(on)
  on('ui.render', ($, e) => $.ui.resolve(e).Box({ key: 'motor' }))
  await startSession($)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({
      plugin: 'oficina-agentes',
      surface,
      component: 'AbovePrompt',
      props: bandProps(false),
    })
    expect(await ui.find({ key: 'motor' })).toBeDefined()
    expect(await ui.find({ key: 'agente-main' })).toBeUndefined()
    await ui.unmount()
  }
})
