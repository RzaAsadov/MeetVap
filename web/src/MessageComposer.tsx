import { Send } from 'lucide-react';
import React, { forwardRef, memo, useEffect, useImperativeHandle, useRef, useState } from 'react';

const LONG_PRESS_MS = 500;
const MAX_TEXTAREA_HEIGHT = 148;

export type MessageComposerHandle = {
  append: (text: string) => void;
  clear: () => void;
  focus: () => void;
  getValue: () => string;
  setValue: (text: string) => void;
};

type MessageComposerProps = {
  disabled: boolean;
  isSendOptionPending: boolean;
  onLongPressSend: () => void;
  onPaste: (event: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  onSend: (body: string) => void;
  placeholder: string;
  sendLabel: string;
};

export const MessageComposer = memo(forwardRef<MessageComposerHandle, MessageComposerProps>(function MessageComposer({
  disabled,
  isSendOptionPending,
  onLongPressSend,
  onPaste,
  onSend,
  placeholder,
  sendLabel,
}, ref) {
  const [value, setValue] = useState('');
  const valueRef = useRef('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressNextClickRef = useRef(false);

  function updateValue(nextValue: string) {
    valueRef.current = nextValue;
    setValue(nextValue);
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
      updateValue('');
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

  useEffect(() => () => stopLongPressTimer(), []);

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

