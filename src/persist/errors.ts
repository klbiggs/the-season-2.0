// Save/load error taxonomy. All errors thrown by load() during a load
// attempt extend SaveLoadError and carry a `userMessage` for banner
// rendering. The technical `message` is for logging only.
//
// P19 deleted the migration ladder, so the load path no longer runs
// migrations: the only failure modes are a missing/invalid version field,
// a too-new version, or a malformed current-version payload.

export abstract class SaveLoadError extends Error {
  // banner-safe; no internal jargon
  abstract readonly userMessage: string;
}

export class InvalidSaveSchemaError extends SaveLoadError {
  readonly userMessage = "This save file is corrupted and cannot be loaded.";
  constructor(public readonly zodIssues: ReadonlyArray<{ path: string; message: string }>) {
    super(`Save fails schema validation: ${zodIssues.length} issue(s)`);
    this.name = "InvalidSaveSchemaError";
  }
}

export class UnknownSaveVersionError extends SaveLoadError {
  readonly userMessage = "This save file is corrupted and cannot be loaded.";
  constructor(public readonly observedVersion: unknown) {
    super(`Unknown save version: ${JSON.stringify(observedVersion)}`);
    this.name = "UnknownSaveVersionError";
  }
}

export class SaveVersionTooNewError extends SaveLoadError {
  readonly userMessage =
    "This save was made by a newer version of the game. Please update before loading.";
  constructor(
    public readonly saveVersion: number,
    public readonly clientVersion: number,
  ) {
    super(`Save version v${saveVersion} is newer than client v${clientVersion}`);
    this.name = "SaveVersionTooNewError";
  }
}
