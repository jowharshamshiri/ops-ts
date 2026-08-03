import { AbortedError } from "./error.js";
import { DryContext, WetContext } from "./contexts.js";

export function dryPut<T>(dry: DryContext, key: string, value: T): void { dry.insert(key, value); }
export function dryGet<T>(dry: DryContext, key: string): T | undefined { return dry.get<T>(key); }
export function dryRequire<T>(dry: DryContext, key: string): T { return dry.getRequired<T>(key); }
export function dryResult<T>(dry: DryContext, opName: string, result: T): void { dry.insert(opName, result); dry.insert("result", result); }
export function wetPutRef<T>(wet: WetContext, key: string, value: T): void { wet.insertRef(key, value); }
export function wetPutArc<T>(wet: WetContext, key: string, value: T): void { wet.insertArc(key, value); }
export function wetGetRef<T>(wet: WetContext, key: string): T | undefined { return wet.getRef<T>(key); }
export function wetRequireRef<T>(wet: WetContext, key: string): T { return wet.getRequired<T>(key); }

export function abort(dry: DryContext, reason?: string): never { dry.setAbort(reason); throw new AbortedError(reason ?? "Operation aborted"); }
export function continueLoop(dry: DryContext): void { const loopId=dry.get<string>("__current_loop_id"); if(loopId) dry.insert(`__continue_loop_${loopId}`,true); }
export function breakLoop(dry: DryContext): void { const loopId=dry.get<string>("__current_loop_id"); if(loopId) dry.insert(`__break_loop_${loopId}`,true); }
export function breakLoopScoped(dry: DryContext, loopId: string): void { dry.insert(`__break_loop_${loopId}`,true); }
export function checkAbort(dry: DryContext): void { if(dry.isAborted()) throw new AbortedError(dry.abortReason() ?? "Operation aborted"); }

export enum AggregationStrategy { All="all", Last="last", First="first", Merge="merge", Unit="unit" }
