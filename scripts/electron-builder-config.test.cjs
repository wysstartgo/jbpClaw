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

test('keeps QingShuClaw artifact names while appending normalized keyfrom', () => {
  const config = loadConfig({ KEYFROM: 'Partner_A' });

  assert.equal(config.dmg.artifactName, 'QingShuClaw-darwin-${arch}-${version}-partner_a.${ext}');
  assert.equal(config.nsis.artifactName, 'QingShuClaw-Setup-${arch}-${version}-partner_a.${ext}');
});
