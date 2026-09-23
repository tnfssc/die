import Foundation
import AVFoundation

// Input tap never emits JSON or allocates: it copies at most 1024 mono frames into a bounded SPSC ring.
// Output callback only pulls from the bounded PCM ring. The command queue alone produces playback.
final class CaptureResampler {
    private var converter: AVAudioConverter?
    private var sourceFormat: AVAudioFormat?
    private var targetFormat: AVAudioFormat?
    private var pending = Data()
    private var rate: Double = 0
    func reset() { converter = nil; sourceFormat = nil; targetFormat = nil; pending.removeAll(keepingCapacity: true); rate = 0 }
    func feed(_ samples: UnsafeBufferPointer<Float>, rate newRate: Double, emit: (Data) -> Void) {
        guard newRate >= 8000 && newRate <= 192000 && samples.count <= 1024 else { return }
        if newRate != rate {
            reset(); rate = newRate
            sourceFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: newRate, channels: 1, interleaved: false)
            targetFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16000, channels: 1, interleaved: false)
            guard let sourceFormat, let targetFormat else { return }
            converter = AVAudioConverter(from: sourceFormat, to: targetFormat)
        }
        guard let sourceFormat, let targetFormat, let converter,
              let input = AVAudioPCMBuffer(pcmFormat: sourceFormat, frameCapacity: AVAudioFrameCount(samples.count)),
              let output = AVAudioPCMBuffer(pcmFormat: targetFormat, frameCapacity: 4096),
              let inputData = input.floatChannelData?[0] else { return }
        input.frameLength = AVAudioFrameCount(samples.count)
        inputData.update(from: samples.baseAddress!, count: samples.count)
        var supplied = false
        while true {
            var failure: NSError?
            let status = converter.convert(to: output, error: &failure) { _, inputStatus in
                if supplied { inputStatus.pointee = .noDataNow; return nil }
                supplied = true; inputStatus.pointee = .haveData; return input
            }
            if failure != nil { reset(); return }
            if let data = output.floatChannelData?[0] {
                for i in 0..<Int(output.frameLength) {
                    let value = data[i]
                    let scaled = value.isFinite ? Int(max(-32768, min(32767, (Double(value) * 32768).rounded()))) : 0
                    let bits = UInt16(bitPattern: Int16(scaled))
                    pending.append(UInt8(truncatingIfNeeded: bits))
                    pending.append(UInt8(truncatingIfNeeded: bits >> 8))
                }
                while pending.count >= 640 {
                    emit(Data(pending.prefix(640)))
                    pending.removeFirst(640)
                }
            }
            if status != .haveData || output.frameLength == 0 { break }
        }
    }
}

func parse(_ line: String) -> [String: Any]? {
    guard let data = line.data(using: .utf8), data.count <= 1_000_000,
          let value = try? JSONSerialization.jsonObject(with: data),
          let object = value as? [String: Any], object["type"] is String else { return nil }
    return object
}
func integer(_ value: Any?) -> Int? {
    guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { return nil }
    let n = number.doubleValue
    guard n.isFinite && n >= 0 && n <= Double(Int32.max) && n.rounded() == n else { return nil }
    return Int(n)
}
import CoreFoundation

if CommandLine.arguments.count > 1 {
    switch CommandLine.arguments[1] {
    case "--help":
        print("live-lab-helper: JSON lines on stdin/stdout. Commands: start, play(data, generation), flush(generation), stop. Run --self-test without devices.")
        exit(0)
    case "--self-test":
        let resampler = CaptureResampler()
        let input = [Float](repeating: 0.25, count: 48000)
        var frames = 0
        for start in stride(from: 0, to: input.count, by: 1024) {
            input[start..<min(start + 1024, input.count)].withUnsafeBufferPointer { samples in
                resampler.feed(samples, rate: 48000) { data in
                    if data.count == 640 { frames += 1 }
                }
            }
        }
        guard ll_self_test() != 0, frames >= 49 && frames <= 50,
              parse("{\"type\":\"start\"}")?["type"] as? String == "start",
              parse("invalid") == nil, integer(1.5) == nil, integer(2) == 2 else {
            fputs("self-test failed\n", stderr); exit(1)
        }
        print("self-test passed: protocol, ring, flush, capture and 48k->16k framing")
        exit(0)
    default: fputs("unknown option; use --help\n", stderr); exit(2)
    }
}

