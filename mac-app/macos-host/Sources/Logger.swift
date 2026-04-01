import Foundation

private let hostLogQueue = DispatchQueue(label: "com.firstloop.nomendex.host-log")
private let hostLogISO8601: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter
}()

private func hostLogFileURL() -> URL {
    FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Application Support/com.firstloop.nomendex/logs.txt")
}

private func appendHostLogToFile(_ message: String) {
    let line = "\(hostLogISO8601.string(from: Date())) [HOST] \(message)\n"
    guard let data = line.data(using: .utf8) else { return }

    hostLogQueue.async {
        let fileURL = hostLogFileURL()
        let directoryURL = fileURL.deletingLastPathComponent()

        do {
            try FileManager.default.createDirectory(at: directoryURL, withIntermediateDirectories: true)
        } catch {
            return
        }

        if FileManager.default.fileExists(atPath: fileURL.path) {
            do {
                let handle = try FileHandle(forWritingTo: fileURL)
                try handle.seekToEnd()
                try handle.write(contentsOf: data)
                try handle.close()
            } catch {
                // Best-effort logging only.
            }
        } else {
            do {
                try data.write(to: fileURL)
            } catch {
                // Best-effort logging only.
            }
        }
    }
}

func log(_ items: Any..., separator: String = " ", terminator: String = "\n") {
    let msg = items.map { "\($0)" }.joined(separator: separator)
    fputs("[host] \(msg)\n", stderr)
    // Sidecar process writes its own logs to logs.txt directly; avoid duplicating them.
    if !msg.hasPrefix("[sidecar]") {
        appendHostLogToFile(msg)
    }
}
