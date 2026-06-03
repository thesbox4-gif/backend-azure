// cluster.ts — Multi-core support for production (run with: node dist/cluster.js)
// Spawns one worker per CPU core. PM2 can manage this automatically via ecosystem.config.js
import cluster from 'cluster'
import os from 'os'
import { logger } from './logger'

const WORKERS = parseInt(process.env.WEB_CONCURRENCY ?? '') || os.cpus().length

if (cluster.isPrimary) {
  logger.info(`Primary ${process.pid} is running — spawning ${WORKERS} workers`)

  for (let i = 0; i < WORKERS; i++) cluster.fork()

  cluster.on('exit', (worker, code, signal) => {
    logger.warn({ pid: worker.process.pid, code, signal }, 'Worker died — respawning')
    cluster.fork()
  })
} else {
  // Each worker imports and runs the main app
  require('./index')
  logger.info(`Worker ${process.pid} started`)
}
