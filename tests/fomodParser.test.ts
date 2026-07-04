// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'

// fomodParser routes fallback labels through i18n; the store-backed translator
// would drag the whole renderer store into the test, so stub it to echo keys.
vi.mock('../src/renderer/i18n/translate', () => ({
  translate: (key: string) => key,
  translateN: (key: string) => key,
}))

import {
  buildInitialSelections,
  computeVisibleSteps,
  parseFomodXml,
  resolveInstallEntries,
} from '../src/renderer/utils/fomodParser'

const FULL_MODULE = `<?xml version="1.0" encoding="utf-16"?>
<config xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <moduleName>Cool Body Mod</moduleName>
  <moduleImage path="fomod/banner.png" />
  <requiredInstallFiles>
    <folder source="Core" destination="" />
  </requiredInstallFiles>
  <installSteps order="Explicit">
    <installStep name="Body Type">
      <optionalFileGroups>
        <group name="Choose body" type="SelectExactlyOne">
          <plugins order="Explicit">
            <plugin name="Slim">
              <description>Slim body</description>
              <image path="fomod/slim.png" />
              <conditionFlags><flag name="body">slim</flag></conditionFlags>
              <files><folder source="Slim" destination="" /></files>
              <typeDescriptor><type name="Recommended" /></typeDescriptor>
            </plugin>
            <plugin name="Curvy">
              <description>Curvy body</description>
              <files><folder source="Curvy" destination="" /></files>
              <typeDescriptor><type name="Optional" /></typeDescriptor>
            </plugin>
            <plugin name="Broken">
              <description>Unavailable</description>
              <typeDescriptor><type name="NotUsable" /></typeDescriptor>
            </plugin>
          </plugins>
        </group>
        <group name="Extras" type="SelectAny">
          <plugins order="Explicit">
            <plugin name="Tattoos">
              <files><file source="tattoo.archive" destination="archive/pc/mod/tattoo.archive" /></files>
              <typeDescriptor><type name="Required" /></typeDescriptor>
            </plugin>
            <plugin name="Scars">
              <files><file source="scars.archive" destination="archive/pc/mod/scars.archive" /></files>
            </plugin>
          </plugins>
        </group>
      </optionalFileGroups>
    </installStep>
    <installStep name="Slim Options">
      <visible><dependencies><flagDependency flag="body" value="slim" /></dependencies></visible>
      <optionalFileGroups>
        <group name="Texture" type="SelectAll">
          <plugins order="Explicit">
            <plugin name="4K"><files><folder source="Slim4K" destination="" /></files></plugin>
          </plugins>
        </group>
      </optionalFileGroups>
    </installStep>
  </installSteps>
  <conditionalFileInstalls>
    <patterns>
      <pattern>
        <dependencies operator="And"><flagDependency flag="body" value="slim" /></dependencies>
        <files><folder source="SlimPatch" destination="" /></files>
      </pattern>
    </patterns>
  </conditionalFileInstalls>
</config>`

