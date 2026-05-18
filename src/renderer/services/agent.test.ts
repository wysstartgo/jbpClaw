import { beforeEach, describe, expect, test, vi } from 'vitest';

import { store } from '../store';
import { setAgents, setCurrentAgentId } from '../store/slices/agentSlice';
import { clearActiveSkills, setActiveSkillIds } from '../store/slices/skillSlice';
import type { Agent } from '../types/agent';
import { agentService } from './agent';

const makeAgent = (overrides: Partial<Agent> = {}): Agent => ({
  id: 'agent-1',
  name: 'Agent 1',
  description: '',
  systemPrompt: '',
  identity: '',
  model: '',
  workingDirectory: '',
  icon: '',
  skillIds: [],
  toolBundleIds: [],
  enabled: true,
  isDefault: false,
  source: 'custom',
  presetId: '',
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

beforeEach(() => {
  store.dispatch(setAgents([]));
  store.dispatch(setCurrentAgentId('main'));
  store.dispatch(clearActiveSkills());
  vi.restoreAllMocks();
  delete (globalThis as { window?: unknown }).window;
});

describe('agentService.updateAgent', () => {
  test('refreshes active skills when the current agent is saved', async () => {
    store.dispatch(setAgents([{
      id: 'agent-1',
      name: 'Agent 1',
      description: '',
      systemPrompt: '',
      identity: '',
      icon: '',
      model: '',
      workingDirectory: '',
      enabled: true,
      isDefault: false,
      source: 'custom',
      skillIds: [],
      toolBundleIds: [],
    }]));
    store.dispatch(setCurrentAgentId('agent-1'));

    (globalThis as { window?: unknown }).window = {
      electron: {
        agents: {
          update: vi.fn().mockResolvedValue(makeAgent({ skillIds: ['docx', 'web-search'] })),
        },
      },
    };

    await agentService.updateAgent('agent-1', { skillIds: ['docx', 'web-search'] });

    expect(store.getState().agent.agents[0].skillIds).toEqual(['docx', 'web-search']);
    expect(store.getState().skill.activeSkillIds).toEqual(['docx', 'web-search']);
  });

  test('does not replace active skills when another agent is saved', async () => {
    store.dispatch(setAgents([{
      id: 'agent-1',
      name: 'Agent 1',
      description: '',
      systemPrompt: '',
      identity: '',
      icon: '',
      model: '',
      workingDirectory: '',
      enabled: true,
      isDefault: false,
      source: 'custom',
      skillIds: ['docx'],
      toolBundleIds: [],
    }]));
    store.dispatch(setCurrentAgentId('agent-2'));
    store.dispatch(setActiveSkillIds(['xlsx']));

    (globalThis as { window?: unknown }).window = {
      electron: {
        agents: {
          update: vi.fn().mockResolvedValue(makeAgent({ skillIds: ['docx', 'web-search'] })),
        },
      },
    };

    await agentService.updateAgent('agent-1', { skillIds: ['docx', 'web-search'] });

    expect(store.getState().skill.activeSkillIds).toEqual(['xlsx']);
  });
});
