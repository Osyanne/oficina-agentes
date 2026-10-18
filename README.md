# oficina-agentes

Prototipo de mod de Claude Code (2.1.299+). Encima del prompt muestra una "oficina" con cada agente de la sesión como un personaje y lo que está haciendo en ese momento:

```
🏢 Oficina · 3 agentes
🧑‍💼 Claude              📣 delegando  Revisa los tests
👩‍💻 Explorador de tests  📖 leyendo    oficina.test.ts
🧑‍🔬 Revisor             ✅ terminado
```

- **Claude (el jefe)** es el bucle principal; cada subagente entra con su nombre o descripción.
- Estados: 💭 pensando · 📖 leyendo · ✏️ escribiendo · ⌨️ en la terminal · 🌐 buscando en la web · 📣 delegando · 🔌 MCP · ✋ esperando tu permiso · ✅ terminado · ❌ no terminó · ☕ esperando tu mensaje.
- La banda solo aparece mientras Claude trabaja o hay subagentes. Los terminados se van con tu siguiente mensaje.
- `/oficina` la oculta o la vuelve a mostrar.

## Instalación

Necesita Claude Code 2.1.299 o posterior.

En el prompt de una sesión de terminal:

```
/plugin install oficina-agentes --marketplace Osyanne/oficina-agentes
```

Responde `y` para añadir el marketplace y elige un ámbito (el de usuario es el primero).

Desde una shell:

```bash
claude plugin install oficina-agentes --marketplace Osyanne/oficina-agentes
```

En la app de escritorio, donde `/plugin` no funciona: pulsa **+** junto al cuadro del prompt → **Plugins** → **Add marketplace** con `Osyanne/oficina-agentes` → **Add plugin**.

## Estructura

| Archivo | Qué es |
| --- | --- |
| `.claude-plugin/plugin.json` | Manifiesto del mod |
| `hooks/hooks.json` | Apunta al módulo de hooks |
| `hooks/register.tsx` | Los hooks: `tool.call`, `agent.spawn`, `turn.start`, `turn.complete`, `classic.PermissionRequest` y el dibujo `ui.render` de `AbovePrompt` |
| `types/index.d.ts` | Contrato del estado (`$.state`) |
| `tests/oficina.test.ts` | Tests en terminal y escritorio |

## Comprobarlo

Con Claude Code 2.1.299 o posterior (las versiones anteriores no conocen las funciones de estado y rechazan el módulo):

```bash
claude plugin validate .
```

```bash
claude plugin test .
```

## Limitaciones conocidas

- "✋ esperando tu permiso" se mantiene hasta que la herramienta termina: no hay un evento que avise de cuándo respondiste.
- Es texto con emojis, no pixel art. La fase 2 sería dibujar la oficina con `Svg` en el escritorio.
