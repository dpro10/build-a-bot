// BabAudioHelper.swift: Build-a-bot's small macOS helper (source; build with ./build.sh on a Mac).
//
//   bab-audio-helper mic        one JSON line: which apps have the microphone open right now
//   bab-audio-helper watch      a JSON line whenever that changes (until killed)
//   bab-audio-helper tap [--exclude-pid PID]... [--sample-rate 16000]
//                               the computer's audio output (the call) through a Core Audio tap,
//                               as raw 16-bit little-endian mono PCM on stdout (macOS 14.2+)
//
// `mic` / `watch` need no permission. They read Core Audio's per-process objects
// (macOS 14+: kAudioHardwarePropertyProcessObjectList → kAudioProcessPropertyIsRunningInput,
// kAudioProcessPropertyPID, kAudioProcessPropertyBundleID), map helper processes to their
// outermost .app ("Google Chrome Helper" → com.google.Chrome), and add each app's on-screen
// window bounds (CGWindowList: bounds and owner PID need no Screen Recording permission;
// window titles would, so they're not read). On macOS 13 they fall back to "some app is
// using the default mic" (kAudioDevicePropertyDeviceIsRunningSomewhere), with no app names.
//
// `tap` is the recommended way to hear the call on macOS (docs/research/meetings-2026-10-14.md
// §3.2): CATapDescription → AudioHardwareCreateProcessTap → a private aggregate device →
// an IO proc. It needs only the "System Audio Recording" permission (NSAudioCaptureUsageDescription
// in the app's Info.plist), not Screen Recording. It never mutes the call (muteBehavior .unmuted)
// and leaves out Build-a-bot's own processes. The Electron app doesn't use `tap` yet; see
// desktop/README.md ("System audio on macOS").
//
// Output of `mic`:
//   {"ok":true,"api":"process-objects","inputInUse":true,
//    "processes":[{"pid":4410,"bundleId":"us.zoom.xos","input":true,"output":true,
//                  "windows":[{"x":0,"y":25,"w":1440,"h":875}]}]}

import AppKit
import CoreAudio
import Darwin
import Foundation

// MARK: - Core Audio property helpers

let systemObject = AudioObjectID(kAudioObjectSystemObject)

func address(_ selector: AudioObjectPropertySelector, _ scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal) -> AudioObjectPropertyAddress {
    AudioObjectPropertyAddress(mSelector: selector, mScope: scope, mElement: kAudioObjectPropertyElementMain)
}

func readValue<T>(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector, _ fallback: T) -> T {
    var addr = address(selector)
    var size = UInt32(MemoryLayout<T>.size)
    var value = fallback
    let status = withUnsafeMutablePointer(to: &value) { AudioObjectGetPropertyData(object, &addr, 0, nil, &size, $0) }
    return status == noErr ? value : fallback
}

func readString(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector) -> String? {
    var addr = address(selector)
    var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
    var value: Unmanaged<CFString>?
    let status = withUnsafeMutablePointer(to: &value) { AudioObjectGetPropertyData(object, &addr, 0, nil, &size, $0) }
    guard status == noErr, let v = value else { return nil }
    return v.takeRetainedValue() as String
}

func readObjectList(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector) -> [AudioObjectID] {
    var addr = address(selector)
    var size: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(object, &addr, 0, nil, &size) == noErr, size > 0 else { return [] }
    var ids = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
    let status = ids.withUnsafeMutableBufferPointer { AudioObjectGetPropertyData(object, &addr, 0, nil, &size, $0.baseAddress!) }
    return status == noErr ? ids : []
}

func defaultInputDevice() -> AudioObjectID {
    readValue(systemObject, kAudioHardwarePropertyDefaultInputDevice, AudioObjectID(kAudioObjectUnknown))
}

/** Some app is using the default microphone (works on every supported macOS). */
func inputInUse() -> Bool {
    let device = defaultInputDevice()
    guard device != kAudioObjectUnknown else { return false }
    return readValue(device, kAudioDevicePropertyDeviceIsRunningSomewhere, UInt32(0)) != 0
}

// MARK: - Processes → apps, and their windows

