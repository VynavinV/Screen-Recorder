#!/bin/bash
set -e

SCRIPT_DIR="$(dirname "$0")"
cd "$SCRIPT_DIR/ScreenRecorder"

echo "🔨 Building Swift app..."
swift build -c release

echo "📦 Creating app bundle..."
mkdir -p ../ScreenRecorder.app/Contents/MacOS
mkdir -p ../ScreenRecorder.app/Contents/Resources

cp .build/release/ScreenRecorder ../ScreenRecorder.app/Contents/MacOS/
cp Info.plist ../ScreenRecorder.app/Contents/

echo "📂 Bundling Editor..."
rm -rf ../ScreenRecorder.app/Contents/Resources/Editor
cp -r ../Editor ../ScreenRecorder.app/Contents/Resources/

echo "🔏 Code signing..."
codesign --force --deep --sign - ../ScreenRecorder.app

echo "✅ Build complete! Run: open ../ScreenRecorder.app"
