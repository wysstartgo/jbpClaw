'use strict';

const path = require('path');
const { existsSync, readFileSync, writeFileSync } = require('fs');

const MICROPHONE_USAGE_DESCRIPTION = 'JBPClaw needs microphone access for voice input in the chat box.';
const SPEECH_RECOGNITION_USAGE_DESCRIPTION = 'JBPClaw needs speech recognition access to convert your voice into chat input text.';

function upsertPlistString(xml, key, value) {
  const keyPattern = new RegExp(`<key>${key}</key>\\s*<string>[\\s\\S]*?<\\/string>`);
  const replacement = `<key>${key}</key>\n\t<string>${value}</string>`;

  if (keyPattern.test(xml)) {
    return xml.replace(keyPattern, replacement);
  }

  return xml.replace('</dict>\n</plist>', `\t<key>${key}</key>\n\t<string>${value}</string>\n</dict>\n</plist>`);
}

function resolveElectronInfoPlistPath() {
  return path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'Info.plist');
}

function main() {
  if (process.platform !== 'darwin') {
    console.log('[prepare-dev-electron-speech-host] Skipped because the current platform is not macOS.');
    return;
  }

  const plistPath = resolveElectronInfoPlistPath();
  if (!existsSync(plistPath)) {
    throw new Error(`Electron dev host Info.plist not found: ${plistPath}`);
  }

  const original = readFileSync(plistPath, 'utf8');
  const withMicrophone = upsertPlistString(original, 'NSMicrophoneUsageDescription', MICROPHONE_USAGE_DESCRIPTION);
  const withSpeech = upsertPlistString(withMicrophone, 'NSSpeechRecognitionUsageDescription', SPEECH_RECOGNITION_USAGE_DESCRIPTION);
  writeFileSync(plistPath, withSpeech, 'utf8');

  console.log(`[prepare-dev-electron-speech-host] Updated Electron dev host permissions in ${plistPath}`);
}

try {
  main();
} catch (error) {
  console.error('[prepare-dev-electron-speech-host] Failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
}
