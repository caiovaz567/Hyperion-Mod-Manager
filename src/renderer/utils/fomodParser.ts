import type {
  FomodModuleConfig,
  FomodStep,
  FomodGroup,
  FomodPlugin,
  FomodFileEntry,
  FomodConditionalInstall,
  FomodGroupType,
  FomodPluginType,
} from '@shared/types'

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Helpers that perform case-insensitive / namespace-agnostic element lookups.
function elementsByLocalName(root: Document | Element, name: string): Element[] {
  const lower = name.toLowerCase()
  const nodes = Array.from(root.getElementsByTagName('*'))
  return nodes.filter((n) => {
    const local = (n as Element).localName || n.tagName
    return (local ?? '').toLowerCase() === lower
  }) as Element[]
}

function firstElementByLocalName(root: Document | Element, name: string): Element | null {
  return elementsByLocalName(root, name)[0] ?? null
}

function childText(el: Element | null, tagName: string): string {
  if (!el) return ''
  const node = firstElementByLocalName(el, tagName)
  return node?.textContent?.trim() ?? ''
}

function parseFiles(container: Element | null): FomodFileEntry[] {
  if (!container) return []
  const entries: FomodFileEntry[] = []
  const fileNodes = Array.from(container.getElementsByTagName('*')).filter((n) => {
    const local = (n as Element).localName || n.tagName
    const tag = (local ?? '').toLowerCase()
    return tag === 'file' || tag === 'folder'
  }) as Element[]

  for (const node of fileNodes) {
    const source = node.getAttribute('source') ?? ''
    const destination = node.getAttribute('destination') ?? ''
    if (!source) continue
    const tag = ((node.localName || node.tagName) as string).toLowerCase()
    if (tag === 'folder') entries.push({ source, destination, type: 'folder' })
    else entries.push({ source, destination, type: 'file' })
  }

  return entries
}

const VALID_PLUGIN_TYPES: FomodPluginType[] = ['Optional', 'Required', 'Recommended', 'NotUsable', 'CouldBeUsable']

function parsePluginType(plugin: Element): FomodPluginType {
  const typeEl = firstElementByLocalName(plugin, 'type')
  const name = typeEl?.getAttribute('name') ?? 'Optional'
  return VALID_PLUGIN_TYPES.includes(name as FomodPluginType) ? (name as FomodPluginType) : 'Optional'
}

function parsePlugin(el: Element): FomodPlugin {
  const name = el.getAttribute('name') ?? 'Unknown'
  const description = childText(el, 'description')
  const image = firstElementByLocalName(el, 'image')?.getAttribute('path') ?? undefined
  const files = parseFiles(firstElementByLocalName(el, 'files'))
  const conditionFlags: Array<{ name: string; value: string }> = []

  const flagElements = elementsByLocalName(el, 'flag')
  for (const flag of flagElements) {
    const flagName = flag.getAttribute('name') ?? ''
    if (flagName) conditionFlags.push({ name: flagName, value: flag.textContent?.trim() ?? '' })
  }

  return { name, description, image, files, conditionFlags, typeDescriptor: parsePluginType(el) }
}

const VALID_GROUP_TYPES: FomodGroupType[] = [
  'SelectExactlyOne', 'SelectAtMostOne', 'SelectAll', 'SelectAny', 'SelectAllAndMore',
]

function parseGroup(el: Element): FomodGroup {
  const name = el.getAttribute('name') ?? 'Options'
  const rawType = el.getAttribute('type') ?? 'SelectExactlyOne'
  const type: FomodGroupType = VALID_GROUP_TYPES.includes(rawType as FomodGroupType)
    ? (rawType as FomodGroupType)
    : 'SelectExactlyOne'
  const plugins = elementsByLocalName(el, 'plugin').map(parsePlugin)
  return { name, type, plugins }
}

function parseStep(el: Element): FomodStep {
  const name = el.getAttribute('name') ?? 'Installation Options'
  const groups = elementsByLocalName(el, 'group').map(parseGroup).filter((g) => g.plugins.length > 0)

  const visibleEl = firstElementByLocalName(el, 'visible')
  const rawConditions = visibleEl
    ? elementsByLocalName(visibleEl, 'flagdependency')
        .map((dep) => ({ flag: dep.getAttribute('flag') ?? '', value: dep.getAttribute('value') ?? '' }))
        .filter((d) => d.flag)
    : undefined
  const visibleConditions = rawConditions?.length ? rawConditions : undefined

  return { name, groups, visibleConditions }
}

