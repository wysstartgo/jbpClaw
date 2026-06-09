import { describe, expect, test } from 'vitest';

import {
  normalizeFilePathForDedup,
  parseFileLinksFromMessage,
  parseFilePathsFromText,
  parseLocalServiceUrlsFromText,
  parseMediaTokensFromText,
  parseToolArtifact,
  stripFileLinksFromText,
  stripLocalServiceUrlsFromText,
} from './artifactParser';

describe('normalizeFilePathForDedup', () => {
  test('strips leading / before Windows drive letter', () => {
    expect(normalizeFilePathForDedup('/D:/path/file.html')).toBe('d:/path/file.html');
  });

  test('normalizes backslashes to forward slashes', () => {
    expect(normalizeFilePathForDedup('D:\\path\\file.html')).toBe('d:/path/file.html');
  });

  test('lowercases for case-insensitive comparison', () => {
    expect(normalizeFilePathForDedup('D:/Path/File.HTML')).toBe('d:/path/file.html');
  });

  test('handles Unix absolute paths unchanged except lowercase', () => {
    expect(normalizeFilePathForDedup('/home/user/file.html')).toBe('/home/user/file.html');
  });

  test('dedup matches file URL derived path and tool path', () => {
    const fromFileUrl = '/D:/new_ws_test_2/hello-slide.html';
    const fromTool = 'D:\\new_ws_test_2\\hello-slide.html';
    expect(normalizeFilePathForDedup(fromFileUrl)).toBe(normalizeFilePathForDedup(fromTool));
  });
});

describe('parseFileLinksFromMessage', () => {
  test('strips leading / from Windows file link path', () => {
    const content = '文件：[hello.pptx](file:///D:/workspace/hello.pptx)';
    const artifacts = parseFileLinksFromMessage(content, 'msg1', 'sess1');
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].filePath).toBe('D:/workspace/hello.pptx');
  });

  test('preserves Unix file link path', () => {
    const content = '[report.pdf](file:///home/user/report.pdf)';
    const artifacts = parseFileLinksFromMessage(content, 'msg1', 'sess1');
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].filePath).toBe('/home/user/report.pdf');
  });

  test('handles URI-encoded paths', () => {
    const content = '[文件.pptx](file:///D:/my%20folder/%E6%96%87%E4%BB%B6.pptx)';
    const artifacts = parseFileLinksFromMessage(content, 'msg1', 'sess1');
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].filePath).toBe('D:/my folder/文件.pptx');
  });
});

describe('parseLocalServiceUrlsFromText', () => {
  test('parses localhost service URLs', () => {
    const content = '服务已启动：http://localhost:4173/login-react.html';
    const artifacts = parseLocalServiceUrlsFromText(content, 'msg1', 'sess1');

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({
      type: 'local-service',
      url: 'http://localhost:4173/login-react.html',
      title: 'login-react.html',
    });
  });

  test('uses markdown link text as title', () => {
    const content = '[登录页面](http://localhost:4173/login-react.html)';
    const artifacts = parseLocalServiceUrlsFromText(content, 'msg1', 'sess1');

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].title).toBe('登录页面');
  });

  test('deduplicates repeated markdown and bare URLs', () => {
    const content = '[http://localhost:4173/](http://localhost:4173/)\nhttp://localhost:4173/';
    const artifacts = parseLocalServiceUrlsFromText(content, 'msg1', 'sess1');

    expect(artifacts).toHaveLength(1);
  });

  test('ignores remote URLs', () => {
    const artifacts = parseLocalServiceUrlsFromText('https://example.com/app', 'msg1', 'sess1');

    expect(artifacts).toHaveLength(0);
  });

  test('strips local service URLs before file path scanning', () => {
    const content = '服务已启动：[预览页面](http://localhost:4173/login-react.html)，另见 /tmp/report.pdf';
    const stripped = stripLocalServiceUrlsFromText(content);
    const artifacts = parseFilePathsFromText(stripped, 'msg1', 'sess1');

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].filePath).toBe('/tmp/report.pdf');
  });
});

