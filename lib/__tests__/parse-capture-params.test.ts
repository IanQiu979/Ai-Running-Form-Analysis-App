import { parseCaptureParams } from '../parse-capture-params';

describe('parseCaptureParams', () => {
  it('parses a valid video param set', () => {
    expect(
      parseCaptureParams({ mediaType: 'video', uri: 'file:///a.mp4', durationMs: '4200' })
    ).toEqual({ mediaType: 'video', uri: 'file:///a.mp4', durationMs: 4200 });
  });

  it('parses a valid photo param set', () => {
    expect(
      parseCaptureParams({ mediaType: 'photo', uri: 'file:///a.jpg', width: '1080', height: '1920' })
    ).toEqual({ mediaType: 'photo', uri: 'file:///a.jpg', width: 1080, height: 1920 });
  });

  it('unwraps expo-router array-valued params (uses the first value)', () => {
    expect(
      parseCaptureParams({ mediaType: ['video'], uri: ['file:///a.mp4'], durationMs: ['1000'] })
    ).toEqual({ mediaType: 'video', uri: 'file:///a.mp4', durationMs: 1000 });
  });

  it('returns null when uri is missing', () => {
    expect(parseCaptureParams({ mediaType: 'video', durationMs: '1000' })).toBeNull();
  });

  it('returns null for an unrecognized mediaType', () => {
    expect(parseCaptureParams({ mediaType: 'audio', uri: 'file:///a.mp3' })).toBeNull();
  });

  it('returns null when a video has no positive durationMs', () => {
    expect(parseCaptureParams({ mediaType: 'video', uri: 'file:///a.mp4', durationMs: '0' })).toBeNull();
    expect(parseCaptureParams({ mediaType: 'video', uri: 'file:///a.mp4', durationMs: 'nope' })).toBeNull();
    expect(parseCaptureParams({ mediaType: 'video', uri: 'file:///a.mp4' })).toBeNull();
  });

  it('returns null when a photo is missing width or height', () => {
    expect(parseCaptureParams({ mediaType: 'photo', uri: 'file:///a.jpg', width: '100' })).toBeNull();
    expect(parseCaptureParams({ mediaType: 'photo', uri: 'file:///a.jpg', height: '100' })).toBeNull();
  });

  it('returns null for a negative or non-finite numeric field', () => {
    expect(
      parseCaptureParams({ mediaType: 'video', uri: 'file:///a.mp4', durationMs: '-50' })
    ).toBeNull();
    expect(
      parseCaptureParams({ mediaType: 'video', uri: 'file:///a.mp4', durationMs: 'Infinity' })
    ).toBeNull();
  });
});
