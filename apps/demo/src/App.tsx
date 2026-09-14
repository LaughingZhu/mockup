import { useMemo, useRef, useState } from 'react'
import {
  saveMockupState,
  type ImageSource,
  type SurfacePlacement,
  type SurfaceSelection,
} from '@visible-surface-mockup/core'
import { SurfaceMockupEditor, type SurfaceMockupEditorHandle } from '@visible-surface-mockup/react'
import { createBundledProvider, DEMO_DEPTH_MODEL, DEMO_MODEL_LABEL, DEMO_SURFACE_MODEL } from './demo-provider'
import { createLocalModelProvider, LOCAL_MODEL_ENDPOINT } from './local-model-provider'
import { DEMO_COPY, type DemoLocale } from './copy'

const cupSource: ImageSource = {
  id: 'sample-cup',
  src: new URL('./samples/cup.svg', import.meta.url).href,
  width: 960,
  height: 720,
  alt: 'Synthetic studio photograph of a ceramic cup',
}
const labelSource: ImageSource = {
  id: 'sample-label',
  src: new URL('./samples/label.svg', import.meta.url).href,
  width: 720,
  height: 420,
  alt: 'Orange geometric label artwork',
}
const initialPlacement: SurfacePlacement = { x: 0.5, y: 0.53, scale: 1, rotation: 0 }
const DESIGN_DRAG_TYPE = 'application/x-visible-surface-design'

function readFile(file: File, kind: 'base' | 'design'): ImageSource {
  return {
    id: `local-${kind}:${file.name}:${file.size}:${file.lastModified}`,
    src: URL.createObjectURL(file),
    alt: file.name,
  }
}

