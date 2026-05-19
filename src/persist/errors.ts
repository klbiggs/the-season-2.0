// Save/load error taxonomy. All errors thrown by load() during a load
// attempt extend SaveLoadError and carry a `userMessage` for banner
// rendering. The technical `message` is for logging only.
//
// NOTE: MigrationFailedError.cause carries an Error instance and is NOT
// structured-clone-safe. Do not serialize SaveLoadError instances to
// IndexedDB or postMessage them across worker boundaries — the cause
// chain will degrade to {}. The banner UX only renders userMessage, so
// this is fine for P2; flag for any future "send error report" feature.
//
// Programmer errors at module-load time (e.g., assertMonotonic) are NOT
// part of this taxonomy — they throw plain Error and surface only at
// test-suite boot.

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

export class MigrationFailedError extends SaveLoadError {
  readonly userMessage = "This save file is corrupted and cannot be loaded.";
  // Rationale for the field name: `cause` overlaps with the built-in
  // ES2022 Error.cause. Use `inner` to keep our explicit field separate
  // from Error's optional native one — instanceof narrowing still works.
  constructor(
    public readonly stepFrom: number,
    public readonly stepTo: number,
    public readonly inner: unknown,
  ) {
    super(
      `Migration v${stepFrom} → v${stepTo} failed: ${
        inner instanceof Error ? inner.message : String(inner)
      }`,
    );
    this.name = "MigrationFailedError";
    if (inner instanceof Error && inner.stack !== undefined) {
      this.stack = `${this.stack ?? ""}\nCaused by: ${inner.stack}`;
    }
  }
}

export class MissingMigrationError extends SaveLoadError {
  readonly userMessage = "This save file is corrupted and cannot be loaded.";
  constructor(
    public readonly from: number,
    public readonly to: number,
  ) {
    super(`No migration registered from v${from} to v${to}`);
    this.name = "MissingMigrationError";
  }
}
