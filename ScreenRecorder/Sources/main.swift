import Cocoa
import AVFoundation
import ScreenCaptureKit
import Network

// Simple embedded HTTP server for serving the editor
class LocalHTTPServer {
    private var listener: NWListener?
    private let port: UInt16
    private let resourcesPath: String
    private var videoFolder: String?

    init(port: UInt16 = 8765, resourcesPath: String) {
        self.port = port
        self.resourcesPath = resourcesPath
    }

    func setVideoFolder(_ path: String) {
        self.videoFolder = path
    }

    func start() -> Bool {
        do {
            let params = NWParameters.tcp
            params.allowLocalEndpointReuse = true
            listener = try NWListener(using: params, on: NWEndpoint.Port(rawValue: port)!)

            listener?.newConnectionHandler = { [weak self] connection in
                self?.handleConnection(connection)
            }

            listener?.stateUpdateHandler = { state in
                switch state {
                case .ready:
                    print("🌐 HTTP server running on http://127.0.0.1:\(self.port)")
                case .failed(let error):
                    print("❌ Server failed: \(error)")
                default:
                    break
                }
            }

            listener?.start(queue: DispatchQueue.global(qos: .userInitiated))
            return true
        } catch {
            print("❌ Failed to start server: \(error)")
            return false
        }
    }

    func stop() {
        listener?.cancel()
        listener = nil
    }

    private func handleConnection(_ connection: NWConnection) {
        connection.start(queue: DispatchQueue.global(qos: .userInitiated))

        connection.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] data, _, _, error in
            guard let self = self, let data = data, error == nil else {
                connection.cancel()
                return
            }

            guard let request = String(data: data, encoding: .utf8),
                  let firstLine = request.components(separatedBy: "\r\n").first else {
                connection.cancel()
                return
            }

            // Parse: GET /path HTTP/1.1
            let parts = firstLine.split(separator: " ")
            guard parts.count >= 2, parts[0] == "GET" else {
                self.sendResponse(connection, status: "400 Bad Request", contentType: "text/plain", body: Data("Bad Request".utf8))
                return
            }

            var requestPath = String(parts[1])

            // If client sent an absolute-form request (e.g. "GET http://127.0.0.1:8765/?a=1 HTTP/1.1"),
            // extract only the path component so we don't try to treat the scheme/host as a file path.
            if requestPath.hasPrefix("http://") || requestPath.hasPrefix("https://") {
                if let url = URL(string: requestPath) {
                    // Use "/" when path is empty
                    requestPath = url.path.isEmpty ? "/" : url.path
                }
            }

            // Strip query string before processing path
            if let queryIndex = requestPath.firstIndex(of: "?") {
                requestPath = String(requestPath[..<queryIndex])
            }

            // Handle URL decoding
            if let decoded = requestPath.removingPercentEncoding {
                requestPath = decoded
            }

            // Route: /video/* serves from video folder, everything else from resources
            if requestPath.hasPrefix("/video/") {
                let fileName = String(requestPath.dropFirst(7))
                if let videoFolder = self.videoFolder {
                    let filePath = (videoFolder as NSString).appendingPathComponent(fileName)
                    self.serveFile(connection, path: filePath)
                } else {
                    self.sendResponse(connection, status: "404 Not Found", contentType: "text/plain", body: Data("Video folder not set".utf8))
                }
            } else {
                // Serve from Editor resources
                var filePath = requestPath
                if filePath == "/" { filePath = "/index.html" }
                let fullPath = (self.resourcesPath as NSString).appendingPathComponent("Editor" + filePath)
                self.serveFile(connection, path: fullPath)
            }
        }
    }

    private func serveFile(_ connection: NWConnection, path: String) {
        guard FileManager.default.fileExists(atPath: path),
              let data = FileManager.default.contents(atPath: path) else {
            sendResponse(connection, status: "404 Not Found", contentType: "text/plain", body: Data("Not Found: \(path)".utf8))
            return
        }

        let contentType = mimeType(for: path)
        sendResponse(connection, status: "200 OK", contentType: contentType, body: data)
    }

    private func sendResponse(_ connection: NWConnection, status: String, contentType: String, body: Data) {
        let headers = """
        HTTP/1.1 \(status)\r
        Content-Type: \(contentType)\r
        Content-Length: \(body.count)\r
        Access-Control-Allow-Origin: *\r
        Connection: close\r
        \r

        """

        var response = Data(headers.utf8)
        response.append(body)

        connection.send(content: response, completion: .contentProcessed { _ in
            connection.cancel()
        })
    }

    private func mimeType(for path: String) -> String {
        let ext = (path as NSString).pathExtension.lowercased()
        switch ext {
        case "html": return "text/html; charset=utf-8"
        case "css": return "text/css"
        case "js": return "application/javascript"
        case "json": return "application/json"
        case "mp4": return "video/mp4"
        case "webm": return "video/webm"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "svg": return "image/svg+xml"
        default: return "application/octet-stream"
        }
    }
}

