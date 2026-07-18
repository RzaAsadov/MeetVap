import { useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { InteractionManager } from 'react-native';

import { INITIAL_LOCAL_MESSAGE_HYDRATE_LIMIT } from './useChatTimelineWindow';

type ChatHydrationDiagnostic = (event: string, details?: Record<string, unknown>) => void;

type UseChatHydrationOptions = {
  clearBottomAnchorTimeout: () => void;
  clearInitialScrollTimeouts: () => void;
  clearInstantTailReleaseTimeout: () => void;
  clearPendingMessageJump: () => void;
  clearTailScrollTimeouts: () => void;
  conversationId: string;
  forceTailUntilRef: MutableRefObject<number>;
  hasInitialScrollRef: MutableRefObject<boolean>;
  hasTailActivityDuringOpenRef: MutableRefObject<boolean>;
  instantNextScrollRef: MutableRefObject<boolean>;
  isBottomAnchoringRef: MutableRefObject<boolean>;
  isGroupInvitePending: boolean;
  isInitialScrollScheduledRef: MutableRefObject<boolean>;
  isNearBottomRef: MutableRefObject<boolean>;
  isTailOpenLockedRef: MutableRefObject<boolean>;
  lastAutoTailMessageIdRef: MutableRefObject<string | null>;
  lastContentHeightRef: MutableRefObject<number>;
  lastDistanceFromBottomRef: MutableRefObject<number>;
  lastScrollOffsetYRef: MutableRefObject<number>;
  lastScrolledMessageCountRef: MutableRefObject<number>;
  loadMessages: (conversationId: string, options?: { hydrate?: boolean }) => Promise<void>;
  logLifecycle?: ChatHydrationDiagnostic;
  logScroll?: ChatHydrationDiagnostic;
  onServerSyncError?: (error: unknown) => void;
  openHistoryGuardUntilRef: MutableRefObject<number>;
  pendingInitialAlignmentRef: MutableRefObject<boolean>;
  prepareConversationMessages: (conversationId: string, options?: { limit?: number }) => Promise<void>;
  resetVisibleWindow: () => void;
  serverSyncDelayMs?: number;
  scheduleOpenChatAlignment: () => void;
  setBottomAnchoringActive: Dispatch<SetStateAction<boolean>>;
  setInitialScrollReady: Dispatch<SetStateAction<boolean>>;
};

export function useChatHydration({
  clearBottomAnchorTimeout,
  clearInitialScrollTimeouts,
  clearInstantTailReleaseTimeout,
  clearPendingMessageJump,
  clearTailScrollTimeouts,
  conversationId,
  forceTailUntilRef,
  hasInitialScrollRef,
  hasTailActivityDuringOpenRef,
  instantNextScrollRef,
  isBottomAnchoringRef,
  isGroupInvitePending,
  isInitialScrollScheduledRef,
  isNearBottomRef,
  isTailOpenLockedRef,
  lastAutoTailMessageIdRef,
  lastContentHeightRef,
  lastDistanceFromBottomRef,
  lastScrollOffsetYRef,
  lastScrolledMessageCountRef,
  loadMessages,
  logLifecycle,
  logScroll,
  onServerSyncError,
  openHistoryGuardUntilRef,
  pendingInitialAlignmentRef,
  prepareConversationMessages,
  resetVisibleWindow,
  serverSyncDelayMs = 250,
  scheduleOpenChatAlignment,
  setBottomAnchoringActive,
  setInitialScrollReady,
}: UseChatHydrationOptions) {
  const loadMessagesRef = useRef(loadMessages);
  const logLifecycleRef = useRef(logLifecycle);
  const logScrollRef = useRef(logScroll);
  const onServerSyncErrorRef = useRef(onServerSyncError);
  const prepareConversationMessagesRef = useRef(prepareConversationMessages);
  const resetVisibleWindowRef = useRef(resetVisibleWindow);
  const scheduleOpenChatAlignmentRef = useRef(scheduleOpenChatAlignment);

  loadMessagesRef.current = loadMessages;
  logLifecycleRef.current = logLifecycle;
  logScrollRef.current = logScroll;
  onServerSyncErrorRef.current = onServerSyncError;
  prepareConversationMessagesRef.current = prepareConversationMessages;
  resetVisibleWindowRef.current = resetVisibleWindow;
  scheduleOpenChatAlignmentRef.current = scheduleOpenChatAlignment;

  useEffect(() => {
    let isCancelled = false;

    logLifecycleRef.current?.('chat-open-reset', { routeConversationId: conversationId });
    logScrollRef.current?.('chat-open-reset', { routeConversationId: conversationId });
    clearInitialScrollTimeouts();
    clearBottomAnchorTimeout();
    clearInstantTailReleaseTimeout();
    hasInitialScrollRef.current = false;
    isNearBottomRef.current = true;
    isBottomAnchoringRef.current = false;
    isTailOpenLockedRef.current = true;
    setBottomAnchoringActive(false);
    pendingInitialAlignmentRef.current = false;
    lastScrolledMessageCountRef.current = 0;
    lastAutoTailMessageIdRef.current = null;
    lastContentHeightRef.current = 0;
    lastScrollOffsetYRef.current = 0;
    lastDistanceFromBottomRef.current = 0;
    forceTailUntilRef.current = 0;
    instantNextScrollRef.current = false;
    hasTailActivityDuringOpenRef.current = false;
    openHistoryGuardUntilRef.current = Date.now() + 2500;
    setInitialScrollReady(false);
    resetVisibleWindowRef.current();

    if (isGroupInvitePending) {
      return () => {
        isCancelled = true;
        clearPendingMessageJump();
        clearInitialScrollTimeouts();
        clearBottomAnchorTimeout();
      };
    }

    const syncTimeouts: ReturnType<typeof setTimeout>[] = [];
    let syncInteraction: { cancel: () => void } | null = null;

    logScrollRef.current?.('local-hydrate-start', {
      limit: INITIAL_LOCAL_MESSAGE_HYDRATE_LIMIT,
    });
    logLifecycleRef.current?.('local-hydrate-start', {
      limit: INITIAL_LOCAL_MESSAGE_HYDRATE_LIMIT,
    });
    prepareConversationMessagesRef.current(conversationId, { limit: INITIAL_LOCAL_MESSAGE_HYDRATE_LIMIT }).finally(() => {
      if (isCancelled) {
        logLifecycleRef.current?.('local-hydrate-cancelled');
        logScrollRef.current?.('local-hydrate-cancelled');
        return;
      }

      logLifecycleRef.current?.('local-hydrate-finished');
      logScrollRef.current?.('local-hydrate-finished');
      requestAnimationFrame(() => {
        if (isCancelled) {
          logLifecycleRef.current?.('local-hydrate-align-cancelled');
          logScrollRef.current?.('local-hydrate-align-cancelled');
          return;
        }

        if (hasTailActivityDuringOpenRef.current) {
          logLifecycleRef.current?.('open-alignment-skipped-after-tail-activity');
          return;
        }
        if (!hasInitialScrollRef.current && !isInitialScrollScheduledRef.current) {
          logLifecycleRef.current?.('open-alignment-after-local-hydrate');
          logScrollRef.current?.('open-alignment-after-local-hydrate');
          scheduleOpenChatAlignmentRef.current();
        }
      });

      logLifecycleRef.current?.('server-sync-scheduled', { delayMs: serverSyncDelayMs, afterInteractions: true });
      logScrollRef.current?.('server-sync-scheduled', { delayMs: serverSyncDelayMs, afterInteractions: true });
      syncInteraction = InteractionManager.runAfterInteractions(() => {
        if (isCancelled) {
          return;
        }

        syncTimeouts.push(setTimeout(() => {
          if (isCancelled) {
            return;
          }

          logLifecycleRef.current?.('server-sync-start');
          logScrollRef.current?.('server-sync-start');
          loadMessagesRef.current(conversationId, { hydrate: false })
            .then(() => {
              logLifecycleRef.current?.('server-sync-finished');
              logScrollRef.current?.('server-sync-finished');
              openHistoryGuardUntilRef.current = Math.max(openHistoryGuardUntilRef.current, Date.now() + 900);
            })
            .catch((error) => {
              const message = error instanceof Error ? error.message : String(error);

              logLifecycleRef.current?.('server-sync-failed', { message });
              logScrollRef.current?.('server-sync-failed', { message });
              onServerSyncErrorRef.current?.(error);
            });
        }, serverSyncDelayMs));
      });
    }).catch(() => undefined);

    return () => {
      isCancelled = true;
      logLifecycleRef.current?.('chat-open-cleanup');
      logScrollRef.current?.('chat-open-cleanup');
      syncInteraction?.cancel();
      syncTimeouts.forEach((timeout) => clearTimeout(timeout));
      clearPendingMessageJump();
      clearInitialScrollTimeouts();
      clearTailScrollTimeouts();
      clearInstantTailReleaseTimeout();
      clearBottomAnchorTimeout();
    };
  }, [
    clearBottomAnchorTimeout,
    clearInitialScrollTimeouts,
    clearInstantTailReleaseTimeout,
    clearPendingMessageJump,
    clearTailScrollTimeouts,
    conversationId,
    forceTailUntilRef,
    hasInitialScrollRef,
    hasTailActivityDuringOpenRef,
    instantNextScrollRef,
    isBottomAnchoringRef,
    isGroupInvitePending,
    isInitialScrollScheduledRef,
    isNearBottomRef,
    isTailOpenLockedRef,
    lastAutoTailMessageIdRef,
    lastContentHeightRef,
    lastDistanceFromBottomRef,
    lastScrollOffsetYRef,
    lastScrolledMessageCountRef,
    pendingInitialAlignmentRef,
    openHistoryGuardUntilRef,
    serverSyncDelayMs,
    setBottomAnchoringActive,
    setInitialScrollReady,
  ]);
}