struct WindowRect: Encodable { let x: Double; let y: Double; let w: Double; let h: Double }
struct MicProcess: Encodable { let pid: Int32; let bundleId: String; let input: Bool; let output: Bool; let windows: [WindowRect] }
struct Report: Encodable { let ok: Bool; let api: String; let inputInUse: Bool; let processes: [MicProcess]; let error: String? }

/** PROC_PIDPATHINFO_MAXSIZE (4 × MAXPATHLEN): the macOS 26 SDK no longer lets Swift import that macro. */
let procPidPathMaxSize = 4 * 1024

func executablePath(_ pid: pid_t) -> String? {
    var buffer = [CChar](repeating: 0, count: procPidPathMaxSize)
    let n = proc_pidpath(pid, &buffer, UInt32(buffer.count))
    return n > 0 ? String(cString: buffer) : nil
}

/** The outermost .app around a process ("…/Google Chrome.app/…/Google Chrome Helper.app/…") and that app's main PID. */
func outermostApp(pid: pid_t, reported: String) -> (bundleId: String, appPid: pid_t) {
    guard let path = executablePath(pid) else { return (reported, pid) }
    let parts = path.split(separator: "/", omittingEmptySubsequences: false)
    if let index = parts.firstIndex(where: { $0.hasSuffix(".app") }) {
        let appPath = parts[...index].joined(separator: "/")
        if let id = Bundle(path: appPath)?.bundleIdentifier {
            let main = NSRunningApplication.runningApplications(withBundleIdentifier: id).first?.processIdentifier ?? pid
            return (id, main)
        }
    }
    // Daemons like avconferenced have no .app; keep what Core Audio said.
    return (reported.isEmpty ? (path as NSString).lastPathComponent : reported, pid)
}

/** On-screen normal windows (layer 0) by owner PID, in the same top-left coordinates Electron uses. */
func windowRects() -> [pid_t: [WindowRect]] {
    guard let info = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else { return [:] }
    var out: [pid_t: [WindowRect]] = [:]
    for window in info {
        guard let pid = window[kCGWindowOwnerPID as String] as? pid_t,
              (window[kCGWindowLayer as String] as? Int) == 0,
              let bounds = window[kCGWindowBounds as String] as? NSDictionary,
              let rect = CGRect(dictionaryRepresentation: bounds as CFDictionary),
              rect.width >= 200, rect.height >= 150 else { continue }
        out[pid, default: []].append(WindowRect(x: rect.origin.x, y: rect.origin.y, w: rect.width, h: rect.height))
    }
    return out
}

func makeReport() -> Report {
    let inUse = inputInUse()
    guard #available(macOS 14.0, *) else {
        return Report(ok: true, api: "device-only", inputInUse: inUse, processes: [], error: nil)
    }
    let windows = windowRects()
    var list: [MicProcess] = []
    for object in readObjectList(systemObject, kAudioHardwarePropertyProcessObjectList) {
        let pid = readValue(object, kAudioProcessPropertyPID, pid_t(-1))
        guard pid > 0 else { continue }
        let input = readValue(object, kAudioProcessPropertyIsRunningInput, UInt32(0)) != 0
        let output = readValue(object, kAudioProcessPropertyIsRunningOutput, UInt32(0)) != 0
        guard input || output else { continue }
        let app = outermostApp(pid: pid, reported: readString(object, kAudioProcessPropertyBundleID) ?? "")
        list.append(MicProcess(pid: pid, bundleId: app.bundleId, input: input, output: output, windows: windows[app.appPid] ?? windows[pid] ?? []))
    }
    return Report(ok: true, api: "process-objects", inputInUse: inUse, processes: list, error: nil)
}

func emit(_ report: Report) -> String {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    let data = (try? encoder.encode(report)) ?? Data("{\"ok\":false,\"error\":\"encode\"}".utf8)
    return String(decoding: data, as: UTF8.self)
}

// MARK: - watch: print on every change