class RecordingState {
    static let shared = RecordingState()
    var outputURL: URL?
    var webcamURL: URL?
    var clicksURL: URL?
    var micEnabled = true
    var webcamEnabled = true
    var selectedMic: AVCaptureDevice?
    var selectedCamera: AVCaptureDevice?
    var outputDirectory: URL

    init() {
        outputDirectory = FileManager.default.urls(for: .moviesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("ScreenRecorder")
    }
}

struct ClickEvent: Codable {
    let time: Double
    let x: Double
    let y: Double
    let duration: Double
}

class ScreenRecorder: NSObject, SCStreamDelegate, SCStreamOutput, AVCaptureAudioDataOutputSampleBufferDelegate {
    private var stream: SCStream?
    private var assetWriter: AVAssetWriter?
    private var videoInput: AVAssetWriterInput?
    private var audioInput: AVAssetWriterInput?
    private var audioSession: AVCaptureSession?
    private var audioOutput: AVCaptureAudioDataOutput?
    private var adaptor: AVAssetWriterInputPixelBufferAdaptor?
    private var sessionStarted = false
    private var outputURL: URL
    private var clickEvents: [ClickEvent] = []
    private var clickMonitor: Any?
    private var mouseDownTime: Date?
    private var mouseDownPos: (x: Double, y: Double)?
    private var recordingStartTime: Date?
    private var frameCount = 0
    private let writerQueue = DispatchQueue(label: "com.screenrecorder.writer")

    init(outputURL: URL) {
        self.outputURL = outputURL
        super.init()
    }

    func startRecording() async throws {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        guard let display = content.displays.first else {
            print("No display found")
            return
        }

        let excludedApps = content.applications.filter { app in
            app.bundleIdentifier == Bundle.main.bundleIdentifier ||
            app.applicationName.lowercased().contains("screenrecorder")
        }

        let filter = SCContentFilter(display: display, excludingApplications: excludedApps, exceptingWindows: [])

        let config = SCStreamConfiguration()
        // Use native display resolution (not doubled) to reduce encoding load
        config.width = display.width
        config.height = display.height
        // Target 30 fps
        config.minimumFrameInterval = CMTime(value: 1, timescale: 30)
        // Increase queue depth so the capture pipeline has more buffering before dropping
        config.queueDepth = 30
        config.pixelFormat = kCVPixelFormatType_32BGRA
        config.showsCursor = true

        let outputDir = outputURL.deletingLastPathComponent()
        print("📁 Ensuring directory exists: \(outputDir.path)")
        try FileManager.default.createDirectory(at: outputDir, withIntermediateDirectories: true)
        
        if FileManager.default.fileExists(atPath: outputURL.path) {
            print("🗑️  Removing existing file at: \(outputURL.path)")
            try FileManager.default.removeItem(at: outputURL)
        }
        
        print("✍️  Creating asset writer for: \(outputURL.path)")
        assetWriter = try AVAssetWriter(outputURL: outputURL, fileType: .mp4)

        let videoSettings: [String: Any] = [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: config.width,
            AVVideoHeightKey: config.height,
            AVVideoCompressionPropertiesKey: [
                AVVideoAverageBitRateKey: 6_000_000,
                AVVideoMaxKeyFrameIntervalKey: 60,
                AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
                AVVideoExpectedSourceFrameRateKey: 30
            ]
        ]

        videoInput = AVAssetWriterInput(mediaType: .video, outputSettings: videoSettings)
        videoInput?.expectsMediaDataInRealTime = true

        adaptor = AVAssetWriterInputPixelBufferAdaptor(
            assetWriterInput: videoInput!,
            sourcePixelBufferAttributes: [
                kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
                kCVPixelBufferWidthKey as String: config.width,
                kCVPixelBufferHeightKey as String: config.height
            ]
        )

        if assetWriter!.canAdd(videoInput!) {
            assetWriter!.add(videoInput!)
        }

        // Configure audio capture and writer input if mic is enabled and authorized
        if RecordingState.shared.micEnabled {
            let authStatus = AVCaptureDevice.authorizationStatus(for: .audio)
            if authStatus == .authorized {
                let audioSettings: [String: Any] = [
                    AVFormatIDKey: kAudioFormatMPEG4AAC,
                    AVNumberOfChannelsKey: 1,
                    AVSampleRateKey: 44_100,
                    AVEncoderBitRateKey: 64_000
                ]

                audioInput = AVAssetWriterInput(mediaType: .audio, outputSettings: audioSettings)
                audioInput?.expectsMediaDataInRealTime = true
                if assetWriter!.canAdd(audioInput!) {
                    assetWriter!.add(audioInput!)
                }

                // Setup an AVCaptureSession to feed audio sample buffers
                audioSession = AVCaptureSession()
                if let micDevice = RecordingState.shared.selectedMic ?? AVCaptureDevice.default(for: .audio),
                   let micInput = try? AVCaptureDeviceInput(device: micDevice),
                   audioSession!.canAddInput(micInput) {
                    audioSession!.addInput(micInput)
                }

                audioOutput = AVCaptureAudioDataOutput()
                audioOutput!.setSampleBufferDelegate(self, queue: DispatchQueue(label: "audio.queue"))
                if audioSession!.canAddOutput(audioOutput!) {
                    audioSession!.addOutput(audioOutput!)
                }
                audioSession!.startRunning()
            } else {
                print("Microphone not authorized; audio will not be recorded. Request permission from Settings before recording.")
            }
        }

        guard assetWriter!.startWriting() else {
            print("Failed to start writing: \(assetWriter!.error?.localizedDescription ?? "unknown")")
            return
        }

        stream = SCStream(filter: filter, configuration: config, delegate: self)

        let queue = DispatchQueue(label: "com.screenrecorder.capture", qos: .userInitiated)
        try stream?.addStreamOutput(self, type: .screen, sampleHandlerQueue: queue)

        try await stream?.startCapture()
        print("Screen capture started")

        recordingStartTime = Date()
        startClickMonitoring()
    }

