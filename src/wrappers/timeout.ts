import { DryContext, WetContext } from "../contexts.js";
import { TimeoutError } from "../error.js";
import { Op, rollbackOp } from "../op.js";
import { OpMetadata } from "../metadata.js";
import { LoggingWrapper } from "./logging.js";

export class TimeBoundWrapper<T> implements Op<T> {
  constructor(private readonly op: Op<T>, private readonly timeoutMs: number, private readonly triggerName?: string, private readonly warnOnTimeout=true) {
    if(!Number.isFinite(timeoutMs) || timeoutMs < 0) throw new RangeError("Timeout must be a non-negative finite number");
  }
  static withName<T>(op: Op<T>, timeoutMs: number, name: string): TimeBoundWrapper<T> { return new TimeBoundWrapper(op,timeoutMs,name); }
  static withWarningControl<T>(op: Op<T>, timeoutMs: number, warn: boolean): TimeBoundWrapper<T> { return new TimeBoundWrapper(op,timeoutMs,undefined,warn); }
  private effectiveName(): string { return this.triggerName ?? "TimeBoundOp"; }
  async perform(dry: DryContext, wet: WetContext): Promise<T> {
    const start=performance.now(); let timer: ReturnType<typeof setTimeout>|undefined;
    const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new TimeoutError(this.timeoutMs)),this.timeoutMs);});
    try {
      const result=await Promise.race([this.op.perform(dry,wet),timeout]);
      const durationMs=performance.now()-start;
      if(this.timeoutMs > 0 && durationMs/this.timeoutMs > 0.8) console.info(`Op '${this.effectiveName()}' completed in ${(durationMs/1000).toFixed(3)}s (${Math.round(durationMs/this.timeoutMs*100)}% of ${this.timeoutMs}ms timeout)`);
      return result;
    } catch(error) {
      if(error instanceof TimeoutError){if(this.warnOnTimeout) console.warn(`Op '${this.effectiveName()}' was terminated due to timeout after ${this.timeoutMs}ms`);throw error;}
      throw error;
    } finally { if(timer) clearTimeout(timer); }
  }
  metadata(): OpMetadata { const inner=this.op.metadata(); return this.triggerName === undefined ? inner : new OpMetadata(inner.name,inner.inputSchema,inner.referenceSchema,inner.outputSchema,`${this.triggerName} (timeout: ${this.timeoutMs}ms)`); }
  async rollback(dry: DryContext, wet: WetContext): Promise<void> { await rollbackOp(this.op,dry,wet); }
}

export function createTimeoutWrapperWithCallerName<T>(op: Op<T>, timeoutMs: number): TimeBoundWrapper<T> {
  const stack=new Error().stack?.split("\n");
  if(!stack) throw new Error("Unable to determine timeout caller name: stack trace is unavailable");
  const frame=stack.slice(2).find(line=>line.match(/(?:\(|\s)(?:file:\/\/)?(.+):(\d+):\d+\)?$/));
  if(!frame) throw new Error("Unable to determine timeout caller name: caller frame is unavailable");
  const match=frame.match(/(?:\(|\s)(?:file:\/\/)?(.+):(\d+):\d+\)?$/);
  if(!match) throw new Error("Unable to determine timeout caller name: caller frame is malformed");
  const file=match[1]!.split(/[\\/]/).pop()!.replace(/\.[^.]+$/ ,"");
  if(!file) throw new Error("Unable to determine timeout caller name: caller file is empty");
  return TimeBoundWrapper.withName(op,timeoutMs,`${file}::${match[2]}`);
}
export function createLoggedTimeoutWrapper<T>(op: Op<T>, timeoutMs: number, triggerName: string): LoggingWrapper<T> { return new LoggingWrapper(TimeBoundWrapper.withName(op,timeoutMs,triggerName),`TimeBound[${triggerName}]`); }
