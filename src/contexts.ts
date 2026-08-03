import { ContextError } from "./error.js";

export interface ControlFlags { aborted: boolean; abortReason?: string; }
export class DryContext {
  private readonly valuesMap = new Map<string, unknown>();
  private flags: ControlFlags = { aborted: false };
  withValue(key: string, value: unknown): this { this.insert(key, value); return this; }
  insert(key: string, value: unknown): void { assertJsonValue(value, key); this.valuesMap.set(key, structuredClone(value)); }
  get<T>(key: string): T | undefined { const value=this.valuesMap.get(key); return value === undefined ? undefined : structuredClone(value) as T; }
  getRequired<T>(key: string): T { if (!this.valuesMap.has(key)) throw new ContextError(`Required dry context key '${key}' not found`); return structuredClone(this.valuesMap.get(key)) as T; }
  contains(key: string): boolean { return this.valuesMap.has(key); }
  keys(): IterableIterator<string> { return this.valuesMap.keys(); }
  values(): Record<string, unknown> { return Object.fromEntries([...this.valuesMap].map(([k,v]) => [k, structuredClone(v)])); }
  getOrInsertWith<T>(key: string, factory: () => T): T { if (this.valuesMap.has(key)) return this.getRequired<T>(key); const value=factory(); this.insert(key,value); return value; }
  getOrComputeWith<T>(key: string, computer: (ctx: DryContext, key: string) => T): T { if (this.valuesMap.has(key)) return this.getRequired<T>(key); const value=computer(this,key); this.insert(key,value); return value; }
  async ensure<T>(key: string, wet: WetContext, factory: (dry: DryContext, wet: WetContext, key: string) => Promise<T>): Promise<T> { if (this.valuesMap.has(key)) return this.getRequired<T>(key); const value=await factory(this,wet,key); this.insert(key,value); return value; }
  merge(other: DryContext): void { for (const [key,value] of Object.entries(other.values())) this.insert(key,value); if (other.flags.aborted && !this.flags.aborted) this.flags={...other.flags}; }
  setAbort(reason?: string): void { this.flags={aborted:true, ...(reason === undefined ? {} : {abortReason: reason})}; }
  isAborted(): boolean { return this.flags.aborted; }
  abortReason(): string | undefined { return this.flags.abortReason; }
  clearControlFlags(): void { this.flags={aborted:false}; }
  clone(): DryContext { const result=new DryContext(); for (const [key,value] of Object.entries(this.values())) result.insert(key,value); result.flags={...this.flags}; return result; }
  toJSON(): string { return JSON.stringify({values:this.values(), control_flags:{aborted:this.flags.aborted, ...(this.flags.abortReason === undefined ? {} : {abort_reason:this.flags.abortReason})}}); }
  static fromJSON(serialized: string): DryContext {
    let data: unknown;
    try { data=JSON.parse(serialized); } catch(error) { throw new ContextError(`Invalid dry context JSON: ${error instanceof Error ? error.message : String(error)}`); }
    if(data === null || typeof data !== "object" || Array.isArray(data)) throw new ContextError("Invalid dry context JSON: expected an object");
    const record=data as Record<string,unknown>, values=record.values, flags=record.control_flags;
    if(values === null || typeof values !== "object" || Array.isArray(values)) throw new ContextError("Invalid dry context JSON: 'values' must be an object");
    if(flags === null || typeof flags !== "object" || Array.isArray(flags)) throw new ContextError("Invalid dry context JSON: 'control_flags' must be an object");
    const flagRecord=flags as Record<string,unknown>;
    if(typeof flagRecord.aborted !== "boolean") throw new ContextError("Invalid dry context JSON: 'control_flags.aborted' must be a boolean");
    if(flagRecord.abort_reason !== undefined && typeof flagRecord.abort_reason !== "string") throw new ContextError("Invalid dry context JSON: 'control_flags.abort_reason' must be a string");
    const result=new DryContext(); for(const [key,value] of Object.entries(values as Record<string,unknown>)) result.insert(key,value); result.flags={aborted:flagRecord.aborted, ...(flagRecord.abort_reason === undefined ? {} : {abortReason:flagRecord.abort_reason})}; return result;
  }
}
export class WetContext {
  private readonly refs = new Map<string, unknown>();
  withRef(key: string, value: unknown): this { this.insertRef(key,value); return this; }
  insertRef(key: string, value: unknown): void { this.refs.set(key,value); }
  insertArc(key: string, value: unknown): void { this.insertRef(key,value); }
  getRef<T>(key: string): T | undefined { return this.refs.get(key) as T | undefined; }
  getRequired<T>(key: string): T { if(!this.refs.has(key)) throw new ContextError(`Required wet context reference '${key}' not found`); return this.refs.get(key) as T; }
  contains(key: string): boolean { return this.refs.has(key); }
  keys(): IterableIterator<string> { return this.refs.keys(); }
  async ensure<T>(key: string, dry: DryContext, factory: (dry: DryContext, wet: WetContext, key: string) => Promise<T>): Promise<T> { if(this.refs.has(key)) return this.getRequired<T>(key); const value=await factory(dry,this,key); this.refs.set(key,value); return value; }
  merge(other: WetContext): void { for(const key of other.keys()) this.refs.set(key,other.getRef(key)); }
}
function assertJsonValue(value: unknown, key: string): void { try { JSON.stringify(value); } catch { throw new ContextError(`Value for dry context key '${key}' is not JSON-serializable`); } if(value === undefined || typeof value === "function" || typeof value === "symbol") throw new ContextError(`Value for dry context key '${key}' is not JSON-serializable`); }