    private func startClickMonitoring() {
        // Mouse down: record time and position
        NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) { [weak self] event in
            guard let self = self else { return }
            self.mouseDownTime = Date()
            let screenFrame = NSScreen.main?.frame ?? .zero
            self.mouseDownPos = (
                x: event.locationInWindow.x / screenFrame.width,
                y: 1.0 - (event.locationInWindow.y / screenFrame.height)
            )
        }
        // Mouse up: record time, compute duration, and save click event
        self.clickMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseUp, .rightMouseUp]) { [weak self] event in
            guard let self = self, let startTime = self.recordingStartTime, let downTime = self.mouseDownTime, let downPos = self.mouseDownPos else { return }
            let upTime = Date()
            let elapsed = downTime.timeIntervalSince(startTime)
            let duration = upTime.timeIntervalSince(downTime)
            let screenFrame = NSScreen.main?.frame ?? .zero
            // Use mouse down position for click location
            let click = ClickEvent(
                time: elapsed,
                x: downPos.x,
                y: downPos.y,
                duration: duration
            )
            self.clickEvents.append(click)
            self.mouseDownTime = nil
            self.mouseDownPos = nil
        }
    }

    func stopRecording() async -> [ClickEvent] {
        if let monitor = clickMonitor {
            NSEvent.removeMonitor(monitor)
            clickMonitor = nil
        }

        do {
            try await stream?.stopCapture()
        } catch {
            print("Error stopping capture: \(error)")
        }
        stream = nil

        print("Captured \(frameCount) frames")

        if sessionStarted {
            videoInput?.markAsFinished()
            audioInput?.markAsFinished()
            await assetWriter?.finishWriting()
            print("Finished writing to: \(outputURL.path)")
        } else {
            print("No frames were captured!")
            assetWriter?.cancelWriting()
        }

        // Stop audio capture session if it was running
        if let session = audioSession {
            session.stopRunning()
            audioSession = nil
        }

        return clickEvents
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen else { return }

        guard sampleBuffer.isValid else { return }

        guard let attachments = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
              let statusValue = attachments.first?[.status] as? Int,
              statusValue == SCFrameStatus.complete.rawValue else {
            return
        }

        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }

        let pts = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)

        if !sessionStarted {
            assetWriter?.startSession(atSourceTime: pts)
            sessionStarted = true
            print("Session started at \(pts.seconds)")
        }

        // Append on a dedicated writer queue to avoid blocking the capture callback
        writerQueue.async { [weak self] in
            guard let self = self else { return }
            guard let input = self.videoInput else { return }

            if !input.isReadyForMoreMediaData {
                // Input can't accept data right now; drop this frame and log occasionally
                if self.frameCount % 30 == 0 {
                    print("⚠️ Video input not ready; dropping frame at \(pts.seconds)")
                }
                return
            }

            autoreleasepool {
                let appended = self.adaptor?.append(pixelBuffer, withPresentationTime: pts) == true
                if appended {
                    self.frameCount += 1
                } else {
                    if self.frameCount % 30 == 0 {
                        print("⚠️ Failed to append pixel buffer at \(pts.seconds)")
                    }
                }
            }
        }
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        print("Stream stopped with error: \(error)")
    }

    // AVCaptureAudioDataOutputSampleBufferDelegate - receive mic audio and append to writer
    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        guard RecordingState.shared.micEnabled else { return }
        guard let audioInput = audioInput, audioInput.isReadyForMoreMediaData else { return }
        guard sampleBuffer.isValid else { return }

        // If session hasn't started yet, start it at the first audio timestamp
        if !sessionStarted {
            let pts = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
            assetWriter?.startSession(atSourceTime: pts)
            sessionStarted = true
            print("Session started at (audio) \(pts.seconds)")
        }

        _ = audioInput.append(sampleBuffer)
    }
}

