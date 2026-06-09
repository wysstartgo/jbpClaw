import { expect, test } from 'vitest';
import { QingShuManagedAccessState } from '../../shared/qingshuManaged/access';
import { QingShuObjectSourceType } from '../../shared/qingshuManaged/constants';

import {
  resolveQingShuManagedAccessPresentation,
  resolveQingShuSourceLabelKey,
} from './qingshuManagedUi';

test('统一映射来源标签 key', () => {
  expect(resolveQingShuSourceLabelKey(QingShuObjectSourceType.QingShuManaged)).toBe('sourceTypeQingShuManaged');
  expect(resolveQingShuSourceLabelKey(QingShuObjectSourceType.Preset)).toBe('sourceTypePreset');
  expect(resolveQingShuSourceLabelKey(QingShuObjectSourceType.LocalCustom)).toBe('sourceTypeLocalCustom');
});

test('未登录时返回登录受限展示态', () => {
  expect(resolveQingShuManagedAccessPresentation({
    sourceType: QingShuObjectSourceType.QingShuManaged,
    allowed: true,
    isLoggedIn: false,
  })).toEqual({
    accessState: QingShuManagedAccessState.LoginRequired,
    isLocked: true,
    lockTagKey: 'managedUnavailableTag',
    lockHintKey: 'managedUnavailableHint',
  });
});

test('无权限时保留策略文案覆盖', () => {
  expect(resolveQingShuManagedAccessPresentation({
    sourceType: QingShuObjectSourceType.QingShuManaged,
    allowed: false,
    isLoggedIn: true,
    policyNote: '仅灰度账号可用',
  })).toEqual({
    accessState: QingShuManagedAccessState.Forbidden,
    isLocked: true,
    lockTagKey: 'managedForbiddenTag',
    lockHintKey: 'managedForbiddenHint',
    lockHintOverride: '仅灰度账号可用',
  });
});

test('非聚宝盆来源保持可用', () => {
  expect(resolveQingShuManagedAccessPresentation({
    sourceType: QingShuObjectSourceType.LocalCustom,
    allowed: false,
    isLoggedIn: false,
  })).toEqual({
    accessState: QingShuManagedAccessState.Available,
    isLocked: false,
    lockTagKey: null,
    lockHintKey: null,
  });
});
