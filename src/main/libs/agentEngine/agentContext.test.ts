import { describe, expect, test } from 'vitest';

import type { Agent } from '../../coworkStore';
import { buildManagedToolAlias, mergeAgentInstructionPrompt, mergeAgentSkillIds } from './agentContext';

const makeAgent = (overrides: Partial<Agent> = {}): Agent => ({
  id: 'qingshu-managed:presales',
  name: '售前分析',
  description: '处理售前供需分析任务',
  systemPrompt: '你是聚宝盆售前分析 Agent。',
  identity: '保持专业、结构化、面向业务决策。',
  model: '',
  workingDirectory: '',
  icon: '',
  skillIds: ['supply-demand', 'report'],
  toolBundleIds: [],
  enabled: true,
  isDefault: false,
  source: 'managed',
  managedToolNames: [
    'claw.dictionary.search',
    'lbs.presales.store.supply-demand-balance',
  ],
  presetId: '',
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

describe('agent context', () => {
  test('merges selected agent identity and persona into the system prompt', () => {
    const prompt = mergeAgentInstructionPrompt('global policy', makeAgent());

    expect(prompt).toContain('global policy');
    expect(prompt).toContain('[Current Agent: 售前分析]');
    expect(prompt).toContain('You are this selected agent for the current session.');
    expect(prompt).toContain('你是聚宝盆售前分析 Agent。');
    expect(prompt).toContain('保持专业、结构化、面向业务决策。');
    expect(prompt).toContain('claw.dictionary.search -> qingshu-managed__claw-dictionary-search');
    expect(prompt).toContain('lbs.presales.store.supply-demand-balance -> qingshu-managed__lbs-presales-store-supply-demand-balance');
    expect(prompt).toContain('When a JBP managed tool response includes pagination fields');
  });

  test('uses bound agent skills as defaults and preserves selected turn skills', () => {
    expect(mergeAgentSkillIds(['report', 'xlsx'], makeAgent())).toEqual([
      'supply-demand',
      'report',
      'xlsx',
    ]);
  });

  test('does not duplicate current agent instructions when already merged', () => {
    const once = mergeAgentInstructionPrompt('global policy', makeAgent());
    const twice = mergeAgentInstructionPrompt(once, makeAgent());

    expect(twice?.match(/\[Current Agent: 售前分析\]/g)).toHaveLength(1);
    expect(twice?.match(/\[JBP managed tool aliases\]/g)).toHaveLength(1);
  });

  test('builds the same managed tool alias shape as OpenClaw native MCP', () => {
    expect(buildManagedToolAlias('lbs.presales.brand-city.recruitment-plan')).toBe(
      'qingshu-managed__lbs-presales-brand-city-recruitment-plan',
    );
  });
});
