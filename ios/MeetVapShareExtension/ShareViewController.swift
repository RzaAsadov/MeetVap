import MobileCoreServices
import Social
import UIKit
import UniformTypeIdentifiers

final class ShareViewController: UIViewController {
  private let appGroupIdentifier = "group.com.meetvap.app"
  private let pendingFileName = "pending-share.json"
  private var didStartProcessing = false
  private var didCompleteRequest = false

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)

    guard !didStartProcessing else {
      return
    }

    didStartProcessing = true
    processSharedItems()
  }

  private func processSharedItems() {
    guard let extensionItems = extensionContext?.inputItems as? [NSExtensionItem] else {
      completeRequest()
      return
    }

    let providers = extensionItems.flatMap { $0.attachments ?? [] }
    let group = DispatchGroup()
    let lock = NSLock()
    var sharedItems: [[String: Any]] = []

    providers.forEach { provider in
      if let fileType = preferredFileType(for: provider) {
        group.enter()
        loadSharedFileItem(from: provider, typeIdentifier: fileType) { item in
          defer { group.leave() }

          guard let item else {
            return
          }

          lock.lock()
          sharedItems.append(item)
          lock.unlock()
        }
        return
      }

      if let textType = preferredTextType(for: provider) {
        group.enter()
        provider.loadItem(forTypeIdentifier: textType, options: nil) { item, _ in
          defer { group.leave() }

          if let fileUrl = self.fileUrlValue(from: item) {
            if let sharedFileItem = self.copySharedFile(from: fileUrl, provider: provider, typeIdentifier: textType) {
              lock.lock()
              sharedItems.append(sharedFileItem)
              lock.unlock()
            }
            return
          }

          guard let text = self.textValue(from: item), !text.isEmpty else {
            return
          }

          lock.lock()
          sharedItems.append([
            "kind": "text",
            "text": text,
          ])
          lock.unlock()
        }
        return
      }
    }

    group.notify(queue: .main) {
      self.saveAndOpenApp(sharedItems)
    }
  }

  private func preferredTextType(for provider: NSItemProvider) -> String? {
    [UTType.url.identifier, UTType.plainText.identifier, UTType.text.identifier]
      .first { provider.hasItemConformingToTypeIdentifier($0) }
  }

  private func preferredFileType(for provider: NSItemProvider) -> String? {
    let candidates = [
      UTType.image.identifier,
      UTType.movie.identifier,
      UTType.audio.identifier,
      UTType.pdf.identifier,
      UTType.fileURL.identifier,
      kUTTypeImage as String,
      kUTTypeMovie as String,
      kUTTypeAudio as String,
      kUTTypePDF as String,
    ]

    if let matchedType = candidates.first(where: { provider.hasItemConformingToTypeIdentifier($0) }) {
      return matchedType
    }

    let isTextOnly = provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) ||
      provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) ||
      provider.hasItemConformingToTypeIdentifier(UTType.text.identifier)

    if isTextOnly {
      return nil
    }

    return provider.registeredTypeIdentifiers.first
  }

  private func loadSharedFileItem(
    from provider: NSItemProvider,
    typeIdentifier: String,
    completion: @escaping ([String: Any]?) -> Void
  ) {
    provider.loadFileRepresentation(forTypeIdentifier: typeIdentifier) { url, _ in
      if let url, let item = self.copySharedFile(from: url, provider: provider, typeIdentifier: typeIdentifier) {
        completion(item)
        return
      }

      provider.loadItem(forTypeIdentifier: typeIdentifier, options: nil) { item, _ in
        if let fileUrl = self.fileUrlValue(from: item),
           let sharedFileItem = self.copySharedFile(from: fileUrl, provider: provider, typeIdentifier: typeIdentifier) {
          completion(sharedFileItem)
          return
        }

        if let data = item as? Data,
           let sharedFileItem = self.copySharedData(data, provider: provider, typeIdentifier: typeIdentifier) {
          completion(sharedFileItem)
          return
        }

        if let image = item as? UIImage,
           let imageData = image.jpegData(compressionQuality: 0.92),
           let sharedFileItem = self.copySharedData(imageData, provider: provider, typeIdentifier: UTType.jpeg.identifier) {
          completion(sharedFileItem)
          return
        }

        completion(nil)
      }
    }
  }

  private func fileUrlValue(from item: NSSecureCoding?) -> URL? {
    if let url = item as? URL, url.isFileURL {
      return url
    }

    if let string = item as? String {
      if let url = URL(string: string), url.isFileURL {
        return url
      }

      let fileUrl = URL(fileURLWithPath: string)

      if FileManager.default.fileExists(atPath: fileUrl.path) {
        return fileUrl
      }
    }

    return nil
  }

  private func textValue(from item: NSSecureCoding?) -> String? {
    if let url = item as? URL {
      return url.absoluteString
    }

    if let string = item as? String {
      return string
    }

    if let attributedString = item as? NSAttributedString {
      return attributedString.string
    }

    return nil
  }

  private func copySharedFile(from sourceUrl: URL, provider: NSItemProvider, typeIdentifier: String) -> [String: Any]? {
    guard let containerUrl = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupIdentifier) else {
      return nil
    }

    let importDir = containerUrl.appendingPathComponent("SharedImports", isDirectory: true)
    try? FileManager.default.createDirectory(at: importDir, withIntermediateDirectories: true)

    var suggestedName = provider.suggestedName?.isEmpty == false ? provider.suggestedName! : sourceUrl.lastPathComponent
    if URL(fileURLWithPath: suggestedName).pathExtension.isEmpty, !sourceUrl.pathExtension.isEmpty {
      suggestedName = "\(suggestedName).\(sourceUrl.pathExtension)"
    }
    let effectiveTypeIdentifier = effectiveTypeIdentifier(for: sourceUrl, typeIdentifier: typeIdentifier)
    let fileName = sanitizedFileName(suggestedName, typeIdentifier: effectiveTypeIdentifier)
    let destinationUrl = importDir.appendingPathComponent("\(UUID().uuidString)-\(fileName)")

    do {
      if FileManager.default.fileExists(atPath: destinationUrl.path) {
        try FileManager.default.removeItem(at: destinationUrl)
      }

      try FileManager.default.copyItem(at: sourceUrl, to: destinationUrl)
      let attributes = try? FileManager.default.attributesOfItem(atPath: destinationUrl.path)
      let size = attributes?[.size] as? NSNumber

      return [
        "fileName": fileName,
        "kind": "file",
        "mimeType": mimeType(for: destinationUrl, typeIdentifier: effectiveTypeIdentifier),
        "path": destinationUrl.path,
        "sizeBytes": size?.doubleValue ?? 0,
      ]
    } catch {
      return nil
    }
  }

  private func copySharedData(_ data: Data, provider: NSItemProvider, typeIdentifier: String) -> [String: Any]? {
    guard let containerUrl = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupIdentifier) else {
      return nil
    }

    let importDir = containerUrl.appendingPathComponent("SharedImports", isDirectory: true)
    try? FileManager.default.createDirectory(at: importDir, withIntermediateDirectories: true)

    let suggestedName = provider.suggestedName?.isEmpty == false ? provider.suggestedName! : "shared-file"
    let fileName = sanitizedFileName(suggestedName, typeIdentifier: typeIdentifier)
    let destinationUrl = importDir.appendingPathComponent("\(UUID().uuidString)-\(fileName)")

    do {
      try data.write(to: destinationUrl, options: [.atomic])

      return [
        "fileName": fileName,
        "kind": "file",
        "mimeType": mimeType(for: destinationUrl, typeIdentifier: typeIdentifier),
        "path": destinationUrl.path,
        "sizeBytes": data.count,
      ]
    } catch {
      return nil
    }
  }

  private func saveAndOpenApp(_ items: [[String: Any]]) {
    guard !items.isEmpty else {
      completeRequest()
      return
    }

    guard let containerUrl = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupIdentifier) else {
      completeRequest()
      return
    }

    let payload: [String: Any] = [
      "createdAt": ISO8601DateFormatter().string(from: Date()),
      "items": items,
    ]
    let pendingUrl = containerUrl.appendingPathComponent(pendingFileName)

    do {
      let data = try JSONSerialization.data(withJSONObject: payload)
      try data.write(to: pendingUrl, options: [.atomic])
      openContainingApp()
    } catch {
      completeRequest()
    }
  }

  private func openContainingApp() {
    let urls = ["meetvap://share", "com.meetvap.app://share"].compactMap { URL(string: $0) }

    guard !urls.isEmpty else {
      completeRequest()
      return
    }
    openContainingApp(using: urls, index: 0)
  }

  private func openContainingAppThroughResponderChain(_ url: URL, completion: @escaping (Bool) -> Void) {
    let modernSelector = NSSelectorFromString("openURL:options:completionHandler:")
    var responder: UIResponder? = self

    while let currentResponder = responder {
      if currentResponder.responds(to: modernSelector), let implementation = currentResponder.method(for: modernSelector) {
        typealias OpenURLWithOptionsFunction = @convention(c) (AnyObject, Selector, NSURL, NSDictionary, @escaping (Bool) -> Void) -> Void
        let function = unsafeBitCast(implementation, to: OpenURLWithOptionsFunction.self)
        function(currentResponder, modernSelector, url as NSURL, [:] as NSDictionary) { didOpen in
          DispatchQueue.main.async {
            completion(didOpen)
          }
        }
        return
      }

      responder = currentResponder.next
    }

    let legacySelector = NSSelectorFromString("openURL:")
    responder = self

    while let currentResponder = responder {
      if currentResponder.responds(to: legacySelector) {
        _ = currentResponder.perform(legacySelector, with: url)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
          completion(true)
        }
        return
      }

      responder = currentResponder.next
    }
    completion(false)
  }

  private func openContainingAppThroughApplication(_ url: URL, completion: @escaping (Bool) -> Void) {
    let sharedApplicationSelector = NSSelectorFromString("sharedApplication")

    guard
      let applicationClass = NSClassFromString("UIApplication") as? NSObject.Type,
      applicationClass.responds(to: sharedApplicationSelector),
      let application = applicationClass.perform(sharedApplicationSelector)?.takeUnretainedValue() as? NSObject
    else {
      completion(false)
      return
    }

    let modernSelector = NSSelectorFromString("openURL:options:completionHandler:")
    if application.responds(to: modernSelector), let implementation = application.method(for: modernSelector) {
      typealias OpenURLWithOptionsFunction = @convention(c) (AnyObject, Selector, NSURL, NSDictionary, @escaping (Bool) -> Void) -> Void
      let function = unsafeBitCast(implementation, to: OpenURLWithOptionsFunction.self)
      function(application, modernSelector, url as NSURL, [:] as NSDictionary) { didOpen in
        DispatchQueue.main.async {
          completion(didOpen)
        }
      }
      return
    }

    let legacySelector = NSSelectorFromString("openURL:")
    if application.responds(to: legacySelector) {
      _ = application.perform(legacySelector, with: url)
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
        completion(true)
      }
      return
    }
    completion(false)
  }

  private func completeRequest() {
    guard !didCompleteRequest else {
      return
    }

    didCompleteRequest = true
    extensionContext?.completeRequest(returningItems: nil)
  }

  private func completeRequestAfterOpen() {
    guard !didCompleteRequest else {
      return
    }

    didCompleteRequest = true
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
      self.extensionContext?.completeRequest(returningItems: nil)
    }
  }

  private func openContainingApp(using urls: [URL], index: Int) {
    guard index < urls.count else {
      completeRequest()
      return
    }

    let url = urls[index]

    openContainingAppThroughApplication(url) { applicationDidOpen in
      if applicationDidOpen {
        self.completeRequestAfterOpen()
        return
      }

      self.openContainingAppThroughExtensionContext(url, urls: urls, index: index)
    }
  }

  private func openContainingAppThroughExtensionContext(_ url: URL, urls: [URL], index: Int) {
    guard let extensionContext else {
      openContainingAppThroughResponderChain(url) { responderDidOpen in
        if responderDidOpen {
          self.completeRequestAfterOpen()
          return
        }

        self.openContainingApp(using: urls, index: index + 1)
      }
      return
    }

    extensionContext.open(url) { didOpen in
      DispatchQueue.main.async {
        if didOpen {
          self.completeRequestAfterOpen()
          return
        }

        self.openContainingAppThroughResponderChain(url) { responderDidOpen in
          if responderDidOpen {
            self.completeRequestAfterOpen()
            return
          }

          self.openContainingApp(using: urls, index: index + 1)
        }
      }
    }
  }

  private func sanitizedFileName(_ name: String, typeIdentifier: String) -> String {
    let fallbackExtension = UTType(typeIdentifier)?.preferredFilenameExtension
    let cleaned = name
      .replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: ":", with: "_")
      .trimmingCharacters(in: .whitespacesAndNewlines)

    if !cleaned.isEmpty, URL(fileURLWithPath: cleaned).pathExtension.isEmpty, let fallbackExtension {
      return "\(cleaned).\(fallbackExtension)"
    }

    return cleaned.isEmpty ? "shared-file\(fallbackExtension.map { ".\($0)" } ?? "")" : cleaned
  }

  private func mimeType(for url: URL, typeIdentifier: String) -> String {
    if let type = UTType(typeIdentifier), let mimeType = type.preferredMIMEType {
      return mimeType
    }

    if let type = UTType(filenameExtension: url.pathExtension), let mimeType = type.preferredMIMEType {
      return mimeType
    }

    return "application/octet-stream"
  }

  private func effectiveTypeIdentifier(for url: URL, typeIdentifier: String) -> String {
    if typeIdentifier == UTType.url.identifier || typeIdentifier == UTType.fileURL.identifier {
      return UTType(filenameExtension: url.pathExtension)?.identifier ?? typeIdentifier
    }

    return typeIdentifier
  }
}
