import CoreImage
import CFNetwork
import Foundation
import ReplayKit

final class SampleUploader {
  private static let imageContext = CIContext(options: nil)
  private static let maxChunkLength = 10 * 1024

  @Atomic private var isReady = false
  private let connection: ScreenShareSocketConnection
  private let queue = DispatchQueue(label: "com.meetvap.screenshare.uploader")
  private var pendingData: Data?
  private var byteOffset = 0

  init(connection: ScreenShareSocketConnection) {
    self.connection = connection

    connection.didOpen = { [weak self] in
      self?.isReady = true
    }
    connection.didHaveSpaceAvailable = { [weak self] in
      self?.queue.async {
        self?.sendNextChunk()
      }
    }
  }

  func send(sampleBuffer: CMSampleBuffer) {
    guard isReady, let data = prepare(sampleBuffer: sampleBuffer) else {
      return
    }

    isReady = false
    pendingData = data
    byteOffset = 0

    queue.async { [weak self] in
      self?.sendNextChunk()
    }
  }

  private func sendNextChunk() {
    guard let pendingData else {
      isReady = true
      return
    }

    let remaining = pendingData.count - byteOffset
    guard remaining > 0 else {
      self.pendingData = nil
      byteOffset = 0
      isReady = true
      return
    }

    let chunkLength = min(Self.maxChunkLength, remaining)
    let written = pendingData[byteOffset..<(byteOffset + chunkLength)].withUnsafeBytes { rawBuffer -> Int in
      guard let pointer = rawBuffer.bindMemory(to: UInt8.self).baseAddress else {
        return 0
      }
      return connection.write(pointer, maxLength: chunkLength)
    }

    guard written > 0 else {
      return
    }

    byteOffset += written
    if byteOffset >= pendingData.count {
      self.pendingData = nil
      byteOffset = 0
      isReady = true
    }
  }

  private func prepare(sampleBuffer: CMSampleBuffer) -> Data? {
    guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else {
      return nil
    }

    CVPixelBufferLockBaseAddress(pixelBuffer, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, .readOnly) }

    let scale = screenScale(for: pixelBuffer)
    let width = max(1, Int(Double(CVPixelBufferGetWidth(pixelBuffer)) / scale))
    let height = max(1, Int(Double(CVPixelBufferGetHeight(pixelBuffer)) / scale))
    let transform = CGAffineTransform(scaleX: CGFloat(1.0 / scale), y: CGFloat(1.0 / scale))
    let image = CIImage(cvPixelBuffer: pixelBuffer).transformed(by: transform)
    let colorSpace = image.colorSpace ?? CGColorSpaceCreateDeviceRGB()
    let options: [CIImageRepresentationOption: Any] = [
      CIImageRepresentationOption(rawValue: kCGImageDestinationLossyCompressionQuality as String): 0.82
    ]

    guard let jpegData = Self.imageContext.jpegRepresentation(of: image, colorSpace: colorSpace, options: options) else {
      return nil
    }

    let orientation = CMGetAttachment(
      sampleBuffer,
      key: RPVideoSampleOrientationKey as CFString,
      attachmentModeOut: nil
    )?.uintValue ?? 0

    let response = CFHTTPMessageCreateResponse(nil, 200, nil, kCFHTTPVersion1_1).takeRetainedValue()
    CFHTTPMessageSetHeaderFieldValue(response, "Content-Length" as CFString, String(jpegData.count) as CFString)
    CFHTTPMessageSetHeaderFieldValue(response, "Buffer-Width" as CFString, String(width) as CFString)
    CFHTTPMessageSetHeaderFieldValue(response, "Buffer-Height" as CFString, String(height) as CFString)
    CFHTTPMessageSetHeaderFieldValue(response, "Buffer-Orientation" as CFString, String(orientation) as CFString)
    CFHTTPMessageSetBody(response, jpegData as CFData)

    return CFHTTPMessageCopySerializedMessage(response)?.takeRetainedValue() as Data?
  }

  private func screenScale(for pixelBuffer: CVPixelBuffer) -> Double {
    let longestSide = max(CVPixelBufferGetWidth(pixelBuffer), CVPixelBufferGetHeight(pixelBuffer))
    if longestSide >= 2400 {
      return 2.0
    }
    if longestSide >= 1600 {
      return 1.5
    }
    return 1.0
  }
}
