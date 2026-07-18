import cors from 'cors';
import express, { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import http from 'http';
import morgan from 'morgan';
import { ZodError } from 'zod';

import { config } from './config';
import { HttpError } from './httpError';
import { payloadMaskMiddleware } from './payloadMaskMiddleware';
import { prisma } from './prisma';
import { authRoutes } from './routes/authRoutes';
import { attestationRoutes } from './routes/attestationRoutes';
import { callRoutes, publicCallRoutes } from './routes/callRoutes';
import { cleanupExpiredDisappearingMessages, cleanupExpiredViewDisappearingMessages, conversationRoutes, processDueScheduledMessages } from './routes/conversationRoutes';
import { groupWebhookRoutes } from './routes/groupWebhookRoutes';
import { mediaRoutes } from './routes/mediaRoutes';
import { liveLocationRoutes } from './routes/liveLocationRoutes';
import { cleanupExpiredMeetings, meetingRoutes } from './routes/meetingRoutes';
import { reportRoutes } from './routes/reportRoutes';
import { subscriptionRoutes } from './routes/subscriptionRoutes';
import { supportRoutes } from './routes/supportRoutes';
import { cleanupExpiredStatuses, statusRoutes } from './routes/statusRoutes';
import { userRoutes } from './routes/userRoutes';
import { webRoutes } from './routes/webRoutes';
import { createSocketServer } from './socket';
import { requireAuth } from './auth';
import { getClientPolicy, operationalConfig } from './operationalConfig';
import { runOperationalCleanup } from './maintenance';
import { startLiveKitHealthMonitor } from './livekitPool';
import { withRedisLock } from './redisCache';

const app = express();
const server = http.createServer(app);
const io = createSocketServer(server);

app.set('io', io);
app.set('trust proxy', true);
app.use(helmet());
app.use(cors({ origin: config.CLIENT_ORIGIN === '*' ? true : config.CLIENT_ORIGIN }));
app.use(express.json({ limit: '30mb' }));
app.use(payloadMaskMiddleware);
app.use(morgan(config.NODE_ENV === 'production' ? 'combined' : 'dev', {
  skip: (req, res) => (
    req.path === '/health' ||
    (
      config.NODE_ENV === 'production' &&
      res.statusCode === 304 &&
      (
        req.path.endsWith('/status-updates') ||
        req.path.endsWith('/deletions') ||
        req.path.endsWith('/edits') ||
        req.path.endsWith('/messages')
      )
    )
  ),
}));

app.get('/health', async (_req, res) => {
  await prisma.$queryRaw`SELECT 1`;
  res.json({
    ok: true,
    service: 'messenger-server',
    timestamp: new Date().toISOString(),
  });
});

app.get('/config/client', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.json(getClientPolicy());
});

app.use('/call-receipts', publicCallRoutes);
app.use('/group-webhooks', groupWebhookRoutes);
app.use('/auth', authRoutes);
app.use('/attestation', requireAuth, attestationRoutes);
app.use('/subscriptions', subscriptionRoutes);
app.use('/support', supportRoutes);
app.use('/statuses', statusRoutes);
app.use('/calls', requireAuth, callRoutes);
app.use('/meetings', meetingRoutes);
app.use('/users', userRoutes);
app.use('/web', webRoutes);
app.use('/conversations', conversationRoutes);
app.use('/media', mediaRoutes);
app.use('/live-locations', requireAuth, liveLocationRoutes);
app.use('/reports', requireAuth, reportRoutes);

app.use((_req, _res, next) => {
  next(new HttpError(404, 'Route not found'));
});

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (isIgnorableClientDisconnect(error)) {
    return;
  }

  if (res.headersSent) {
    console.error(error);
    return;
  }

  if (error instanceof ZodError) {
    res.status(400).json({
      error: 'Validation failed',
      issues: error.issues,
    });
    return;
  }

  if (error instanceof HttpError) {
    res.status(error.statusCode).json({ error: error.message, ...error.details });
    return;
  }

  console.error(error);
  res.status(500).json({ error: 'Internal server error' });
});

server.listen(config.PORT, () => {
  console.log(`Messenger server listening on port ${config.PORT}`);
});

startLiveKitHealthMonitor(io);

const disappearingMessagesCleanupTimer = setInterval(() => {
  void withRedisLock('lock:cleanup:disappearing-messages', 55, () => cleanupExpiredDisappearingMessages(io)).catch((error) => {
    console.error('Disappearing message cleanup failed', error);
  });
}, 60_000);
disappearingMessagesCleanupTimer.unref();

const scheduledMessagesTimer = setInterval(() => {
  void withRedisLock('lock:scheduled-messages', 8, () => processDueScheduledMessages(io)).catch((error) => {
    console.error('Scheduled message delivery failed', error);
  });
}, 10_000);
scheduledMessagesTimer.unref();

const viewDisappearingMessagesTimer = setInterval(() => {
  void withRedisLock('lock:cleanup:view-disappearing-messages', 8, () => cleanupExpiredViewDisappearingMessages(io)).catch((error) => {
    console.error('View disappearing message cleanup failed', error);
  });
}, 10_000);
viewDisappearingMessagesTimer.unref();

const statusCleanupTimer = setInterval(() => {
  void withRedisLock('lock:cleanup:statuses', 300, () => cleanupExpiredStatuses(io)).catch((error) => {
    console.error('Status cleanup failed', error);
  });
}, 5 * 60_000);
statusCleanupTimer.unref();

const initialOperationalCleanupTimer = setTimeout(() => {
  void withRedisLock('lock:cleanup:operational', operationalConfig.maintenance.cleanupIntervalMinutes * 60, runOperationalCleanup).catch((error) => {
    console.error('Initial operational cleanup failed', error);
  });
}, 60_000);
initialOperationalCleanupTimer.unref();
const operationalCleanupTimer = setInterval(() => {
  void withRedisLock('lock:cleanup:operational', operationalConfig.maintenance.cleanupIntervalMinutes * 60, runOperationalCleanup).catch((error) => {
    console.error('Operational cleanup failed', error);
  });
}, operationalConfig.maintenance.cleanupIntervalMinutes * 60_000);
operationalCleanupTimer.unref();

const meetingCleanupTimer = setInterval(() => {
  void withRedisLock('lock:cleanup:meetings', 25, cleanupExpiredMeetings).catch((error) => {
    console.error('Meeting cleanup failed', error);
  });
}, 30_000);
meetingCleanupTimer.unref();

async function shutdown() {
  await prisma.$disconnect();
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

function isIgnorableClientDisconnect(error: unknown) {
  return error instanceof Error &&
    'code' in error &&
    (
      (error as NodeJS.ErrnoException).code === 'EPIPE' ||
      (error as NodeJS.ErrnoException).code === 'ECONNABORTED' ||
      (error as NodeJS.ErrnoException).code === 'ECONNRESET'
    );
}