class WebcamRecorder: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
    private var session: AVCaptureSession?
    private var assetWriter: AVAssetWriter?
    private var videoInput: AVAssetWriterInput?
    private var adaptor: AVAssetWriterInputPixelBufferAdaptor?
    private var sessionStarted = false
    private var outputURL: URL

    init(outputURL: URL) {
        self.outputURL = outputURL
        super.init()
    }

    func startRecording() throws {
        guard RecordingState.shared.webcamEnabled else { return }

        session = AVCaptureSession()
        session?.sessionPreset = .hd1280x720

        let camera = RecordingState.shared.selectedCamera ?? AVCaptureDevice.default(for: .video)
        guard let cam = camera, let input = try? AVCaptureDeviceInput(device: cam) else { return }

        session?.addInput(input)

        let output = AVCaptureVideoDataOutput()
        output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
        output.setSampleBufferDelegate(self, queue: DispatchQueue(label: "webcam.queue"))
        session?.addOutput(output)

        if FileManager.default.fileExists(atPath: outputURL.path) {
            try FileManager.default.removeItem(at: outputURL)
        }

        assetWriter = try AVAssetWriter(outputURL: outputURL, fileType: .mp4)

        let videoSettings: [String: Any] = [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: 1280,
            AVVideoHeightKey: 720,
            AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: 4_000_000]
        ]

        videoInput = AVAssetWriterInput(mediaType: .video, outputSettings: videoSettings)
        videoInput?.expectsMediaDataInRealTime = true

        adaptor = AVAssetWriterInputPixelBufferAdaptor(
            assetWriterInput: videoInput!,
            sourcePixelBufferAttributes: nil
        )

        assetWriter?.add(videoInput!)
        assetWriter?.startWriting()
        session?.startRunning()
    }

    func stopRecording() async {
        session?.stopRunning()
        session = nil

        if sessionStarted {
            videoInput?.markAsFinished()
            await assetWriter?.finishWriting()
        }
    }

    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        let pts = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)

        if !sessionStarted {
            assetWriter?.startSession(atSourceTime: pts)
            sessionStarted = true
        }

        guard let input = videoInput, input.isReadyForMoreMediaData else { return }
        adaptor?.append(pixelBuffer, withPresentationTime: pts)
    }
}

class SettingsWindowController: NSWindowController {
    var onStart: (() -> Void)?
    private var micPopup: NSPopUpButton!
    private var cameraPopup: NSPopUpButton!
    private var micToggle: NSSwitch!
    private var cameraToggle: NSSwitch!
    private var pathLabel: NSTextField!
    private var previewLayer: AVCaptureVideoPreviewLayer?
    private var previewSession: AVCaptureSession?

    init() {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 500, height: 450),
            styleMask: [.titled, .closable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.title = "Screen Recorder"
        window.titlebarAppearsTransparent = true
        window.backgroundColor = NSColor(white: 0.1, alpha: 1)
        window.center()

        super.init(window: window)
        setupUI()
    }

    required init?(coder: NSCoder) { fatalError() }

