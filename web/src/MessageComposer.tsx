import { Send } from 'lucide-react';
import React, { forwardRef, memo, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';

const LONG_PRESS_MS = 500;
const MAX_TEXTAREA_HEIGHT = 148;
const DRAFT_STORAGE_PREFIX = 'meetvap.web.draft.v1.';
const DRAFT_SAVE_DELAY_MS = 250;

export type MessageComposerHandle = {
  append: (text: string) => void;
  clear: () => void;
  focus: () => void;
  getValue: () => string;
  setValue: (text: string) => void;
};

type MessageComposerProps = {
  disabled: boolean;
  draftKey: string | null;
  isSendOptionPending: boolean;
  onLongPressSend: () => void;
  onPaste: (event: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  onSend: (body: string) => void;
  placeholder: string;
  sendLabel: string;
};

export const MessageComposer = memo(forwardRef<MessageComposerHandle, MessageComposerProps>(function MessageComposer({
  disabled,
  draftKey,
  isSendOptionPending,
  onLongPressSend,
  onPaste,
  onSend,
  placeholder,
  sendLabel,
}, ref) {
  const [value, setValue] = useState(() => readDraft(draftKey));
  const valueRef = useRef(value);
  const activeDraftKeyRef = useRef(draftKey);
  const draftSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressNextClickRef = useRef(false);

  function cancelDraftSave() {
    if (draftSaveTimerRef.current) {
      clearTimeout(draftSaveTimerRef.current);
      draftSaveTimerRef.current = null;
    }
  }

  function flushDraft() {
    cancelDraftSave();
    persistDraft(activeDraftKeyRef.current, valueRef.current);
  }

  function scheduleDraftSave() {
    cancelDraftSave();
    draftSaveTimerRef.current = setTimeout(() => {
      draftSaveTimerRef.current = null;
      persistDraft(activeDraftKeyRef.current, valueRef.current);
    }, DRAFT_SAVE_DELAY_MS);
  }

  function updateValue(nextValue: string, persist = true) {
    valueRef.current = nextValue;
    setValue(nextValue);

    if (persist) {
      scheduleDraftSave();
    }
  }

  function stopLongPressTimer() {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }

  useImperativeHandle(ref, () => ({
    append(text) {
      updateValue(`${valueRef.current}${text}`);
      requestAnimationFrame(() => textareaRef.current?.focus());
    },
    clear() {
      cancelDraftSave();
      updateValue('', false);
      persistDraft(activeDraftKeyRef.current, '');
    },
    focus() {
      textareaRef.current?.focus();
    },
    getValue() {
      return valueRef.current;
    },
    setValue(text) {
      updateValue(text);
    },
  }), []);

  useLayoutEffect(() => {
    if (activeDraftKeyRef.current === draftKey) {
      return;
    }

    flushDraft();
    activeDraftKeyRef.current = draftKey;
    updateValue(readDraft(draftKey), false);
  }, [draftKey]);

  useEffect(() => {
    const textarea = textareaRef.current;

    if (!textarea) {
      return;
    }

    textarea.style.height = 'auto';
    const nextHeight = Math.min(textarea.scrollHeight, MAX_TEXTAREA_HEIGHT);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > MAX_TEXTAREA_HEIGHT ? 'auto' : 'hidden';
  }, [value]);

  useEffect(() => () => {
    stopLongPressTimer();
    flushDraft();
  }, []);

  function submit() {
    const body = valueRef.current.trim();

    if (body) {
      onSend(body);
    }
  }

  return (
    <>
      <textarea
        disabled={disabled}
        onChange={(event) => updateValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            submit();
          }
        }}
        onPaste={onPaste}
        placeholder={placeholder}
        ref={textareaRef}
        rows={1}
        value={value}
      />
      <button
        aria-label={sendLabel}
        disabled={!value.trim()}
        onClick={() => {
          if (suppressNextClickRef.current) {
            suppressNextClickRef.current = false;
            return;
          }

          submit();
        }}
        onContextMenu={(event) => event.preventDefault()}
        onPointerCancel={stopLongPressTimer}
        onPointerDown={() => {
          if (!valueRef.current.trim() || isSendOptionPending) {
            return;
          }

          stopLongPressTimer();
          suppressNextClickRef.current = false;
          longPressTimerRef.current = setTimeout(() => {
            longPressTimerRef.current = null;
            suppressNextClickRef.current = true;
            onLongPressSend();
          }, LONG_PRESS_MS);
        }}
        onPointerLeave={stopLongPressTimer}
        onPointerUp={stopLongPressTimer}
        title={sendLabel}
      >
        <Send aria-hidden size={18} />
      </button>
    </>
  );
}));

function getDraftStorageKey(draftKey: string) {
  return `${DRAFT_STORAGE_PREFIX}${draftKey}`;
}

function readDraft(draftKey: string | null) {
  if (!draftKey) {
    return '';
  }

  try {
    return localStorage.getItem(getDraftStorageKey(draftKey)) ?? '';
  } catch {
    return '';
  }
}

function persistDraft(draftKey: string | null, value: string) {
  if (!draftKey) {
    return;
  }

  try {
    const storageKey = getDraftStorageKey(draftKey);

    if (value.length > 0) {
      localStorage.setItem(storageKey, value);
    } else {
      localStorage.removeItem(storageKey);
    }
  } catch {
    // Draft persistence is best-effort when browser storage is unavailable.
  }
}
