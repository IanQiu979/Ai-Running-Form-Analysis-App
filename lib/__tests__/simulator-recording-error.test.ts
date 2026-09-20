import { isSimulatorNotSupportedError } from '../simulator-recording-error';

describe('isSimulatorNotSupportedError', () => {
  it('matches the real expo-camera SimulatorNotSupported rejection (issue #232)', () => {
    const error = new Error(
      "FunctionCallException: Calling the 'record' function has failed (at ExpoModulesCore/AsyncFunctionDefinition.swift:123)\n" +
        '→ Caused by: SimulatorNotSupported: This operation is not supported on the simulator (at ExpoCamera/CameraViewModule.swift:290)'
    );
    expect(isSimulatorNotSupportedError(error)).toBe(true);
  });

  it('matches a plain-text "not supported on the simulator" message without the error-code token', () => {
    expect(isSimulatorNotSupportedError(new Error('This operation is not supported on the simulator'))).toBe(true);
  });

  it('does not match an unrelated recording failure', () => {
    expect(isSimulatorNotSupportedError(new Error('Disk full'))).toBe(false);
  });

  it('does not match a non-Error rejection with no matching text', () => {
    expect(isSimulatorNotSupportedError('camera busy')).toBe(false);
  });
});
