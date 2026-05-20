import { describe, expect, test } from 'vitest';

import { OpenClawProviderId, ProviderName } from '../../shared/providers/constants';
import type { Model } from '../store/slices/modelSlice';
import { resolveOpenClawModelRef, toOpenClawModelRef } from './openclawModelRef';

const models: Model[] = [
  {
    id: 'gpt-5.3-codex',
    name: 'GPT-5.3 Codex',
    providerKey: ProviderName.OpenAI,
    openClawProviderId: OpenClawProviderId.OpenAICodex,
  },
  {
    id: 'claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6',
    providerKey: ProviderName.Anthropic,
  },
  {
    id: 'deepseek-reasoner',
    name: 'DeepSeek Reasoner',
    providerKey: ProviderName.DeepSeek,
  },
];

describe('openclawModelRef', () => {
  test('uses explicit OpenClaw provider id when available', () => {
    expect(toOpenClawModelRef(models[0])).toBe('openai-codex/gpt-5.3-codex');
  });

  test('keeps server package models under qingshu-server', () => {
    expect(toOpenClawModelRef({
      id: 'qwen3.5-plus',
      providerKey: ProviderName.Qwen,
      isServerModel: true,
    })).toBe('qingshu-server/qwen3.5-plus');
  });

  test('resolves legacy lobsterai-server refs to server package models', () => {
    const serverModel: Model = {
      id: 'qwen3.5-plus',
      name: 'Qwen 3.5 Plus',
      providerKey: ProviderName.QingShuServer,
      isServerModel: true,
    };

    expect(resolveOpenClawModelRef('lobsterai-server/qwen3.5-plus', [serverModel])).toBe(serverModel);
  });

  test('uses lobster fallback when provider key is missing', () => {
    expect(toOpenClawModelRef({
      id: 'unknown-model',
      providerKey: '',
    })).toBe('lobster/unknown-model');
  });

  test('resolves exact provider/model refs', () => {
    expect(resolveOpenClawModelRef('anthropic/claude-sonnet-4-6', models)).toBe(models[1]);
  });

  test('resolves old openai refs to openai-codex models for migration compatibility', () => {
    expect(resolveOpenClawModelRef('openai/gpt-5.3-codex', models)).toBe(models[0]);
  });

  test('falls back by unique model id when provider id changed', () => {
    expect(resolveOpenClawModelRef('legacy-provider/deepseek-reasoner', models)).toBe(models[2]);
  });

  test('does not fall back by model id when it is ambiguous', () => {
    const ambiguousModels: Model[] = [
      { id: 'same-id', name: 'A', providerKey: ProviderName.OpenAI },
      { id: 'same-id', name: 'B', providerKey: ProviderName.Anthropic },
    ];

    expect(resolveOpenClawModelRef('legacy-provider/same-id', ambiguousModels)).toBeNull();
  });
});
