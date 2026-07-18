import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';

import { Message } from '../types/domain';

export const INITIAL_VISIBLE_MESSAGE_COUNT = 40;
export const INITIAL_LOCAL_MESSAGE_HYDRATE_LIMIT = 80;
export const TAIL_APPEND_VISIBLE_MESSAGE_LIMIT = 80;
export const VISIBLE_MESSAGE_PAGE_SIZE = 30;

type ChatTimelineDiagnostic = (event: string, details?: Record<string, unknown>) => void;

type UseChatTimelineWindowOptions = {
  conversationId: string;
  isControlledHistoryPrependRef?: MutableRefObject<boolean>;
  isDisabled: boolean;
  isTailOpenLockedRef?: MutableRefObject<boolean>;
  logLifecycle?: ChatTimelineDiagnostic;
  logScroll?: ChatTimelineDiagnostic;
  pendingDeletedMessageIds: string[];
  pendingDeletedMessageKeys: string[];
  remoteMessages: Message[];
  shouldRenderMessage: (message: Message) => boolean;
};

export type ChatTimelineWindow = {
  archivedMessages: Message[];
  archivedMessagesRef: MutableRefObject<Message[]>;
  effectiveVisibleMessageCount: number;
  messages: Message[];
  renderTailAppendBoost: number;
  resetVisibleWindow: () => void;
  setVisibleMessageCount: Dispatch<SetStateAction<number>>;
  visibleMessageCount: number;
  visibleWindowStartIndex: number;
};

const EMPTY_MESSAGES: Message[] = [];

