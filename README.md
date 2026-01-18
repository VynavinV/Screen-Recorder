# Screen Recorder

A lightweight macOS screen recording application with a built-in editor for assembling screen and webcam recordings, visualizing clicks, and exporting finished videos.

## Main features

- Capture screen (native display resolution) and optional webcam and microphone.
- Simple floating recording island with start/stop/pause controls.
- Built-in web-based editor (served from a small local HTTP server) to preview, compose, and export videos.
- WebM export from the editor with audio mixing and configurable quality settings.
- Editor UI improvements: resizable sidebar (persisted) and accessible keyboard controls.

## Requirements

- macOS (supported versions depend on ScreenCaptureKit availability)
- Swift toolchain (used by `build.sh`) and standard macOS developer tools
- (Optional) `ffmpeg` for advanced audio/video fixes

## Quick start

1. Build and bundle the app:

```bash
./build.sh
```

2. Run the app:

```bash
open ../ScreenRecorder.app
```

3. Grant permissions when prompted:

- Screen Recording (System Settings > Privacy & Security > Screen Recording)
- Microphone (if you enable mic capture)

## Editor (Editor/index.html)

- Import session files or use the Auto-Discover button to load a session folder containing `screen.mp4`, `webcam.mp4`, and `clicks.json`.
- Use the controls to toggle webcam, captions, and background.
- Export via the **Export Video** button. The editor uses a playback-based WebM export (MediaRecorder) and attempts to mix audio from the video elements so export includes sound.

Important implementation details:
- The export canvas uses the original recording's dimensions (so exported video matches source resolution).
- Export quality defaults can be adjusted in `Editor/index.html`:
  - `videoBitsPerSecond` (MediaRecorder option) controls bitrate.
  - `fps` controls exported frame rate.
- If audio capture via the editor is not available (browser limitations), the fallback is to extract audio with `ffmpeg` and reattach it (see Troubleshooting).

## Troubleshooting

### App remains running ("ghost" instance)

If the app refuses to reopen after finishing a recording:

```bash
ps aux | grep ScreenRecorder
# note the PID for the running ScreenRecorder process
kill -9 <PID>
```

The app also schedules an automatic termination 5 minutes after opening the editor to avoid lingering server processes. You can adjust or remove that timer in `ScreenRecorder/Sources/main.swift` (search for `Auto-terminating app after 5 minutes`).

### No audio on exported video

1. Verify microphone permission (System Settings > Privacy & Security > Microphone).
2. Confirm the source `screen.mp4` actually contains audio (play it in QuickTime).
3. The editor mixes audio using Web Audio APIs; some WebView configurations may not expose these APIs. If audio is missing, use the fallback method below.

Fallback: extract audio from the screen recording and reattach to an export using `ffmpeg` (example commands):

```bash
# Extract audio (AAC) from screen.mp4
ffmpeg -i screen.mp4 -vn -acodec copy audio.aac

# Reattach audio to exported video (re-mux if codecs compatible)
ffmpeg -i exported_video.webm -i audio.aac -c copy -map 0:v:0 -map 1:a:0 final_with_audio.webm

# If re-muxing fails, re-encode audio to a compatible format and re-encode container
ffmpeg -i screen.mp4 -vn -acodec aac -b:a 128k audio.m4a
ffmpeg -i exported_video.webm -i audio.m4a -c:v copy -c:a aac final_with_audio.mp4
```

### Low export resolution or poor quality

- The editor now exports at the recording's source resolution by default. If you still see reduced quality, check the following:
  - In `Editor/index.html` adjust `videoBitsPerSecond` (higher value = better quality, larger file size).
  - Increase `fps` used during export if you need smoother motion.
  - Ensure the original `screen.mp4` resolution is high (the app captures the display's native resolution).

## Development notes

- Project structure (key files/folders):
  - `ScreenRecorder/` – Swift app sources and resources
  - `Editor/` – web-based editor shipped in app resources
  - `build.sh` – build and bundling script
  - `ScreenRecorder.app/` – generated app bundle (after build)

- To quickly test editor changes during development, copy the editor into the app bundle and reopen the app:

```bash
cp Editor/index.html "ScreenRecorder.app/Contents/Resources/Editor/index.html"
open ScreenRecorder.app
```

- To change the local HTTP server port or behavior, edit `LocalHTTPServer` in `ScreenRecorder/Sources/main.swift` (defaults to port `8765`).

- The app uses `AVAssetWriter` and `ScreenCaptureKit` for capture. Video settings like width/height and bitrate are configured in `ScreenRecorder/Sources/main.swift`.

## Contributing

- Fork the repo, create a topic branch, make changes, and open a pull request with a concise description and rationale.
- Add unit or manual test steps for behavior changes where applicable.

## License

Add a license file (for example, `LICENSE` with an MIT or other license) to clarify project terms.

## Contact / Support

If you encounter issues not covered here, open an issue with logs and steps to reproduce. Include macOS version, how the app was run (built vs. app bundle), and any relevant console output.