describe('parseFomodXml', () => {
  it('parses module name, image, steps, groups, plugins, flags and conditionals', () => {
    const config = parseFomodXml(FULL_MODULE)

    expect(config.moduleName).toBe('Cool Body Mod')
    expect(config.moduleImage).toBe('fomod/banner.png')
    expect(config.requiredFiles).toEqual([{ source: 'Core', destination: '', type: 'folder' }])

    expect(config.steps).toHaveLength(2)
    const [step1, step2] = config.steps
    expect(step1.name).toBe('Body Type')
    expect(step1.groups.map((group) => group.type)).toEqual(['SelectExactlyOne', 'SelectAny'])
    expect(step1.groups[0].plugins.map((plugin) => plugin.typeDescriptor)).toEqual([
      'Recommended',
      'Optional',
      'NotUsable',
    ])
    expect(step1.groups[0].plugins[0].conditionFlags).toEqual([{ name: 'body', value: 'slim' }])
    expect(step1.groups[0].plugins[0].image).toBe('fomod/slim.png')

    expect(step2.visibleConditions).toEqual([{ flag: 'body', value: 'slim' }])
    expect(config.conditionalInstalls).toHaveLength(1)
    expect(config.conditionalInstalls[0].dependencies).toEqual([{ flag: 'body', value: 'slim' }])
  })

  it('survives malformed XML by falling back to lenient parsing instead of throwing', () => {
    const malformed = '<config><moduleName>Broken & Mod</moduleName><installSteps><installStep name="Step">'
    expect(() => parseFomodXml(malformed)).not.toThrow()
    const config = parseFomodXml(malformed)
    expect(config.moduleName).toContain('Broken')
  })

  it('handles empty and garbage input with safe fallbacks', () => {
    for (const input of ['', 'not xml at all', '<?xml version="1.0"?>']) {
      const config = parseFomodXml(input)
      expect(config.steps).toEqual([])
      expect(config.requiredFiles).toEqual([])
      expect(config.moduleName.length).toBeGreaterThan(0)
    }
  })

  it('strips a BOM and unknown plugin/group types degrade to defaults', () => {
    const xml = '﻿<config><moduleName>BOM Mod</moduleName><installSteps><installStep name="S"><optionalFileGroups><group name="G" type="MadeUpType"><plugins><plugin name="P"><files><file source="a" /></files><typeDescriptor><type name="Nonsense" /></typeDescriptor></plugin></plugins></group></optionalFileGroups></installStep></installSteps></config>'
    const config = parseFomodXml(xml)
    expect(config.moduleName).toBe('BOM Mod')
    expect(config.steps[0].groups[0].type).toBe('SelectExactlyOne')
    expect(config.steps[0].groups[0].plugins[0].typeDescriptor).toBe('Optional')
  })
})

describe('buildInitialSelections', () => {
  it('picks Recommended > Required > first usable for SelectExactlyOne, Required+Recommended for SelectAny', () => {
    const config = parseFomodXml(FULL_MODULE)
    const selections = buildInitialSelections(config)

    // Step 1 group 0 (SelectExactlyOne): "Slim" is Recommended.
    expect([...selections.get('0:0')!]).toEqual([0])
    // Step 1 group 1 (SelectAny): only the Required "Tattoos".
    expect([...selections.get('0:1')!]).toEqual([0])
    // Step 2 group 0 (SelectAll): everything.
    expect([...selections.get('1:0')!]).toEqual([0])
  })
})

describe('resolveInstallEntries', () => {
  it('collects required files, selected plugin files and flag-gated conditionals, deduped', () => {
    const config = parseFomodXml(FULL_MODULE)
    const selections = buildInitialSelections(config)

    const entries = resolveInstallEntries(config, selections)
    const sources = entries.map((entry) => entry.source)

    expect(sources).toContain('Core') // required
    expect(sources).toContain('Slim') // selected radio
    expect(sources).toContain('tattoo.archive') // required checkbox
    expect(sources).toContain('Slim4K') // SelectAll step
    expect(sources).toContain('SlimPatch') // conditional gated on body=slim
    expect(sources).not.toContain('Curvy')
    expect(sources).not.toContain('scars.archive')
    // Dedup: no repeated source/destination pairs.
    expect(new Set(sources).size).toBe(sources.length)
  })

  it('drops conditional files when their flag is not active', () => {
    const config = parseFomodXml(FULL_MODULE)
    const selections = buildInitialSelections(config)
    selections.set('0:0', new Set([1])) // switch to "Curvy" - no body=slim flag

    const sources = resolveInstallEntries(config, selections).map((entry) => entry.source)
    expect(sources).toContain('Curvy')
    expect(sources).not.toContain('SlimPatch')
  })
})

describe('computeVisibleSteps', () => {
  it('gates steps on flags accumulated from earlier visible steps', () => {
    const config = parseFomodXml(FULL_MODULE)
    const selections = buildInitialSelections(config)

    // Slim selected -> body=slim -> step 2 visible.
    expect(computeVisibleSteps(config, selections)).toEqual([0, 1])

    // Curvy selected -> no flag -> step 2 hidden.
    selections.set('0:0', new Set([1]))
    expect(computeVisibleSteps(config, selections)).toEqual([0])
  })
})
