import AVFAudio
import AVFoundation
import CallKit
import CryptoKit
import DeviceCheck
internal import ExpoNotifications
import Foundation
import livekit_react_native
import livekit_react_native_webrtc
import PushKit
import QuartzCore
import React
import Photos
import Security
import UniformTypeIdentifiers
import UIKit
import UserNotifications

@objc(CallNative)
class CallNative: NSObject {
  static func bootstrap() {
    CallNativeQuickReplyHandler.shared.start()
    CallNativeCallManager.shared.startPushRegistry()
  }

  static func noteIncomingCallUrlOpened(_ url: URL) {
    CallNativeCallManager.shared.noteIncomingCallUrlOpened(url)
  }

  @objc
  static func requiresMainQueueSetup() -> Bool {
    true
  }

  private static func base64UrlDecode(_ input: String) -> Data? {
    var normalized = input
      .replacingOccurrences(of: "-", with: "+")
      .replacingOccurrences(of: "_", with: "/")
    let paddingLength = (4 - normalized.count % 4) % 4

    if paddingLength > 0 {
      normalized += String(repeating: "=", count: paddingLength)
    }

    return Data(base64Encoded: normalized)
  }

  @objc(getAppVersion:rejecter:)
  func getAppVersion(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    resolve(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String)
  }

  @objc(setQuickReplyCredentials:authToken:)
  func setQuickReplyCredentials(_ serverUrl: String, authToken: String) {
    CallNativeQuickReplyCredentials.shared.save(serverUrl: serverUrl, authToken: authToken)
  }

  @objc
  func clearQuickReplyCredentials() {
    CallNativeQuickReplyCredentials.shared.clear()
  }

  @objc(setMediaViewerOrientationUnlocked:)
  func setMediaViewerOrientationUnlocked(_ unlocked: Bool) {
    DispatchQueue.main.async {
      CallNativeOrientationLock.shared.setMediaViewerUnlocked(unlocked)
    }
  }

  @objc(cancelMessageNotifications:)
  func cancelMessageNotifications(_ conversationId: String?) {
    guard let conversationId, !conversationId.isEmpty else {
      return
    }

    UNUserNotificationCenter.current().getDeliveredNotifications { notifications in
      let identifiers = notifications.compactMap { notification -> String? in
        let userInfo = notification.request.content.userInfo
        let type = userInfo["type"] as? String
        let notificationConversationId = userInfo["conversationId"] as? String

        return type == "message" && notificationConversationId == conversationId
          ? notification.request.identifier
          : nil
      }

      if !identifiers.isEmpty {
        UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: identifiers)
      }
    }
  }

  @objc(waitForCallKitAudioActivation:rejecter:)
  func waitForCallKitAudioActivation(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    CallNativeCallManager.shared.waitForCallKitAudioActivation(resolve: resolve)
  }

  @objc(answerIncomingCallKitCall:resolver:rejecter:)
  func answerIncomingCallKitCall(
    _ callId: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    CallNativeCallManager.shared.answerIncomingCallKitCall(callId: callId, resolve: resolve)
  }

  @objc(suppressIncomingCallKitCall:resolver:rejecter:)
  func suppressIncomingCallKitCall(
    _ callId: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    CallNativeCallManager.shared.suppressIncomingCallKitCall(callId: callId)
    resolve(true)
  }

  @objc(peekPendingAnsweredCallKitCallId:rejecter:)
  func peekPendingAnsweredCallKitCallId(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    resolve(CallNativeCallManager.shared.peekPendingAnsweredCallKitCallId())
  }

  @objc(peekPendingAnsweredCallKitUrl:rejecter:)
  func peekPendingAnsweredCallKitUrl(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    resolve(CallNativeCallManager.shared.peekPendingAnsweredCallKitUrl())
  }

  @objc(consumePendingIncomingCallUrl:rejecter:)
  func consumePendingIncomingCallUrl(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    resolve(CallNativeCallManager.shared.consumePendingIncomingCallUrl())
  }

  @objc(peekPendingIncomingCallUrl:rejecter:)
  func peekPendingIncomingCallUrl(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    resolve(CallNativeCallManager.shared.peekPendingIncomingCallUrl())
  }

  @objc(generateAppAttestKey:rejecter:)
  func generateAppAttestKey(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    if #available(iOS 14.0, *) {
      let service = DCAppAttestService.shared

      guard service.isSupported else {
        resolve(nil)
        return
      }

      service.generateKey { keyId, error in
        if let error = error {
          reject("app_attest_key_failed", error.localizedDescription, error)
          return
        }

        resolve(keyId)
      }
    } else {
      resolve(nil)
    }
  }

  @objc(attestAppAttestKey:challenge:resolver:rejecter:)
  func attestAppAttestKey(
    _ keyId: String,
    challenge: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    if #available(iOS 14.0, *) {
      let service = DCAppAttestService.shared

      guard service.isSupported else {
        resolve(nil)
        return
      }

      guard let challengeData = CallNative.base64UrlDecode(challenge) else {
        reject("app_attest_invalid_challenge", "Invalid App Attest challenge", nil)
        return
      }

      let clientDataHash = Data(SHA256.hash(data: challengeData))
      service.attestKey(keyId, clientDataHash: clientDataHash) { attestationObject, error in
        if let error = error {
          reject("app_attest_failed", error.localizedDescription, error)
          return
        }

        resolve(attestationObject?.base64EncodedString())
      }
    } else {
      resolve(nil)
    }
  }

  @objc(registerVoipPushToken:rejecter:)
  func registerVoipPushToken(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    CallNativeCallManager.shared.registerVoipPushToken(resolve: resolve, reject: reject)
  }

  @objc(isMultitaskingCameraAccessSupported:rejecter:)
  func isMultitaskingCameraAccessSupported(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.main.async {
      if #available(iOS 16.0, *) {
        let session = AVCaptureSession()
        resolve(session.isMultitaskingCameraAccessSupported)
      } else {
        resolve(false)
      }
    }
  }

  @objc(consumeSharedItems:rejecter:)
  func consumeSharedItems(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    do {
      resolve(try SharedImportStore.consumeSharedItems())
    } catch {
      reject("shared_items_failed", error.localizedDescription, error)
    }
  }

  @objc(hasPendingSharedItems:rejecter:)
  func hasPendingSharedItems(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    resolve(SharedImportStore.hasPendingSharedItems())
  }

  @objc(endCall:)
  func endCall(_ callId: String) {
    CallNativeCallManager.shared.reportCallEnded(callId: callId)
  }

  @objc(setProximityScreenOffEnabled:)
  func setProximityScreenOffEnabled(_ enabled: Bool) {
    DispatchQueue.main.async {
      UIDevice.current.isProximityMonitoringEnabled = enabled
    }
  }

  @objc(setScreenCaptureProtection:)
  func setScreenCaptureProtection(_ enabled: Bool) {
    DispatchQueue.main.async {
      CallNativeScreenCaptureProtection.shared.setEnabled(enabled)
    }
  }

  @objc(getCallAudioRoutes:rejecter:)
  func getCallAudioRoutes(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.main.async {
      resolve(CallNativeAudioRouteManager.shared.routes())
    }
  }

  @objc(prepareCallAudioSession:useSpeaker:resolver:rejecter:)
  func prepareCallAudioSession(
    _ mode: String,
    useSpeaker: Bool,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.main.async {
      do {
        try CallNativeAudioRouteManager.shared.prepareCallSession(mode: mode, useSpeaker: useSpeaker)
        resolve(true)
      } catch {
        reject("call_audio_prepare_failed", error.localizedDescription, error)
      }
    }
  }

  @objc(prepareCallKitAudioSession:useSpeaker:resolver:rejecter:)
  func prepareCallKitAudioSession(
    _ mode: String,
    useSpeaker: Bool,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.main.async {
      do {
        try CallNativeAudioRouteManager.shared.prepareCallKitSession(mode: mode, useSpeaker: useSpeaker)
        resolve(true)
      } catch {
        reject("callkit_audio_prepare_failed", error.localizedDescription, error)
      }
    }
  }

  @objc(selectCallAudioRoute:resolver:rejecter:)
  func selectCallAudioRoute(
    _ routeId: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.main.async {
      do {
        resolve(try CallNativeAudioRouteManager.shared.select(routeId: routeId))
      } catch {
        reject("call_audio_route_failed", error.localizedDescription, error)
      }
    }
  }

  @objc
  func clearCallAudioRoute() {
    DispatchQueue.main.async {
      CallNativeAudioRouteManager.shared.clear()
    }
  }

  @objc(setLiveVoiceEffect:)
  func setLiveVoiceEffect(_ effectId: String) {
    CallNativeLiveVoiceEffectController.shared.setEffect(effectId)
  }

  @objc(processVoiceMessage:effectId:resolver:rejecter:)
  func processVoiceMessage(
    _ uri: String,
    effectId: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    VoiceMessageProcessor.process(inputUri: uri, effectId: effectId, resolve: resolve, reject: reject)
  }

  @objc(saveFile:mimeType:displayName:resolver:rejecter:)
  func saveFile(
    _ uri: String,
    mimeType: String?,
    displayName: String?,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    MediaSaveCoordinator.shared.save(
      uri: uri,
      mimeType: mimeType,
      displayName: displayName,
      resolve: resolve,
      reject: reject
    )
  }

  @objc(shareFile:mimeType:displayName:resolver:rejecter:)
  func shareFile(
    _ uri: String,
    mimeType: String?,
    displayName: String?,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    MediaShareCoordinator.shared.share(
      uri: uri,
      mimeType: mimeType,
      displayName: displayName,
      resolve: resolve,
      reject: reject
    )
  }

  @objc(renderImageDrawing:strokesJson:outputFileName:resolver:rejecter:)
  func renderImageDrawing(
    _ uri: String,
    strokesJson: String,
    outputFileName: String?,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    ImageDrawingRenderer.render(
      uri: uri,
      strokesJson: strokesJson,
      outputFileName: outputFileName,
      resolve: resolve,
      reject: reject
    )
  }

  @objc
  func startIncomingRingtone() {
    CallNativeCallManager.shared.startIncomingRingtone()
  }

  @objc
  func stopIncomingRingtone() {
    CallNativeCallManager.shared.stopIncomingRingtone()
  }

  @objc(startOutgoingRingback:mode:resolver:rejecter:)
  func startOutgoingRingback(
    _ uri: String,
    mode: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.main.async {
      resolve(CallNativeOutgoingRingback.shared.start(uri: uri, mode: mode))
    }
  }

  @objc
  func stopOutgoingRingback() {
    DispatchQueue.main.async {
      CallNativeOutgoingRingback.shared.stop()
    }
  }
}

final class CallNativeOrientationLock {
  static let shared = CallNativeOrientationLock()

  private var isMediaViewerUnlocked = false

  var supportedInterfaceOrientations: UIInterfaceOrientationMask {
    isMediaViewerUnlocked ? .allButUpsideDown : .portrait
  }

  func setMediaViewerUnlocked(_ unlocked: Bool) {
    isMediaViewerUnlocked = unlocked

    refreshPresentedViewControllerOrientations()

    if #available(iOS 16.0, *) {
      UIApplication.shared.connectedScenes
        .compactMap { $0 as? UIWindowScene }
        .forEach { scene in
          scene.requestGeometryUpdate(.iOS(interfaceOrientations: supportedInterfaceOrientations))
        }
    }

    UIViewController.attemptRotationToDeviceOrientation()

    if !unlocked {
      UIDevice.current.setValue(UIInterfaceOrientation.portrait.rawValue, forKey: "orientation")
      refreshPresentedViewControllerOrientations()
      UINavigationController.attemptRotationToDeviceOrientation()
    }
  }

  private func refreshPresentedViewControllerOrientations() {
    UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap { $0.windows }
      .forEach { window in
        refreshSupportedOrientations(from: window.rootViewController)
      }
  }

  private func refreshSupportedOrientations(from viewController: UIViewController?) {
    guard let viewController else {
      return
    }

    if #available(iOS 16.0, *) {
      viewController.setNeedsUpdateOfSupportedInterfaceOrientations()
    }

    refreshSupportedOrientations(from: viewController.presentedViewController)

    if let navigationController = viewController as? UINavigationController {
      refreshSupportedOrientations(from: navigationController.visibleViewController)
    }

    if let tabBarController = viewController as? UITabBarController {
      refreshSupportedOrientations(from: tabBarController.selectedViewController)
    }
  }
}

private struct CallNativeQuickReplyCredentialPayload: Codable {
  let authToken: String
  let serverUrl: String
}

private final class CallNativeQuickReplyCredentials {
  static let shared = CallNativeQuickReplyCredentials()

  private let account = "quickReplyCredentials"
  private let service = "com.meetvap.messenger.quickReply"

