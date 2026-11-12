import { describe, expect, it } from 'vitest'
import { createSerialQueue, runWithConcurrency } from '../src/renderer/utils/taskQueue'

const tick = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

describe('createSerialQueue', () => {
  it('never runs two tasks at the same time', async () => {
    const queue = createSerialQueue()
    let running = 0
    let maxRunning = 0
    const task = (ms: number) => async () => {
      running += 1
      maxRunning = Math.max(maxRunning, running)
      await tick(ms)
      running -= 1
    }
    await Promise.all([queue(task(20)), queue(task(5)), queue(task(10)), queue(task(1))])
    expect(maxRunning).toBe(1)
  })

  it('runs tasks in the order they were queued, even when later ones are faster', async () => {
    const queue = createSerialQueue()
    const order: string[] = []
    const task = (name: string, ms: number) => async () => {
      await tick(ms)
      order.push(name)
    }
    await Promise.all([queue(task('slow', 25)), queue(task('fast', 1)), queue(task('medium', 10))])
    expect(order).toEqual(['slow', 'fast', 'medium'])
  })

  it('keeps going after a failed task, and the failure reaches its caller', async () => {
    const queue = createSerialQueue()
    const order: string[] = []
    const failed = queue(async () => {
      order.push('broken')
      throw new Error('install failed')
    })
    const next = queue(async () => {
      order.push('next')
    })
    await expect(failed).rejects.toThrow('install failed')
    await next
    expect(order).toEqual(['broken', 'next'])
  })
})

describe('runWithConcurrency', () => {
  it('runs at most the limit at once and still processes every item', async () => {
    let running = 0
    let maxRunning = 0
    const done: number[] = []
    await runWithConcurrency([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3, async (item) => {
      running += 1
      maxRunning = Math.max(maxRunning, running)
      await tick(5 + (item % 3) * 5)
      running -= 1
      done.push(item)
    })
    expect(maxRunning).toBe(3)
    expect(done.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('reports a failed item and finishes the rest', async () => {
    const done: string[] = []
    const failures: string[] = []
    await runWithConcurrency(['a', 'b', 'c', 'd'], 2, async (item) => {
      if (item === 'b') throw new Error('download failed')
      await tick(2)
      done.push(item)
    }, (item) => failures.push(item))
    expect(failures).toEqual(['b'])
    expect(done.sort()).toEqual(['a', 'c', 'd'])
  })

  it('handles an empty list and fewer items than the limit', async () => {
    await expect(runWithConcurrency([], 3, async () => {})).resolves.toBeUndefined()
    const done: number[] = []
    await runWithConcurrency([1], 3, async (item) => { done.push(item) })
    expect(done).toEqual([1])
  })
})
