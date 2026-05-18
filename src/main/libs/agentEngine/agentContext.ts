import type { Agent } from '../../coworkStore';

const normalizePromptPart = (value?: string | null): string => value?.trim() ?? '';
const MANAGED_TOOL_ALIAS_HEADER = '[QingShu managed tool aliases]';
const MANAGED_TOOL_ALIAS_LIMIT = 20;

export function buildManagedToolAlias(toolName: string): string {
  const normalizedToolName = toolName.trim();
  if (!normalizedToolName) return '';
  return `mcp_qingshu_managed_${normalizedToolName.replace(/[^a-z0-9]+/gi, '_')}`.toLowerCase();
}

function buildManagedToolAliasPrompt(agent: Agent): string {
  const toolNames = (agent.managedToolNames ?? [])
    .map((toolName) => toolName.trim())
    .filter(Boolean);
  if (toolNames.length === 0) return '';

  const lines = toolNames.slice(0, MANAGED_TOOL_ALIAS_LIMIT).map((toolName) => (
    `- ${toolName} -> ${buildManagedToolAlias(toolName)}`
  ));

  if (toolNames.length > MANAGED_TOOL_ALIAS_LIMIT) {
    lines.push(`- ... ${toolNames.length - MANAGED_TOOL_ALIAS_LIMIT} more managed tool aliases are available with the same mcp_qingshu_managed_* naming rule.`);
  }

  return [
    MANAGED_TOOL_ALIAS_HEADER,
    'OpenClaw exposes QingShu managed tools through native MCP aliases. When a skill or user mentions the business tool name on the left, call the native MCP tool name on the right directly. Do not say these tools are unavailable just because the business name is not listed verbatim.',
    ...lines,
  ].join('\n');
}

export function mergeAgentInstructionPrompt(
  baseSystemPrompt: string | undefined,
  agent: Agent | null | undefined,
): string | undefined {
  const sections: string[] = [];
  const normalizedBasePrompt = normalizePromptPart(baseSystemPrompt);
  const agentHeader = agent ? `[Current Agent: ${agent.name || agent.id}]` : '';
  if (normalizedBasePrompt) {
    sections.push(normalizedBasePrompt);
  }

  if (agent && !normalizedBasePrompt.includes(agentHeader)) {
    const agentSections: string[] = [];
    const identity = normalizePromptPart(agent.identity);
    if (identity) {
      agentSections.push(`Identity:\n${identity}`);
    }

    const persona = normalizePromptPart(agent.systemPrompt);
    if (persona) {
      agentSections.push(`Persona and operating instructions:\n${persona}`);
    }

    const description = normalizePromptPart(agent.description);
    if (description) {
      agentSections.push(`Agent description:\n${description}`);
    }

    if (agentSections.length > 0) {
      const managedToolAliasPrompt = buildManagedToolAliasPrompt(agent);
      if (managedToolAliasPrompt && !normalizedBasePrompt.includes(MANAGED_TOOL_ALIAS_HEADER)) {
        agentSections.push(managedToolAliasPrompt);
      }

      sections.push([
        agentHeader,
        'You are this selected agent for the current session. Do not delegate by first looking for another agent unless the user explicitly asks you to.',
        ...agentSections,
      ].join('\n\n'));
    }
  }

  return sections.length > 0 ? sections.join('\n\n') : undefined;
}

export function mergeAgentSkillIds(
  selectedSkillIds: string[] | undefined,
  agent: Agent | null | undefined,
): string[] {
  const merged = new Set<string>();
  for (const skillId of agent?.skillIds ?? []) {
    const normalized = skillId.trim();
    if (normalized) {
      merged.add(normalized);
    }
  }
  for (const skillId of selectedSkillIds ?? []) {
    const normalized = skillId.trim();
    if (normalized) {
      merged.add(normalized);
    }
  }
  return [...merged];
}
