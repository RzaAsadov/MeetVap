import Foundation

final class ScreenShareSocketConnection: NSObject {
  var didOpen: (() -> Void)?
  var didClose: ((Error?) -> Void)?
  var didHaveSpaceAvailable: (() -> Void)?

  private let filePath: String
  private let socketHandle: Int32
  private var inputStream: InputStream?
  private var outputStream: OutputStream?
  private var streamThread: Thread?

  init?(filePath: String) {
    self.filePath = filePath
    self.socketHandle = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)

    guard socketHandle >= 0 else {
      return nil
    }
  }

  deinit {
    close()
  }

  func open() -> Bool {
    guard FileManager.default.fileExists(atPath: filePath), connectSocket() else {
      return false
    }

    var readStream: Unmanaged<CFReadStream>?
    var writeStream: Unmanaged<CFWriteStream>?
    CFStreamCreatePairWithSocket(kCFAllocatorDefault, socketHandle, &readStream, &writeStream)

    inputStream = readStream?.takeRetainedValue()
    outputStream = writeStream?.takeRetainedValue()
    inputStream?.delegate = self
    outputStream?.delegate = self
    inputStream?.setProperty(kCFBooleanTrue, forKey: Stream.PropertyKey(kCFStreamPropertyShouldCloseNativeSocket as String))
    outputStream?.setProperty(kCFBooleanTrue, forKey: Stream.PropertyKey(kCFStreamPropertyShouldCloseNativeSocket as String))

    let thread = Thread { [weak self] in
      guard let self else { return }
      self.inputStream?.schedule(in: .current, forMode: .common)
      self.outputStream?.schedule(in: .current, forMode: .common)
      self.inputStream?.open()
      self.outputStream?.open()

      while !Thread.current.isCancelled {
        RunLoop.current.run(mode: .default, before: Date(timeIntervalSinceNow: 0.25))
      }
    }
    thread.qualityOfService = .userInitiated
    streamThread = thread
    thread.start()

    return true
  }

  func close() {
    let input = inputStream
    let output = outputStream

    streamThread?.cancel()
    streamThread = nil

    input?.delegate = nil
    output?.delegate = nil
    input?.close()
    output?.close()
    inputStream = nil
    outputStream = nil
  }

  func write(_ buffer: UnsafePointer<UInt8>, maxLength: Int) -> Int {
    outputStream?.write(buffer, maxLength: maxLength) ?? 0
  }

  private func connectSocket() -> Bool {
    var address = sockaddr_un()
    address.sun_family = sa_family_t(AF_UNIX)

    guard filePath.utf8.count < MemoryLayout.size(ofValue: address.sun_path) else {
      return false
    }

    _ = withUnsafeMutablePointer(to: &address.sun_path.0) { pointer in
      filePath.withCString { source in
        strncpy(pointer, source, filePath.utf8.count)
      }
    }

    return withUnsafePointer(to: &address) { pointer in
      pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
        Darwin.connect(socketHandle, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) == 0
      }
    }
  }
}

extension ScreenShareSocketConnection: StreamDelegate {
  func stream(_ stream: Stream, handle eventCode: Stream.Event) {
    switch eventCode {
    case .openCompleted:
      if stream == outputStream {
        didOpen?()
      }
    case .hasSpaceAvailable:
      if stream == outputStream {
        didHaveSpaceAvailable?()
      }
    case .hasBytesAvailable:
      var byte: UInt8 = 0
      let readCount = inputStream?.read(&byte, maxLength: 1) ?? 0
      if readCount == 0 && stream.streamStatus == .atEnd {
        close()
        didClose?(nil)
      }
    case .errorOccurred:
      let error = stream.streamError
      close()
      didClose?(error)
    case .endEncountered:
      close()
      didClose?(nil)
    default:
      break
    }
  }
}