function parseConditionalInstalls(doc: Document): FomodConditionalInstall[] {
  const patterns = elementsByLocalName(doc, 'pattern')
  return patterns
    .map((pattern) => {
      const dependencies = elementsByLocalName(pattern, 'flagdependency')
        .map((dep) => ({ flag: dep.getAttribute('flag') ?? '', value: dep.getAttribute('value') ?? '' }))
        .filter((d) => d.flag)
      const files = parseFiles(firstElementByLocalName(pattern, 'files'))
      return { dependencies, files }
    })
    .filter((c) => c.files.length > 0)
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function parseFomodXml(xml: string): FomodModuleConfig {
  // Strip BOM that may survive encoding detection
  const cleanXml = xml.charCodeAt(0) === 0xFEFF ? xml.slice(1) : xml

  let doc: Document = new DOMParser().parseFromString(cleanXml, 'text/xml')

  // If XML parsing failed (returns a <parsererror> document), fall back to
  // lenient HTML parsing — it ignores malformed declarations and handles
  // common FOMOD quirks.
  if (doc.getElementsByTagName('parsererror').length > 0) {
    doc = new DOMParser().parseFromString(cleanXml, 'text/html')
  }

  const moduleName = firstElementByLocalName(doc, 'moduleName')?.textContent?.trim() || 'Mod Installation'
  const moduleImage = firstElementByLocalName(doc, 'moduleImage')?.getAttribute('path') ?? undefined
  const requiredFiles = parseFiles(firstElementByLocalName(doc, 'requiredInstallFiles'))
  const steps = elementsByLocalName(doc, 'installstep').map(parseStep).filter((s) => s.groups.length > 0)
  const conditionalInstalls = parseConditionalInstalls(doc)
  return { moduleName, moduleImage, steps, requiredFiles, conditionalInstalls }
}

/** Build the initial selection map for all groups.
 *  Key: `${stepIdx}:${groupIdx}` → Set of selected plugin indices. */
export function buildInitialSelections(config: FomodModuleConfig): Map<string, Set<number>> {
  const selections = new Map<string, Set<number>>()
  config.steps.forEach((step, si) => {
    step.groups.forEach((group, gi) => {
      const key = `${si}:${gi}`
      const set = new Set<number>()
      if (group.type === 'SelectAll' || group.type === 'SelectAllAndMore') {
        group.plugins.forEach((_, idx) => set.add(idx))
      } else if (group.type === 'SelectExactlyOne') {
        // First Recommended, then Required, then first Optional
        const rec = group.plugins.findIndex((p) => p.typeDescriptor === 'Recommended')
        const req = group.plugins.findIndex((p) => p.typeDescriptor === 'Required')
        const opt = group.plugins.findIndex((p) => p.typeDescriptor !== 'NotUsable')
        const pick = rec >= 0 ? rec : req >= 0 ? req : opt
        if (pick >= 0) set.add(pick)
      } else if (group.type === 'SelectAtMostOne') {
        const rec = group.plugins.findIndex((p) => p.typeDescriptor === 'Recommended')
        if (rec >= 0) set.add(rec)
      } else {
        // SelectAny — select all Required and Recommended
        group.plugins.forEach((p, idx) => {
          if (p.typeDescriptor === 'Required' || p.typeDescriptor === 'Recommended') set.add(idx)
        })
      }
      selections.set(key, set)
    })
  })
  return selections
}

/** Resolve which FomodFileEntries to install given the user's selections. */
export function resolveInstallEntries(
  config: FomodModuleConfig,
  selections: Map<string, Set<number>>
): FomodFileEntry[] {
  const entries: FomodFileEntry[] = [...config.requiredFiles]
  const activeFlags = new Map<string, string>()

  config.steps.forEach((step, si) => {
    step.groups.forEach((group, gi) => {
      const key = `${si}:${gi}`
      let effective: Set<number>
      if (group.type === 'SelectAll' || group.type === 'SelectAllAndMore') {
        effective = new Set(group.plugins.map((_, i) => i))
      } else {
        effective = selections.get(key) ?? new Set()
      }
      for (const idx of effective) {
        const plugin = group.plugins[idx]
        if (!plugin) continue
        entries.push(...plugin.files)
        for (const flag of plugin.conditionFlags ?? []) activeFlags.set(flag.name, flag.value)
      }
    })
  })

  for (const cond of config.conditionalInstalls) {
    if (cond.dependencies.every((d) => activeFlags.get(d.flag) === d.value)) {
      entries.push(...cond.files)
    }
  }

  // Deduplicate
  const seen = new Set<string>()
  return entries.filter((e) => {
    const k = `${e.type}:${e.source}:${e.destination}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/**
 * Computes which step indices (into config.steps) are visible given the current
 * selections. Step visibility is evaluated iteratively: condition flags set by
 * selected plugins in visible steps accumulate and gate subsequent steps.
 */
export function computeVisibleSteps(
  config: FomodModuleConfig,
  selections: Map<string, Set<number>>
): number[] {
  const visibleSteps: number[] = []
  const activeFlags = new Map<string, string>()

  for (let si = 0; si < config.steps.length; si++) {
    const step = config.steps[si]

    if (step.visibleConditions?.length) {
      const visible = step.visibleConditions.every((c) => activeFlags.get(c.flag) === c.value)
      if (!visible) continue
    }

    visibleSteps.push(si)

    step.groups.forEach((group, gi) => {
      const key = `${si}:${gi}`
      let effective: Set<number>
      if (group.type === 'SelectAll' || group.type === 'SelectAllAndMore') {
        effective = new Set(group.plugins.map((_, i) => i))
      } else {
        effective = selections.get(key) ?? new Set()
      }
      for (const idx of effective) {
        const plugin = group.plugins[idx]
        for (const flag of plugin?.conditionFlags ?? []) {
          activeFlags.set(flag.name, flag.value)
        }
      }
    })
  }

  return visibleSteps
}

/** Returns the absolute filesystem path for a FOMOD image, used by the
 *  renderer to load it via the FOMOD_READ_IMAGE IPC channel. */
export function fomodImageUrl(extractRoot: string, imagePath: string): string {
  const normalized = extractRoot.replace(/\\/g, '/').replace(/\/$/, '')
  const img = imagePath.replace(/\\/g, '/').replace(/^\//, '')
  return `${normalized}/${img}`
}