  func save(serverUrl: String, authToken: String) {
    let payload = CallNativeQuickReplyCredentialPayload(
      authToken: authToken.trimmingCharacters(in: .whitespacesAndNewlines),
      serverUrl: serverUrl.trimmingCharacters(in: .whitespacesAndNewlines).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    )

    guard !payload.authToken.isEmpty, !payload.serverUrl.isEmpty, let data = try? JSONEncoder().encode(payload) else {
      clear()
      return
    }

    var query = baseQuery()
    query[kSecValueData as String] = data
    query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly

    let status = SecItemAdd(query as CFDictionary, nil)

    if status == errSecDuplicateItem {
      SecItemUpdate(baseQuery() as CFDictionary, [kSecValueData as String: data] as CFDictionary)
    }
  }

  func load() -> CallNativeQuickReplyCredentialPayload? {
    var query = baseQuery()
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne

    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)

    guard status == errSecSuccess, let data = item as? Data else {
      return nil
    }

    return try? JSONDecoder().decode(CallNativeQuickReplyCredentialPayload.self, from: data)
  }

  func clear() {
    SecItemDelete(baseQuery() as CFDictionary)
  }

  private func baseQuery() -> [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrAccount as String: account,
      kSecAttrService as String: service,
    ]
  }
}

private final class CallNativeQuickReplyHandler: NSObject, NotificationDelegate {
  static let shared = CallNativeQuickReplyHandler()

  private let maskHeader = "x-meetvap-mask"
  private let maskKey = "meetvap:first-api-mask:v1:2026-05"
  private let maskVersion = "v1"
  private let defaultServerUrl = "https://mm.meetvap.com"
  private var isRegistered = false

  func start() {
    guard !isRegistered else {
      return
    }

    isRegistered = true
    NotificationCenterManager.shared.addDelegate(self)
  }

  func didReceive(_ response: UNNotificationResponse, completionHandler: @escaping () -> Void) -> Bool {
    guard response.actionIdentifier == "reply", let textResponse = response as? UNTextInputNotificationResponse else {
      return false
    }

    let userInfo = response.notification.request.content.userInfo
    guard stringValue(userInfo["type"]) == "message", let conversationId = stringValue(userInfo["conversationId"]), !conversationId.isEmpty else {
      return false
    }

    let body = textResponse.userText.trimmingCharacters(in: .whitespacesAndNewlines)

    guard !body.isEmpty else {
      return true
    }

    let quickReplyToken = stringValue(userInfo["quickReplyToken"])?.trimmingCharacters(in: .whitespacesAndNewlines)
    sendQuickReply(
      body: body,
      conversationId: conversationId,
      notificationIdentifier: response.notification.request.identifier,
      quickReplyToken: quickReplyToken
    )
    return true
  }

  private func sendQuickReply(body: String, conversationId: String, notificationIdentifier: String, quickReplyToken: String?) {
    let credentials = CallNativeQuickReplyCredentials.shared.load()
    let backgroundTask = beginBackgroundTask()

    if let quickReplyToken, !quickReplyToken.isEmpty {
      post(
        body: [
          "body": body,
          "token": quickReplyToken,
        ],
        serverUrl: credentials?.serverUrl ?? defaultServerUrl,
        authToken: nil,
        path: "/conversations/quick-reply"
      ) { [weak self] sent in
        if sent {
          UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: [notificationIdentifier])
        }
        self?.endBackgroundTask(backgroundTask)
      }
      return
    }

    guard let credentials else {
      endBackgroundTask(backgroundTask)
      return
    }

    post(
      body: [
        "body": body,
        "kind": "TEXT",
        "metadata": [
          "clientId": "quick-reply-\(UUID().uuidString)",
        ],
      ],
      credentials: credentials,
      path: "/conversations/\(percentEncodePathComponent(conversationId))/messages"
    ) { [weak self] sent in
      guard sent else {
        self?.endBackgroundTask(backgroundTask)
        return
      }

      self?.post(
        body: [
          "source": "notification_action",
        ],
        credentials: credentials,
        path: "/conversations/\(self?.percentEncodePathComponent(conversationId) ?? conversationId)/read"
      ) { _ in
        UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: [notificationIdentifier])
        self?.endBackgroundTask(backgroundTask)
      }
    }
  }

  private func post(body: [String: Any], credentials: CallNativeQuickReplyCredentialPayload, path: String, completion: @escaping (Bool) -> Void) {
    post(body: body, serverUrl: credentials.serverUrl, authToken: credentials.authToken, path: path, completion: completion)
  }

  private func post(body: [String: Any], serverUrl: String, authToken: String?, path: String, completion: @escaping (Bool) -> Void) {
    guard let url = URL(string: "\(serverUrl)\(path)"), let payload = maskPayload(body) else {
      completion(false)
      return
    }

    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.httpBody = payload
    request.timeoutInterval = 15
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    if let authToken, !authToken.isEmpty {
      request.setValue("Bearer \(authToken)", forHTTPHeaderField: "Authorization")
    }
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue(maskVersion, forHTTPHeaderField: maskHeader)

    URLSession.shared.dataTask(with: request) { _, response, error in
      guard error == nil, let httpResponse = response as? HTTPURLResponse else {
        completion(false)
        return
      }

      completion((200...299).contains(httpResponse.statusCode))
    }.resume()
  }

  private func maskPayload(_ body: [String: Any]) -> Data? {
    guard
      let plainData = try? JSONSerialization.data(withJSONObject: body),
      let plainText = String(data: plainData, encoding: .utf8),
      let plainBytes = plainText.data(using: .utf8),
      let keyBytes = maskKey.data(using: .utf8)
    else {
      return nil
    }

    let plain = [UInt8](plainBytes)
    let key = [UInt8](keyBytes)
    var masked = [UInt8]()
    masked.reserveCapacity(plain.count)

    for index in plain.indices {
      masked.append(plain[index] ^ key[index % key.count])
    }

    let maskedPayload = Data(masked).base64EncodedString()
    return try? JSONSerialization.data(withJSONObject: ["payload": maskedPayload])
  }

  private func stringValue(_ value: Any?) -> String? {
    if let value = value as? String {
      return value
    }

    if let value = value as? CustomStringConvertible {
      return value.description
    }

    return nil
  }

  private func percentEncodePathComponent(_ value: String) -> String {
    value.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? value
  }

  private func beginBackgroundTask() -> UIBackgroundTaskIdentifier {
    if Thread.isMainThread {
      return UIApplication.shared.beginBackgroundTask(withName: "MeetVapQuickReply")
    }

    var task = UIBackgroundTaskIdentifier.invalid
    DispatchQueue.main.sync {
      task = UIApplication.shared.beginBackgroundTask(withName: "MeetVapQuickReply")
    }
    return task
  }

  private func endBackgroundTask(_ task: UIBackgroundTaskIdentifier) {
    guard task != .invalid else {
      return
    }

    DispatchQueue.main.async {
      UIApplication.shared.endBackgroundTask(task)
    }
  }
}

private final class CallNativeOutgoingRingback: NSObject, AVAudioPlayerDelegate {
  static let shared = CallNativeOutgoingRingback()

  private let pauseBetweenRepeats: TimeInterval = 1
  private let session = AVAudioSession.sharedInstance()
  private var player: AVAudioPlayer?
  private var recoveryTimer: Timer?
  private var routeObserver: NSObjectProtocol?
  private var interruptionObserver: NSObjectProtocol?
  private var isVideoMode = false
  private var nextReplayAt: Date?
  private var sourceURL: URL?

  func start(uri: String, mode: String) -> Bool {
    let isVideo = mode.caseInsensitiveCompare("video") == .orderedSame
    isVideoMode = isVideo

    do {
      try configureRoute(isVideo: isVideo)

      if player != nil {
        return true
      }

      stop()
      guard let url = URL(string: uri), url.isFileURL else {
        return false
      }

      sourceURL = url
      return startPlayer()
    } catch {
      stop()
      return false
    }
  }

  func stop() {
    recoveryTimer?.invalidate()
    recoveryTimer = nil
    if let routeObserver {
      NotificationCenter.default.removeObserver(routeObserver)
      self.routeObserver = nil
    }
    if let interruptionObserver {
      NotificationCenter.default.removeObserver(interruptionObserver)
      self.interruptionObserver = nil
    }
    player?.stop()
    player = nil
    nextReplayAt = nil
    sourceURL = nil
  }

  private func configureRoute(isVideo: Bool) throws {
    var options: AVAudioSession.CategoryOptions = [.allowBluetooth]
    if isVideo {
      options.insert(.allowBluetoothA2DP)
      options.insert(.defaultToSpeaker)
    }

    try session.setCategory(
      .playAndRecord,
      mode: isVideo ? .videoChat : .voiceChat,
      options: options
    )
    try session.setActive(true)
    try applyPreferredRoute(isVideo: isVideo)
  }

  private func applyPreferredRoute(isVideo: Bool) throws {
    if !isVideo {
      try session.setPreferredInput(
        session.availableInputs?.first(where: { $0.portType == .builtInMic })
      )
      try session.overrideOutputAudioPort(.none)
      return
    }

    if let externalInput = session.availableInputs?.first(where: isExternalInput) {
      try session.overrideOutputAudioPort(.none)
      try session.setPreferredInput(externalInput)
      return
    }

    try session.setPreferredInput(
      session.availableInputs?.first(where: { $0.portType == .builtInMic })
    )
    try session.overrideOutputAudioPort(isVideo ? .speaker : .none)
  }

  private func observeRouteChanges() {
    if routeObserver != nil {
      return
    }

    routeObserver = NotificationCenter.default.addObserver(
      forName: AVAudioSession.routeChangeNotification,
      object: session,
      queue: .main
    ) { [weak self] _ in
      guard let self, self.player != nil else {
        return
      }

      DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
        guard self.player != nil else {
          return
        }
        try? self.applyPreferredRoute(isVideo: self.isVideoMode)
      }
    }
  }

  private func startPlayer() -> Bool {
    guard let sourceURL else {
      return false
    }

    do {
      let nextPlayer = try AVAudioPlayer(contentsOf: sourceURL)
      nextPlayer.delegate = self
      nextPlayer.numberOfLoops = 0
      nextPlayer.volume = 0.62
      nextPlayer.prepareToPlay()

      guard nextPlayer.play() else {
        return false
      }

      player = nextPlayer
      nextReplayAt = nil
      observeRouteChanges()
      observeInterruptions()
      startRecoveryTimer()
      return true
    } catch {
      player = nil
      return false
    }
  }

  private func startRecoveryTimer() {
    recoveryTimer?.invalidate()
    let timer = Timer(timeInterval: 0.35, repeats: true) { [weak self] _ in
      guard let self, self.sourceURL != nil, self.player?.isPlaying != true else {
        return
      }

      if let nextReplayAt = self.nextReplayAt, nextReplayAt > Date() {
        return
      }

      do {
        try self.configureRoute(isVideo: self.isVideoMode)

        if let player = self.player {
          self.nextReplayAt = nil
          if player.duration > 0 && player.currentTime >= player.duration - 0.05 {
            player.currentTime = 0
          }
          player.prepareToPlay()
          if !player.play() {
            self.player = nil
            _ = self.startPlayer()
          }
        } else {
          _ = self.startPlayer()
        }
      } catch {
        // The next pass retries after WebRTC finishes changing the audio session.
      }
    }
    recoveryTimer = timer
    RunLoop.main.add(timer, forMode: .common)
  }

  private func observeInterruptions() {
    if interruptionObserver != nil {
      return
    }

    interruptionObserver = NotificationCenter.default.addObserver(
      forName: AVAudioSession.interruptionNotification,
      object: session,
      queue: .main
    ) { [weak self] _ in
      guard let self, self.sourceURL != nil else {
        return
      }

      DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
        guard self.sourceURL != nil, self.player?.isPlaying != true else {
          return
        }
        if let nextReplayAt = self.nextReplayAt, nextReplayAt > Date() {
          return
        }
        try? self.configureRoute(isVideo: self.isVideoMode)
        self.nextReplayAt = nil
        self.player?.prepareToPlay()
        self.player?.play()
      }
    }
  }

  func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
    guard self.player === player, sourceURL != nil else {
      return
    }

    nextReplayAt = flag ? Date().addingTimeInterval(pauseBetweenRepeats) : nil
  }

  private func isExternalInput(_ port: AVAudioSessionPortDescription) -> Bool {
    switch port.portType {
    case .bluetoothHFP, .bluetoothLE, .headsetMic, .usbAudio:
      return true
    default:
      return false
    }
  }
}

private final class CallNativeAudioRouteManager {
  static let shared = CallNativeAudioRouteManager()

  private let session = AVAudioSession.sharedInstance()

  func prepareCallSession(mode: String, useSpeaker: Bool) throws {
    let settings = callSessionSettings(mode: mode, useSpeaker: useSpeaker)

    try session.setCategory(
      .playAndRecord,
      mode: settings.isVideo ? .videoChat : .voiceChat,
      options: settings.options
    )
    try session.setActive(true)
    let rtcAudioSession = RTCAudioSession.sharedInstance()
    rtcAudioSession.audioSessionDidActivate(session)
    rtcAudioSession.isAudioEnabled = true
    try applyPreferredRoute(useSpeaker: useSpeaker)
  }