    private func setupUI() {
        let container = NSView(frame: NSRect(x: 0, y: 0, width: 500, height: 450))

        let titleLabel = NSTextField(labelWithString: "Screen Recorder")
        titleLabel.frame = NSRect(x: 20, y: 400, width: 460, height: 30)
        titleLabel.font = .systemFont(ofSize: 24, weight: .bold)
        titleLabel.textColor = .white
        container.addSubview(titleLabel)

        let previewBox = NSBox(frame: NSRect(x: 20, y: 240, width: 200, height: 150))
        previewBox.title = "Camera Preview"
        previewBox.titlePosition = .atTop
        previewBox.boxType = .custom
        previewBox.fillColor = NSColor(white: 0.15, alpha: 1)
        previewBox.borderColor = NSColor(white: 0.3, alpha: 1)
        previewBox.cornerRadius = 8
        container.addSubview(previewBox)
        setupCameraPreview(in: previewBox)

        let cameraLabel = NSTextField(labelWithString: "Camera")
        cameraLabel.frame = NSRect(x: 240, y: 360, width: 100, height: 20)
        cameraLabel.textColor = .white
        container.addSubview(cameraLabel)

        cameraToggle = NSSwitch(frame: NSRect(x: 420, y: 355, width: 50, height: 25))
        cameraToggle.state = .on
        cameraToggle.target = self
        cameraToggle.action = #selector(cameraToggled)
        container.addSubview(cameraToggle)

        cameraPopup = NSPopUpButton(frame: NSRect(x: 240, y: 320, width: 240, height: 30))
        populateCameras()
        container.addSubview(cameraPopup)

        let micLabel = NSTextField(labelWithString: "Microphone")
        micLabel.frame = NSRect(x: 240, y: 280, width: 100, height: 20)
        micLabel.textColor = .white
        container.addSubview(micLabel)

        micToggle = NSSwitch(frame: NSRect(x: 420, y: 275, width: 50, height: 25))
        micToggle.state = .on
        micToggle.target = self
        micToggle.action = #selector(micToggled)
        container.addSubview(micToggle)

        micPopup = NSPopUpButton(frame: NSRect(x: 240, y: 240, width: 240, height: 30))
        populateMicrophones()
        // Enable mic popup only if mic permission is already authorized
        let micAuth = AVCaptureDevice.authorizationStatus(for: .audio)
        micPopup.isEnabled = (micAuth == .authorized) && (micToggle.state == .on)
        container.addSubview(micPopup)

        let pathBox = NSBox(frame: NSRect(x: 20, y: 140, width: 460, height: 80))
        pathBox.title = "Save Location"
        pathBox.titlePosition = .atTop
        pathBox.boxType = .custom
        pathBox.fillColor = NSColor(white: 0.15, alpha: 1)
        pathBox.borderColor = NSColor(white: 0.3, alpha: 1)
        pathBox.cornerRadius = 8
        container.addSubview(pathBox)

        pathLabel = NSTextField(labelWithString: RecordingState.shared.outputDirectory.path)
        pathLabel.frame = NSRect(x: 10, y: 10, width: 340, height: 40)
        pathLabel.textColor = .lightGray
        pathLabel.backgroundColor = .clear
        pathLabel.isBezeled = false
        pathLabel.isEditable = false
        pathLabel.lineBreakMode = .byTruncatingMiddle
        pathBox.contentView?.addSubview(pathLabel)

        let browseBtn = NSButton(title: "Browse", target: self, action: #selector(browsePath))
        browseBtn.frame = NSRect(x: 360, y: 15, width: 80, height: 30)
        browseBtn.bezelStyle = .rounded
        pathBox.contentView?.addSubview(browseBtn)

        let startButton = NSButton(title: "Start Recording", target: self, action: #selector(startRecording))
        startButton.frame = NSRect(x: 150, y: 40, width: 200, height: 50)
        startButton.bezelStyle = .rounded
        startButton.font = .systemFont(ofSize: 16, weight: .semibold)
        startButton.contentTintColor = .white
        startButton.wantsLayer = true
        startButton.layer?.backgroundColor = NSColor.systemRed.cgColor
        startButton.layer?.cornerRadius = 10
        container.addSubview(startButton)

        window?.contentView = container
    }

    private func setupCameraPreview(in box: NSBox) {
        previewSession = AVCaptureSession()
        guard let camera = AVCaptureDevice.default(for: .video),
              let input = try? AVCaptureDeviceInput(device: camera) else { return }
        previewSession?.addInput(input)
        previewLayer = AVCaptureVideoPreviewLayer(session: previewSession!)
        previewLayer?.frame = NSRect(x: 5, y: 5, width: 190, height: 120)
        previewLayer?.videoGravity = .resizeAspectFill
        previewLayer?.cornerRadius = 6
        box.contentView?.wantsLayer = true
        box.contentView?.layer?.addSublayer(previewLayer!)
        previewSession?.startRunning()
    }

    private func populateCameras() {
        let cameras = AVCaptureDevice.DiscoverySession(deviceTypes: [.builtInWideAngleCamera, .externalUnknown], mediaType: .video, position: .unspecified).devices
        cameraPopup.removeAllItems()
        for camera in cameras {
            cameraPopup.addItem(withTitle: camera.localizedName)
            cameraPopup.lastItem?.representedObject = camera
        }
    }

    private func populateMicrophones() {
        let mics = AVCaptureDevice.DiscoverySession(deviceTypes: [.builtInMicrophone, .externalUnknown], mediaType: .audio, position: .unspecified).devices
        micPopup.removeAllItems()
        for mic in mics {
            micPopup.addItem(withTitle: mic.localizedName)
            micPopup.lastItem?.representedObject = mic
        }
    }

    @objc private func cameraToggled() {
        RecordingState.shared.webcamEnabled = cameraToggle.state == .on
        cameraPopup.isEnabled = cameraToggle.state == .on
        if cameraToggle.state == .on { previewSession?.startRunning() }
        else { previewSession?.stopRunning() }
    }

    @objc private func micToggled() {
        let enabled = micToggle.state == .on
        RecordingState.shared.micEnabled = enabled
        micPopup.isEnabled = enabled

        if enabled {
            let status = AVCaptureDevice.authorizationStatus(for: .audio)
            switch status {
            case .notDetermined:
                AVCaptureDevice.requestAccess(for: .audio) { granted in
                    DispatchQueue.main.async {
                        if granted {
                            self.populateMicrophones()
                            self.micPopup.isEnabled = true
                        } else {
                            self.micToggle.state = .off
                            RecordingState.shared.micEnabled = false
                            self.micPopup.isEnabled = false
                            let alert = NSAlert()
                            alert.messageText = "Microphone Permission Required"
                            alert.informativeText = "Please enable Microphone access in System Settings > Privacy & Security > Microphone."
                            alert.addButton(withTitle: "Open System Settings")
                            alert.addButton(withTitle: "OK")
                            if alert.runModal() == .alertFirstButtonReturn {
                                NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone")!)
                            }
                        }
                    }
                }
            case .denied, .restricted:
                // Inform the user and offer to open System Settings
                let alert = NSAlert()
                alert.messageText = "Microphone Permission Disabled"
                alert.informativeText = "Microphone access is disabled. Open System Settings to enable it."
                alert.addButton(withTitle: "Open System Settings")
                alert.addButton(withTitle: "Cancel")
                if alert.runModal() == .alertFirstButtonReturn {
                    NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone")!)
                }
                micToggle.state = .off
                RecordingState.shared.micEnabled = false
                micPopup.isEnabled = false
            case .authorized:
                populateMicrophones()
                micPopup.isEnabled = true
            @unknown default:
                micPopup.isEnabled = false
            }
        } else {
            micPopup.isEnabled = false
        }
    }

    @objc private func browsePath() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.canCreateDirectories = true
        if panel.runModal() == .OK, let url = panel.url {
            RecordingState.shared.outputDirectory = url
            pathLabel.stringValue = url.path
        }
    }

    @objc private func startRecording() {
        RecordingState.shared.micEnabled = micToggle.state == .on
        RecordingState.shared.webcamEnabled = cameraToggle.state == .on
        RecordingState.shared.selectedCamera = cameraPopup.selectedItem?.representedObject as? AVCaptureDevice
        RecordingState.shared.selectedMic = micPopup.selectedItem?.representedObject as? AVCaptureDevice
        previewSession?.stopRunning()
        window?.close()
        onStart?()
    }
}

class CountdownWindowController: NSWindowController {
    var onComplete: (() -> Void)?
    private var countLabel: NSTextField!
    private var count = 3