export function App() {
  const editorRef = useRef<SurfaceMockupEditorHandle>(null)
  const localModelProvider = useMemo(createLocalModelProvider, [])
  const bundledProvider = useMemo(createBundledProvider, [])
  const [mode, setMode] = useState<'local-model' | 'fixture'>('local-model')
  const provider = mode === 'local-model' ? localModelProvider : bundledProvider
  const [base, setBase] = useState<ImageSource>(cupSource)
  const [design, setDesign] = useState<ImageSource | null>(labelSource)
  const [selection, setSelection] = useState<SurfaceSelection | null>(null)
  const [placement, setPlacement] = useState<SurfacePlacement>(initialPlacement)
  const [dragPlacement, setDragPlacement] = useState<SurfacePlacement | null>(null)
  const [draggingDesign, setDraggingDesign] = useState(false)
  const [original, setOriginal] = useState(false)
  const [dark, setDark] = useState(true)
  const [language, setLanguage] = useState<DemoLocale>('en')
  const [notice, setNotice] = useState('')
  const copy = DEMO_COPY[language]

  const persist = (nextPlacement: SurfacePlacement, nextSelection: SurfaceSelection | null = selection) => {
    setPlacement(nextPlacement)
    try {
      saveMockupState(window.localStorage, 'demo', {
        sourceRef: base.id ?? base.src,
        designRef: design?.id ?? design?.src,
        selection: nextSelection,
        placement: nextPlacement,
      })
    } catch {
      // Local preview URLs are intentionally not persisted; the demo remains usable.
    }
  }

  const placementAtDropPoint = (event: { currentTarget: HTMLElement; clientX: number; clientY: number }) => {
    const stage = event.currentTarget.querySelector<HTMLElement>('.surface-mockup-stage')
    const rect = (stage ?? event.currentTarget).getBoundingClientRect()
    return {
      ...placement,
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width))),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / Math.max(1, rect.height))),
    }
  }

  const hasDesignTransfer = (event: React.DragEvent<HTMLElement>) => event.dataTransfer.types.includes(DESIGN_DRAG_TYPE)

  const startDesignDrag = (event: React.DragEvent<HTMLDivElement>) => {
    if (!design) return
    event.dataTransfer.effectAllowed = 'copy'
    event.dataTransfer.setData(DESIGN_DRAG_TYPE, design.id ?? design.src)
    setDraggingDesign(true)
  }

  const updateDropPreview = (event: React.DragEvent<HTMLDivElement>) => {
    if (original || !selection || !hasDesignTransfer(event)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    setDraggingDesign(true)
    setDragPlacement(placementAtDropPoint(event))
  }

  const clearDropPreview = (event?: React.DragEvent<HTMLDivElement>) => {
    if (event && event.currentTarget.contains(event.relatedTarget as Node | null)) return
    setDraggingDesign(false)
    setDragPlacement(null)
  }

  const commitDesignDrop = (event: React.DragEvent<HTMLDivElement>) => {
    if (original || !selection || !hasDesignTransfer(event)) return
    event.preventDefault()
    const next = placementAtDropPoint(event)
    setDraggingDesign(false)
    setDragPlacement(null)
    persist(next)
    setNotice(copy.designCommitted)
  }

  const exportPng = async () => {
    try {
      const result = await editorRef.current?.exportPng()
      if (!result) return
      const url = URL.createObjectURL(result.blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'visible-surface-mockup.png'
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      setNotice(copy.exported(result.width, result.height))
    } catch (error) {
      setNotice(error instanceof Error ? error.message : (language === 'en' ? 'Export failed' : '导出失败'))
    }
  }

  const reset = () => {
    editorRef.current?.resetPlacement()
    setNotice(copy.placementReset)
  }

  const chooseFile = (kind: 'base' | 'design', file: File | undefined) => {
    if (!file) return
    const next = readFile(file, kind)
    if (kind === 'base') {
      setBase(next)
      setSelection(null)
    } else setDesign(next)
    setNotice(kind === 'base' ? copy.sourceLoaded : copy.designLoaded)
  }

  const loadSample = () => {
    setMode('fixture')
    setBase(cupSource)
    setDesign(labelSource)
    setSelection(null)
    setPlacement(initialPlacement)
    setDragPlacement(null)
    setDraggingDesign(false)
    setOriginal(false)
    setNotice(copy.bundledLoaded)
  }

  const activateLocalModel = () => {
    setMode('local-model')
    setSelection(null)
    setPlacement(initialPlacement)
    setDragPlacement(null)
    setDraggingDesign(false)
    setOriginal(false)
    setNotice(copy.localEnabled)
  }

  return <main lang={language === 'en' ? 'en' : 'zh-CN'} className={dark ? 'demo demo-dark' : 'demo demo-light'}>
    <header className="demo-header">
      <div>
        <p className="eyebrow">{copy.eyebrow}</p>
        <h1>{copy.title}</h1>
        <p className="lede">{copy.lede}</p>
      </div>
      <div className="header-actions">
        <button type="button" className="quiet-button" onClick={() => setDark((value) => !value)}>{dark ? copy.lightMode : copy.darkMode}</button>
        <button type="button" className="quiet-button" onClick={() => setLanguage((value) => value === 'en' ? 'zh' : 'en')}>{language === 'en' ? '中文' : 'English'}</button>
        <a className="quiet-button" href="https://github.com/LaughingZhu/mockup" target="_blank" rel="noreferrer">{copy.github}</a>
      </div>
    </header>

    <section className="demo-layout">
      <aside className="demo-panel">
        <div className="panel-heading"><span className="step">01</span><div><h2>{copy.chooseInputs}</h2><p>{mode === 'local-model' ? copy.localServiceSub : copy.fixtureSub}</p></div></div>
        <div className="input-block"><label htmlFor="base-upload">{copy.sourcePhoto}</label><input id="base-upload" type="file" accept="image/*" onChange={(event) => chooseFile('base', event.target.files?.[0])} /><small>{mode === 'local-model' ? copy.sentLocal : copy.fixtureData}</small></div>
        <div className="input-block"><label htmlFor="design-upload">{copy.designArtwork}</label><input id="design-upload" type="file" accept="image/*" onChange={(event) => chooseFile('design', event.target.files?.[0])} /><small>{copy.transparentHint}</small></div>
        {design ? <div className="design-drag-source" draggable onDragStart={startDesignDrag} onDragEnd={() => clearDropPreview()} aria-label="Drag design artwork onto the preview">
          <img src={design.src} alt={design.alt ?? 'Current design artwork'} />
          <span><strong>{copy.dragArtwork}</strong><small>{copy.dragPreview}</small></span>
        </div> : null}
        <div className="button-row"><button type="button" className="sample-button" onClick={loadSample}>{copy.useFixture}</button><button type="button" className="quiet-button" onClick={activateLocalModel}>{copy.useLocal}</button></div>
        <div className="rule" />
        <div className="panel-heading"><span className="step">02</span><div><h2>{copy.wholeSurface}</h2><p>{copy.wholeSurfaceDesc}</p></div></div>
        <div className="contract-card"><span className="status-dot" /> <span><strong>{mode === 'local-model' ? copy.localService : copy.bundledFixture}</strong><br /><code>{mode === 'local-model' ? LOCAL_MODEL_ENDPOINT : DEMO_MODEL_LABEL}</code></span></div>
        <div className="rule" />
        <div className="panel-heading"><span className="step">03</span><div><h2>{copy.export}</h2><p>{copy.exportDesc}</p></div></div>
        <div className="button-row"><button type="button" className="primary-button" onClick={exportPng}>{copy.exportPng}</button><button type="button" className="quiet-button" onClick={reset}>{copy.reset}</button></div>
        <button type="button" className="before-after" onClick={() => setOriginal((value) => !value)}>{original ? copy.showMockup : copy.showBefore}</button>
        {notice ? <p className="notice" role="status">{notice}</p> : null}
      </aside>

      <section className="preview-panel">
        <div className="preview-topline"><span><span className="live-dot" /> {mode === 'local-model' ? copy.localPreview : copy.fixturePreview}</span><span>{draggingDesign ? copy.releaseCommit : copy.dragResizeRotate}</span></div>
        <div className={`preview-frame ${original ? 'show-original' : ''} ${draggingDesign ? 'is-drop-target' : ''}`}
          onDragOver={updateDropPreview} onDragLeave={clearDropPreview} onDrop={commitDesignDrop}>
          {original ? <img className="before-image" src={base.src} alt={base.alt ?? 'Original source'} /> : <SurfaceMockupEditor
            ref={editorRef}
            base={base}
            design={design}
            provider={provider}
            locale={language}
            sourceKey={base.id}
            selection={selection}
            placement={dragPlacement ?? placement}
            defaultPlacement={initialPlacement}
            onPlacementChange={(next) => persist(next)}
            onInteractionEnd={() => setNotice(copy.placementCommitted)}
            onSurfaceSelectionChange={(next) => { setSelection(next); persist(dragPlacement ?? placement, next) }}
            style={{ width: '100%', height: '100%' }}
          />}
          {original ? <span className="before-badge">Before</span> : null}
        </div>
        <div className="preview-caption"><span><strong>{copy.surface}:</strong> {selection?.candidateId ?? (mode === 'local-model' ? (language === 'en' ? 'whole-image surface' : '整张图片表面') : (language === 'en' ? 'bundled surface' : '内置样例表面'))}</span><span><strong>{copy.model}:</strong> {selection?.model ?? (mode === 'local-model' ? DEMO_MODEL_LABEL : 'precomputed demo')}</span><span><strong>{copy.state}:</strong> {original ? copy.before : selection ? copy.ready : copy.loading}</span></div>
      </section>
    </section>

    <section className="explanation-grid">
      <article><span className="card-index">A</span><h3>{copy.oneDepthField}</h3><p>{copy.oneDepthDesc}</p></article>
      <article><span className="card-index">B</span><h3>{copy.depthMapping}</h3><p>{copy.depthDesc}</p></article>
      <article><span className="card-index">C</span><h3>{copy.twoModels}</h3><p>{copy.twoModelsDesc}</p></article>
    </section>

    <footer className="demo-footer"><span>{mode === 'local-model' ? DEMO_MODEL_LABEL + ' · localhost:8080' : DEMO_MODEL_LABEL + (language === 'en' ? ' · Local fixture' : ' · 本地样例')}</span><span>{copy.docsIncluded}</span></footer>
  </main>
}
