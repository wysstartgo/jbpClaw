import { describe, expect, test } from 'vitest';

import { BUILTIN_NOVEL_COMIC_WECHAT_POST_KIT } from './kit';

describe('built-in kits', () => {
  test('novel comic WeChat post kit exposes the full seven-skill suite', () => {
    const skillIds = BUILTIN_NOVEL_COMIC_WECHAT_POST_KIT.skills?.list?.map(skill => skill.id);

    expect(skillIds).toEqual([
      'novel-comic-wechat-post',
      'long-novel-graph',
      'baoyu-comic',
      'explosive-cover-generator-gzh',
      'xiaohu-wechat-cover',
      'qingshu-image',
      'xiaohu-wechat-format',
    ]);
    expect(BUILTIN_NOVEL_COMIC_WECHAT_POST_KIT.version).toBe('2026.06.10');
  });
});
