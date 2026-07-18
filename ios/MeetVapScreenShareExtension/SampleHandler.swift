import ReplayKit

private enum ScreenShareConstants {
  static let appGroupIdentifier = "group.com.meetvap.app"
  static let socketFileName = "rtc_SSFD"
}

final class SampleHandler: RPBroadcastSampleHandler {
  private var connection: ScreenShareSocketConnection?
  private var uploader: SampleUploader?
  private var frameCount = 0

  override init() {
    super.init()

    guard
      let containerUrl = FileManager.default.containerURL(
        forSecurityApplicationGroupIdentifier: ScreenShareConstants.appGroupIdentifier
      )
    else {
      return
    }

    let socketPath = containerUrl.appendingPathComponent(ScreenShareConstants.socketFileName).path
    guard let connection = ScreenShareSocketConnection(filePath: socketPath) else {
      return
    }

    self.connection = connection
    self.uploader = SampleUploader(connection: connection)

    connection.didClose = { [weak self] error in
      if let error {
        self?.finishBroadcastWithError(error)
      } else {
        let stopError = NSError(
          domain: RPRecordingErrorDomain,
          code: 10001,
          userInfo: [NSLocalizedDescriptionKey: "Screen sharing stopped"]
        )
        self?.finishBroadcastWithError(stopError)
      }
    }
  }

  override func broadcastStarted(withSetupInfo setupInfo: [String: NSObject]?) {
    frameCount = 0
    openConnectionWhenReady()
  }

  override func broadcastFinished() {
    connection?.close()
  }

  override func processSampleBuffer(_ sampleBuffer: CMSampleBuffer, with sampleBufferType: RPSampleBufferType) {
    guard sampleBufferType == .video else {
      return
    }

    frameCount += 1
    if frameCount % 3 == 0 {
      uploader?.send(sampleBuffer: sampleBuffer)
    }
  }

  private func openConnectionWhenReady() {
    let timer = DispatchSource.makeTimerSource(queue: DispatchQueue(label: "com.meetvap.screenshare.connect"))
    timer.schedule(deadline: .now(), repeating: .milliseconds(100), leeway: .milliseconds(250))
    timer.setEventHandler { [weak self] in
      guard let self else {
        timer.cancel()
        return
      }

      if self.connection?.open() == true {
        timer.cancel()
      }
    }
    timer.resume()
  }
}
