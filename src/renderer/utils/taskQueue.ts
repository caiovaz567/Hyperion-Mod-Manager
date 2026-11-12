// Small async helpers for the download/install pipeline. Pure, so the ordering
// guarantees are unit-tested (tests/taskQueue.test.ts).

// Runs queued tasks one at a time, in the order they were queued. A task that fails
// does not block the ones after it; its own promise still rejects for the caller.
export function createSerialQueue(): (run: () => Promise<void>) => Promise<void> {
  let tail: Promise<void> = Promise.resolve()
  return (run) => {
    const next = tail.then(run, run)
    tail = next.catch(() => {})
    return next
  }
}

// Calls `worker` for every item with at most `limit` running at once. A worker that
// throws does not stop the others; failed items are reported through `onError`.
export async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>,
  onError?: (item: T, error: unknown) => void,
): Promise<void> {
  let nextIndex = 0
  const workerCount = Math.min(Math.max(1, limit), items.length)
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex]
      nextIndex += 1
      try {
        await worker(item)
      } catch (error) {
        onError?.(item, error)
      }
    }
  }))
}