func watch() -> Never {
    var last = ""
    func check() {
        let line = emit(makeReport())
        if line != last {
            last = line
            print(line)
            fflush(stdout)
        }
    }
    let queue = DispatchQueue.main
    var device = defaultInputDevice()
    var runningAddress = address(kAudioDevicePropertyDeviceIsRunningSomewhere)
    let onRunning: AudioObjectPropertyListenerBlock = { _, _ in check() }
    if device != kAudioObjectUnknown { AudioObjectAddPropertyListenerBlock(device, &runningAddress, queue, onRunning) }
    // Re-attach when the default microphone changes.
    var defaultAddress = address(kAudioHardwarePropertyDefaultInputDevice)
    AudioObjectAddPropertyListenerBlock(systemObject, &defaultAddress, queue) { _, _ in
        if device != kAudioObjectUnknown { AudioObjectRemovePropertyListenerBlock(device, &runningAddress, queue, onRunning) }
        device = defaultInputDevice()
        if device != kAudioObjectUnknown { AudioObjectAddPropertyListenerBlock(device, &runningAddress, queue, onRunning) }
        check()
    }
    if #available(macOS 14.0, *) {
        var processesAddress = address(kAudioHardwarePropertyProcessObjectList)
        AudioObjectAddPropertyListenerBlock(systemObject, &processesAddress, queue) { _, _ in check() }
    }
    // Per-process input flags have no list-level notification: also look every 2 s.
    let timer = DispatchSource.makeTimerSource(queue: queue)
    timer.schedule(deadline: .now() + 2, repeating: 2)
    timer.setEventHandler { check() }
    timer.resume()
    check()
    dispatchMain()
}

// MARK: - tap: the call's audio as PCM (macOS 14.2+)

@available(macOS 14.2, *)
final class SystemAudioTap {
    private var tapID = AudioObjectID(kAudioObjectUnknown)
    private var aggregateID = AudioObjectID(kAudioObjectUnknown)
    private var procID: AudioDeviceIOProcID?
    private let outRate: Double
    private let lock = NSLock()
    private var pending = Data()
    private var phase = 0.0

    init(sampleRate: Double) { outRate = sampleRate }

    func processObject(for pid: pid_t) -> AudioObjectID? {
        var addr = address(kAudioHardwarePropertyTranslatePIDToProcessObject)
        var qualifier = pid
        var object = AudioObjectID(kAudioObjectUnknown)
        var size = UInt32(MemoryLayout<AudioObjectID>.size)
        let status = AudioObjectGetPropertyData(systemObject, &addr, UInt32(MemoryLayout<pid_t>.size), &qualifier, &size, &object)
        return status == noErr && object != kAudioObjectUnknown ? object : nil
    }

