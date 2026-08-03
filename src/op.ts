import type { DryContext, WetContext } from "./contexts.js";
import type { OpMetadata } from "./metadata.js";
export interface Op<T> { perform(dry: DryContext, wet: WetContext): Promise<T>; metadata(): OpMetadata; rollback?(dry: DryContext, wet: WetContext): Promise<void>; }
export async function rollbackOp<T>(op: Op<T>, dry: DryContext, wet: WetContext): Promise<void> { if(op.rollback) await op.rollback(dry,wet); }