    init() {
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 200, height: 200), styleMask: [.borderless], backing: .buffered, defer: false)
        window.level = .screenSaver
        window.backgroundColor = .clear
        window.isOpaque = false
        window.center()
        super.init(window: window)
        setupUI()
    }

    required init?(coder: NSCoder) { fatalError() }

    private func setupUI() {
        let container = NSVisualEffectView(frame: NSRect(x: 0, y: 0, width: 200, height: 200))
        container.material = .hudWindow
        container.state = .active
        container.wantsLayer = true
        container.layer?.cornerRadius = 100
        container.layer?.masksToBounds = true
        countLabel = NSTextField(labelWithString: "3")
        countLabel.frame = NSRect(x: 0, y: 60, width: 200, height: 80)
        countLabel.font = .systemFont(ofSize: 72, weight: .bold)
        countLabel.textColor = .white
        countLabel.alignment = .center
        container.addSubview(countLabel)
        window?.contentView = container
    }

    func startCountdown() {
        showWindow(nil)
        playTick()
        Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] timer in
            guard let self = self else { timer.invalidate(); return }
            self.count -= 1
            if self.count > 0 {
                self.countLabel.stringValue = "\(self.count)"
                self.playTick()
            } else {
                timer.invalidate()
                self.playStart()
                self.window?.close()
                self.onComplete?()
            }
        }
    }

    private func playTick() { NSSound(named: "Tink")?.play() }
    private func playStart() { NSSound(named: "Glass")?.play() }
}

class FloatingPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

class RecordingIslandController: NSWindowController {
    private var screenRecorder: ScreenRecorder?
    private var webcamRecorder: WebcamRecorder?
    private var timer: Timer?
    private var seconds = 0
    private var timerLabel: NSTextField!
    private var pauseButton: NSButton!
    private var micButton: NSButton!
    private var webcamButton: NSButton!
    private var isPaused = false
    private var isMicMuted = false
    private var isWebcamHidden = false
    private var httpServer: LocalHTTPServer?

    init() {
        let panel = FloatingPanel(contentRect: NSRect(x: 0, y: 0, width: 320, height: 50), styleMask: [.nonactivatingPanel, .fullSizeContentView], backing: .buffered, defer: false)
        panel.level = .screenSaver
        panel.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.sharingType = .none
        panel.isMovableByWindowBackground = true
        super.init(window: panel)
        setupUI()
        if let screen = NSScreen.main {
            panel.setFrameOrigin(NSPoint(x: (screen.frame.width - 320) / 2, y: 80))
        }
    }

    required init?(coder: NSCoder) { fatalError() }

