import { logger } from '../logger'

type JobFn = () => Promise<void>

// Lightweight in-process async queue — prevents notification failures
// from blocking HTTP responses. Replace with BullMQ + Redis for production scale.
class NotificationQueue {
  private queue: JobFn[] = []
  private running = false

  enqueue(job: JobFn): void {
    this.queue.push(job)
    if (!this.running) this.drain()
  }

  private async drain(): Promise<void> {
    this.running = true
    while (this.queue.length > 0) {
      const job = this.queue.shift()!
      try {
        await job()
      } catch (err) {
        logger.error({ err }, 'Notification job failed')
      }
    }
    this.running = false
  }
}

export const notificationQueue = new NotificationQueue()
