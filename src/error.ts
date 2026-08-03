export enum AttributionClass {
  Input = "input", Resource = "resource", Environment = "environment", Internal = "internal"
}
export namespace AttributionClass {
  export function fromWire(token: string): AttributionClass | undefined {
    return ([AttributionClass.Input, AttributionClass.Resource, AttributionClass.Environment, AttributionClass.Internal] as string[]).includes(token) ? token as AttributionClass : undefined;
  }
  export function isPermanent(value: AttributionClass): boolean { return value === AttributionClass.Input; }
}

export class OpError extends Error {
  override readonly name: string = "OpError";
  attributionClass(): AttributionClass { return AttributionClass.Internal; }
  failureCode(): string | undefined { return undefined; }
  failureArgUrn(): string | undefined { return undefined; }
  failureReason(): string { return this.message; }
}
export class ExecutionFailedError extends OpError { constructor(readonly detail: string) { super(`Op execution failed: ${detail}`); } }
export class TimeoutError extends OpError { constructor(readonly timeoutMs: number) { super(`Op timeout after ${timeoutMs}ms`); } }
export class ContextError extends OpError { constructor(readonly detail: string) { super(`Context error: ${detail}`); } }
export class BatchFailedError extends OpError { constructor(readonly detail: string) { super(`Batch op failed: ${detail}`); } }
export class AbortedError extends OpError { constructor(readonly reason: string) { super(`Op aborted: ${reason}`); } }
export class TriggerError extends OpError { constructor(readonly detail: string) { super(`Trigger error: ${detail}`); } }
export class ClassifiedError extends OpError {
  constructor(readonly code: string, readonly klass: AttributionClass, readonly detail: string, readonly argUrn?: string) { super(`${code}: ${detail}`); }
  override attributionClass(): AttributionClass { return this.klass; }
  override failureCode(): string { return this.code; }
  override failureArgUrn(): string | undefined { return this.argUrn; }
  override failureReason(): string { return this.detail; }
}
export class WrappedClassifiedError extends OpError {
  constructor(readonly chain: string, readonly code: string, readonly klass: AttributionClass, readonly reason: string, readonly argUrn?: string) { super(chain); }
  override attributionClass(): AttributionClass { return this.klass; }
  override failureCode(): string { return this.code; }
  override failureArgUrn(): string | undefined { return this.argUrn; }
  override failureReason(): string { return this.reason; }
}
export class OtherError extends OpError { constructor(readonly wrapped: unknown) { super(errorMessage(wrapped)); } }
export function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
export function opErrorFromJsonError(error: unknown): OtherError { return new OtherError(error); }