describe('parseMediaTokensFromText', () => {
  test('parses media token with macOS path containing spaces', () => {
    const content = 'MEDIA: /Users/test/Library/Application Support/JBPClaw/output.png';
    const artifacts = parseMediaTokensFromText(content, 'msg1', 'sess1');

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({
      type: 'image',
      fileName: 'output.png',
      filePath: '/Users/test/Library/Application Support/JBPClaw/output.png',
    });
  });

  test('parses backtick-wrapped and file-url media tokens', () => {
    const content = [
      'MEDIA: `/Users/test/Library/Application Support/output.png`',
      'MEDIA: file:///D:/workspace/image.jpg',
    ].join('\n');
    const artifacts = parseMediaTokensFromText(content, 'msg1', 'sess1');

    expect(artifacts.map((artifact) => artifact.filePath)).toEqual([
      '/Users/test/Library/Application Support/output.png',
      'D:/workspace/image.jpg',
    ]);
  });

  test('ignores media tokens with unsupported extensions', () => {
    const artifacts = parseMediaTokensFromText('MEDIA: /tmp/data.xyz', 'msg1', 'sess1');

    expect(artifacts).toHaveLength(0);
  });
});

describe('parseFilePathsFromText', () => {
  test('does not re-detect paths from markdown file links after stripping links', () => {
    const content = '文件：[hello.html](file:///D:/workspace/hello.html)，另见 /tmp/chart.svg。';
    const artifacts = parseFilePathsFromText(stripFileLinksFromText(content), 'msg1', 'sess1');

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].filePath).toBe('/tmp/chart.svg');
  });

  test('strips leading / after file protocol removal on Windows', () => {
    const content = 'output at file:///D:/project/output.pdf done';
    const artifacts = parseFilePathsFromText(content, 'msg1', 'sess1');
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].filePath).toBe('D:/project/output.pdf');
  });

  test('extracts previewable file paths from plain assistant text', () => {
    const content = '已生成 /tmp/demo.html 和 /tmp/chart.svg，以及 /tmp/screenshot.png';
    const artifacts = parseFilePathsFromText(content, 'msg1', 'sess1');

    expect(artifacts).toHaveLength(3);
    expect(artifacts.map((artifact) => artifact.type)).toEqual(['html', 'svg', 'image']);
    expect(artifacts.map((artifact) => artifact.filePath)).toEqual([
      '/tmp/demo.html',
      '/tmp/chart.svg',
      '/tmp/screenshot.png',
    ]);
  });

  test('extracts previewable file paths before Chinese punctuation', () => {
    const content = '产物包括 /tmp/demo.html，/tmp/chart.svg。/tmp/screenshot.png；';
    const artifacts = parseFilePathsFromText(content, 'msg1', 'sess1');

    expect(artifacts.map((artifact) => artifact.filePath)).toEqual([
      '/tmp/demo.html',
      '/tmp/chart.svg',
      '/tmp/screenshot.png',
    ]);
  });

  test('extracts mermaid and code file paths from plain assistant text', () => {
    const content = '保存到了 /tmp/flow.mmd 和 /tmp/component.tsx';
    const artifacts = parseFilePathsFromText(content, 'msg1', 'sess1');

    expect(artifacts).toHaveLength(2);
    expect(artifacts.map((artifact) => artifact.type)).toEqual(['mermaid', 'code']);
  });
});

describe('parseToolArtifact', () => {
  test('extracts file path from Write tool input', () => {
    const toolUseMsg = {
      id: 'tool1',
      type: 'tool_use' as const,
      content: '',
      timestamp: Date.now(),
      metadata: {
        toolName: 'Write',
        toolUseId: 'tu1',
        toolInput: { file_path: 'D:\\workspace\\hello.html', content: '<html></html>' },
      },
    };
    const toolResultMsg = {
      id: 'result1',
      type: 'tool_result' as const,
      content: 'OK',
      timestamp: Date.now(),
      metadata: { toolUseId: 'tu1' },
    };
    const artifact = parseToolArtifact(toolUseMsg, toolResultMsg, 'sess1');
    expect(artifact).not.toBeNull();
    expect(artifact?.filePath).toBe('D:\\workspace\\hello.html');
  });

  test('dedup normalizes tool path and file link path to same value', () => {
    const toolPath = 'D:\\new_ws_test_2\\hello-slide.pptx';
    const linkContent = '[hello-slide.pptx](file:///D:/new_ws_test_2/hello-slide.pptx)';
    const linkArtifacts = parseFileLinksFromMessage(linkContent, 'msg1', 'sess1');
    expect(linkArtifacts).toHaveLength(1);
    expect(normalizeFilePathForDedup(toolPath)).toBe(normalizeFilePathForDedup(linkArtifacts[0].filePath!));
  });
});
