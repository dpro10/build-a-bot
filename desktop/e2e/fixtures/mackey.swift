// Press keys like a real keyboard on macOS (Quartz events), for the desktop e2e tests on a Mac
// (the counterpart of winkey.py). Needs Accessibility for the process running it, as any app that
// types for you does.
//
// Usage: mackey type "Prozzi" tap left cmd tap right - tap right shift sleep 0.5
//
//   type <text>         type text, a character at a time
//   tap <key> <mods>    press and let go a key (left, right, up, down, return, delete, escape, tab,
//                       space, a, n, v), with modifiers: a comma list of cmd, shift, alt, ctrl, or -
//   sleep <s>           wait <s> seconds
//   trusted             print whether this process may press keys (true/false)
//
// Build: xcrun swiftc -O -o mackey mackey.swift
import ApplicationServices
import Foundation

let codes: [String: CGKeyCode] = [
    "left": 123, "right": 124, "down": 125, "up": 126, "return": 36, "delete": 51, "escape": 53,
    "tab": 48, "space": 49, "a": 0, "n": 45, "v": 9,
]
let modifiers: [String: CGEventFlags] = ["cmd": .maskCommand, "shift": .maskShift, "alt": .maskAlternate, "ctrl": .maskControl]

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data("mackey: \(message)\n".utf8))
    exit(1)
}

let source = CGEventSource(stateID: .hidSystemState)

func press(_ code: CGKeyCode, flags: CGEventFlags = [], text: [UniChar]? = nil) {
    for down in [true, false] {
        guard let event = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: down) else { fail("couldn't make a key event") }
        event.flags = flags
        if let text = text {
            text.withUnsafeBufferPointer { event.keyboardSetUnicodeString(stringLength: $0.count, unicodeString: $0.baseAddress) }
        }
        event.post(tap: .cghidEventTap)
        usleep(15_000)
    }
}

var args = Array(CommandLine.arguments.dropFirst())
while !args.isEmpty {
    let command = args.removeFirst()
    switch command {
    case "trusted":
        print(AXIsProcessTrusted())
    case "type":
        guard !args.isEmpty else { fail("type what?") }
        for character in args.removeFirst() {
            press(0, text: Array(String(character).utf16))
            // About a fast typist's pace.
            usleep(40_000)
        }
    case "tap":
        guard args.count >= 2 else { fail("tap <key> <mods>") }
        let name = args.removeFirst()
        let mods = args.removeFirst()
        guard let code = codes[name] else { fail("unknown key \(name)") }
        var flags: CGEventFlags = []
        if mods != "-" {
            for m in mods.split(separator: ",") {
                guard let f = modifiers[String(m)] else { fail("unknown modifier \(m)") }
                flags.insert(f)
            }
        }
        press(code, flags: flags)
    case "sleep":
        guard !args.isEmpty, let seconds = Double(args.removeFirst()) else { fail("sleep <seconds>") }
        usleep(useconds_t(seconds * 1_000_000))
    default:
        fail("unknown command \(command)")
    }
}