    private func setupUI() {
        let container = NSVisualEffectView(frame: NSRect(x: 0, y: 0, width: 320, height: 50))
        container.material = .hudWindow
        container.state = .active
        container.wantsLayer = true
        container.layer?.cornerRadius = 25
        container.layer?.masksToBounds = true

        let stopBtn = createBtn(frame: NSRect(x: 12, y: 10, width: 30, height: 30), title: "◼", color: .systemRed)
        stopBtn.action = #selector(stopAndEdit)
        stopBtn.target = self
        container.addSubview(stopBtn)

        pauseButton = createBtn(frame: NSRect(x: 48, y: 10, width: 30, height: 30), title: "⏸", color: .systemOrange)
        pauseButton.action = #selector(togglePause)
        pauseButton.target = self
        container.addSubview(pauseButton)

        let restartBtn = createBtn(frame: NSRect(x: 84, y: 10, width: 30, height: 30), title: "↺", color: .systemBlue)
        restartBtn.action = #selector(restartRecording)
        restartBtn.target = self
        container.addSubview(restartBtn)

        timerLabel = NSTextField(labelWithString: "00:00")
        timerLabel.frame = NSRect(x: 120, y: 15, width: 60, height: 20)
        timerLabel.font = .monospacedDigitSystemFont(ofSize: 15, weight: .medium)
        timerLabel.textColor = .white
        container.addSubview(timerLabel)

        micButton = createBtn(frame: NSRect(x: 185, y: 10, width: 30, height: 30), title: "🎤", color: .systemGreen)
        micButton.action = #selector(toggleMic)
        micButton.target = self
        container.addSubview(micButton)

        webcamButton = createBtn(frame: NSRect(x: 221, y: 10, width: 30, height: 30), title: "📷", color: .systemGreen)
        webcamButton.action = #selector(toggleWebcam)
        webcamButton.target = self
        container.addSubview(webcamButton)

        let doneBtn = NSButton(title: "Done", target: self, action: #selector(stopAndEdit))
        doneBtn.frame = NSRect(x: 257, y: 10, width: 52, height: 30)
        doneBtn.bezelStyle = .rounded
        container.addSubview(doneBtn)

        window?.contentView = container
    }

    private func createBtn(frame: NSRect, title: String, color: NSColor) -> NSButton {
        let btn = NSButton(frame: frame)
        btn.title = title
        btn.bezelStyle = .circular
        btn.isBordered = false
        btn.wantsLayer = true
        btn.layer?.backgroundColor = color.withAlphaComponent(0.3).cgColor
        btn.layer?.cornerRadius = 15
        btn.font = .systemFont(ofSize: 13)
        return btn
    }

    func startRecording() {
        let df = DateFormatter()
        df.dateFormat = "yyyy-MM-dd_HH-mm-ss"
        let timestamp = df.string(from: Date())

        // Create a unique folder for this recording session
        let folderName = "Video_\(timestamp)"
        let sessionDir = RecordingState.shared.outputDirectory.appendingPathComponent(folderName)
        
        do {
            try FileManager.default.createDirectory(at: sessionDir, withIntermediateDirectories: true)
            print("✅ Created session directory: \(sessionDir.path)")
        } catch {
            print("❌ Failed to create directory: \(error)")
            return
        }

        let screenURL = sessionDir.appendingPathComponent("screen.mp4")
        let webcamURL = sessionDir.appendingPathComponent("webcam.mp4")
        let clicksURL = sessionDir.appendingPathComponent("clicks.json")
        
        print("📹 Screen recording will be saved to: \(screenURL.path)")
        print("📹 Webcam recording will be saved to: \(webcamURL.path)")
        print("📄 Clicks data will be saved to: \(clicksURL.path)")

        RecordingState.shared.outputURL = screenURL
        RecordingState.shared.webcamURL = webcamURL
        RecordingState.shared.clicksURL = clicksURL

        screenRecorder = ScreenRecorder(outputURL: screenURL)
        webcamRecorder = WebcamRecorder(outputURL: webcamURL)

        Task {
            do {
                try await screenRecorder?.startRecording()
                try webcamRecorder?.startRecording()
            } catch {
                print("Recording error: \(error)")
            }
        }

        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            guard let self = self, !self.isPaused else { return }
            self.seconds += 1
            DispatchQueue.main.async {
                self.timerLabel.stringValue = String(format: "%02d:%02d", self.seconds / 60, self.seconds % 60)
            }
        }
    }

    @objc private func togglePause() {
        isPaused = !isPaused
        pauseButton.title = isPaused ? "▶" : "⏸"
        pauseButton.layer?.backgroundColor = (isPaused ? NSColor.systemGreen : NSColor.systemOrange).withAlphaComponent(0.3).cgColor
    }

    @objc private func toggleMic() {
        isMicMuted = !isMicMuted
        micButton.layer?.backgroundColor = (isMicMuted ? NSColor.systemRed : NSColor.systemGreen).withAlphaComponent(0.3).cgColor
        micButton.title = isMicMuted ? "🔇" : "🎤"
    }

    @objc private func toggleWebcam() {
        isWebcamHidden = !isWebcamHidden
        webcamButton.layer?.backgroundColor = (isWebcamHidden ? NSColor.systemRed : NSColor.systemGreen).withAlphaComponent(0.3).cgColor
    }

    @objc private func restartRecording() {
        Task {
            _ = await screenRecorder?.stopRecording()
            await webcamRecorder?.stopRecording()
            DispatchQueue.main.async {
                self.seconds = 0
                self.timerLabel.stringValue = "00:00"
            }
            try? await Task.sleep(nanoseconds: 300_000_000)
            DispatchQueue.main.async { self.startRecording() }
        }
    }

    @objc private func stopAndEdit() {
        timer?.invalidate()
        window?.orderOut(nil)

        Task {
            let clicks = await screenRecorder?.stopRecording() ?? []
            await webcamRecorder?.stopRecording()

            if let clicksURL = RecordingState.shared.clicksURL {
                let encoder = JSONEncoder()
                encoder.outputFormatting = .prettyPrinted
                if let data = try? encoder.encode(clicks) {
                    try? data.write(to: clicksURL)
                }
            }

            try? await Task.sleep(nanoseconds: 500_000_000)
            DispatchQueue.main.async { self.openEditor() }
        }
    }

