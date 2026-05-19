import { describe, expect, test } from 'vitest';

import type { Artifact } from '../../types/artifact';
import reducer, {
  addArtifact,
  closeArtifactPreviewTab,
  clearSessionArtifacts,
  openArtifactPreviewTab,
  selectActivePreviewTab,
  selectArtifact,
  selectPreviewTabs,
  setActiveTab,
  setPanelWidth,
} from './artifactSlice';

const makeArtifact = (overrides: Partial<Artifact> = {}): Artifact => ({
  id: 'artifact-1',
  messageId: 'msg-1',
  sessionId: 'session-1',
  type: 'document',
  title: 'Report',
  content: '',
  fileName: 'report.pdf',
  filePath: 'D:\\workspace\\report.pdf',
  source: 'tool',
  createdAt: 1,
  ...overrides,
});

describe('artifactSlice', () => {
  test('deduplicates artifacts by normalized file path', () => {
    const first = reducer(undefined, addArtifact({
      sessionId: 'session-1',
      artifact: makeArtifact({
        id: 'tool-artifact',
        filePath: 'D:\\workspace\\report.pdf',
      }),
    }));

    const next = reducer(first, addArtifact({
      sessionId: 'session-1',
      artifact: makeArtifact({
        id: 'link-artifact',
        title: 'Report Link',
        filePath: '/D:/workspace/report.pdf',
      }),
    }));

    expect(next.artifactsBySession['session-1']).toHaveLength(1);
    expect(next.artifactsBySession['session-1'][0].filePath).toBe('/D:/workspace/report.pdf');
  });

  test('replaces duplicate file artifact when newer artifact has content', () => {
    const first = reducer(undefined, addArtifact({
      sessionId: 'session-1',
      artifact: makeArtifact({
        id: 'link-artifact',
        content: '',
        filePath: '/D:/workspace/report.md',
      }),
    }));

    const next = reducer(first, addArtifact({
      sessionId: 'session-1',
      artifact: makeArtifact({
        id: 'tool-artifact',
        content: '# Report',
        filePath: 'D:\\workspace\\report.md',
      }),
    }));

    expect(next.artifactsBySession['session-1']).toHaveLength(1);
    expect(next.artifactsBySession['session-1'][0]).toMatchObject({
      id: 'tool-artifact',
      content: '# Report',
    });
  });

  test('keeps existing duplicate file artifact when incoming artifact has no content', () => {
    const first = reducer(undefined, addArtifact({
      sessionId: 'session-1',
      artifact: makeArtifact({
        id: 'tool-artifact',
        content: '<html>preview</html>',
        filePath: 'D:\\workspace\\preview.html',
      }),
    }));

    const next = reducer(first, addArtifact({
      sessionId: 'session-1',
      artifact: makeArtifact({
        id: 'link-artifact',
        content: '',
        filePath: '/D:/workspace/preview.html',
      }),
    }));

    expect(next.artifactsBySession['session-1']).toHaveLength(1);
    expect(next.artifactsBySession['session-1'][0]).toMatchObject({
      id: 'tool-artifact',
      content: '<html>preview</html>',
      filePath: 'D:\\workspace\\preview.html',
    });
  });

  test('selecting an artifact opens preview panel state', () => {
    const withArtifact = reducer(undefined, addArtifact({
      sessionId: 'session-1',
      artifact: makeArtifact(),
    }));
    const next = reducer(withArtifact, selectArtifact('artifact-1'));

    expect(next.selectedArtifactId).toBe('artifact-1');
    expect(next.isPanelOpen).toBe(true);
    expect(next.panelView).toBe('preview');
    expect(next.activeTab).toBe('preview');
  });

  test('opens preview tabs per session and keeps active content view in sync', () => {
    const withFirst = reducer(undefined, addArtifact({
      sessionId: 'session-1',
      artifact: makeArtifact({ id: 'artifact-1', filePath: 'D:\\workspace\\one.pdf' }),
    }));
    const withSecond = reducer(withFirst, addArtifact({
      sessionId: 'session-1',
      artifact: makeArtifact({ id: 'artifact-2', filePath: 'D:\\workspace\\two.md', type: 'markdown' }),
    }));

    const openedFirst = reducer(withSecond, openArtifactPreviewTab({
      sessionId: 'session-1',
      artifactId: 'artifact-1',
    }));
    const openedSecond = reducer(openedFirst, openArtifactPreviewTab({
      sessionId: 'session-1',
      artifactId: 'artifact-2',
    }));
    const codeView = reducer(openedSecond, setActiveTab('code'));

    const rootState = { artifact: codeView } as any;
    expect(selectPreviewTabs(rootState, 'session-1').map((tab) => tab.artifactId)).toEqual([
      'artifact-1',
      'artifact-2',
    ]);
    expect(selectActivePreviewTab(rootState, 'session-1')).toMatchObject({
      artifactId: 'artifact-2',
      contentView: 'code',
    });
    expect(codeView.selectedArtifactId).toBe('artifact-2');
  });

  test('closing the active preview tab activates the nearest remaining tab', () => {
    const withFirst = reducer(undefined, addArtifact({
      sessionId: 'session-1',
      artifact: makeArtifact({ id: 'artifact-1', filePath: 'D:\\workspace\\one.pdf' }),
    }));
    const withSecond = reducer(withFirst, addArtifact({
      sessionId: 'session-1',
      artifact: makeArtifact({ id: 'artifact-2', filePath: 'D:\\workspace\\two.pdf' }),
    }));
    const openedFirst = reducer(withSecond, openArtifactPreviewTab({
      sessionId: 'session-1',
      artifactId: 'artifact-1',
    }));
    const openedSecond = reducer(openedFirst, openArtifactPreviewTab({
      sessionId: 'session-1',
      artifactId: 'artifact-2',
    }));
    const closedSecond = reducer(openedSecond, closeArtifactPreviewTab({
      sessionId: 'session-1',
      tabId: 'artifact:artifact-2',
    }));

    const rootState = { artifact: closedSecond } as any;
    expect(selectPreviewTabs(rootState, 'session-1')).toHaveLength(1);
    expect(selectActivePreviewTab(rootState, 'session-1')).toMatchObject({
      artifactId: 'artifact-1',
    });
    expect(closedSecond.selectedArtifactId).toBe('artifact-1');
  });

  test('updates preview tab artifact id when duplicate file artifact is replaced', () => {
    const first = reducer(undefined, addArtifact({
      sessionId: 'session-1',
      artifact: makeArtifact({
        id: 'link-artifact',
        content: '',
        filePath: '/D:/workspace/report.md',
      }),
    }));
    const opened = reducer(first, openArtifactPreviewTab({
      sessionId: 'session-1',
      artifactId: 'link-artifact',
    }));
    const replaced = reducer(opened, addArtifact({
      sessionId: 'session-1',
      artifact: makeArtifact({
        id: 'tool-artifact',
        content: '# Report',
        filePath: 'D:\\workspace\\report.md',
      }),
    }));

    const rootState = { artifact: replaced } as any;
    expect(selectPreviewTabs(rootState, 'session-1')).toEqual([
      expect.objectContaining({
        id: 'artifact:tool-artifact',
        artifactId: 'tool-artifact',
      }),
    ]);
    expect(replaced.selectedArtifactId).toBe('tool-artifact');
  });

  test('panel width is clamped', () => {
    const small = reducer(undefined, setPanelWidth(1));
    const large = reducer(small, setPanelWidth(9999));

    expect(small.panelWidth).toBe(180);
    expect(large.panelWidth).toBe(1000);
  });

  test('clearing a session removes its artifacts and selection', () => {
    const first = reducer(undefined, addArtifact({
      sessionId: 'session-1',
      artifact: makeArtifact(),
    }));
    const selected = reducer(first, selectArtifact('artifact-1'));
    const next = reducer(selected, clearSessionArtifacts('session-1'));

    expect(next.artifactsBySession['session-1']).toBeUndefined();
    expect(next.selectedArtifactId).toBeNull();
  });
});
