import { describe, expect, it } from 'vitest';
import {
  MIN_VIDEO_DURATION_SECONDS,
  VIDEO_DURATION_CAP_SECONDS,
  captionForEffect,
  chooseVerticalCanvasSize,
  inspectVideoExportResult,
  sanitizeVideoTitle,
  selectVideoMimeType,
  titleFromFilename,
} from '../src/video/export';

describe('vertical video export helpers', () => {
  it('chooses the best genuinely supported recording MIME type with matching extensions', () => {
    expect(selectVideoMimeType((mime) => mime === 'video/mp4;codecs=avc1.42E01E,mp4a.40.2')).toEqual({ mimeType: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', extension: 'mp4' });
    expect(selectVideoMimeType((mime) => mime === 'video/mp4')).toEqual({ mimeType: 'video/mp4', extension: 'mp4' });
    expect(selectVideoMimeType((mime) => mime === 'video/webm;codecs=vp9,opus')).toEqual({ mimeType: 'video/webm;codecs=vp9,opus', extension: 'webm' });
    expect(selectVideoMimeType((mime) => mime === 'video/webm;codecs=vp8,opus')).toEqual({ mimeType: 'video/webm;codecs=vp8,opus', extension: 'webm' });
    expect(selectVideoMimeType((mime) => mime === 'video/webm')).toEqual({ mimeType: 'video/webm', extension: 'webm' });
    expect(selectVideoMimeType(() => false)).toBeNull();
  });

  it('offers only non-empty known-container results with a filename extension derived from the reported Blob MIME', () => {
    expect(inspectVideoExportResult({ size: 12, type: 'video/mp4; codecs=avc1.42E01E' } as Blob)).toEqual({ usable: true, mimeType: 'video/mp4; codecs=avc1.42e01e', extension: 'mp4' });
    expect(inspectVideoExportResult({ size: 12, type: 'video/webm;codecs=vp9,opus' } as Blob)).toEqual({ usable: true, mimeType: 'video/webm;codecs=vp9,opus', extension: 'webm' });
    expect(inspectVideoExportResult({ size: 0, type: 'video/mp4' } as Blob)).toMatchObject({ usable: false, reason: expect.stringContaining('empty') });
    expect(inspectVideoExportResult({ size: 12, type: '' } as Blob)).toMatchObject({ usable: false, reason: expect.stringContaining('unknown file type') });
    expect(inspectVideoExportResult({ size: 12, type: 'audio/mpeg' } as Blob)).toMatchObject({ usable: false, reason: expect.stringContaining('unknown file type') });
  });

  it('sanitizes and bounds titles while preserving a useful filename default', () => {
    expect(sanitizeVideoTitle('  Slow\n  flip\u0000  ')).toBe('Slow flip');
    expect(sanitizeVideoTitle('')).toBe('AudioFlip');
    expect(sanitizeVideoTitle('x'.repeat(45))).toHaveLength(40);
    expect(titleFromFilename('my.sound.demo.wav')).toBe('my.sound.demo');
  });

  it('selects a performance-safe 9:16 canvas and creates local share copy', () => {
    expect(chooseVerticalCanvasSize({ hardwareConcurrency: 8, deviceMemory: 8 })).toEqual({ width: 1080, height: 1920 });
    expect(chooseVerticalCanvasSize({ hardwareConcurrency: 4, deviceMemory: 8 })).toEqual({ width: 720, height: 1280 });
    expect(chooseVerticalCanvasSize({ hardwareConcurrency: 8, deviceMemory: 4 })).toEqual({ width: 720, height: 1280 });
    expect(captionForEffect('Slowed + reverb')).toBe('slowed + reverb version - made with AudioFlip');
    expect(VIDEO_DURATION_CAP_SECONDS).toBe(60);
    expect(MIN_VIDEO_DURATION_SECONDS).toBe(1);
  });
});