final class Lab {
    let core = ll_create()!
    let output = DispatchQueue(label: "live-lab.json-output")
    let resampler = CaptureResampler()
    var engine: AVAudioEngine?
    var timer: DispatchSourceTimer?
    var notification: NSObjectProtocol?
    var starting = false
    var captureRate: Double = 0
    var reportedQueuedMs = 0
    func event(_ object: [String: Any]) {
        output.async {
            guard let bytes = try? JSONSerialization.data(withJSONObject: object),
                  let text = String(data: bytes, encoding: .utf8) else { return }
            print(text); fflush(stdout)
        }
    }
    func error(_ code: String, _ message: String) { event(["type":"error", "code":code, "message":message]) }
    func start() {
        guard engine == nil && !starting else { error("state", "Audio is already starting or running"); return }
        starting = true
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized: open()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .audio) { granted in
                DispatchQueue.main.async {
                    if granted { self.open() }
                    else { self.starting = false; self.error("permission", "Microphone permission denied") }
                }
            }
        default: starting = false; error("permission", "Microphone permission denied")
        }
    }
    func open() {
        let audio = AVAudioEngine()
        do {
            try audio.inputNode.setVoiceProcessingEnabled(true)
            guard audio.inputNode.isVoiceProcessingEnabled else { throw NSError(domain: "voice-processing", code: 1) }
            let inputFormat = audio.inputNode.outputFormat(forBus: 0)
            guard inputFormat.channelCount > 0, inputFormat.commonFormat == .pcmFormatFloat32,
                  !inputFormat.isInterleaved, inputFormat.sampleRate >= 8000,
                  inputFormat.sampleRate <= 192000 else { throw NSError(domain: "input-format", code: 1) }
            captureRate = inputFormat.sampleRate
            let mixFormat = audio.mainMixerNode.outputFormat(forBus: 0)
            let source = AVAudioSourceNode { [core, rate = mixFormat.sampleRate] _, _, frameCount, buffers -> OSStatus in
                let list = UnsafeMutableAudioBufferListPointer(buffers)
                guard let first = list.first, let memory = first.mData else { return -1 }
                let frames = Int(frameCount)
                ll_render(core, memory.assumingMemoryBound(to: Float.self), Int32(frames), rate)
                for channel in list.dropFirst() {
                    if let data = channel.mData { memcpy(data, memory, frames * MemoryLayout<Float>.size) }
                }
                return noErr
            }
            audio.attach(source)
            audio.connect(source, to: audio.mainMixerNode, format: mixFormat)
            audio.inputNode.installTap(onBus: 0, bufferSize: 1024, format: inputFormat) { [core] buffer, _ in
                guard let channel = buffer.floatChannelData?[0], buffer.frameLength <= 1024 else { return }
                _ = ll_capture_push(core, channel, Int32(buffer.frameLength))
            }
            notification = NotificationCenter.default.addObserver(forName: .AVAudioEngineConfigurationChange, object: audio, queue: .main) { [weak self] _ in
                self?.error("route_lost", "Audio device route changed; restart with start after stop")
                self?.stop()
            }
            try audio.start()
            engine = audio
            starting = false
            let t = DispatchSource.makeTimerSource(queue: output)
            t.schedule(deadline: .now() + .milliseconds(10), repeating: .milliseconds(10))
            t.setEventHandler { [weak self] in
                guard let self else { return }
                self.drainCapture()
                let queued = Int(ll_queued_ms(self.core))
                if queued != self.reportedQueuedMs {
                    self.reportedQueuedMs = queued
                    self.event(["type":"played", "queuedMs":queued])
                }
            }
            timer = t; t.resume()
            event(["type":"ready"])
        } catch {
            audio.inputNode.removeTap(onBus: 0)
            if let notification { NotificationCenter.default.removeObserver(notification); self.notification = nil }
            audio.stop(); starting = false
            self.error("audio_start", "Could not start default audio route with voice processing")
        }
    }
    func drainCapture() {
        guard engine != nil else { return }
        var samples = [Float](repeating: 0, count: 1024)
        samples.withUnsafeMutableBufferPointer { ptr in
            while true {
                let n = Int(ll_capture_pop(core, ptr.baseAddress!))
                if n <= 0 { break }
                resampler.feed(UnsafeBufferPointer(start: ptr.baseAddress!, count: n), rate: captureRate) { data in
                    // Already on output queue: preserve order and avoid accumulating a second queue.
                    let object: [String: Any] = ["type":"capture", "data":data.base64EncodedString()]
                    if let bytes = try? JSONSerialization.data(withJSONObject: object),
                       let line = String(data: bytes, encoding: .utf8) { print(line); fflush(stdout) }
                }
            }
        }
    }
    func stop() {
        starting = false
        if let notification { NotificationCenter.default.removeObserver(notification); self.notification = nil }
        timer?.cancel(); timer = nil
        engine?.inputNode.removeTap(onBus: 0)
        engine?.stop(); engine = nil
        ll_flush(core, ll_generation(core) + 1)
        output.async {
            self.resampler.reset()
            self.reportedQueuedMs = 0
            self.event(["type":"played", "queuedMs":0])
        }
        event(["type":"stopped"])
    }
    func command(_ c: [String: Any]) {
        guard let type = c["type"] as? String else { error("protocol", "Missing type"); return }
        switch type {
        case "start": start()
        case "stop": stop()
        case "flush":
            guard let generation = integer(c["generation"]), generation > ll_generation(core) else {
                error("generation", "Flush generation must increase"); return
            }
            ll_flush(core, Int32(generation))
            event(["type":"played", "queuedMs":0])
        case "play":
            guard engine != nil else { error("state", "Start audio before play"); return }
            guard let generation = integer(c["generation"]), generation == ll_generation(core),
                  let encoded = c["data"] as? String, encoded.count <= 64000,
                  let bytes = Data(base64Encoded: encoded), !bytes.isEmpty, bytes.count % 2 == 0,
                  bytes.count <= 48000 else { error("play", "Invalid PCM16 data or generation"); return }
            let count = bytes.count / 2
            var samples = [Int16](repeating: 0, count: count)
            for i in 0..<count { samples[i] = Int16(bitPattern: UInt16(bytes[i*2]) | (UInt16(bytes[i*2+1]) << 8)) }
            var accepted = true
            samples.withUnsafeBufferPointer { ptr in
                var offset = 0
                while offset < count {
                    let n = min(480, count - offset)
                    if ll_play_push(core, ptr.baseAddress! + offset, Int32(n), Int32(generation)) == 0 {
                        accepted = false; break
                    }
                    offset += n
                }
            }
            if !accepted { error("playback_full", "Playback ring full; tail dropped") }
            event(["type":"played", "queuedMs":ll_queued_ms(core)])
        default: error("protocol", "Unknown command")
        }
    }
}
let lab = Lab()
lab.event(["type":"hello", "protocol":1])
DispatchQueue.global(qos: .userInitiated).async {
    while let line = readLine() {
        let parsed = parse(line)
        DispatchQueue.main.async {
            if let parsed { lab.command(parsed) }
            else { lab.error("protocol", "Invalid JSON command") }
        }
    }
    DispatchQueue.main.async { lab.stop(); exit(0) }
}
dispatchMain()
