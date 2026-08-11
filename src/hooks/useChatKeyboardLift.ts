import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { Dimensions, Keyboard, KeyboardEvent, Platform } from 'react-native';

import { noteHighPriorityUiActivity } from '../lib/foregroundWorkScheduler';

type ChatKeyboardDiagnostic = (event: string, details?: Record<string, unknown>) => void;

type ScheduleTailScroll = (options?: { reason?: string; settle?: boolean }) => void;

type UseChatKeyboardLiftOptions = {
  bottomInset: number;
  isCaptionComposerVisible: boolean;
  isNearBottomRef: MutableRefObject<boolean>;
  isTailForced: () => boolean;
  logLifecycle?: ChatKeyboardDiagnostic;
  logScroll?: ChatKeyboardDiagnostic;
  scheduleTailScroll: ScheduleTailScroll;
  topInset: number;
  windowHeight: number;
};

export type ChatKeyboardLiftController = {
  isKeyboardVisibleRef: MutableRefObject<boolean>;
  keyboardLift: number;
  keyboardLiftRef: MutableRefObject<number>;
};

export function useChatKeyboardLift({
  bottomInset,
  isCaptionComposerVisible,
  isNearBottomRef,
  isTailForced,
  logLifecycle,
  logScroll,
  scheduleTailScroll,
  topInset,
  windowHeight,
}: UseChatKeyboardLiftOptions): ChatKeyboardLiftController {
  const [keyboardLift, setKeyboardLift] = useState(0);
  const keyboardBaselineWindowHeightRef = useRef(0);
  const keyboardLiftRef = useRef(0);
  const keyboardRawLiftRef = useRef(0);
  const isKeyboardVisibleRef = useRef(false);
  const isTailForcedRef = useRef(isTailForced);
  const logLifecycleRef = useRef(logLifecycle);
  const logScrollRef = useRef(logScroll);
  const scheduleTailScrollRef = useRef(scheduleTailScroll);

  isTailForcedRef.current = isTailForced;
  logLifecycleRef.current = logLifecycle;
  logScrollRef.current = logScroll;
  scheduleTailScrollRef.current = scheduleTailScroll;

  const setMeasuredKeyboardLift = useCallback((value: number) => {
    const nextValue = Math.max(0, Math.ceil(value));
    const threshold = Platform.OS === 'android' ? 12 : 2;

    if (
      nextValue !== 0 &&
      keyboardLiftRef.current !== 0 &&
      Math.abs(nextValue - keyboardLiftRef.current) <= threshold
    ) {
      return false;
    }

    keyboardLiftRef.current = nextValue;
    setKeyboardLift(nextValue);
    return true;
  }, []);

  const reconcileAndroidKeyboardLift = useCallback((reason: string) => {
    if (Platform.OS !== 'android' || !isKeyboardVisibleRef.current) {
      return;
    }

    const rawLift = keyboardRawLiftRef.current;
    const baselineWindowHeight = keyboardBaselineWindowHeightRef.current;
    const currentWindowHeight = Dimensions.get('window').height;
    const resizedBy = baselineWindowHeight > 0 && currentWindowHeight > 0
      ? Math.max(0, baselineWindowHeight - currentWindowHeight)
      : 0;
    const nextLift = Math.max(0, rawLift - resizedBy);
    const didChange = setMeasuredKeyboardLift(nextLift);
    const details = {
      baselineWindowHeight: Math.round(baselineWindowHeight),
      currentWindowHeight: Math.round(currentWindowHeight),
      didChange,
      nextLift: Math.round(nextLift),
      rawLift: Math.round(rawLift),
      reason,
      resizedBy: Math.round(resizedBy),
    };

    logLifecycleRef.current?.('android-keyboard-lift-reconciled', details);
    logScrollRef.current?.('android-keyboard-lift-reconciled', details);
  }, [setMeasuredKeyboardLift]);

  useEffect(() => {
    reconcileAndroidKeyboardLift('window-layout');
  }, [reconcileAndroidKeyboardLift, windowHeight]);

  useEffect(() => {
    function getKeyboardLift(event: KeyboardEvent) {
      const screenHeight = Dimensions.get('screen').height;
      const keyboardTop = event.endCoordinates.screenY;
      const maxReasonableLift = Math.max(0, windowHeight - topInset - bottomInset);
      const liftFromTop = screenHeight > 0 && keyboardTop > 0
        ? screenHeight - keyboardTop - bottomInset
        : 0;
      const liftFromHeight = event.endCoordinates.height - bottomInset;

      return Math.min(Math.max(liftFromTop, liftFromHeight, 0), maxReasonableLift);
    }

    function showKeyboard(event: KeyboardEvent) {
      if (isCaptionComposerVisible) {
        return;
      }

      noteHighPriorityUiActivity(900);

      if (Platform.OS === 'ios') {
        const nextLift = getKeyboardLift(event);
        const didChange = setMeasuredKeyboardLift(nextLift);
        isKeyboardVisibleRef.current = nextLift > 0;
        const details = {
          didChange,
          keyboardLift: Math.round(nextLift),
        };

        logLifecycleRef.current?.('ios-keyboard-change', details);
        logScrollRef.current?.('ios-keyboard-change', details);
        return;
      }

      isKeyboardVisibleRef.current = true;
      keyboardRawLiftRef.current = getKeyboardLift(event);
      const previousLift = keyboardLiftRef.current;
      reconcileAndroidKeyboardLift('keyboard-event');
      const details = {
        didChange: previousLift !== keyboardLiftRef.current,
        keyboardLift: Math.round(keyboardRawLiftRef.current),
      };

      logLifecycleRef.current?.('keyboard-show', details);
      logScrollRef.current?.('keyboard-show', details);
    }

    function hideKeyboard() {
      if (isCaptionComposerVisible) {
        return;
      }

      noteHighPriorityUiActivity(500);

      keyboardRawLiftRef.current = 0;
      const didChange = setMeasuredKeyboardLift(0);
      isKeyboardVisibleRef.current = false;
      keyboardBaselineWindowHeightRef.current = Math.max(Dimensions.get('window').height, windowHeight);
      logLifecycleRef.current?.('keyboard-hide', { didChange });
      logScrollRef.current?.('keyboard-hide', { didChange });
      if (didChange && (isNearBottomRef.current || isTailForcedRef.current())) {
        scheduleTailScrollRef.current({ reason: 'keyboard-hide', settle: false });
      }
    }

    if (!isKeyboardVisibleRef.current) {
      keyboardBaselineWindowHeightRef.current = Math.max(
        keyboardBaselineWindowHeightRef.current,
        Dimensions.get('window').height,
        windowHeight,
      );
    }

    const showSubscription = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', showKeyboard);
    const changeSubscription = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillChangeFrame' : 'keyboardDidChangeFrame', showKeyboard);
    const hideSubscription = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', hideKeyboard);

    return () => {
      showSubscription.remove();
      changeSubscription.remove();
      hideSubscription.remove();
    };
  }, [
    bottomInset,
    isCaptionComposerVisible,
    reconcileAndroidKeyboardLift,
    setMeasuredKeyboardLift,
    topInset,
    windowHeight,
  ]);

  return {
    isKeyboardVisibleRef,
    keyboardLift,
    keyboardLiftRef,
  };
}
