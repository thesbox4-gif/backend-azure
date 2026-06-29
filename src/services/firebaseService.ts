import { cert, getApps, initializeApp, type ServiceAccount } from 'firebase-admin/app'
import { getMessaging } from 'firebase-admin/messaging'
import { logger } from '../logger'

let initialized = false

function normalizePrivateKey(key: string): string {
  return key.replace(/\\n/g, '\n')
}

function loadServiceAccount(): ServiceAccount | null {
  const projectId = process.env.FIREBASE_PROJECT_ID?.trim()
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim()
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.trim()

  if (!projectId || !clientEmail || !privateKey) return null

  return {
    projectId,
    clientEmail,
    privateKey: normalizePrivateKey(privateKey),
  }
}

export function initFirebase(): boolean {
  if (initialized) return true
  if (getApps().length > 0) {
    initialized = true
    return true
  }

  const serviceAccount = loadServiceAccount()
  if (!serviceAccount) {
    logger.warn(
      'Firebase not configured — set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY'
    )
    return false
  }

  try {
    initializeApp({ credential: cert(serviceAccount) })
    initialized = true
    logger.info({ projectId: serviceAccount.projectId }, 'Firebase Admin initialized')
    return true
  } catch (err) {
    logger.warn({ err }, 'Firebase init failed — push notifications disabled (check FIREBASE_PRIVATE_KEY format)')
    return false
  }
}

export function isFirebaseReady(): boolean {
  return initialized || getApps().length > 0
}

export async function sendFcmNotification(
  token: string,
  title: string,
  body: string,
  data?: Record<string, string>
): Promise<boolean> {
  if (!initFirebase()) return false

  try {
    await getMessaging().send({
      token,
      notification: { title, body },
      data: data ?? {},
      android: { priority: 'high', notification: { sound: 'default', channelId: 'default' } },
      apns: { payload: { aps: { sound: 'default', badge: 1 } } },
    })
    return true
  } catch (err) {
    logger.error({ err, token: token.slice(0, 12) + '…' }, 'FCM push failed')
    return false
  }
}