  func prepareCallKitSession(mode: String, useSpeaker: Bool) throws {
    let settings = callSessionSettings(mode: mode, useSpeaker: useSpeaker)

    try session.setCategory(
      .playAndRecord,
      mode: settings.isVideo ? .videoChat : .voiceChat,
      options: settings.options
    )
    RTCAudioSession.sharedInstance().isAudioEnabled = true
    try? applyPreferredRoute(useSpeaker: useSpeaker)
  }

  private func callSessionSettings(
    mode: String,
    useSpeaker: Bool
  ) -> (isVideo: Bool, options: AVAudioSession.CategoryOptions) {
    let isVideo = mode.caseInsensitiveCompare("video") == .orderedSame
    var options: AVAudioSession.CategoryOptions = [.allowBluetooth]

    if isVideo || useSpeaker {
      options.insert(.defaultToSpeaker)
    }

    if isVideo {
      options.insert(.allowBluetoothA2DP)
    }

    return (isVideo: isVideo, options: options)
  }

  private func applyPreferredRoute(useSpeaker: Bool) throws {
    if useSpeaker {
      try session.overrideOutputAudioPort(.speaker)
    } else {
      try session.overrideOutputAudioPort(.none)
      try session.setPreferredInput(
        session.availableInputs?.first(where: { $0.portType == .builtInMic })
      )
    }
  }

  func routes() -> [[String: Any]] {
    let activeType = session.currentRoute.outputs.first.map(routeType) ?? "earpiece"
    var routes = session.availableInputs?
      .filter { routeType($0) == "bluetooth" || routeType($0) == "wired" }
      .map { input in
        [
          "id": "input:\(input.uid)",
          "type": routeType(input),
          "name": input.portName,
          "isActive": routeType(input) == activeType,
        ] as [String: Any]
      } ?? []

    routes.append([
      "id": "speaker",
      "type": "speaker",
      "name": "Speaker",
      "isActive": activeType == "speaker",
    ])
    routes.append([
      "id": "earpiece",
      "type": "earpiece",
      "name": "Phone",
      "isActive": activeType == "earpiece",
    ])
    return routes
  }

  func select(routeId: String) throws -> Bool {
    try session.setActive(true)

    if routeId == "speaker" {
      try session.overrideOutputAudioPort(.speaker)
      return true
    }

    try session.overrideOutputAudioPort(.none)

    if routeId == "earpiece" {
      try session.setPreferredInput(
        session.availableInputs?.first(where: { $0.portType == .builtInMic })
      )
      return true
    }

    guard routeId.hasPrefix("input:") else {
      return false
    }

    let uid = String(routeId.dropFirst("input:".count))
    guard let input = session.availableInputs?.first(where: { $0.uid == uid }) else {
      return false
    }

    try session.setPreferredInput(input)
    return true
  }

  func clear() {
    try? session.overrideOutputAudioPort(.none)
    try? session.setPreferredInput(nil)
    let rtcAudioSession = RTCAudioSession.sharedInstance()
    rtcAudioSession.audioSessionDidDeactivate(session)
    rtcAudioSession.isAudioEnabled = false
  }

  private func routeType(_ port: AVAudioSessionPortDescription) -> String {
    switch port.portType {
    case .bluetoothA2DP, .bluetoothHFP, .bluetoothLE:
      return "bluetooth"
    case .headphones, .headsetMic, .usbAudio:
      return "wired"
    case .builtInSpeaker:
      return "speaker"
    default:
      return "earpiece"
    }
  }

  private func isExternalInput(_ port: AVAudioSessionPortDescription) -> Bool {
    switch port.portType {
    case .bluetoothA2DP, .bluetoothHFP, .bluetoothLE, .headphones, .headsetMic, .usbAudio:
      return true
    default:
      return false
    }
  }
}

private final class CallNativeScreenCaptureProtection {
  static let shared = CallNativeScreenCaptureProtection()

  private struct ProtectedWindowRecord {
    weak var window: UIWindow?
    let originalSuperlayer: CALayer
    let originalLayerIndex: UInt32
    let secureTextField: UITextField
  }

  private var isEnabled = false
  private var overlay: UIView?
  private var captureObserver: NSObjectProtocol?
  private var windowObserver: NSObjectProtocol?
  private var windowVisibleObserver: NSObjectProtocol?
  private var sceneObserver: NSObjectProtocol?
  private var appActiveObserver: NSObjectProtocol?
  private var appWillResignObserver: NSObjectProtocol?
  private var appBackgroundObserver: NSObjectProtocol?
  private var protectedWindows: [ObjectIdentifier: ProtectedWindowRecord] = [:]
  private var secureRetryCount = 0
  private var secureRetryScheduled = false
  private var containerMutationInProgress = false

  func setEnabled(_ enabled: Bool) {
    guard isEnabled != enabled else {
      if enabled {
        scheduleSecureContainerRetry()
      }
      updateCaptureOverlay()
      return
    }

    isEnabled = enabled

    if enabled {
      ensureSecureContainers()
      captureObserver = NotificationCenter.default.addObserver(
        forName: UIScreen.capturedDidChangeNotification,
        object: nil,
        queue: .main
      ) { [weak self] _ in
        self?.updateCaptureOverlay()
      }
      windowObserver = NotificationCenter.default.addObserver(
        forName: UIWindow.didBecomeKeyNotification,
        object: nil,
        queue: .main
      ) { [weak self] _ in
        self?.ensureSecureContainers()
        self?.scheduleSecureContainerRetry()
      }
      windowVisibleObserver = NotificationCenter.default.addObserver(
        forName: UIWindow.didBecomeVisibleNotification,
        object: nil,
        queue: .main
      ) { [weak self] _ in
        self?.ensureSecureContainers()
        self?.scheduleSecureContainerRetry()
      }
      sceneObserver = NotificationCenter.default.addObserver(
        forName: UIScene.didActivateNotification,
        object: nil,
        queue: .main
      ) { [weak self] _ in
        self?.ensureSecureContainers()
        self?.scheduleSecureContainerRetry()
      }
      appActiveObserver = NotificationCenter.default.addObserver(
        forName: UIApplication.didBecomeActiveNotification,
        object: nil,
        queue: .main
      ) { [weak self] _ in
        self?.ensureSecureContainers()
        if self?.protectedWindows.isEmpty == false {
          self?.removeOverlay()
        }
        self?.scheduleSecureContainerRetry()
      }
      appWillResignObserver = NotificationCenter.default.addObserver(
        forName: UIApplication.willResignActiveNotification,
        object: nil,
        queue: .main
      ) { [weak self] _ in
        self?.prepareForTransientSystemTransition()
      }
      appBackgroundObserver = NotificationCenter.default.addObserver(
        forName: UIApplication.didEnterBackgroundNotification,
        object: nil,
        queue: .main
      ) { [weak self] _ in
        self?.prepareForBackgroundTransition()
      }
      updateCaptureOverlay()
    } else {
      if let captureObserver {
        NotificationCenter.default.removeObserver(captureObserver)
      }
      if let windowObserver {
        NotificationCenter.default.removeObserver(windowObserver)
      }
      if let windowVisibleObserver {
        NotificationCenter.default.removeObserver(windowVisibleObserver)
      }
      if let sceneObserver {
        NotificationCenter.default.removeObserver(sceneObserver)
      }
      if let appActiveObserver {
        NotificationCenter.default.removeObserver(appActiveObserver)
      }
      if let appWillResignObserver {
        NotificationCenter.default.removeObserver(appWillResignObserver)
      }
      if let appBackgroundObserver {
        NotificationCenter.default.removeObserver(appBackgroundObserver)
      }
      captureObserver = nil
      windowObserver = nil
      windowVisibleObserver = nil
      sceneObserver = nil
      appActiveObserver = nil
      appWillResignObserver = nil
      appBackgroundObserver = nil
      removeOverlay()
      disableSecureContainers()
    }
  }

  private func ensureSecureContainers() {
    guard UIApplication.shared.applicationState == .active else {
      return
    }

    guard !containerMutationInProgress else {
      scheduleSecureContainerRetry()
      return
    }

    containerMutationInProgress = true
    defer {
      containerMutationInProgress = false
    }

    let windows = activeWindows()

    guard !windows.isEmpty else {
      scheduleSecureContainerRetry()
      return
    }

    let activeWindowIds = Set(windows.map { ObjectIdentifier($0) })

    for (windowId, record) in Array(protectedWindows) {
      if !activeWindowIds.contains(windowId) || record.window == nil {
        disableSecureContainer(for: windowId)
      }
    }

    for window in windows {
      let windowId = ObjectIdentifier(window)

      if protectedWindows[windowId] == nil {
        enableSecureContainer(in: window)
      }
    }

    if windows.contains(where: { protectedWindows[ObjectIdentifier($0)] == nil }) {
      scheduleSecureContainerRetry()
    }
  }

  private func enableSecureContainer(in window: UIWindow) {
    let windowId = ObjectIdentifier(window)

    guard
      protectedWindows[windowId] == nil,
      let originalSuperlayer = window.layer.superlayer,
      let originalLayerIndex = originalSuperlayer.sublayers?.firstIndex(where: { $0 === window.layer })
    else {
      return
    }

    let secureField = SecureScreenCaptureTextField(frame: window.bounds)
    secureField.backgroundColor = .clear
    secureField.borderStyle = .none
    secureField.text = " "
    secureField.isSecureTextEntry = true
    secureField.isUserInteractionEnabled = false
    secureField.textColor = .clear
    secureField.tintColor = .clear
    window.addSubview(secureField)
    secureField.layoutIfNeeded()
    secureField.isSecureTextEntry = false
    secureField.isSecureTextEntry = true

    guard let secureCanvas = secureCanvasView(in: secureField) else {
      secureField.removeFromSuperview()
      return
    }
    secureCanvas.isUserInteractionEnabled = false
    // The secure field is only a retained layer host. Leaving it in the window's
    // UIView tree while moving the window layer beneath its canvas creates an
    // invalid recursive UIKit hierarchy during React Native layout updates.
    secureField.removeFromSuperview()

    protectedWindows[windowId] = ProtectedWindowRecord(
      window: window,
      originalSuperlayer: originalSuperlayer,
      originalLayerIndex: UInt32(originalLayerIndex),
      secureTextField: secureField
    )
    secureRetryCount = 0
    secureRetryScheduled = false

    CATransaction.begin()
    CATransaction.setDisableActions(true)
    originalSuperlayer.addSublayer(secureField.layer)
    secureCanvas.layer.addSublayer(window.layer)
    CATransaction.commit()
  }

  private func disableSecureContainers() {
    guard !containerMutationInProgress else {
      DispatchQueue.main.async { [weak self] in
        self?.disableSecureContainers()
      }
      return
    }

    containerMutationInProgress = true
    defer {
      containerMutationInProgress = false
    }

    for windowId in Array(protectedWindows.keys) {
      disableSecureContainer(for: windowId)
    }

    secureRetryCount = 0
    secureRetryScheduled = false
  }

  private func disableSecureContainer(for windowId: ObjectIdentifier) {
    guard let record = protectedWindows.removeValue(forKey: windowId) else {
      return
    }

    if let window = record.window {
      CATransaction.begin()
      CATransaction.setDisableActions(true)
      let layerCount = UInt32(record.originalSuperlayer.sublayers?.count ?? 0)
      record.originalSuperlayer.insertSublayer(window.layer, at: min(record.originalLayerIndex, layerCount))
      CATransaction.commit()
    }

    record.secureTextField.layer.removeFromSuperlayer()
    record.secureTextField.removeFromSuperview()

    if protectedWindows.isEmpty {
      secureRetryCount = 0
      secureRetryScheduled = false
    }
  }

  private func scheduleSecureContainerRetry() {
    guard isEnabled, !secureRetryScheduled, secureRetryCount < 20 else {
      return
    }

    secureRetryScheduled = true
    secureRetryCount += 1

    DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self] in
      guard let self else {
        return
      }

      self.secureRetryScheduled = false

