# RevenueCat webhook

The first integration connected RevenueCat events to the subscription record in Firestore. The client then used that record to display the current plan and weekly Action Plan allowance.

The excerpt below shows the handler from that milestone. Imports and Firebase initialization belong to the surrounding backend. Before adapting it for production, review subscription lifecycle semantics, event ordering, and idempotency.

```typescript
const REVENUECAT_ACTIVE_EVENT_TYPES = new Set([
  'INITIAL_PURCHASE',
  'RENEWAL',
  'PRODUCT_CHANGE',
  'UNCANCELLATION',
]);
const REVENUECAT_INACTIVE_EVENT_TYPES = new Set([
  'CANCELLATION',
  'EXPIRATION',
  'BILLING_ISSUE',
]);

const REVENUECAT_PRO_ENTITLEMENT_ID = 'Synced - Inbox on Autopilot Pro';

// Writes users/{app_user_id}.subscription — the single source of truth
// functions/src/pipeline.ts's writeTriageTasks enforces the weekly Action
// Plan cap against, and what the app reads for gating (see
// contexts/UserContext.tsx). Never written by the client.
export const revenueCatWebhook = onRequest(
  { cors: false, timeoutSeconds: 30, memory: '256MiB' },
  async (req, res) => {
    const expectedSecret = process.env.REVENUECAT_WEBHOOK_SECRET || '';
    const authHeader = req.get('Authorization') || '';
    if (!expectedSecret || authHeader !== `Bearer ${expectedSecret}`) {
      logger.error('[RevenueCat Webhook] Missing or invalid Authorization header — rejecting request.');
      res.status(401).send('Unauthorized');
      return;
    }

    const event = req.body?.event;
    if (!event || typeof event.app_user_id !== 'string') {
      logger.warn('[RevenueCat Webhook] Payload missing event.app_user_id — ignoring.');
      res.status(200).send('Ignored: no app_user_id');
      return;
    }

    const userId: string = event.app_user_id;
    const eventType: string = event.type;

    if (!REVENUECAT_ACTIVE_EVENT_TYPES.has(eventType) && !REVENUECAT_INACTIVE_EVENT_TYPES.has(eventType)) {
      logger.info(`[RevenueCat Webhook] Ignoring event type "${eventType}" for user ${userId} — does not affect entitlement state.`);
      res.status(200).send('Ignored: event type not entitlement-affecting');
      return;
    }

    const entitlementIds: string[] = event.entitlement_ids || [];
    if (!entitlementIds.includes(REVENUECAT_PRO_ENTITLEMENT_ID)) {
      logger.info(`[RevenueCat Webhook] Event for user ${userId} does not include the Pro entitlement (${entitlementIds.join(', ') || 'none'}) — ignoring.`);
      res.status(200).send('Ignored: unrelated entitlement');
      return;
    }

    try {
      const db = admin.firestore();
      const userRef = db.collection('users').doc(userId);
      const userSnap = await userRef.get();
      if (!userSnap.exists) {
        logger.warn(`[RevenueCat Webhook] app_user_id ${userId} does not match any users/{uid} doc — ignoring (RevenueCat appUserID is always the Firebase uid).`);
        res.status(200).send('Ignored: unknown user');
        return;
      }

      const entitlementActive = REVENUECAT_ACTIVE_EVENT_TYPES.has(eventType);
      const store = event.store === 'PLAY_STORE' ? 'play_store' : event.store === 'APP_STORE' ? 'app_store' : undefined;

      await userRef.update({
        subscription: {
          plan: entitlementActive ? 'pro' : 'free',
          entitlementActive,
          productId: event.product_id || null,
          willRenew: typeof event.auto_resume_at_ms !== 'undefined' ? true : event.cancel_reason ? false : null,
          periodEnd: event.expiration_at_ms ? new Date(event.expiration_at_ms).toISOString() : null,
          store: store || null,
          updatedAt: new Date().toISOString(),
        },
      });

      logger.info(`[RevenueCat Webhook] Updated user ${userId}: entitlementActive=${entitlementActive} (event=${eventType}).`);
      res.status(200).send('OK');
    } catch (err: any) {
      logger.error(`[RevenueCat Webhook] Failed to process event for user ${userId}:`, err);
      res.status(500).send('Internal error');
    }
  },
);
```
