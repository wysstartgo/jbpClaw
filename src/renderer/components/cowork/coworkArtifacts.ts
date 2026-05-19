import {
  normalizeFilePathForDedup,
  parseCodeBlockArtifacts,
  parseFileLinksFromMessage,
  parseFilePathsFromText,
  parseMediaTokensFromText,
  parseToolArtifact,
  stripFileLinksFromText,
} from '../../services/artifactParser';
import type { Artifact } from '../../types/artifact';
import type { CoworkMessage } from '../../types/cowork';
import {
  getToolResultDisplay,
  isLargeToolResultMessage,
  TOOL_RESULT_DISPLAY_MAX_CHARS,
} from './coworkConversationTurns';

const ARTIFACT_SCAN_MAX_MESSAGE_CHARS = 80_000;

export const collectCoworkSessionArtifacts = (
  messages: CoworkMessage[],
  sessionId: string,
): Artifact[] => {
  const artifacts: Artifact[] = [];
  const seenFilePaths = new Set<string>();
  const toolResultsByUseId = new Map<string, CoworkMessage>();

  for (const message of messages) {
    if (message.type !== 'tool_result') continue;
    const toolUseId = message.metadata?.toolUseId;
    if (typeof toolUseId === 'string' && toolUseId.trim()) {
      toolResultsByUseId.set(toolUseId, message);
    }
  }

  const pushArtifact = (artifact: Artifact): void => {
    if (artifact.filePath) {
      const normalized = normalizeFilePathForDedup(artifact.filePath);
      if (seenFilePaths.has(normalized)) return;
      seenFilePaths.add(normalized);
    }
    artifacts.push(artifact);
  };

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];

    if (
      message.type === 'assistant'
      && !message.metadata?.isThinking
      && message.content
      && message.content.length <= ARTIFACT_SCAN_MAX_MESSAGE_CHARS
    ) {
      for (const artifact of parseCodeBlockArtifacts(message.content, message.id, sessionId)) {
        pushArtifact(artifact);
      }

      for (const artifact of parseFileLinksFromMessage(message.content, message.id, sessionId)) {
        pushArtifact(artifact);
      }

      for (const artifact of parseMediaTokensFromText(message.content, message.id, sessionId)) {
        pushArtifact(artifact);
      }

      const contentWithoutFileLinks = stripFileLinksFromText(message.content);
      for (const artifact of parseFilePathsFromText(contentWithoutFileLinks, message.id, sessionId)) {
        pushArtifact(artifact);
      }
    }

    if (message.type === 'tool_result') {
      if (isLargeToolResultMessage(message)) {
        continue;
      }
      const displayText = getToolResultDisplay(message);
      for (const artifact of parseMediaTokensFromText(displayText, message.id, sessionId)) {
        pushArtifact(artifact);
      }
      for (const artifact of parseFilePathsFromText(displayText, message.id, sessionId, 'artifact-toolresult')) {
        pushArtifact(artifact);
      }
    }

    if (message.type === 'tool_use') {
      const toolUseId = message.metadata?.toolUseId;
      const toolResult = typeof toolUseId === 'string' && toolUseId.trim()
        ? toolResultsByUseId.get(toolUseId)
        : messages[index + 1]?.type === 'tool_result'
          ? messages[index + 1]
          : undefined;
      if (toolResult && isLargeToolResultMessage(toolResult)) {
        const safeResult = {
          ...toolResult,
          content: toolResult.content.slice(0, TOOL_RESULT_DISPLAY_MAX_CHARS),
          metadata: {
            ...(toolResult.metadata ?? {}),
            toolResult: typeof toolResult.metadata?.toolResult === 'string'
              ? toolResult.metadata.toolResult.slice(0, TOOL_RESULT_DISPLAY_MAX_CHARS)
              : toolResult.metadata?.toolResult,
          },
        };
        const artifact = parseToolArtifact(message, safeResult, sessionId);
        if (artifact) {
          pushArtifact(artifact);
        }
        continue;
      }
      const artifact = parseToolArtifact(message, toolResult, sessionId);
      if (artifact) {
        pushArtifact(artifact);
      }
    }
  }

  return artifacts;
};