      if self.isEnabled {
        self.ensureSecureContainers()
      }
    }
  }

  private func secureCanvasView(in view: UIView) -> UIView? {
    if String(describing: type(of: view)).contains("Canvas") {
      return view
    }

    for subview in view.subviews {
      if let canvas = secureCanvasView(in: subview) {
        return canvas
      }
    }

    return nil
  }

  private func updateCaptureOverlay() {
    guard isEnabled else {
      removeOverlay()
      return
    }

    ensureSecureContainers()

    if UIScreen.main.isCaptured {
      showOverlay()
    } else {
      removeOverlay()
    }
  }

  private func showOverlay() {
    guard overlay == nil, let window = activeWindow() else {
      return
    }

    let view = UIView(frame: window.bounds)
    view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    view.backgroundColor = UIColor.black
    view.isUserInteractionEnabled = false
    window.addSubview(view)
    overlay = view
  }

  private func removeOverlay() {
    overlay?.removeFromSuperview()
    overlay = nil
  }

  private func prepareForTransientSystemTransition() {
    guard isEnabled else {
      return
    }

    showOverlay()
  }

  private func prepareForBackgroundTransition() {
    guard isEnabled else {
      return
    }

    showOverlay()
    disableSecureContainers()
  }

  private func activeWindow() -> UIWindow? {
    activeWindows().first { $0.isKeyWindow } ?? activeWindows().first
  }

  private func activeWindows() -> [UIWindow] {
    let candidates = UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .filter { $0.activationState == .foregroundActive }
      .flatMap { $0.windows }
      .filter { isProtectableWindow($0) }

    if let keyWindow = candidates.first(where: { $0.isKeyWindow }) {
      return [keyWindow]
    }

    if let firstWindow = candidates.first {
      return [firstWindow]
    }

    return []
  }

  private func isProtectableWindow(_ window: UIWindow) -> Bool {
    guard !window.isHidden, window.alpha > 0, window.screen === UIScreen.main else {
      return false
    }

    let windowClassName = String(describing: type(of: window))
    let rootClassName = window.rootViewController.map { String(describing: type(of: $0)) } ?? ""
    let skippedClassNames = [
      "Alert",
      "Keyboard",
      "RemoteKeyboard",
      "StatusBar",
      "TextEffects",
      "UIText",
    ]

    if skippedClassNames.contains(where: { windowClassName.contains($0) || rootClassName.contains($0) }) {
      return false
    }

    guard window.rootViewController?.view != nil else {
      return false
    }

    return abs(window.windowLevel.rawValue - UIWindow.Level.normal.rawValue) < 0.1
  }
}

private final class SecureScreenCaptureTextField: UITextField {
  override var canBecomeFirstResponder: Bool {
    false
  }

  override func caretRect(for position: UITextPosition) -> CGRect {
    .zero
  }

  override func selectionRects(for range: UITextRange) -> [UITextSelectionRect] {
    []
  }
}

private final class MediaSaveCoordinator: NSObject, UIDocumentPickerDelegate {
  static let shared = MediaSaveCoordinator()

  private var documentResolve: RCTPromiseResolveBlock?
  private var documentReject: RCTPromiseRejectBlock?
  private var exportedTempUrl: URL?

  func save(
    uri: String,
    mimeType: String?,
    displayName: String?,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.main.async {
      do {
        let fileUrl = try resolveLocalFileUrl(from: uri)

        if Self.isPhotoLibraryAsset(fileUrl: fileUrl, mimeType: mimeType) {
          self.saveToPhotoLibrary(fileUrl: fileUrl, resolve: resolve, reject: reject)
          return
        }

        self.presentDocumentExporter(fileUrl: fileUrl, displayName: displayName, resolve: resolve, reject: reject)
      } catch {
        reject("save_failed", error.localizedDescription, error)
      }
    }
  }

  private func saveToPhotoLibrary(
    fileUrl: URL,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    let authorizationHandler: (PHAuthorizationStatus) -> Void = { status in
      guard status == .authorized || status == .limited else {
        reject("save_denied", "Photo library access was denied.", nil)
        return
      }

      PHPhotoLibrary.shared().performChanges({
        let pathExtension = fileUrl.pathExtension.lowercased()
        if ["mov", "mp4", "m4v", "avi"].contains(pathExtension) {
          PHAssetChangeRequest.creationRequestForAssetFromVideo(atFileURL: fileUrl)
        } else {
          PHAssetChangeRequest.creationRequestForAssetFromImage(atFileURL: fileUrl)
        }
      }, completionHandler: { success, error in
        if let error {
          reject("save_failed", error.localizedDescription, error)
          return
        }

        resolve(success)
      })
    }

    let currentStatus = PHPhotoLibrary.authorizationStatus(for: .addOnly)
    if currentStatus == .authorized || currentStatus == .limited {
      authorizationHandler(currentStatus)
      return
    }

    if currentStatus == .notDetermined {
      PHPhotoLibrary.requestAuthorization(for: .addOnly, handler: authorizationHandler)
      return
    }

    reject("save_denied", "Photo library access was denied.", nil)
  }

  private func presentDocumentExporter(
    fileUrl: URL,
    displayName: String?,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    guard documentResolve == nil else {
      reject("save_in_progress", "Another save operation is already in progress.", nil)
      return
    }

    guard let presenter = Self.topViewController() else {
      reject("save_failed", "Could not present the Files picker.", nil)
      return
    }

    do {
      let exportUrl = try prepareExportUrl(sourceUrl: fileUrl, displayName: displayName)
      exportedTempUrl = exportUrl != fileUrl ? exportUrl : nil
      documentResolve = resolve
      documentReject = reject

      let picker = UIDocumentPickerViewController(forExporting: [exportUrl], asCopy: true)
      picker.delegate = self
      picker.modalPresentationStyle = .formSheet
      presenter.present(picker, animated: true)
    } catch {
      cleanupDocumentExportState()
      reject("save_failed", error.localizedDescription, error)
    }
  }

  private func prepareExportUrl(sourceUrl: URL, displayName: String?) throws -> URL {
    guard let displayName, !displayName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
      return sourceUrl
    }

    let extensionPart = sourceUrl.pathExtension
    let sanitizedBase = displayName.replacingOccurrences(of: "/", with: "-")
    let destinationUrl = FileManager.default.temporaryDirectory
      .appendingPathComponent(UUID().uuidString)
      .appendingPathExtension(extensionPart.isEmpty ? "tmp" : extensionPart)

    try? FileManager.default.removeItem(at: destinationUrl)
    try FileManager.default.copyItem(at: sourceUrl, to: destinationUrl)

    let finalName = extensionPart.isEmpty || sanitizedBase.lowercased().hasSuffix(".\(extensionPart.lowercased())")
      ? sanitizedBase
      : "\(sanitizedBase).\(extensionPart)"
    let finalUrl = destinationUrl.deletingLastPathComponent().appendingPathComponent(finalName)

    try? FileManager.default.removeItem(at: finalUrl)
    try FileManager.default.moveItem(at: destinationUrl, to: finalUrl)
    return finalUrl
  }

  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    documentResolve?(false)
    cleanupDocumentExportState()
  }

  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
    documentResolve?(true)
    cleanupDocumentExportState()
  }

  private func cleanupDocumentExportState() {
    documentResolve = nil
    documentReject = nil

    if let exportedTempUrl {
      try? FileManager.default.removeItem(at: exportedTempUrl)
    }

    exportedTempUrl = nil
  }

  private static func isPhotoLibraryAsset(fileUrl: URL, mimeType: String?) -> Bool {
    if let mimeType {
      if mimeType.hasPrefix("image/") || mimeType.hasPrefix("video/") {
        return true
      }
    }

    if let type = UTType(filenameExtension: fileUrl.pathExtension) {
      return type.conforms(to: .image) || type.conforms(to: .movie)
    }

    return false
  }

  private static func topViewController(
    base: UIViewController? = UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap(\.windows)
      .first(where: \.isKeyWindow)?
      .rootViewController
  ) -> UIViewController? {
    if let navigationController = base as? UINavigationController {
      return topViewController(base: navigationController.visibleViewController)
    }

    if let tabBarController = base as? UITabBarController, let selected = tabBarController.selectedViewController {
      return topViewController(base: selected)
    }

    if let presented = base?.presentedViewController {
      return topViewController(base: presented)
    }

    return base
  }
}

private final class MediaShareCoordinator {
  static let shared = MediaShareCoordinator()

  private var exportedTempUrl: URL?

  func share(
    uri: String,
    mimeType: String?,
    displayName: String?,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.main.async {
      do {
        let fileUrl = try resolveLocalFileUrl(from: uri)
        let shareUrl = try self.prepareShareUrl(sourceUrl: fileUrl, displayName: displayName)

        guard let presenter = Self.topViewController() else {
          self.cleanup()
          reject("share_failed", "Could not present the share sheet.", nil)
          return
        }

        let controller = UIActivityViewController(activityItems: [shareUrl], applicationActivities: nil)
        controller.completionWithItemsHandler = { _, _, _, _ in
          self.cleanup()
        }

        if let popover = controller.popoverPresentationController {
          popover.sourceView = presenter.view
          popover.sourceRect = CGRect(
            x: presenter.view.bounds.midX,
            y: presenter.view.bounds.midY,
            width: 1,
            height: 1
          )
          popover.permittedArrowDirections = []
        }

        presenter.present(controller, animated: true) {
          resolve(true)
        }
      } catch {
        self.cleanup()
        reject("share_failed", error.localizedDescription, error)
      }
    }
  }

  private func prepareShareUrl(sourceUrl: URL, displayName: String?) throws -> URL {
    guard let displayName, !displayName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
      exportedTempUrl = nil
      return sourceUrl
    }

    let extensionPart = sourceUrl.pathExtension
    let sanitizedBase = displayName
      .replacingOccurrences(of: "/", with: "-")
      .replacingOccurrences(of: ":", with: "-")
      .trimmingCharacters(in: .whitespacesAndNewlines)
    let finalName: String

    if sanitizedBase.isEmpty {
      finalName = sourceUrl.lastPathComponent
    } else if extensionPart.isEmpty || sanitizedBase.lowercased().hasSuffix(".\(extensionPart.lowercased())") {
      finalName = sanitizedBase
    } else {
      finalName = "\(sanitizedBase).\(extensionPart)"
    }

    let directoryUrl = FileManager.default.temporaryDirectory
      .appendingPathComponent("meetvap-share-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directoryUrl, withIntermediateDirectories: true)

    let destinationUrl = directoryUrl.appendingPathComponent(finalName)
    try FileManager.default.copyItem(at: sourceUrl, to: destinationUrl)
    exportedTempUrl = directoryUrl
    return destinationUrl
  }

  private func cleanup() {
    if let exportedTempUrl {
      try? FileManager.default.removeItem(at: exportedTempUrl)
    }

    exportedTempUrl = nil
  }

  private static func topViewController(
    base: UIViewController? = UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap(\.windows)
      .first(where: \.isKeyWindow)?
      .rootViewController
  ) -> UIViewController? {
    if let navigationController = base as? UINavigationController {
      return topViewController(base: navigationController.visibleViewController)
    }

    if let tabBarController = base as? UITabBarController, let selected = tabBarController.selectedViewController {
      return topViewController(base: selected)
    }

    if let presented = base?.presentedViewController {
      return topViewController(base: presented)
    }

    return base
  }
}

