'use strict';

const assert = require('assert/strict');
const path = require('path');
const test = require('node:test');

const configPath = path.join(__dirname, 'electron-builder-config.cjs');

function loadConfig(env = {}) {
  const previousKeyfrom = process.env.KEYFROM;
  if (Object.prototype.hasOwnProperty.call(env, 'KEYFROM')) {
    process.env.KEYFROM = env.KEYFROM;
  } else {
    delete process.env.KEYFROM;
  }

  try {
    delete require.cache[require.resolve(configPath)];
    return require(configPath);
  } finally {
    if (previousKeyfrom === undefined) {
      delete process.env.KEYFROM;
    } else {
      process.env.KEYFROM = previousKeyfrom;
    }
    delete require.cache[require.resolve(configPath)];
  }
}

function hasResource(resources, from, to) {
  return Array.isArray(resources)
    && resources.some((resource) => resource && resource.from === from && resource.to === to);
}

function findResource(resources, from, to) {
  if (!Array.isArray(resources)) return null;
  return resources.find((resource) => resource && resource.from === from && resource.to === to) || null;
}

test('merges shared keyfrom resources into every platform config', () => {
  const config = loadConfig({ KEYFROM: 'partner_a' });

  for (const platformName of ['mac', 'win', 'linux']) {
    assert.equal(
      hasResource(config[platformName]?.extraResources, '.keyfrom-build', 'keyfrom'),
      true,
      `${platformName} should package .keyfrom-build as keyfrom resource`,
    );
  }
  assert.equal(Object.prototype.hasOwnProperty.call(config, 'extraResources'), false);
});

test('keeps JBPClaw artifact names while appending normalized keyfrom', () => {
  const config = loadConfig({ KEYFROM: 'Partner_A' });

  assert.equal(config.dmg.artifactName, 'JBPClaw-darwin-${arch}-${version}-partner_a.${ext}');
  assert.equal(config.nsis.artifactName, 'JBPClaw-Setup-${arch}-${version}-partner_a.${ext}');
});

test('packages only macOS speech helper binaries without Swift module caches', () => {
  const config = loadConfig();
  const resource = findResource(config.mac?.extraResources, 'build/generated/macos-speech', 'macos-speech');

  assert.ok(resource, 'macOS speech helper resource should be configured');
  assert.deepEqual(resource.filter, [
    'MacSpeechHelper',
    'MacTtsHelper',
    '!module-cache/**',
    '!module-cache-tts/**',
  ]);
});
