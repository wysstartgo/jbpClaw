import React, { useMemo } from 'react';

import type { CoworkMessage } from '../../types/cowork';
import type { Skill } from '../../types/skill';
import {
  AssistantTurnBlock,
  UserMessageItem,
} from './CoworkSessionDetail';
import {
  buildConversationTurns,
  buildDisplayItems,
  hasRenderableAssistantContent,
} from './coworkConversationTurns';

interface ConversationTurnsViewProps {
  messages: CoworkMessage[];
  isStreaming?: boolean;
  skills?: Skill[];
  readOnly?: boolean;
}

const EMPTY_SKILLS: Skill[] = [];

const ConversationTurnsView: React.FC<ConversationTurnsViewProps> = ({
  messages,
  isStreaming = false,
  skills = EMPTY_SKILLS,
}) => {
  const turns = useMemo(
    () => buildConversationTurns(buildDisplayItems(messages)),
    [messages],
  );

  if (turns.length === 0) {
    if (!isStreaming) return null;
    return (
      <div data-export-role="assistant-block">
        <AssistantTurnBlock
          turn={{
            id: 'streaming-only',
            userMessage: null,
            assistantItems: [],
          }}
          showTypingIndicator
          showCopyButtons={false}
        />
      </div>
    );
  }

  return (
    <>
      {turns.map((turn, index) => {
        const isLastTurn = index === turns.length - 1;
        const showTypingIndicator = isStreaming && isLastTurn && !hasRenderableAssistantContent(turn);
        const showAssistantBlock = turn.assistantItems.length > 0 || showTypingIndicator;
        return (
          <div key={turn.id} data-turn-index={index}>
            {turn.userMessage && (
              <div data-export-role="user-message">
                <UserMessageItem
                  message={turn.userMessage}
                  skills={skills}
                />
              </div>
            )}
            {showAssistantBlock && (
              <div data-export-role="assistant-block">
                <AssistantTurnBlock
                  turn={turn}
                  showTypingIndicator={showTypingIndicator}
                  showCopyButtons={!isStreaming || !isLastTurn}
                />
              </div>
            )}
          </div>
        );
      })}
    </>
  );
};

export default ConversationTurnsView;