private enum ImageDrawingRenderer {
  static func render(
    uri: String,
    strokesJson: String,
    outputFileName: String?,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.global(qos: .userInitiated).async {
      do {
        let sourceUrl = try resolveLocalFileUrl(from: uri)
        guard let image = UIImage(contentsOfFile: sourceUrl.path) else {
          throw NSError(domain: "CallNative", code: 1010, userInfo: [
            NSLocalizedDescriptionKey: "Image could not be opened.",
          ])
        }

        let imageSize = image.size.width > 0 && image.size.height > 0
          ? image.size
          : CGSize(width: image.cgImage?.width ?? 1, height: image.cgImage?.height ?? 1)
        let strokes = try parseStrokes(strokesJson)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        format.preferredRange = .standard
        let renderer = UIGraphicsImageRenderer(size: imageSize, format: format)
        let renderedImage = renderer.image { context in
          UIColor.white.setFill()
          context.fill(CGRect(origin: .zero, size: imageSize))
          image.draw(in: CGRect(origin: .zero, size: imageSize))
          draw(strokes: strokes, in: context.cgContext, imageSize: imageSize)
        }

        guard let data = renderedImage.jpegData(compressionQuality: 0.9) else {
          throw NSError(domain: "CallNative", code: 1011, userInfo: [
            NSLocalizedDescriptionKey: "Edited image could not be encoded.",
          ])
        }

        let directory = FileManager.default.temporaryDirectory
          .appendingPathComponent("meetvap-drawn-images", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let fileName = outputFileNameFor(originalName: outputFileName)
        let outputUrl = directory.appendingPathComponent("\(UUID().uuidString)-\(fileName)")
        try data.write(to: outputUrl, options: .atomic)

        DispatchQueue.main.async {
          resolve([
            "fileName": fileName,
            "mimeType": "image/jpeg",
            "sizeBytes": data.count,
            "uri": outputUrl.absoluteString,
          ])
        }
      } catch {
        DispatchQueue.main.async {
          reject("image_drawing_failed", error.localizedDescription, error)
        }
      }
    }
  }

  private struct Stroke {
    let color: UIColor
    let points: [CGPoint]
    let width: CGFloat
  }

  private static func parseStrokes(_ strokesJson: String) throws -> [Stroke] {
    guard let data = strokesJson.data(using: .utf8) else {
      return []
    }

    let rawValue = try JSONSerialization.jsonObject(with: data)
    guard let rawStrokes = rawValue as? [[String: Any]] else {
      return []
    }

    return rawStrokes.compactMap { rawStroke in
      guard let rawPoints = rawStroke["points"] as? [[String: Any]], !rawPoints.isEmpty else {
        return nil
      }

      let points = rawPoints.compactMap { rawPoint -> CGPoint? in
        guard let x = numberValue(rawPoint["x"]), let y = numberValue(rawPoint["y"]) else {
          return nil
        }

        return CGPoint(x: max(0, min(1, x)), y: max(0, min(1, y)))
      }

      guard !points.isEmpty else {
        return nil
      }

      return Stroke(
        color: UIColor(hexString: rawStroke["color"] as? String) ?? UIColor.red,
        points: points,
        width: max(0.004, min(0.05, numberValue(rawStroke["width"]) ?? 0.014))
      )
    }
  }

  private static func draw(strokes: [Stroke], in context: CGContext, imageSize: CGSize) {
    let scale = min(imageSize.width, imageSize.height)

    for stroke in strokes {
      guard let firstPoint = stroke.points.first else {
        continue
      }

      context.setStrokeColor(stroke.color.cgColor)
      context.setLineCap(.round)
      context.setLineJoin(.round)
      context.setLineWidth(max(2, stroke.width * scale))
      context.beginPath()
      context.move(to: CGPoint(x: firstPoint.x * imageSize.width, y: firstPoint.y * imageSize.height))

      if stroke.points.count == 1 {
        context.addLine(to: CGPoint(x: firstPoint.x * imageSize.width + 0.5, y: firstPoint.y * imageSize.height + 0.5))
      } else {
        for point in stroke.points.dropFirst() {
          context.addLine(to: CGPoint(x: point.x * imageSize.width, y: point.y * imageSize.height))
        }
      }

      context.strokePath()
    }
  }

  private static func numberValue(_ value: Any?) -> CGFloat? {
    if let number = value as? NSNumber {
      return CGFloat(truncating: number)
    }

    if let string = value as? String, let double = Double(string) {
      return CGFloat(double)
    }

    return nil
  }

  private static func outputFileNameFor(originalName: String?) -> String {
    let baseName = ((originalName ?? "photo.jpg") as NSString).lastPathComponent
    let withoutExtension = (baseName as NSString).deletingPathExtension
    let sanitized = withoutExtension
      .replacingOccurrences(of: "/", with: "-")
      .replacingOccurrences(of: ":", with: "-")
      .trimmingCharacters(in: .whitespacesAndNewlines)
    let finalBase = sanitized.isEmpty ? "photo" : sanitized

    return finalBase.lowercased().hasSuffix(".jpg") || finalBase.lowercased().hasSuffix(".jpeg")
      ? finalBase
      : "\(finalBase).jpg"
  }
}

private extension UIColor {
  convenience init?(hexString: String?) {
    guard let hexString else {
      return nil
    }

    let cleaned = hexString.trimmingCharacters(in: CharacterSet(charactersIn: "#")).trimmingCharacters(in: .whitespacesAndNewlines)
    guard cleaned.count == 6, let value = Int(cleaned, radix: 16) else {
      return nil
    }

    self.init(
      red: CGFloat((value >> 16) & 0xff) / 255,
      green: CGFloat((value >> 8) & 0xff) / 255,
      blue: CGFloat(value & 0xff) / 255,
      alpha: 1
    )
  }
}

private func resolveLocalFileUrl(from value: String) throws -> URL {
  if let url = URL(string: value), url.isFileURL {
    return url
  }

  let path = (value as NSString).expandingTildeInPath
  if FileManager.default.fileExists(atPath: path) {
    return URL(fileURLWithPath: path)
  }

  throw NSError(domain: "CallNative", code: 1005, userInfo: [
    NSLocalizedDescriptionKey: "Attachment file was not found.",
  ])
}

private final class CallNativeLiveVoiceEffectController {
  static let shared = CallNativeLiveVoiceEffectController()

  private let processor = CallNativeLiveVoiceEffectProcessor()
  private var isRegistered = false

  func setEffect(_ effectId: String) {
    processor.setEffect(effectId)

    if processor.isPassthrough {
      if isRegistered {
        LKAudioProcessingManager.sharedInstance().removeCapturePostProcessor(processor)
        isRegistered = false
      }
      return
    }

    if !isRegistered {
      LKAudioProcessingManager.sharedInstance().addCapturePostProcessor(processor)
      isRegistered = true
    }
  }
}

private final class CallNativeLiveVoiceEffectProcessor: NSObject, LKExternalAudioProcessingDelegate {
  private enum Effect: Int {
    case normal
    case deep
    case bright
    case helium
  }

  private let lock = NSLock()
  private var requestedEffect = Effect.normal
  private var activeEffect = Effect.normal
  private var resetRequested = false
  private var sampleRateHz: Double = 48000
  private var previousInputByChannel = [Float](repeating: 0, count: 2)
  private var highPassByChannel = [Float](repeating: 0, count: 2)
  private var lowPassByChannel = [Float](repeating: 0, count: 2)
  private var outputToneByChannel = [Float](repeating: 0, count: 2)
  private var outputSmoothByChannel = [Float](repeating: 0, count: 2)
  private var outputAirEnvelopeByChannel = [Float](repeating: 0, count: 2)
  private var pitchPhaseByChannel = [Float](repeating: 0, count: 2)
  private var pitchWriteIndexByChannel = [Int](repeating: 0, count: 2)
  private var pitchRingBuffers = Array(repeating: [Float](repeating: 0, count: 96000), count: 2)

  var isPassthrough: Bool {
    lock.lock()
    let result = requestedEffect == .normal
    lock.unlock()
    return result
  }

  func setEffect(_ effectId: String) {
    lock.lock()
    let nextEffect = Self.normalize(effectId)
    if requestedEffect != nextEffect {
      requestedEffect = nextEffect
      resetRequested = true
    }
    lock.unlock()
  }

  func audioProcessingInitialize(withSampleRate sampleRateHz: Int, channels: Int) {
    self.sampleRateHz = Double(max(sampleRateHz, 8000))
    ensureChannelState(channels: max(channels, 1))
    resetProcessingState()
  }

  func audioProcessingProcess(_ audioBuffer: RTCAudioBuffer) {
    let controlState = pullControlState()
    let currentEffect = controlState.effect
    let shouldReset = controlState.shouldReset

    guard currentEffect != .normal else {
      return
    }

    let channelCount = Int(audioBuffer.channels)
    let frameCount = Int(audioBuffer.frames)
    ensureChannelState(channels: channelCount)

    if shouldReset {
      resetProcessingState()
    }

    for channel in 0..<channelCount {
      let samples = audioBuffer.rawBuffer(forChannel: channel)

      for frame in 0..<frameCount {
        let input = floatS16ToNormalized(samples[frame])
        samples[frame] = normalizedToFloatS16(apply(effect: currentEffect, input: input, channel: channel))
      }
    }
  }

  func audioProcessingRelease() {
    resetProcessingState()
  }

  private func pullControlState() -> (effect: Effect, shouldReset: Bool) {
    if lock.try() {
      let nextEffect = requestedEffect
      let shouldReset = resetRequested || activeEffect != nextEffect
      activeEffect = nextEffect
      resetRequested = false
      lock.unlock()
      return (nextEffect, shouldReset)
    }

    return (activeEffect, false)
  }

  private func apply(effect currentEffect: Effect, input: Float, channel: Int) -> Float {
    let cleanInput = removeDcOffset(input, channel: channel)
    let lowPass = (lowPassByChannel[channel] * Self.fallbackLowPassKeep) + (cleanInput * (1 - Self.fallbackLowPassKeep))
    let highPass = cleanInput - lowPass
    lowPassByChannel[channel] = lowPass

    let output: Float
    switch currentEffect {
    case .normal:
      output = input
    case .deep:
      let shifted = pitchShift(input: cleanInput, channel: channel, pitchRatio: 0.78)
      output = limitSample((shifted * 0.88) + (lowPass * 0.20) - (highPass * 0.08))
    case .bright:
      let shifted = pitchShift(input: cleanInput, channel: channel, pitchRatio: 1.22)
      output = limitSample(shifted * 0.96)
    case .helium:
      let shifted = pitchShift(input: cleanInput, channel: channel, pitchRatio: 1.42)
      output = limitSample(shifted * 0.94)
    }

    let toneShapedOutput = reduceWheeze(currentEffect, input: output, channel: channel)
    return smoothOutput(limitSample(toneShapedOutput * Self.effectOutputGain), channel: channel)
  }

  private func pitchShift(input: Float, channel: Int, pitchRatio: Float) -> Float {
    guard pitchRatio > 0, channel < pitchRingBuffers.count else {
      return input
    }

    let bufferSize = pitchRingBuffers[channel].count
    guard bufferSize > 0 else {
      return input
    }

    var writeIndex = pitchWriteIndexByChannel[channel]
    pitchRingBuffers[channel][writeIndex] = input

    if abs(pitchRatio - 1) < 0.001 {
      writeIndex = (writeIndex + 1) % bufferSize
      pitchWriteIndexByChannel[channel] = writeIndex
      return input
    }

    let windowSamples = max(640, min(Int(sampleRateHz * 0.045), bufferSize / 4))
    let maxDelay = windowSamples + 48
    let phaseIncrement = max(0.01, abs(pitchRatio - 1.0))
    var phase = pitchPhaseByChannel[channel] + phaseIncrement

    if phase >= Float(windowSamples) {
      phase -= Float(windowSamples)
    }

    let delayA = pitchRatio >= 1.0 ? Float(maxDelay) - phase : Float(maxDelay) + phase
    let delayB = pitchRatio >= 1.0 ? delayA + Float(windowSamples) : delayA - Float(windowSamples)
    let fade = clamp(phase / Float(windowSamples), minValue: 0, maxValue: 1)
    let sampleA = readInterpolatedSample(from: pitchRingBuffers[channel], writeIndex: writeIndex, delay: delayA)
    let sampleB = readInterpolatedSample(from: pitchRingBuffers[channel], writeIndex: writeIndex, delay: delayB)
    let fadeB = fade * fade * (3 - (2 * fade))
    let fadeA = 1 - fadeB
    let shifted = (sampleA * fadeA) + (sampleB * fadeB)

    writeIndex = (writeIndex + 1) % bufferSize
    pitchWriteIndexByChannel[channel] = writeIndex
    pitchPhaseByChannel[channel] = phase

    return shifted
  }

  private func removeDcOffset(_ input: Float, channel: Int) -> Float {
    let output = input - previousInputByChannel[channel] + (Self.dcBlockerKeep * highPassByChannel[channel])
    previousInputByChannel[channel] = input
    highPassByChannel[channel] = output
    return clamp(output, minValue: -1, maxValue: 1)
  }

  private func reduceWheeze(_ currentEffect: Effect, input: Float, channel: Int) -> Float {
    let keep: Float
    switch currentEffect {
    case .helium:
      keep = Self.outputToneKeepHelium
    case .bright:
      keep = Self.outputToneKeepBright
    default:
      keep = Self.outputToneKeepDefault
    }

    let filtered = (outputToneByChannel[channel] * keep) + (input * (1 - keep))
    let filterMix: Float
    switch currentEffect {
    case .helium:
      filterMix = Self.outputToneMixHelium
    case .bright:
      filterMix = Self.outputToneMixBright
    default:
      filterMix = Self.outputToneMixDefault
    }

    outputToneByChannel[channel] = filtered
    let blended = (input * (1 - filterMix)) + (filtered * filterMix)
    return applyOutputDeEsser(currentEffect, input: blended, filtered: filtered, channel: channel)
  }

  private func applyOutputDeEsser(_ currentEffect: Effect, input: Float, filtered: Float, channel: Int) -> Float {
    let air = input - filtered
    let envelopeKeep: Float
    switch currentEffect {
    case .helium:
      envelopeKeep = Self.outputAirEnvelopeKeepHelium
    case .bright:
      envelopeKeep = Self.outputAirEnvelopeKeepBright
    default:
      envelopeKeep = Self.outputAirEnvelopeKeepDefault
    }

    let nextEnvelope = (outputAirEnvelopeByChannel[channel] * envelopeKeep) + (abs(air) * (1 - envelopeKeep))
    outputAirEnvelopeByChannel[channel] = nextEnvelope

    let threshold: Float
    let maxCut: Float
    switch currentEffect {
    case .helium:
      threshold = Self.outputAirThresholdHelium
      maxCut = Self.outputAirMaxCutHelium
    case .bright:
      threshold = Self.outputAirThresholdBright
      maxCut = Self.outputAirMaxCutBright
    default:
      threshold = Self.outputAirThresholdDefault
      maxCut = Self.outputAirMaxCutDefault
    }

    let over = clamp((nextEnvelope - threshold) / (1 - threshold), minValue: 0, maxValue: 1)
    let softenedAir = air * (1 - (maxCut * over))
    return limitSample(filtered + softenedAir)
  }

