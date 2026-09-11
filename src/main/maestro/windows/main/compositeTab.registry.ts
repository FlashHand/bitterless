import type { MaestroCompositeTabSpec } from '@maestro-shared/compositeTab.api'

/**
 * The composite mini apps this Maestro build can host in a tab.
 *
 * Empty until a host registers something, which is the whole point: Maestro carries a native view
 * in a tab without knowing what is inside it, so nothing here imports a mini app and the alias
 * boundary stays intact.
 */
const specs = new Map<string, MaestroCompositeTabSpec>()

export const registerMaestroCompositeTab = (spec: MaestroCompositeTabSpec): void => {
  specs.set(spec.id, spec)
}

export const getMaestroCompositeTab = (id: string): MaestroCompositeTabSpec | null =>
  specs.get(id) ?? null

/**
 * Every registered composite mini app, in registration order.
 *
 * The new-tab menu is built from this rather than a hand-written list: "which mini apps can a tab
 * hold" is one fact, and a hand-written copy of it goes stale the first time a mini app is added.
 */
export const listMaestroCompositeTabs = (): MaestroCompositeTabSpec[] => [...specs.values()]
