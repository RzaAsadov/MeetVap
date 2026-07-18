import { Router } from 'express';

import { getAuthedUser, requireAuth } from '../auth';
import { config } from '../config';
import { HttpError } from '../httpError';
import { notifyServerSubscriptionEntitlementById, notifyServerUserSubscribed } from '../serverEventMessages';
import { getSubscriptionStatus, redeemSubscriptionCode, refreshGoogleSubscriptionByToken, verifyAppleSubscription, verifyGoogleSubscription } from '../subscriptions';
import { redeemSubscriptionCodeSchema, verifyAppleSubscriptionSchema, verifyGoogleSubscriptionSchema } from '../validators';

export const subscriptionRoutes = Router();

subscriptionRoutes.post('/apple/webhook', async (req, res, next) => {
  try {
    // App Store Server Notifications v2 are signed JWS payloads. Keep this
    // endpoint available for App Store configuration, but do not mutate
    // entitlements until Apple certificate-chain validation is wired in.
    void req.body;
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

subscriptionRoutes.post('/google/webhook', async (req, res, next) => {
  try {
    const messageData = typeof req.body?.message?.data === 'string'
      ? JSON.parse(Buffer.from(req.body.message.data, 'base64').toString('utf8')) as { subscriptionNotification?: { purchaseToken?: string } }
      : null;
    const purchaseToken = messageData?.subscriptionNotification?.purchaseToken;

    if (purchaseToken) {
      const entitlement = await refreshGoogleSubscriptionByToken(purchaseToken);

      if (entitlement) {
        void notifyServerUserSubscribed({
          entitlement,
          io: req.app.get('io'),
        }).catch((error) => {
          console.warn('Could not send Google subscription server event', error);
        });
      }
    }

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

subscriptionRoutes.post('/internal/manual-entitlement-event', async (req, res, next) => {
  try {
    if (!config.SERVER_EVENTS_INTERNAL_SECRET) {
      throw new HttpError(404, 'Route not found');
    }

    const secret = req.get('x-meetvap-internal-secret') ?? '';

    if (secret !== config.SERVER_EVENTS_INTERNAL_SECRET) {
      throw new HttpError(403, 'Forbidden');
    }

    const entitlementId = typeof req.body?.entitlementId === 'string'
      ? req.body.entitlementId.trim()
      : '';

    if (!entitlementId) {
      throw new HttpError(400, 'Missing entitlementId');
    }

    const sent = await notifyServerSubscriptionEntitlementById(entitlementId, req.app.get('io'));

    res.json({ ok: true, sent });
  } catch (error) {
    next(error);
  }
});

subscriptionRoutes.use(requireAuth);

subscriptionRoutes.get('/status', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);

    res.json(await getSubscriptionStatus(currentUser.id));
  } catch (error) {
    next(error);
  }
});

subscriptionRoutes.post('/redeem', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const input = redeemSubscriptionCodeSchema.parse(req.body);
    const entitlement = await redeemSubscriptionCode(currentUser.id, input.code);

    void notifyServerUserSubscribed({
      entitlement,
      io: req.app.get('io'),
    }).catch((error) => {
      console.warn('Could not send redeem subscription server event', error);
    });

    res.json(await getSubscriptionStatus(currentUser.id));
  } catch (error) {
    next(error);
  }
});

subscriptionRoutes.post('/apple/verify', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const input = verifyAppleSubscriptionSchema.parse(req.body);
    const entitlement = await verifyAppleSubscription(currentUser.id, input);

    void notifyServerUserSubscribed({
      entitlement,
      io: req.app.get('io'),
    }).catch((error) => {
      console.warn('Could not send Apple subscription server event', error);
    });
    res.json(await getSubscriptionStatus(currentUser.id));
  } catch (error) {
    next(error);
  }
});

subscriptionRoutes.post('/google/verify', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const input = verifyGoogleSubscriptionSchema.parse(req.body);
    const entitlement = await verifyGoogleSubscription(currentUser.id, input);

    void notifyServerUserSubscribed({
      entitlement,
      io: req.app.get('io'),
    }).catch((error) => {
      console.warn('Could not send Google subscription server event', error);
    });
    res.json(await getSubscriptionStatus(currentUser.id));
  } catch (error) {
    next(error);
  }
});