  private func smoothOutput(_ input: Float, channel: Int) -> Float {
    let output = (outputSmoothByChannel[channel] * Self.outputSmoothKeep) + (input * (1 - Self.outputSmoothKeep))
    outputSmoothByChannel[channel] = output
    return output
  }

  private func readInterpolatedSample(from buffer: [Float], writeIndex: Int, delay: Float) -> Float {
    let bufferSize = buffer.count
    let readPosition = Float(writeIndex) - delay
    let baseIndex = Int(floor(readPosition))
    let fraction = readPosition - Float(baseIndex)
    let indexA = positiveModulo(baseIndex, bufferSize)
    let indexB = positiveModulo(baseIndex + 1, bufferSize)

    return (buffer[indexA] * (1.0 - fraction)) + (buffer[indexB] * fraction)
  }

  private func ensureChannelState(channels: Int) {
    guard previousInputByChannel.count < channels else {
      return
    }

    previousInputByChannel = [Float](repeating: 0, count: channels)
    highPassByChannel = [Float](repeating: 0, count: channels)
    lowPassByChannel = [Float](repeating: 0, count: channels)
    outputToneByChannel = [Float](repeating: 0, count: channels)
    outputSmoothByChannel = [Float](repeating: 0, count: channels)
    outputAirEnvelopeByChannel = [Float](repeating: 0, count: channels)
    pitchPhaseByChannel = [Float](repeating: 0, count: channels)
    pitchWriteIndexByChannel = [Int](repeating: 0, count: channels)
    pitchRingBuffers = Array(repeating: [Float](repeating: 0, count: max(Int(sampleRateHz * 2), 16000)), count: channels)
  }

  private static func normalize(_ effectId: String) -> Effect {
    switch effectId {
    case "deep":
      return .deep
    case "bright":
      return .bright
    case "helium":
      return .helium
    default:
      return .normal
    }
  }

  private func floatS16ToNormalized(_ value: Float) -> Float {
    guard value.isFinite else {
      return 0
    }

    return clamp(value / Self.floatS16Scale, minValue: -1, maxValue: 1)
  }

  private func normalizedToFloatS16(_ value: Float) -> Float {
    clamp(sanitizeSample(value) * Self.floatS16Scale)
  }

  private func sanitizeSample(_ value: Float) -> Float {
    value.isFinite ? clamp(value, minValue: -1, maxValue: 1) : 0
  }

  private func limitSample(_ value: Float) -> Float {
    let clipped = clamp(value, minValue: -Self.limiterInputCeiling, maxValue: Self.limiterInputCeiling)
    let magnitude = abs(clipped)

    if magnitude <= Self.limiterKnee {
      return clipped
    }

    let sign: Float = clipped < 0 ? -1 : 1
    let over = magnitude - Self.limiterKnee
    let compressed = Self.limiterKnee + ((over / (1 + over)) * (1 - Self.limiterKnee))
    return sign * min(compressed, 1)
  }

  private func clamp(_ value: Float, minValue: Float = -32768, maxValue: Float = 32767) -> Float {
    min(max(value, minValue), maxValue)
  }

  private func positiveModulo(_ value: Int, _ modulo: Int) -> Int {
    let result = value % modulo
    return result >= 0 ? result : result + modulo
  }

  private func resetPitchBuffers() {
    for channel in 0..<pitchRingBuffers.count {
      let bufferSize = max(Int(sampleRateHz * 2), 16000)

      if pitchRingBuffers[channel].count != bufferSize {
        pitchRingBuffers[channel] = [Float](repeating: 0, count: bufferSize)
        continue
      }

      fillZeros(&pitchRingBuffers[channel])
    }
  }

  private func resetProcessingState() {
    fillZeros(&previousInputByChannel)
    fillZeros(&highPassByChannel)
    fillZeros(&lowPassByChannel)
    fillZeros(&outputToneByChannel)
    fillZeros(&outputSmoothByChannel)
    fillZeros(&outputAirEnvelopeByChannel)
    fillZeros(&pitchPhaseByChannel)
    fillZeros(&pitchWriteIndexByChannel)
    resetPitchBuffers()
  }

  private func fillZeros(_ values: inout [Float]) {
    for index in values.indices {
      values[index] = 0
    }
  }

  private func fillZeros(_ values: inout [Int]) {
    for index in values.indices {
      values[index] = 0
    }
  }

  private static let floatS16Scale: Float = 32768
  private static let dcBlockerKeep: Float = 0.995
  private static let fallbackLowPassKeep: Float = 0.86
  private static let outputToneKeepDefault: Float = 0.28
  private static let outputToneKeepBright: Float = 0.34
  private static let outputToneKeepHelium: Float = 0.40
  private static let outputToneMixDefault: Float = 0.22
  private static let outputToneMixBright: Float = 0.34
  private static let outputToneMixHelium: Float = 0.42
  private static let outputAirEnvelopeKeepDefault: Float = 0.86
  private static let outputAirEnvelopeKeepBright: Float = 0.89
  private static let outputAirEnvelopeKeepHelium: Float = 0.91
  private static let outputAirThresholdDefault: Float = 0.030
  private static let outputAirThresholdBright: Float = 0.024
  private static let outputAirThresholdHelium: Float = 0.020
  private static let outputAirMaxCutDefault: Float = 0.18
  private static let outputAirMaxCutBright: Float = 0.30
  private static let outputAirMaxCutHelium: Float = 0.42
  private static let outputSmoothKeep: Float = 0.22
  private static let effectOutputGain: Float = 1.0
  private static let limiterInputCeiling: Float = 1.6
  private static let limiterKnee: Float = 0.88
}

private enum SharedImportStore {
  static let appGroupIdentifier = "group.com.meetvap.app"
  private static let pendingFileName = "pending-share.json"

  static func hasPendingSharedItems() -> Bool {
    guard let containerUrl = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupIdentifier) else {
      return false
    }

    let pendingUrl = containerUrl.appendingPathComponent(pendingFileName)
    return FileManager.default.fileExists(atPath: pendingUrl.path)
  }

  static func consumeSharedItems() throws -> [[String: Any]] {
    guard let containerUrl = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupIdentifier) else {
      return []
    }

    let pendingUrl = containerUrl.appendingPathComponent(pendingFileName)

    guard FileManager.default.fileExists(atPath: pendingUrl.path) else {
      return []
    }

    let data = try Data(contentsOf: pendingUrl)
    try? FileManager.default.removeItem(at: pendingUrl)

    guard
      let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
      let rawItems = object["items"] as? [[String: Any]]
    else {
      return []
    }

    return rawItems.compactMap { rawItem in
      guard let kind = rawItem["kind"] as? String else {
        return nil
      }

      if kind == "text", let text = rawItem["text"] as? String, !text.isEmpty {
        return [
          "kind": "text",
          "text": text,
        ]
      }

      guard kind == "file", let path = rawItem["path"] as? String else {
        return nil
      }

      let fileUrl = URL(fileURLWithPath: path)
      guard FileManager.default.fileExists(atPath: fileUrl.path) else {
        return nil
      }

      let attributes = try? FileManager.default.attributesOfItem(atPath: fileUrl.path)
      let size = attributes?[.size] as? NSNumber
      let mimeType = (rawItem["mimeType"] as? String) ?? mimeTypeForFileUrl(fileUrl)
      let fileName = (rawItem["fileName"] as? String) ?? fileUrl.lastPathComponent

      return [
        "fileName": fileName,
        "kind": "file",
        "mimeType": mimeType,
        "sizeBytes": size?.doubleValue ?? 0,
        "uri": fileUrl.absoluteString,
      ]
    }
  }

  private static func mimeTypeForFileUrl(_ url: URL) -> String {
    if let type = UTType(filenameExtension: url.pathExtension), let mimeType = type.preferredMIMEType {
      return mimeType
    }

    return "application/octet-stream"
  }
}

private enum PendingIncomingCallLaunchStore {
  private struct AnsweredCallMarker: Codable {
    let callId: String
    let savedAt: TimeInterval
    let url: String?
  }

  private static let pendingIncomingCallUrlKey = "pendingIncomingCallUrl"
  private static let pendingAnsweredCallKitCallKey = "pendingAnsweredCallKitCall"
  private static let pendingAnsweredCallKitCallTtl: TimeInterval = 90
  private static let userDefaults = UserDefaults.standard
  private static let appGroupUserDefaults = UserDefaults(suiteName: SharedImportStore.appGroupIdentifier)

  static func save(_ url: String) {
    userDefaults.set(url, forKey: pendingIncomingCallUrlKey)
    appGroupUserDefaults?.set(url, forKey: pendingIncomingCallUrlKey)
    userDefaults.synchronize()
    appGroupUserDefaults?.synchronize()
  }

  static func consume() -> String? {
    let url = userDefaults.string(forKey: pendingIncomingCallUrlKey) ??
      appGroupUserDefaults?.string(forKey: pendingIncomingCallUrlKey)

    clear()
    return url
  }

  static func peek() -> String? {
    userDefaults.string(forKey: pendingIncomingCallUrlKey) ??
      appGroupUserDefaults?.string(forKey: pendingIncomingCallUrlKey)
  }

  static func saveAnsweredCallKitCallId(_ callId: String, url: String? = nil) {
    let existingMarker = peekAnsweredCallKitMarker()
    let existingUrl = url ?? (existingMarker?.callId == callId ? existingMarker?.url : nil)
    let marker = AnsweredCallMarker(callId: callId, savedAt: Date().timeIntervalSince1970, url: existingUrl)
    guard let data = try? JSONEncoder().encode(marker) else {
      return
    }

    userDefaults.set(data, forKey: pendingAnsweredCallKitCallKey)
    appGroupUserDefaults?.set(data, forKey: pendingAnsweredCallKitCallKey)
    userDefaults.synchronize()
    appGroupUserDefaults?.synchronize()
  }

  static func peekAnsweredCallKitCallId() -> String? {
    peekAnsweredCallKitMarker()?.callId
  }

  static func peekAnsweredCallKitUrl() -> String? {
    peekAnsweredCallKitMarker()?.url
  }

  private static func peekAnsweredCallKitMarker() -> AnsweredCallMarker? {
    let data = userDefaults.data(forKey: pendingAnsweredCallKitCallKey) ??
      appGroupUserDefaults?.data(forKey: pendingAnsweredCallKitCallKey)

    guard let data, let marker = try? JSONDecoder().decode(AnsweredCallMarker.self, from: data) else {
      clearAnsweredCallKitCallId()
      return nil
    }

    if Date().timeIntervalSince1970 - marker.savedAt > pendingAnsweredCallKitCallTtl {
      clearAnsweredCallKitCallId()
      return nil
    }

    return marker
  }

  static func clearAnsweredCallKitCallId(_ callId: String? = nil) {
    if let callId, peekAnsweredCallKitCallId() != callId {
      return
    }

    userDefaults.removeObject(forKey: pendingAnsweredCallKitCallKey)
    appGroupUserDefaults?.removeObject(forKey: pendingAnsweredCallKitCallKey)
    userDefaults.synchronize()
    appGroupUserDefaults?.synchronize()
  }

  static func clear() {
    userDefaults.removeObject(forKey: pendingIncomingCallUrlKey)
    appGroupUserDefaults?.removeObject(forKey: pendingIncomingCallUrlKey)
    userDefaults.synchronize()
    appGroupUserDefaults?.synchronize()
  }
}

private enum VoiceMessageProcessor {
  private static let renderFrameCount: AVAudioFrameCount = 4096

  static func process(
    inputUri: String,
    effectId: String,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    guard effectId != "normal" else {
      resolve(inputUri)
      return
    }

    DispatchQueue.global(qos: .userInitiated).async {
      do {
        let inputUrl = try fileUrl(from: inputUri)
        let outputUrl = FileManager.default.temporaryDirectory
          .appendingPathComponent("voice-effects", isDirectory: true)
          .appendingPathComponent(UUID().uuidString)
          .appendingPathExtension("m4a")

        try FileManager.default.createDirectory(
          at: outputUrl.deletingLastPathComponent(),
          withIntermediateDirectories: true
        )

        try renderEffect(inputUrl: inputUrl, outputUrl: outputUrl, effectId: effectId)
        resolve(outputUrl.absoluteString)
      } catch {
        reject("voice_effect_failed", error.localizedDescription, error)
      }
    }
  }

  private static func fileUrl(from value: String) throws -> URL {
    if let url = URL(string: value), url.isFileURL {
      return url
    }

    let path = (value as NSString).expandingTildeInPath
    if FileManager.default.fileExists(atPath: path) {
      return URL(fileURLWithPath: path)
    }

    throw NSError(domain: "CallNative", code: 1001, userInfo: [
      NSLocalizedDescriptionKey: "Voice message file was not found.",
    ])
  }

