jest.mock('expo-file-system', () => ({
  File: jest.fn(),
}));

import { File } from 'expo-file-system';

import { readFileSizeBytes } from '../media-file-size';

const MockFile = File as unknown as jest.Mock;

describe('readFileSizeBytes', () => {
  afterEach(() => {
    MockFile.mockReset();
  });

  it('returns the size reported by File', () => {
    MockFile.mockImplementation(() => ({ size: 12_345 }));
    expect(readFileSizeBytes('file:///a.mp4')).toBe(12_345);
  });

  it('returns null when File throws (bad/expired uri)', () => {
    MockFile.mockImplementation(() => {
      throw new Error('boom');
    });
    expect(readFileSizeBytes('file:///missing.mp4')).toBeNull();
  });

  it('returns null when size is not a number', () => {
    MockFile.mockImplementation(() => ({ size: undefined }));
    expect(readFileSizeBytes('file:///a.mp4')).toBeNull();
  });
});