export function useChatTimelineWindow({
  conversationId,
  isControlledHistoryPrependRef,
  isDisabled,
  isTailOpenLockedRef,
  logLifecycle,
  logScroll,
  pendingDeletedMessageIds,
  pendingDeletedMessageKeys,
  remoteMessages,
  shouldRenderMessage,
}: UseChatTimelineWindowOptions): ChatTimelineWindow {
  const previousArchiveLengthRef = useRef(0);
  const previousArchiveFirstIdRef = useRef<string | null>(null);
  const previousArchiveLastIdRef = useRef<string | null>(null);
  const previousVisibleWindowStartIndexRef = useRef(0);
  const logLifecycleRef = useRef(logLifecycle);
  const logScrollRef = useRef(logScroll);
  const [visibleMessageCount, setVisibleMessageCount] = useState(INITIAL_VISIBLE_MESSAGE_COUNT);

  logLifecycleRef.current = logLifecycle;
  logScrollRef.current = logScroll;

  const archivedMessages = useMemo(() => {
    if (isDisabled) {
      return EMPTY_MESSAGES;
    }

    if (pendingDeletedMessageIds.length === 0 && pendingDeletedMessageKeys.length === 0) {
      return remoteMessages;
    }

    const pendingDeletedIds = new Set(pendingDeletedMessageIds);
    const pendingDeletedKeys = new Set(pendingDeletedMessageKeys);

    return remoteMessages.filter((message) => {
      const deleteKey = getMessageDeleteKey(message);

      return !pendingDeletedIds.has(message.id) &&
        (!deleteKey || !pendingDeletedKeys.has(deleteKey));
    });
  }, [isDisabled, pendingDeletedMessageIds, pendingDeletedMessageKeys, remoteMessages]);

  const archivedMessagesRef = useRef<Message[]>(EMPTY_MESSAGES);
  archivedMessagesRef.current = archivedMessages;

  const archivedFirstId = archivedMessages[0]?.id ?? null;
  const archivedLastId = archivedMessages[archivedMessages.length - 1]?.id ?? null;
  const renderTailAppendBoost = (() => {
    const previousArchiveLength = previousArchiveLengthRef.current;
    const previousArchiveFirstId = previousArchiveFirstIdRef.current;
    const previousArchiveLastId = previousArchiveLastIdRef.current;
    const didTailAppend = archivedMessages.length > previousArchiveLength &&
      !!previousArchiveLastId &&
      previousArchiveLastId !== archivedLastId &&
      previousArchiveFirstId === archivedFirstId;

    if (!didTailAppend || visibleMessageCount >= TAIL_APPEND_VISIBLE_MESSAGE_LIMIT) {
      return 0;
    }

    return Math.min(
      archivedMessages.length - previousArchiveLength,
      TAIL_APPEND_VISIBLE_MESSAGE_LIMIT - visibleMessageCount,
    );
  })();
  const effectiveVisibleMessageCount = Math.min(
    archivedMessages.length,
    visibleMessageCount + Math.max(0, renderTailAppendBoost),
  );
  const visibleWindowStartIndex = useMemo(
    () => Math.max(0, archivedMessages.length - effectiveVisibleMessageCount),
    [archivedMessages.length, effectiveVisibleMessageCount],
  );
  const messages = useMemo(
    () => archivedMessages.slice(visibleWindowStartIndex).filter(shouldRenderMessage),
    [archivedMessages, shouldRenderMessage, visibleWindowStartIndex],
  );

  useEffect(() => {
    setVisibleMessageCount(INITIAL_VISIBLE_MESSAGE_COUNT);
    previousArchiveLengthRef.current = 0;
    previousArchiveFirstIdRef.current = null;
    previousArchiveLastIdRef.current = null;
    previousVisibleWindowStartIndexRef.current = 0;
  }, [conversationId]);

  useEffect(() => {
    const previousArchiveLength = previousArchiveLengthRef.current;
    const previousArchiveFirstId = previousArchiveFirstIdRef.current;
    const previousArchiveLastId = previousArchiveLastIdRef.current;
    const previousVisibleWindowStartIndex = previousVisibleWindowStartIndexRef.current;
    const currentArchiveFirstId = archivedFirstId;
    const currentArchiveLastId = archivedLastId;
    const didGrow = archivedMessages.length > previousArchiveLength;
    const didTailAppend = didGrow &&
      !!previousArchiveLastId &&
      previousArchiveLastId !== currentArchiveLastId &&
      previousArchiveFirstId === currentArchiveFirstId;
    const didHeadPrepend = didGrow &&
      !!previousArchiveFirstId &&
      previousArchiveFirstId !== currentArchiveFirstId;

    if (
      didHeadPrepend &&
      !didTailAppend &&
      previousVisibleWindowStartIndex > 0
    ) {
      const delta = archivedMessages.length - previousArchiveLength;

      if (isTailOpenLockedRef?.current) {
        logLifecycleRef.current?.('history-auto-window-growth-skipped', {
          delta,
          growth: 'tail-open-lock-head-prepend',
          previousArchiveLength,
          previousVisibleWindowStartIndex,
        });
        logScrollRef.current?.('history-auto-window-growth-skipped', {
          delta,
          growth: 'tail-open-lock-head-prepend',
          previousArchiveLength,
          previousVisibleWindowStartIndex,
        });
      } else if (isControlledHistoryPrependRef?.current) {
        logLifecycleRef.current?.('history-auto-window-growth-skipped', {
          delta,
          growth: 'controlled-head-prepend',
          previousArchiveLength,
          previousVisibleWindowStartIndex,
        });
        logScrollRef.current?.('history-auto-window-growth-skipped', {
          delta,
          previousArchiveLength,
          previousVisibleWindowStartIndex,
        });
      } else {
        logLifecycleRef.current?.('preserve-visible-window-growth', {
          delta,
          growth: 'head-prepend',
          previousArchiveFirstId,
          previousArchiveLastId,
          previousArchiveLength,
          previousVisibleWindowStartIndex,
        });
        logScrollRef.current?.('preserve-visible-window-growth', {
          delta,
          growth: 'head-prepend',
          previousArchiveLength,
          previousVisibleWindowStartIndex,
        });
        setVisibleMessageCount((current) => Math.min(archivedMessages.length, current + delta));
      }
    } else if (didTailAppend) {
      const delta = archivedMessages.length - previousArchiveLength;

      logLifecycleRef.current?.('skip-visible-window-growth', {
        currentArchiveLastId,
        delta,
        effectiveVisibleCount: effectiveVisibleMessageCount,
        growth: 'tail-append',
        previousArchiveLastId,
        previousArchiveLength,
        renderTailAppendBoost,
      });
      if (renderTailAppendBoost > 0) {
        setVisibleMessageCount((current) => Math.min(
          archivedMessages.length,
          TAIL_APPEND_VISIBLE_MESSAGE_LIMIT,
          current + delta,
        ));
      }
    } else if (didGrow && previousVisibleWindowStartIndex > 0) {
      logLifecycleRef.current?.('skip-visible-window-growth', {
        currentArchiveFirstId,
        currentArchiveLastId,
        growth: 'mixed-or-replace',
        previousArchiveFirstId,
        previousArchiveLastId,
        previousArchiveLength,
      });
    }

    previousArchiveLengthRef.current = archivedMessages.length;
    previousArchiveFirstIdRef.current = currentArchiveFirstId;
    previousArchiveLastIdRef.current = currentArchiveLastId;
    previousVisibleWindowStartIndexRef.current = visibleWindowStartIndex;
  }, [
    archivedFirstId,
    archivedLastId,
    archivedMessages.length,
    effectiveVisibleMessageCount,
    renderTailAppendBoost,
    visibleWindowStartIndex,
  ]);

  useEffect(() => {
    previousVisibleWindowStartIndexRef.current = visibleWindowStartIndex;
  }, [visibleWindowStartIndex]);

  const resetVisibleWindow = useCallback(() => {
    setVisibleMessageCount(INITIAL_VISIBLE_MESSAGE_COUNT);
  }, []);

  return {
    archivedMessages,
    archivedMessagesRef,
    effectiveVisibleMessageCount,
    messages,
    renderTailAppendBoost,
    resetVisibleWindow,
    setVisibleMessageCount,
    visibleMessageCount,
    visibleWindowStartIndex,
  };
}

function getMessageDeleteKey(message?: Message | null) {
  const metadata = message?.metadata;

  return metadata &&
    typeof metadata === 'object' &&
    'deleteKey' in metadata &&
    typeof metadata.deleteKey === 'string'
    ? metadata.deleteKey
    : undefined;
}
