import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { Dimensions, Keyboard, KeyboardEvent, Platform } from 'react-native';

type ChatKeyboardDiagnostic = (event: string, details?: Record<string, unknown>) => void;

type ScheduleTailScroll = (options?: { reason?: string; settle?: boolean }) => void;

type UseChatKeyboardLiftOptions = {
  bottomInset: number;
  isCaptionComposerVisible: boolean;
  isNearBottomRef: MutableRefObject<boolean>;
  isTailForced: () => boolean;
  listViewportHeightRef: MutableRefObject<number>;
  logLifecycle?: ChatKeyboardDiagnostic;
  logScroll?: ChatKeyboardDiagnostic;
  scheduleTailScroll: ScheduleTailScroll;
  topInset: number;
  windowHeight: number;
};

export type ChatKeyboardLiftController = {
  isKeyboardVisibleRef: MutableRefObject<boolean>;
  keyboardBaselineViewportHeightRef: MutableRefObject<number>;
  keyboardLift: number;
  keyboardLiftRef: MutableRefObject<number>;
};

export function useChatKeyboardLift({
  bottomInset,
  isCaptionComposerVisible,
  isNearBottomRef,
  isTailForced,
  listViewportHeightRef,
  logLifecycle,
  logScroll,
  scheduleTailScroll,
  topInset,
  windowHeight,
}: UseChatKeyboardLiftOptions): ChatKeyboardLiftController {
  const [keyboardLift, setKeyboardLift] = useState(0);
  const keyboardBaselineWindowHeightRef = useRef(0);
  const keyboardBaselineViewportHeightRef = useRef(0);
  const keyboardLiftDecisionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

    function setMeasuredKeyboardLift(value: number) {
      const nextValue = Math.max(0, Math.ceil(value));
      const threshold = Platform.OS === 'android' ? 12 : 2;

      if (Math.abs(nextValue - keyboardLiftRef.current) <= threshold) {
        return false;
      }

      keyboardLiftRef.current = nextValue;
      setKeyboardLift(nextValue);
      return true;
    }

    function clearKeyboardLiftDecisionTimeout() {
      if (keyboardLiftDecisionTimeoutRef.current) {
        clearTimeout(keyboardLiftDecisionTimeoutRef.current);
        keyboardLiftDecisionTimeoutRef.current = null;
      }
    }

    function applyAndroidKeyboardLiftOnce(reason: string) {
      if (Platform.OS !== 'android' || !isKeyboardVisibleRef.current) {
        return;
      }

      const rawLift = keyboardRawLiftRef.current;
      const baselineViewportHeight = keyboardBaselineViewportHeightRef.current;
      const currentViewportHeight = listViewportHeightRef.current;
      const resizedBy = baselineViewportHeight > 0 && currentViewportHeight > 0
        ? Math.max(0, baselineViewportHeight - currentViewportHeight)
        : 0;
      const resizeLooksHandled = rawLift > 0 && resizedBy >= Math.max(80, rawLift * 0.45);
      const nextLift = resizeLooksHandled ? 0 : rawLift;
      const didChange = setMeasuredKeyboardLift(nextLift);

      const details = {
        baselineViewportHeight: Math.round(baselineViewportHeight),
        currentViewportHeight: Math.round(currentViewportHeight),
        didChange,
        nextLift: Math.round(nextLift),
        rawLift: Math.round(rawLift),
        reason,
        resizedBy: Math.round(resizedBy),
        resizeLooksHandled,
      };
      logLifecycleRef.current?.('android-keyboard-lift-decision', details);
      logScrollRef.current?.('android-keyboard-lift-decision', details);
    }

    function showKeyboard(event: KeyboardEvent) {
      if (isCaptionComposerVisible) {
        return;
      }

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
      clearKeyboardLiftDecisionTimeout();
      const didChange = setMeasuredKeyboardLift(0);
      keyboardLiftDecisionTimeoutRef.current = setTimeout(() => {
        keyboardLiftDecisionTimeoutRef.current = null;
        applyAndroidKeyboardLiftOnce('show-settled');
      }, 180);
      const details = {
        didChange,
        keyboardLift: Math.round(keyboardRawLiftRef.current),
      };

      logLifecycleRef.current?.('keyboard-show', details);
      logScrollRef.current?.('keyboard-show', details);
    }

    function hideKeyboard() {
      if (isCaptionComposerVisible) {
        return;
      }

      clearKeyboardLiftDecisionTimeout();
      keyboardRawLiftRef.current = 0;
      const didChange = setMeasuredKeyboardLift(0);
      isKeyboardVisibleRef.current = false;
      keyboardBaselineWindowHeightRef.current = Math.max(Dimensions.get('window').height, windowHeight);
      if (listViewportHeightRef.current > 0) {
        keyboardBaselineViewportHeightRef.current = Math.max(keyboardBaselineViewportHeightRef.current, listViewportHeightRef.current);
      }
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
      clearKeyboardLiftDecisionTimeout();
      showSubscription.remove();
      changeSubscription.remove();
      hideSubscription.remove();
    };
  }, [
    bottomInset,
    isCaptionComposerVisible,
    listViewportHeightRef,
    topInset,
    windowHeight,
  ]);

  return {
    isKeyboardVisibleRef,
    keyboardBaselineViewportHeightRef,
    keyboardLift,
    keyboardLiftRef,
  };
}