  private static func renderEffect(inputUrl: URL, outputUrl: URL, effectId: String) throws {
    let inputFile = try AVAudioFile(forReading: inputUrl)
    let processingFormat = inputFile.processingFormat

    guard let pcmFormat = AVAudioFormat(
      commonFormat: .pcmFormatFloat32,
      sampleRate: processingFormat.sampleRate,
      channels: processingFormat.channelCount,
      interleaved: false
    ) else {
      throw NSError(domain: "CallNative", code: 1002, userInfo: [
        NSLocalizedDescriptionKey: "Voice message format is not supported.",
      ])
    }

    let engine = AVAudioEngine()
    let player = AVAudioPlayerNode()
    let timePitch = AVAudioUnitTimePitch()

    apply(effectId: effectId, to: timePitch)

    engine.attach(player)
    engine.attach(timePitch)
    engine.connect(player, to: timePitch, format: processingFormat)
    engine.connect(timePitch, to: engine.mainMixerNode, format: processingFormat)

    try engine.enableManualRenderingMode(.offline, format: pcmFormat, maximumFrameCount: renderFrameCount)

    let outputFile = try AVAudioFile(
      forWriting: outputUrl,
      settings: [
        AVFormatIDKey: kAudioFormatMPEG4AAC,
        AVSampleRateKey: pcmFormat.sampleRate,
        AVNumberOfChannelsKey: Int(pcmFormat.channelCount),
        AVEncoderBitRateKey: 96000,
      ]
    )

    player.scheduleFile(inputFile, at: nil)
    try engine.start()
    player.play()

    let buffer = AVAudioPCMBuffer(pcmFormat: engine.manualRenderingFormat, frameCapacity: renderFrameCount)

    while engine.manualRenderingSampleTime < inputFile.length {
      let framesToRender = min(renderFrameCount, AVAudioFrameCount(inputFile.length - engine.manualRenderingSampleTime))
      let status = try engine.renderOffline(framesToRender, to: buffer!)

      switch status {
      case .success:
        try outputFile.write(from: buffer!)
      case .insufficientDataFromInputNode, .cannotDoInCurrentContext:
        continue
      case .error:
        throw NSError(domain: "CallNative", code: 1003, userInfo: [
          NSLocalizedDescriptionKey: "Voice effect rendering failed.",
        ])
      @unknown default:
        throw NSError(domain: "CallNative", code: 1004, userInfo: [
          NSLocalizedDescriptionKey: "Voice effect rendering returned an unknown state.",
        ])
      }
    }

    player.stop()
    engine.stop()
    engine.disableManualRenderingMode()
  }

  private static func apply(effectId: String, to unit: AVAudioUnitTimePitch) {
    unit.rate = 1.0

    switch effectId {
    case "deep":
      unit.pitch = -420
    case "bright":
      unit.pitch = 320
    case "helium":
      unit.pitch = 620
    default:
      unit.pitch = 0
    }
  }
}

private final class CallNativeCallManager: NSObject, PKPushRegistryDelegate, CXProviderDelegate {
  static let shared = CallNativeCallManager()

  private let provider: CXProvider
  private let callController = CXCallController()
  private var incomingRingtonePlayer: AVAudioPlayer?
  private var pushRegistry: PKPushRegistry?
  private var tokenHex: String?
  private var tokenPromises: [(RCTPromiseResolveBlock, RCTPromiseRejectBlock)] = []
  private var callsByUUID: [UUID: IncomingCallPayload] = [:]
  private var recentlyFinishedCallIds: [String: Date] = [:]
  private var foregroundHandledCallIds: [String: Date] = [:]
  private var reportedIncomingCallIds: [String: Date] = [:]
  private var programmaticAnswerCallIds = Set<String>()
  private var callKitAudioActivatedAt: Date?
  private var callKitAudioActivationWaiters: [RCTPromiseResolveBlock] = []
  private var callKitAudioActivationTimeout: Timer?
  private var pendingIncomingCallUrl: String?

  private override init() {
    let configuration = CXProviderConfiguration(localizedName: "MeetVap")
    configuration.supportsVideo = true
    configuration.maximumCallsPerCallGroup = 1
    configuration.maximumCallGroups = 1
    configuration.ringtoneSound = "ringtone.wav"
    configuration.supportedHandleTypes = [.generic]

    provider = CXProvider(configuration: configuration)

    super.init()

    provider.setDelegate(self, queue: nil)
  }

  func registerVoipPushToken(
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.main.async {
      if let tokenHex = self.tokenHex {
        resolve(tokenHex)
        return
      }

      self.tokenPromises.append((resolve, reject))
      self.startPushRegistry()
    }
  }

  func startPushRegistry() {
    if Thread.isMainThread {
      createPushRegistryIfNeeded()
      return
    }

    DispatchQueue.main.async {
      self.createPushRegistryIfNeeded()
    }
  }

  private func createPushRegistryIfNeeded() {
    if pushRegistry == nil {
      let registry = PKPushRegistry(queue: DispatchQueue.main)
      registry.delegate = self
      registry.desiredPushTypes = [.voIP]
      pushRegistry = registry
    }
  }

  func pushRegistry(
    _ registry: PKPushRegistry,
    didUpdate pushCredentials: PKPushCredentials,
    for type: PKPushType
  ) {
    guard type == .voIP else {
      return
    }

    let token = pushCredentials.token.map { String(format: "%02x", $0) }.joined()
    tokenHex = token
    tokenPromises.forEach { resolve, _ in resolve(token) }
    tokenPromises.removeAll()
  }

  func pushRegistry(
    _ registry: PKPushRegistry,
    didInvalidatePushTokenFor type: PKPushType
  ) {
    guard type == .voIP else {
      return
    }

    tokenHex = nil
  }

  func pushRegistry(
    _ registry: PKPushRegistry,
    didReceiveIncomingPushWith payload: PKPushPayload,
    for type: PKPushType,
    completion: @escaping () -> Void
  ) {
    guard type == .voIP else {
      completion()
      return
    }

    let payloadType = Self.stringValue(payload.dictionaryPayload["type"])

    if payloadType == "call-ended" {
      if let callId = Self.stringValue(payload.dictionaryPayload["callId"]) {
        let uuid = stableCallUUID(for: callId)

        if callsByUUID[uuid] != nil {
          reportCallEnded(callId: callId)
        }
        recentlyFinishedCallIds[callId] = Date()
        reportedIncomingCallIds.removeValue(forKey: callId)
      }
      // End notifications must not create synthetic CallKit calls. They can
      // deactivate the real call audio session during a cold-start answer.
      completion()
      return
    }

    if payloadType != nil && payloadType != "incoming-call" {
      completion()
      return
    }

    guard let callPayload = IncomingCallPayload(dictionary: payload.dictionaryPayload) else {
      reportTransientHandledVoipPush(
        callId: Self.stringValue(payload.dictionaryPayload["callId"]),
        title: transientVoipTitle(from: payload.dictionaryPayload),
        hasVideo: Self.stringValue(payload.dictionaryPayload["mode"])?.lowercased() == "video",
        reason: .failed,
        completion: completion
      )
      return
    }

    guard callPayload.isFresh else {
      recentlyFinishedCallIds[callPayload.callId] = Date()
      reportTransientHandledVoipPush(
        callId: callPayload.callId,
        title: callPayload.displayTitle,
        hasVideo: callPayload.mode == "video",
        reason: .unanswered,
        completion: completion
      )
      return
    }

    if UIApplication.shared.applicationState == .active && isForegroundHandled(callId: callPayload.callId) {
      reportTransientHandledVoipPush(
        callId: callPayload.callId,
        title: callPayload.displayTitle,
        hasVideo: callPayload.mode == "video",
        reason: .remoteEnded,
        completion: completion
      )
      return
    }

    acknowledgeRingingReceipt(callPayload.ringingReceiptUrl)
    reportIncomingCall(callPayload, completion: completion)
  }

  private static func stringValue(_ value: Any?) -> String? {
    if let value = value as? String, !value.isEmpty {
      return value
    }

    if let value {
      let string = "\(value)"
      return string.isEmpty ? nil : string
    }

    return nil
  }

  private func acknowledgeRingingReceipt(_ url: URL?) {
    guard let url, url.scheme == "https" || url.scheme == "http" else {
      return
    }

    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.timeoutInterval = 5
    URLSession.shared.dataTask(with: request).resume()
  }

  func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
    guard let payload = callsByUUID[action.callUUID] else {
      action.fulfill()
      return
    }

    if let url = makeIncomingCallUrl(
      payload: payload,
      answeredByNative: true,
      declineFromNative: false
    ) {
      let urlString = url.absoluteString
      pendingIncomingCallUrl = urlString
      PendingIncomingCallLaunchStore.save(urlString)
      PendingIncomingCallLaunchStore.saveAnsweredCallKitCallId(payload.callId, url: urlString)
    } else {
      PendingIncomingCallLaunchStore.saveAnsweredCallKitCallId(payload.callId)
    }