    func start(excluding pids: [pid_t]) throws {
        let excluded = pids.compactMap { processObject(for: $0) }
        let description = CATapDescription(stereoGlobalTapButExcludeProcesses: excluded)
        description.name = "Build-a-bot meeting notes"
        description.isPrivate = true
        description.muteBehavior = .unmuted // never mute the call for the owner
        var status = AudioHardwareCreateProcessTap(description, &tapID)
        guard status == noErr else { throw HelperError.coreAudio("create tap", status) }

        let aggregate: [String: Any] = [
            kAudioAggregateDeviceNameKey: "Build-a-bot tap",
            kAudioAggregateDeviceUIDKey: UUID().uuidString,
            kAudioAggregateDeviceIsPrivateKey: true,
            kAudioAggregateDeviceIsStackedKey: false,
            kAudioAggregateDeviceTapAutoStartKey: true,
            kAudioAggregateDeviceTapListKey: [[kAudioSubTapUIDKey: description.uuid.uuidString, kAudioSubTapDriftCompensationKey: true]],
        ]
        status = AudioHardwareCreateAggregateDevice(aggregate as CFDictionary, &aggregateID)
        guard status == noErr else { throw HelperError.coreAudio("create aggregate device", status) }

        let format = readValue(tapID, kAudioTapPropertyFormat, AudioStreamBasicDescription())
        guard format.mFormatID == kAudioFormatLinearPCM, format.mFormatFlags & kAudioFormatFlagIsFloat != 0 else {
            throw HelperError.message("unexpected tap format")
        }
        let channels = Int(max(format.mChannelsPerFrame, 1))
        let interleaved = format.mFormatFlags & kAudioFormatFlagIsNonInterleaved == 0
        let step = format.mSampleRate / outRate

        status = AudioDeviceCreateIOProcIDWithBlock(&procID, aggregateID, nil) { [weak self] _, input, _, _, _ in
            guard let self else { return }
            let buffers = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: input))
            guard let first = buffers.first, let base = first.mData else { return }
            let frames = interleaved ? Int(first.mDataByteSize) / (MemoryLayout<Float>.size * channels) : Int(first.mDataByteSize) / MemoryLayout<Float>.size
            // Mono mix, then a simple resample to the output rate, then 16-bit PCM.
            func sample(_ i: Int) -> Float {
                if interleaved {
                    let p = base.assumingMemoryBound(to: Float.self)
                    var sum: Float = 0
                    for c in 0..<channels { sum += p[i * channels + c] }
                    return sum / Float(channels)
                }
                var sum: Float = 0
                for b in buffers { if let d = b.mData { sum += d.assumingMemoryBound(to: Float.self)[i] } }
                return sum / Float(max(buffers.count, 1))
            }
            var out = [Int16]()
            out.reserveCapacity(Int(Double(frames) / step) + 2)
            var t = self.phase
            while t < Double(frames) {
                let v = max(-1, min(1, sample(Int(t))))
                out.append(Int16(v * 32767))
                t += step
            }
            self.phase = t - Double(frames)
            let data = out.withUnsafeBufferPointer { Data(buffer: $0) }
            self.lock.lock()
            self.pending.append(data)
            self.lock.unlock()
        }
        guard status == noErr else { throw HelperError.coreAudio("create IO proc", status) }
        status = AudioDeviceStart(aggregateID, procID)
        guard status == noErr else { throw HelperError.coreAudio("start", status) }

        // Write from a normal queue, not the real-time audio thread.
        let timer = DispatchSource.makeTimerSource(queue: DispatchQueue(label: "bab.tap.writer"))
        timer.schedule(deadline: .now() + 0.05, repeating: 0.05)
        timer.setEventHandler { [weak self] in
            guard let self else { return }
            self.lock.lock()
            let chunk = self.pending
            self.pending.removeAll(keepingCapacity: true)
            self.lock.unlock()
            if !chunk.isEmpty { FileHandle.standardOutput.write(chunk) }
        }
        timer.resume()
        writer = timer
    }

    private var writer: DispatchSourceTimer?

    func stop() {
        if let procID { AudioDeviceStop(aggregateID, procID); AudioDeviceDestroyIOProcID(aggregateID, procID) }
        if aggregateID != kAudioObjectUnknown { AudioHardwareDestroyAggregateDevice(aggregateID) }
        if tapID != kAudioObjectUnknown { AudioHardwareDestroyProcessTap(tapID) }
    }
}

enum HelperError: Error, CustomStringConvertible {
    case coreAudio(String, OSStatus)
    case message(String)
    var description: String {
        switch self {
        case let .coreAudio(what, status): return "\(what) failed (OSStatus \(status))"
        case let .message(m): return m
        }
    }
}

// MARK: - main

let args = Array(CommandLine.arguments.dropFirst())
switch args.first ?? "mic" {
case "mic":
    print(emit(makeReport()))
case "watch":
    watch()
case "tap":
    guard #available(macOS 14.2, *) else {
        FileHandle.standardError.write(Data("tap needs macOS 14.2 or later\n".utf8))
        exit(2)
    }
    var exclude: [pid_t] = [getpid(), getppid()]
    var rate = 16000.0
    var i = 1
    while i < args.count {
        if args[i] == "--exclude-pid", i + 1 < args.count, let p = pid_t(args[i + 1]) { exclude.append(p); i += 2 }
        else if args[i] == "--sample-rate", i + 1 < args.count, let r = Double(args[i + 1]) { rate = r; i += 2 }
        else { i += 1 }
    }
    let tap = SystemAudioTap(sampleRate: rate)
    do { try tap.start(excluding: exclude) } catch {
        FileHandle.standardError.write(Data("\(error)\n".utf8))
        exit(1)
    }
    signal(SIGTERM) { _ in exit(0) }
    signal(SIGINT) { _ in exit(0) }
    dispatchMain()
default:
    FileHandle.standardError.write(Data("usage: bab-audio-helper mic | watch | tap [--exclude-pid PID]... [--sample-rate HZ]\n".utf8))
    exit(64)
}
