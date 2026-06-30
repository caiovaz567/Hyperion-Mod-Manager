// Lets main-process work report fine-grained, real-time progress to the splash
// screen while the app boots. index.ts registers an emitter (which updates the
// splash text and re-arms the boot watchdog); long operations like the mod scan and
// the conflict pass call reportBootProgress so the splash shows what's actually
// happening ("Scanning library · 45/105") instead of sitting on one static label.
//
// The emitter is cleared the moment the main window is revealed, so this is a no-op
// during normal operation — the same functions run on every scan but only emit while
// the splash is up.

let emit: ((message: string) => void) | null = null
let lastEmitAt = 0

export function setSplashProgressEmitter(fn: ((message: string) => void) | null): void {
  emit = fn
  lastEmitAt = 0
}

export function isBootProgressActive(): boolean {
  return emit !== null
}

// Reports a progress line to the splash. `minIntervalMs` throttles bursts (e.g. a
// tight per-mod loop) so the splash isn't flooded with updates; pass 0 to always
// emit. Intermediate throttled messages are dropped, which is fine for a counter.
export function reportBootProgress(message: string, minIntervalMs = 0): void {
  if (!emit) return
  if (minIntervalMs > 0) {
    const now = Date.now()
    if (now - lastEmitAt < minIntervalMs) return
    lastEmitAt = now
  }
  emit(message)
}
