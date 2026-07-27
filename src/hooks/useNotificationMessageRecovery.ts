import { useEffect,useRef } from 'react';

import { logMessageDeliveryDiagnostic } from '../lib/messageDeliveryDiagnostics';
import { useAppStore } from '../store/useAppStore';

type NotificationRecoveryDiagnostic = (event: string, details?: Record<string, unknown>) => void;

type UseNotificationMessageRecoveryOptions = {
  conversationId: string;
  isDisabled: boolean;
  loadMessages: (conversationId: string, options?: { hydrate?: boolean }) => Promise<void>;
  logLifecycle?: NotificationRecoveryDiagnostic;
  openReason?: string;
  targetMessageId?: string;
};

const RECOVERY_DELAYS_MS = [0, 700, 2_000] as const;

export function useNotificationMessageRecovery({
  conversationId,
  isDisabled,
  loadMessages,
  logLifecycle,
  openReason,
  targetMessageId,
}: UseNotificationMessageRecoveryOptions) {
  const loadMessagesRef = useRef(loadMessages);
  const logLifecycleRef = useRef(logLifecycle);

  loadMessagesRef.current = loadMessages;
  logLifecycleRef.current = logLifecycle;

  useEffect(() => {
    if (openReason !== 'notification' || !targetMessageId || isDisabled) {
      return undefined;
    }

    let isCancelled = false;
    const recoveryKey = `${conversationId}:${targetMessageId}`;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const hasTarget = () => (
      (useAppStore.getState().messagesByConversation[conversationId] ?? [])
        .some((message) => message.id === targetMessageId)
    );

    logLifecycleRef.current?.('notification-message-check', {
      hasTargetMessage: hasTarget(),
      targetMessageId,
    });

    const runAttempt = async (attempt: number) => {
      if (isCancelled || hasTarget()) {
        return;
      }

      logLifecycleRef.current?.('notification-recovery-sync-start', {
        attempt,
        targetMessageId,
      });
      logMessageDeliveryDiagnostic('chat-notification-recovery-start', {
        attempt,
        conversationId,
        recoveryKey,
        targetMessageId,
      });

      try {
        await loadMessagesRef.current(conversationId, { hydrate: false });
      } catch (error) {
        logMessageDeliveryDiagnostic('chat-notification-recovery-request-failed', {
          attempt,
          conversationId,
          message: error instanceof Error ? error.message : String(error),
          targetMessageId,
        });
      }

      if (isCancelled) {
        return;
      }

      const recoveredMessages = useAppStore.getState().messagesByConversation[conversationId] ?? [];
      const didRecoverTarget = recoveredMessages.some((message) => message.id === targetMessageId);

      logLifecycleRef.current?.('notification-recovery-sync-finished', {
        attempt,
        didRecoverTarget,
        targetMessageId,
      });
      logMessageDeliveryDiagnostic('chat-notification-recovery-finished', {
        attempt,
        conversationId,
        didRecoverTarget,
        messageIds: recoveredMessages.slice(-10).map((message) => message.id),
        recoveredCount: recoveredMessages.length,
        targetMessageId,
      });
    };

    const recoverSequentially = async () => {
      for (const [attempt, delayMs] of RECOVERY_DELAYS_MS.entries()) {
        if (isCancelled || hasTarget()) {
          return;
        }

        if (delayMs > 0) {
          await new Promise<void>((resolve) => {
            retryTimer = setTimeout(() => {
              retryTimer = null;
              resolve();
            }, delayMs);
          });
        }

        await runAttempt(attempt + 1);
      }
    };

    void recoverSequentially();

    return () => {
      isCancelled = true;
      if (retryTimer) {
        clearTimeout(retryTimer);
      }
    };
  }, [conversationId, isDisabled, openReason, targetMessageId]);
}
