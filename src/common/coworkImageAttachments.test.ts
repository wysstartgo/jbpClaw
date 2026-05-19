import { expect, test } from 'vitest';

import {
  estimateBase64ByteLength,
  stripCoworkImageAttachmentPayloads,
  summarizeCoworkImageAttachments,
} from './coworkImageAttachments';

test('summarizeCoworkImageAttachments stores metadata without base64 payload', () => {
  const summary = summarizeCoworkImageAttachments([
    {
      name: 'report.png',
      mimeType: 'image/png',
      base64Data: 'YWJjZA==',
    },
  ]);

  expect(summary).toEqual([
    {
      name: 'report.png',
      mimeType: 'image/png',
      sizeBytes: 4,
      base64Length: 8,
      source: 'runtime',
    },
  ]);
  expect(JSON.stringify(summary)).not.toContain('YWJjZA==');
});

test('summarizeCoworkImageAttachments keeps cached image references lightweight', () => {
  const summary = summarizeCoworkImageAttachments([
    {
      name: 'local.png',
      mimeType: 'image/png',
      path: '/tmp/local.png',
      sizeBytes: 4096,
    },
  ]);

  expect(summary).toEqual([
    {
      name: 'local.png',
      mimeType: 'image/png',
      sizeBytes: 4096,
      source: 'cached',
    },
  ]);
  expect(JSON.stringify(summary)).not.toContain('/tmp/local.png');
});

test('stripCoworkImageAttachmentPayloads keeps other metadata fields', () => {
  const metadata = stripCoworkImageAttachmentPayloads({
    skillIds: ['skill-a'],
    imageAttachments: [
      {
        name: 'large.jpg',
        mimeType: 'image/jpeg',
        base64Data: 'a'.repeat(1024),
      },
    ],
  });

  expect(metadata?.skillIds).toEqual(['skill-a']);
  expect(metadata?.imageAttachments).toEqual([
    {
      name: 'large.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: estimateBase64ByteLength('a'.repeat(1024)),
      base64Length: 1024,
      source: 'runtime',
    },
  ]);
  expect(JSON.stringify(metadata)).not.toContain('aaaa');
});

test('stripCoworkImageAttachmentPayloads can sanitize summarized metadata repeatedly', () => {
  const firstPass = stripCoworkImageAttachmentPayloads({
    imageAttachments: [
      {
        name: 'summary-only.jpg',
        mimeType: 'image/jpeg',
        base64Data: 'YWJjZA==',
      },
    ],
  });

  const secondPass = stripCoworkImageAttachmentPayloads(firstPass);

  expect(secondPass).toEqual(firstPass);
  expect(JSON.stringify(secondPass)).not.toContain('YWJjZA==');
});
