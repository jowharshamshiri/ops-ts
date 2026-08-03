import { OpMetadata } from "./metadata.js";
import type { Op } from "./op.js";

function required(schema?: object): string[] {
  const value=(schema as {required?:unknown[]}|undefined)?.required;
  return Array.isArray(value) ? value.filter((item): item is string=>typeof item === "string") : [];
}
function properties(schema?: object): Record<string,unknown> {
  const value=(schema as {properties?:unknown}|undefined)?.properties;
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string,unknown> : {};
}
function outputs(schema?: object): Set<string> {
  return (schema as {type?:unknown}|undefined)?.type === "string" ? new Set(["result"]) : new Set(Object.keys(properties(schema)));
}

/** Builds batch metadata from either operations or already-materialized metadata. */
export class BatchMetadataBuilder {
  private readonly metadata: OpMetadata[];
  constructor(items: Iterable<Op<unknown> | OpMetadata>) {
    this.metadata=[...items].map(item=>item instanceof OpMetadata ? item : item.metadata());
  }
  build(): OpMetadata {
    const available=new Set<string>(), needed=new Set<string>(), propMap:Record<string,unknown>={};
    for(const meta of this.metadata){
      for(const field of required(meta.inputSchema)) if(!available.has(field)) needed.add(field);
      for(const [key,value] of Object.entries(properties(meta.inputSchema))) if(needed.has(key) && !(key in propMap)) propMap[key]=value;
      for(const field of outputs(meta.outputSchema)) available.add(field);
    }
    const input={type:"object",properties:Object.fromEntries(Object.entries(propMap).filter(([key])=>needed.has(key))),required:[...needed],additionalProperties:false};
    const refs:Record<string,unknown>={}, refRequired=new Set<string>();
    for(const meta of this.metadata){
      for(const [key,value] of Object.entries(properties(meta.referenceSchema))) if(!(key in refs)) refs[key]=value;
      for(const field of required(meta.referenceSchema)) refRequired.add(field);
    }
    return OpMetadata.builder("BatchOp")
      .description(`Batch of ${this.metadata.length} operations with data flow analysis`)
      .inputSchema(input)
      .referenceSchema({type:"object",properties:refs,required:[...refRequired],additionalProperties:false})
      .outputSchema({type:"array",items:{type:"object",description:"Output from individual ops in the batch"},minItems:this.metadata.length,maxItems:this.metadata.length})
      .build();
  }
}