    private func openEditor() {
        guard let screenURL = RecordingState.shared.outputURL else { return }

        // Try bundled editor first (in app Resources)
        let bundledEditorPath = Bundle.main.bundlePath + "/Contents/Resources/Editor/index.html"

        // Fallback to external editor (when running from .app but editor is alongside)
        let externalEditorDir = (Bundle.main.bundlePath as NSString).deletingLastPathComponent
        let externalEditorPath = externalEditorDir + "/Editor/index.html"

        // Debug mode fallback: when running raw binary from .build/debug/
        // Navigate up from .build/arm64-apple-macosx/debug/ to project root
        let debugBinaryDir = Bundle.main.bundlePath as NSString
        let projectRoot = ((debugBinaryDir.deletingLastPathComponent as NSString)
            .deletingLastPathComponent as NSString)
            .deletingLastPathComponent as NSString
        let debugEditorPath = projectRoot.appendingPathComponent("Editor/index.html")

        let resourcesPath: String

        if FileManager.default.fileExists(atPath: bundledEditorPath) {
            resourcesPath = Bundle.main.bundlePath + "/Contents/Resources"
            print("📦 Using bundled editor")
        } else if FileManager.default.fileExists(atPath: externalEditorPath) {
            resourcesPath = externalEditorDir
            print("🔧 Using external editor (dev mode)")
        } else if FileManager.default.fileExists(atPath: debugEditorPath) {
            resourcesPath = projectRoot as String
            print("🔧 Using debug editor at: \(debugEditorPath)")
        } else {
            print("❌ Editor not found! Searched:")
            print("   - \(bundledEditorPath)")
            print("   - \(externalEditorPath)")
            print("   - \(debugEditorPath)")
            NSApp.terminate(nil)
            return
        }

        let videoFolder = screenURL.deletingLastPathComponent().path

        // Always use localhost server - file:// URLs don't allow JS to fetch local files
        print("🌐 Starting localhost server to serve editor and videos...")

        httpServer = LocalHTTPServer(port: 8765, resourcesPath: resourcesPath)
        httpServer?.setVideoFolder(videoFolder)

        if httpServer?.start() == true {
            // Build localhost URL with video paths relative to /video/
            var urlString = "http://127.0.0.1:8765/?screen=/video/screen.mp4"

            if RecordingState.shared.webcamEnabled, let webcamURL = RecordingState.shared.webcamURL,
               FileManager.default.fileExists(atPath: webcamURL.path) {
                urlString += "&webcam=/video/webcam.mp4"
            }

            if let clicksURL = RecordingState.shared.clicksURL,
               FileManager.default.fileExists(atPath: clicksURL.path) {
                urlString += "&clicks=/video/clicks.json"
            }

            // Small delay to ensure server is ready
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                if let url = URL(string: urlString) {
                    print("🌐 Opening editor: \(url)")
                    NSWorkspace.shared.open(url)
                }
            }

            // Schedule app termination after 5 minutes to prevent ghost instances
            DispatchQueue.main.asyncAfter(deadline: .now() + 300) {
                print("⏰ Auto-terminating app after 5 minutes")
                NSApp.terminate(nil)
            }

            // Keep app running to serve files (don't terminate)
            print("📡 Server running - app will stay open to serve files")
        } else {
            print("❌ Failed to start server")
            NSApp.terminate(nil)
        }
    }

}

class AppDelegate: NSObject, NSApplicationDelegate {
    var settingsController: SettingsWindowController?
    var countdownController: CountdownWindowController?
    var islandController: RecordingIslandController?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)

        // Check screen recording permission silently
        Task {
            do {
                _ = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
                // Permission granted, proceed normally
                DispatchQueue.main.async {
                    self.settingsController = SettingsWindowController()
                    self.settingsController?.onStart = { [weak self] in self?.showCountdown() }
                    self.settingsController?.showWindow(nil)
                }
            } catch {
                // Permission denied - show our dialog
                DispatchQueue.main.async {
                    let alert = NSAlert()
                    alert.messageText = "Screen Recording Permission Required"
                    alert.informativeText = "Please grant screen recording permission in System Settings > Privacy & Security > Screen Recording"
                    alert.alertStyle = .warning
                    alert.addButton(withTitle: "Open System Settings")
                    alert.addButton(withTitle: "Quit")
                    let response = alert.runModal()
                    if response == .alertFirstButtonReturn {
                        NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")!)
                        // Do not terminate here; user needs to enable permission and then relaunch the app manually.
                        return
                    } else {
                        NSApp.terminate(nil)
                    }
                }
            }
        }
    }

    private func showCountdown() {
        NSApp.setActivationPolicy(.accessory)
        countdownController = CountdownWindowController()
        countdownController?.onComplete = { [weak self] in self?.startRecording() }
        countdownController?.startCountdown()
    }

    private func startRecording() {
        islandController = RecordingIslandController()
        islandController?.showWindow(nil)
        islandController?.startRecording()
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
