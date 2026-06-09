import {
  buildQingShuManagedToolAlias,
  getQingShuManagedToolAliasPattern,
} from '../../../shared/qingshuManaged/constants';
import type { Agent } from '../../coworkStore';

const normalizePromptPart = (value?: string | null): string => value?.trim() ?? '';
export const MANAGED_TOOL_ALIAS_HEADER = '[JBP managed tool aliases]';
const MANAGED_TOOL_ALIAS_LIMIT = 20;
const MANAGED_TOOL_PAGINATION_INSTRUCTION = 'When a JBP managed tool response includes pagination fields such as hasMore=true and nextPageNo, and the user asks for all records, a full report, or a complete comparison, keep calling the same tool with unchanged filters and the returned nextPageNo until hasMore=false before summarizing or generating files.';

export function buildManagedToolAlias(toolName: string): string {
  return buildQingShuManagedToolAlias(toolName);
}

export function buildManagedToolAliasPrompt(agent: Agent): string {
  const toolNames = (agent.managedToolNames ?? [])
    .map((toolName) => toolName.trim())
    .filter(Boolean);
  if (toolNames.length === 0) return '';

  const lines = toolNames.slice(0, MANAGED_TOOL_ALIAS_LIMIT).map((toolName) => (
    `- ${toolName} -> ${buildManagedToolAlias(toolName)}`
  ));

  if (toolNames.length > MANAGED_TOOL_ALIAS_LIMIT) {
    lines.push(`- ... ${toolNames.length - MANAGED_TOOL_ALIAS_LIMIT} more managed tool aliases are available with the same ${getQingShuManagedToolAliasPattern()} naming rule.`);
  }

  return [
    MANAGED_TOOL_ALIAS_HEADER,
    'OpenClaw exposes JBP managed tools through native MCP aliases. When a skill or user mentions the business tool name on the left, call the native MCP tool name on the right directly. Do not say these tools are unavailable just because the business name is not listed verbatim.',
    MANAGED_TOOL_PAGINATION_INSTRUCTION,
    ...lines,
  ].join('\n');
}

function removeManagedToolAliasSections(prompt: string): string {
  return prompt
    .split(/\n{2,}/)
    .filter((section) => !section.trimStart().startsWith(MANAGED_TOOL_ALIAS_HEADER))
    .join('\n\n')
    .trim();
}

export function mergeAgentInstructionPrompt(
  baseSystemPrompt: string | undefined,
  agent: Agent | null | undefined,
): string | undefined {
  const sections: string[] = [];
  const agentHeader = agent ? `[Current Agent: ${agent.name || agent.id}]` : '';
  const managedToolAliasPrompt = agent ? buildManagedToolAliasPrompt(agent) : '';
  const normalizedBasePrompt = agent && managedToolAliasPrompt
    ? removeManagedToolAliasSections(normalizePromptPart(baseSystemPrompt))
    : normalizePromptPart(baseSystemPrompt);
  if (normalizedBasePrompt) {
    sections.push(normalizedBasePrompt);
  }

  if (agent && normalizedBasePrompt.includes(agentHeader)) {
    // 旧会话可能已经带有过期 alias 块；重新附加当前 alias，避免工具名漂移。
    if (managedToolAliasPrompt) {
      sections.push(managedToolAliasPrompt);
    }
  } else if (agent) {
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