    try? CallNativeAudioRouteManager.shared.prepareCallKitSession(
      mode: payload.mode,
      useSpeaker: payload.mode.caseInsensitiveCompare("video") == .orderedSame
    )
    action.fulfill()
    if programmaticAnswerCallIds.remove(payload.callId) != nil {
      return
    }
    openIncomingCall(payload: payload, answeredByNative: true, urlAlreadySaved: true)
  }

  func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
    if let payload = callsByUUID.removeValue(forKey: action.callUUID) {
      recentlyFinishedCallIds[payload.callId] = Date()
      reportedIncomingCallIds.removeValue(forKey: payload.callId)
      PendingIncomingCallLaunchStore.clear()
      PendingIncomingCallLaunchStore.clearAnsweredCallKitCallId(payload.callId)
      openIncomingCall(payload: payload, declineFromNative: true)
    }

    action.fulfill()
  }

  func providerDidReset(_ provider: CXProvider) {
    callsByUUID.removeAll()
    recentlyFinishedCallIds.removeAll()
    reportedIncomingCallIds.removeAll()
    callKitAudioActivatedAt = nil
    finishCallKitAudioActivationWaiters(false)
  }

  func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) {
    if let payload = callsByUUID.values.first {
      try? CallNativeAudioRouteManager.shared.prepareCallKitSession(
        mode: payload.mode,
        useSpeaker: payload.mode.caseInsensitiveCompare("video") == .orderedSame
      )
    }

    // CallKit owns activation after VoIP wake; WebRTC must be told or call audio can stay inactive.
    let rtcAudioSession = RTCAudioSession.sharedInstance()
    rtcAudioSession.audioSessionDidActivate(audioSession)
    rtcAudioSession.isAudioEnabled = true
    callKitAudioActivatedAt = Date()
    finishCallKitAudioActivationWaiters(true)
  }

  func provider(_ provider: CXProvider, didDeactivate audioSession: AVAudioSession) {
    // Keep WebRTC's audio state aligned with CallKit when the native call ends.
    let rtcAudioSession = RTCAudioSession.sharedInstance()
    rtcAudioSession.audioSessionDidDeactivate(audioSession)
    rtcAudioSession.isAudioEnabled = false
    callKitAudioActivatedAt = nil
  }

  func consumePendingIncomingCallUrl() -> String? {
    let url = pendingIncomingCallUrl ?? PendingIncomingCallLaunchStore.consume()
    pendingIncomingCallUrl = nil
    PendingIncomingCallLaunchStore.clear()
    return url
  }

  func peekPendingIncomingCallUrl() -> String? {
    pendingIncomingCallUrl ?? PendingIncomingCallLaunchStore.peek()
  }

  func peekPendingAnsweredCallKitCallId() -> String? {
    PendingIncomingCallLaunchStore.peekAnsweredCallKitCallId()
  }

  func peekPendingAnsweredCallKitUrl() -> String? {
    PendingIncomingCallLaunchStore.peekAnsweredCallKitUrl()
  }

  func noteIncomingCallUrlOpened(_ url: URL) {
    guard
      url.host == "incoming-call",
      let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
      components.queryItems?.first(where: { $0.name == "answeredByNative" })?.value == "true",
      let callId = components.queryItems?.first(where: { $0.name == "callId" })?.value,
      !callId.isEmpty
    else {
      return
    }

    PendingIncomingCallLaunchStore.saveAnsweredCallKitCallId(callId, url: url.absoluteString)
  }

  func reportCallEnded(callId: String) {
    let uuid = stableCallUUID(for: callId)
    callsByUUID.removeValue(forKey: uuid)
    recentlyFinishedCallIds[callId] = Date()
    reportedIncomingCallIds.removeValue(forKey: callId)
    pendingIncomingCallUrl = nil
    PendingIncomingCallLaunchStore.clear()
    PendingIncomingCallLaunchStore.clearAnsweredCallKitCallId(callId)
    provider.reportCall(with: uuid, endedAt: Date(), reason: .remoteEnded)
  }

  func suppressIncomingCallKitCall(callId: String) {
    DispatchQueue.main.async {
      self.foregroundHandledCallIds[callId] = Date()
      self.pruneForegroundHandledCallIds()
    }
  }

  func answerIncomingCallKitCall(callId: String, resolve: @escaping RCTPromiseResolveBlock) {
    DispatchQueue.main.async {
      let uuid = self.stableCallUUID(for: callId)

      guard self.callsByUUID[uuid] != nil else {
        resolve(false)
        return
      }

      self.programmaticAnswerCallIds.insert(callId)
      let action = CXAnswerCallAction(call: uuid)
      let transaction = CXTransaction(action: action)

      self.callController.request(transaction) { [weak self] error in
        DispatchQueue.main.async {
          if error != nil {
            self?.programmaticAnswerCallIds.remove(callId)
            resolve(false)
            return
          }

          resolve(true)
        }
      }
    }
  }

  func waitForCallKitAudioActivation(resolve: @escaping RCTPromiseResolveBlock) {
    DispatchQueue.main.async {
      if self.callKitAudioActivatedAt != nil {
        resolve(true)
        return
      }

      self.callKitAudioActivationWaiters.append(resolve)

      if self.callKitAudioActivationTimeout == nil {
        let timer = Timer(timeInterval: 8.0, repeats: false) { [weak self] _ in
          self?.finishCallKitAudioActivationWaiters(false)
        }
        self.callKitAudioActivationTimeout = timer
        RunLoop.main.add(timer, forMode: .common)
      }
    }
  }

  private func finishCallKitAudioActivationWaiters(_ activated: Bool) {
    callKitAudioActivationTimeout?.invalidate()
    callKitAudioActivationTimeout = nil

    guard !callKitAudioActivationWaiters.isEmpty else {
      return
    }

    let waiters = callKitAudioActivationWaiters
    callKitAudioActivationWaiters.removeAll()
    waiters.forEach { $0(activated) }
  }

  func startIncomingRingtone() {
    DispatchQueue.main.async {
      if self.incomingRingtonePlayer?.isPlaying == true {
        return
      }

      guard let url = Bundle.main.url(forResource: "ringtone", withExtension: "wav") else {
        return
      }

      do {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playback, options: [])
        try session.setActive(true, options: [])

        let player = try AVAudioPlayer(contentsOf: url)
        player.numberOfLoops = -1
        player.volume = 0.72
        player.prepareToPlay()
        player.play()
        self.incomingRingtonePlayer = player
      } catch {
        self.incomingRingtonePlayer?.stop()
        self.incomingRingtonePlayer = nil
      }
    }
  }

  func stopIncomingRingtone() {
    DispatchQueue.main.async {
      self.incomingRingtonePlayer?.stop()
      self.incomingRingtonePlayer = nil
    }
  }

  private func reportIncomingCall(_ payload: IncomingCallPayload, completion: @escaping () -> Void) {
    if PendingIncomingCallLaunchStore.peekAnsweredCallKitCallId() != payload.callId {
      pendingIncomingCallUrl = nil
      PendingIncomingCallLaunchStore.clear()
      PendingIncomingCallLaunchStore.clearAnsweredCallKitCallId()
    }

    let uuid = stableCallUUID(for: payload.callId)

    pruneReportedIncomingCallIds()

    if callsByUUID[uuid] != nil {
      completion()
      return
    }

    if reportedIncomingCallIds[payload.callId] != nil {
      completion()
      return
    }

    if isRecentlyFinished(callId: payload.callId) {
      reportTransientHandledVoipPush(
        callId: payload.callId,
        title: payload.displayTitle,
        hasVideo: payload.mode == "video",
        reason: .remoteEnded,
        completion: completion
      )
      return
    }

    callsByUUID[uuid] = payload
    reportedIncomingCallIds[payload.callId] = Date()

    let update = CXCallUpdate()
    update.localizedCallerName = payload.displayTitle
    update.remoteHandle = CXHandle(type: .generic, value: payload.displayTitle)
    update.hasVideo = payload.mode == "video"
    update.supportsHolding = false
    update.supportsGrouping = false
    update.supportsUngrouping = false

    provider.reportNewIncomingCall(with: uuid, update: update) { [weak self] error in
      if error != nil {
        self?.callsByUUID.removeValue(forKey: uuid)
        self?.reportedIncomingCallIds.removeValue(forKey: payload.callId)
      }

      completion()
    }
  }

  private func reportTransientHandledVoipPush(
    callId: String?,
    title: String,
    hasVideo: Bool,
    reason: CXCallEndedReason,
    completion: @escaping () -> Void
  ) {
    let uuid = UUID()
    let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
    let displayTitle = trimmedTitle.isEmpty ? IncomingCallPayload.defaultFallbackTitle(nil) : trimmedTitle
    let update = CXCallUpdate()
    update.localizedCallerName = displayTitle
    update.remoteHandle = CXHandle(type: .generic, value: displayTitle)
    update.hasVideo = hasVideo
    update.supportsHolding = false
    update.supportsGrouping = false
    update.supportsUngrouping = false

    provider.reportNewIncomingCall(with: uuid, update: update) { [weak self] _ in
      if let callId {
        self?.recentlyFinishedCallIds[callId] = Date()
      }

      self?.provider.reportCall(with: uuid, endedAt: Date(), reason: reason)
      completion()
    }
  }

  private func transientVoipTitle(from dictionary: [AnyHashable: Any]) -> String {
    let locale = Self.stringValue(dictionary["locale"])

    return Self.stringValue(dictionary["title"]) ??
      Self.stringValue(dictionary["callerName"]) ??
      Self.stringValue(dictionary["displayName"]) ??
      Self.stringValue(dictionary["body"]) ??
      Self.stringValue(dictionary["fallbackTitle"]) ??
      IncomingCallPayload.defaultFallbackTitle(locale)
  }

  private func isRecentlyFinished(callId: String) -> Bool {
    let now = Date()
    recentlyFinishedCallIds = recentlyFinishedCallIds.filter { now.timeIntervalSince($0.value) < 180 }
    return recentlyFinishedCallIds[callId] != nil
  }

  private func pruneReportedIncomingCallIds() {
    let now = Date()
    reportedIncomingCallIds = reportedIncomingCallIds.filter { now.timeIntervalSince($0.value) < 300 }
  }

  private func isForegroundHandled(callId: String) -> Bool {
    pruneForegroundHandledCallIds()
    return foregroundHandledCallIds[callId] != nil
  }

  private func pruneForegroundHandledCallIds() {
    let now = Date()
    foregroundHandledCallIds = foregroundHandledCallIds.filter { now.timeIntervalSince($0.value) < 45 }
  }

  private func stableCallUUID(for callId: String) -> UUID {
    if let uuid = UUID(uuidString: callId) {
      return uuid
    }

    var bytes = Array(SHA256.hash(data: Data(callId.utf8)).prefix(16))
    bytes[6] = (bytes[6] & 0x0f) | 0x50
    bytes[8] = (bytes[8] & 0x3f) | 0x80

    return UUID(uuid: (
      bytes[0], bytes[1], bytes[2], bytes[3],
      bytes[4], bytes[5],
      bytes[6], bytes[7],
      bytes[8], bytes[9],
      bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15]
    ))
  }

  private func makeIncomingCallUrl(
    payload: IncomingCallPayload,
    answeredByNative: Bool,
    declineFromNative: Bool
  ) -> URL? {
    guard var components = URLComponents(string: "meetvap://incoming-call") else {
      return nil
    }

    var queryItems = [
      URLQueryItem(name: "callId", value: payload.callId),
      URLQueryItem(name: "conversationId", value: payload.conversationId),
      URLQueryItem(name: "mode", value: payload.mode),
      URLQueryItem(name: "title", value: payload.displayTitle),
      URLQueryItem(name: "isGroupCall", value: payload.isGroupCall ? "true" : "false"),
      URLQueryItem(name: "autoJoin", value: payload.autoJoin ? "true" : "false"),
    ]

    if !payload.participantNames.isEmpty {
      queryItems.append(URLQueryItem(name: "participantNames", value: payload.participantNames.joined(separator: ",")))
    }

    if answeredByNative {
      queryItems.append(URLQueryItem(name: "answeredByNative", value: "true"))
    }

    if declineFromNative {
      queryItems.append(URLQueryItem(name: "action", value: "decline"))
    }

    components.queryItems = queryItems
    return components.url
  }

  private func openIncomingCall(
    payload: IncomingCallPayload,
    answeredByNative: Bool = false,
    declineFromNative: Bool = false,
    urlAlreadySaved: Bool = false
  ) {
    guard let url = makeIncomingCallUrl(
      payload: payload,
      answeredByNative: answeredByNative,
      declineFromNative: declineFromNative
    ) else {
      return
    }

    if !urlAlreadySaved {
      let urlString = url.absoluteString
      pendingIncomingCallUrl = urlString
      PendingIncomingCallLaunchStore.save(urlString)
      if answeredByNative {
        PendingIncomingCallLaunchStore.saveAnsweredCallKitCallId(payload.callId, url: urlString)
      }
    }

    DispatchQueue.main.async {
      UIApplication.shared.open(url)

      if declineFromNative {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.75) {
          UIApplication.shared.open(url)
        }
      }
    }
  }
}

private struct IncomingCallPayload {
  let callId: String
  let conversationId: String
  let mode: String
  let title: String
  let body: String?
  let fallbackTitle: String?
  let locale: String?
  let issuedAt: Date?
  let expiresAt: Date?
  let autoJoin: Bool
  let isGroupCall: Bool
  let participantNames: [String]
  let ringingReceiptUrl: URL?
  var displayTitle: String {
    if !title.isEmpty {
      return title
    }

    if let fallbackTitle, !fallbackTitle.isEmpty {
      return fallbackTitle
    }

    return Self.defaultFallbackTitle(locale)
  }

  var isFresh: Bool {
    let now = Date()

    if let expiresAt {
      return expiresAt > now
    }

    if let issuedAt {
      return now.timeIntervalSince(issuedAt) <= 90
    }

    return true
  }

  init?(dictionary: [AnyHashable: Any]) {
    guard
      let callId = Self.stringValue(dictionary["callId"]),
      let conversationId = Self.stringValue(dictionary["conversationId"])
    else {
      return nil
    }

    self.callId = callId
    self.conversationId = conversationId
    self.mode = Self.callMode(dictionary)
    self.locale = Self.stringValue(dictionary["locale"])
    self.body = Self.stringValue(dictionary["body"])
    self.fallbackTitle = Self.stringValue(dictionary["fallbackTitle"])
    self.title = Self.stringValue(dictionary["title"]) ??
      Self.stringValue(dictionary["callerName"]) ??
      Self.stringValue(dictionary["displayName"]) ??
      Self.stringValue(dictionary["body"]) ??
      Self.defaultFallbackTitle(self.locale)
    self.issuedAt = Self.dateFromMilliseconds(dictionary["issuedAt"])
    self.expiresAt = Self.dateFromMilliseconds(dictionary["expiresAt"])
    self.autoJoin = Self.boolValue(dictionary["autoJoin"])
    self.isGroupCall = Self.boolValue(dictionary["isGroupCall"])
    self.participantNames = Self.stringArray(dictionary["participantNames"])
    self.ringingReceiptUrl = Self.stringValue(dictionary["ringingReceiptUrl"]).flatMap(URL.init(string:))
  }

  private static func callMode(_ dictionary: [AnyHashable: Any]) -> String {
    for key in ["mode", "callMode", "callType", "mediaType", "type"] {
      let raw = stringValue(dictionary[key])?.lowercased()

      if raw == "video" {
        return "video"
      }
    }

    if boolValue(dictionary["hasVideo"]) || boolValue(dictionary["video"]) || boolValue(dictionary["isVideo"]) {
      return "video"
    }

    return "voice"
  }

  private static func stringValue(_ value: Any?) -> String? {
    if let value = value as? String, !value.isEmpty {
      return value
    }

    if let value = value {
      let string = "\(value)"
      return string.isEmpty ? nil : string
    }

    return nil
  }

  private static func dateFromMilliseconds(_ value: Any?) -> Date? {
    guard let string = stringValue(value), let milliseconds = Double(string) else {
      return nil
    }

    return Date(timeIntervalSince1970: milliseconds / 1000)
  }

  static func defaultFallbackTitle(_ locale: String?) -> String {
    if locale == "tr" {
      return "Gelen arama"
    }

    if locale == "ru" {
      return "Входящий звонок"
    }

    return "Incoming call"
  }

  private static func boolValue(_ value: Any?) -> Bool {
    if let value = value as? Bool {
      return value
    }

    if let value = value as? String {
      return value == "true" || value == "1"
    }

    if let value = value as? NSNumber {
      return value.boolValue
    }

    return false
  }

  private static func stringArray(_ value: Any?) -> [String] {
    if let value = value as? [String] {
      return value.filter { !$0.isEmpty }
    }

    if let value = value as? [Any] {
      return value.compactMap { stringValue($0) }
    }

    if let value = value as? String, !value.isEmpty {
      return value.split(separator: ",").map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
    }

    return []
  }
}
