#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(CallNative, NSObject)

RCT_EXTERN_METHOD(getAppVersion:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(setQuickReplyCredentials:(NSString *)serverUrl
                  authToken:(NSString *)authToken)
RCT_EXTERN_METHOD(clearQuickReplyCredentials)
RCT_EXTERN_METHOD(setMediaViewerOrientationUnlocked:(BOOL)unlocked)
RCT_EXTERN_METHOD(cancelMessageNotifications:(NSString * _Nullable)conversationId)
RCT_EXTERN_METHOD(waitForCallKitAudioActivation:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(answerIncomingCallKitCall:(NSString *)callId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(suppressIncomingCallKitCall:(NSString *)callId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(peekPendingAnsweredCallKitCallId:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(peekPendingAnsweredCallKitUrl:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(consumePendingIncomingCallUrl:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(peekPendingIncomingCallUrl:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(generateAppAttestKey:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(attestAppAttestKey:(NSString *)keyId
                  challenge:(NSString *)challenge
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(registerVoipPushToken:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(isMultitaskingCameraAccessSupported:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(consumeSharedItems:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(hasPendingSharedItems:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(processVoiceMessage:(NSString *)uri
                  effectId:(NSString *)effectId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(saveFile:(NSString *)uri
                  mimeType:(NSString * _Nullable)mimeType
                  displayName:(NSString * _Nullable)displayName
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(shareFile:(NSString *)uri
                  mimeType:(NSString * _Nullable)mimeType
                  displayName:(NSString * _Nullable)displayName
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(renderImageDrawing:(NSString *)uri
                  strokesJson:(NSString *)strokesJson
                  outputFileName:(NSString * _Nullable)outputFileName
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(endCall:(NSString *)callId)
RCT_EXTERN_METHOD(setLiveVoiceEffect:(NSString *)effectId)
RCT_EXTERN_METHOD(setProximityScreenOffEnabled:(BOOL)enabled)
RCT_EXTERN_METHOD(setScreenCaptureProtection:(BOOL)enabled)
RCT_EXTERN_METHOD(getCallAudioRoutes:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(prepareCallAudioSession:(NSString *)mode
                  useSpeaker:(BOOL)useSpeaker
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(prepareCallKitAudioSession:(NSString *)mode
                  useSpeaker:(BOOL)useSpeaker
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(selectCallAudioRoute:(NSString *)routeId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(clearCallAudioRoute)
RCT_EXTERN_METHOD(startIncomingRingtone)
RCT_EXTERN_METHOD(stopIncomingRingtone)
RCT_EXTERN_METHOD(startOutgoingRingback:(NSString *)uri
                  mode:(NSString *)mode
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(stopOutgoingRingback)

@end
