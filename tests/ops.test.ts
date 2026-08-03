import assert from "node:assert/strict";
import { test } from "node:test";
import { AbortedError, AttributionClass, BatchFailedError, BatchMetadataBuilder, ClassifiedError, ContextError, DryContext, ExecutionFailedError, ListingOutline, LoopOp, Op, OpMetadata, OtherError, TimeBoundWrapper, ValidatingWrapper, WetContext, WrappedClassifiedError, BatchOp, OutlineEntry, abort, breakLoop, continueLoop, dryResult, wetPutRef } from "../src/index.js";

class ValueOp implements Op<number> {
  constructor(private readonly value:number, private readonly name="ValueOp", private readonly fail?:Error, private readonly state?:string[]) {}
  async perform():Promise<number>{if(this.fail)throw this.fail;this.state?.push(`perform:${this.value}`);return this.value;}
  async rollback():Promise<void>{this.state?.push(`rollback:${this.value}`);}
  metadata():OpMetadata{return OpMetadata.builder(this.name).outputSchema({type:"number"}).build();}
}

test("dry context preserves JSON values, clones boundaries, and serializes control flags",()=>{
  const dry=new DryContext().withValue("value",{nested:[1]});
  const value=dry.getRequired<{nested:number[]}>("value"); value.nested.push(2);
  assert.deepEqual(dry.get("value"),{nested:[1]});
  dry.setAbort("cancelled"); assert.match(dry.toJSON(),/"control_flags"/); assert.match(dry.toJSON(),/"abort_reason":"cancelled"/); const restored=DryContext.fromJSON(dry.toJSON());
  assert.equal(restored.isAborted(),true); assert.equal(restored.abortReason(),"cancelled");
  assert.throws(()=>DryContext.fromJSON('{"values":{}}'),ContextError);
});

test("required context access distinguishes absence from a present undefined value",()=>{
  const dry=new DryContext(); assert.throws(()=>dry.getRequired("missing"),ContextError);
  assert.throws(()=>dry.insert("bad",undefined),ContextError);
});

test("batch rolls back succeeded operations in LIFO order and preserves classified identity",async()=>{
  const state:string[]=[]; const classified=new ClassifiedError("E_INPUT",AttributionClass.Input,"bad input","media:arg");
  const batch=new BatchOp<number>([new ValueOp(1,"first",undefined,state),new ValueOp(2,"second",classified,state)]);
  await assert.rejects(()=>batch.perform(new DryContext(),new WetContext()),(error:unknown)=>{
    assert.ok(error instanceof WrappedClassifiedError); assert.equal(error.code,"E_INPUT"); assert.equal(error.klass,AttributionClass.Input); assert.equal(error.reason,"bad input"); assert.equal(error.argUrn,"media:arg"); return true;
  });
  assert.deepEqual(state,["perform:1","rollback:1"]);
});

test("batch metadata builder accepts operations and analyzes producer-consumer data flow",()=>{
  const producer:Op<number>={perform:async()=>1,metadata:()=>OpMetadata.builder("producer").outputSchema({type:"object",properties:{value:{type:"number"}}}).build()};
  const consumer:Op<number>={perform:async()=>1,metadata:()=>OpMetadata.builder("consumer").inputSchema({type:"object",properties:{value:{type:"number"}},required:["value"]}).build()};
  const metadata=new BatchMetadataBuilder([producer,consumer]).build(); assert.deepEqual(metadata.inputSchema?.required,[]);
});

test("batch aborts before the next operation and rolls back prior work",async()=>{
  const state:string[]=[]; const dry=new DryContext();
  const aborting:Op<number>={perform:async()=>{dry.setAbort("stop");return 1;},metadata:()=>OpMetadata.builder("abort").build(),rollback:async()=>state.push("rollback:abort")};
  const batch=new BatchOp<number>([aborting,new ValueOp(2,"never",undefined,state)]);
  await assert.rejects(()=>batch.perform(dry,new WetContext()),AbortedError); assert.deepEqual(state,["rollback:abort"]);
});

test("loop scopes continue and break to its own loop and tracks the counter",async()=>{
  const dry=new DryContext(); const seen:number[]=[];
  const continueOp:Op<number>={perform:async(ctx)=>{seen.push(ctx.getRequired("counter"));ctx.insert("continue",true);return 1;},metadata:()=>OpMetadata.builder("continue").build()};
  const loop=new LoopOp("counter",3,[continueOp]); await loop.perform(dry,new WetContext());
  assert.deepEqual(seen,[0,1,2]); assert.equal(dry.get("counter"),3);
});

test("validation uses JSON Schema types, constraints, and required fields",async()=>{
  const op:Op<number>={perform:async()=>42,metadata:()=>OpMetadata.builder("validated").inputSchema({type:"object",properties:{name:{type:"string",minLength:2}},required:["name"],additionalProperties:false}).outputSchema({type:"number",minimum:0}).build()};
  const wrapped=new ValidatingWrapper(op); await assert.rejects(()=>wrapped.perform(new DryContext().withValue("name",""),new WetContext()),ContextError);
  assert.equal(await wrapped.perform(new DryContext().withValue("name","ok"),new WetContext()),42);
});

test("metadata context reports retain the other ports' required-field semantics while wrappers enforce full schemas",async()=>{
  const metadata=OpMetadata.builder("schema").inputSchema({type:"object",properties:{count:{type:"integer",minimum:1}},required:["count"]}).referenceSchema({type:"object",properties:{service:{type:"string"}},required:["service"]}).build();
  assert.equal(metadata.validateDryContext(new DryContext().withValue("count",0)).isValid,true);
  assert.equal(metadata.validateWetContext(new WetContext().withRef("service",{connected:true})).isValid,true);
  const op:Op<number>={perform:async()=>1,metadata:()=>metadata};
  await assert.rejects(()=>new ValidatingWrapper(op).perform(new DryContext().withValue("count",0),new WetContext().withRef("service",{connected:true})),ContextError);
});

test("context helpers store results, references, and scoped loop signals",()=>{
  const dry=new DryContext(); dry.insert("__current_loop_id","loop"); dryResult(dry,"work",3); continueLoop(dry); assert.equal(dry.get("work"),3); assert.equal(dry.get("result"),3); assert.equal(dry.get("__continue_loop_loop"),true);
  breakLoop(dry); assert.equal(dry.get("__break_loop_loop"),true); const wet=new WetContext(); wetPutRef(wet,"service",{id:1}); assert.deepEqual(wet.getRequired("service"),{id:1});
  assert.throws(()=>abort(new DryContext(),"stop"),AbortedError);
});

test("timeout reports the configured duration",async()=>{
  const slow:Op<number>={perform:()=>new Promise(resolve=>setTimeout(()=>resolve(1),30)),metadata:()=>OpMetadata.builder("slow").build()};
  await assert.rejects(()=>new TimeBoundWrapper(slow,5).perform(new DryContext(),new WetContext()),(error:unknown)=>error instanceof Error && error.message==="Op timeout after 5ms");
});

test("structured outline flattening records hierarchical paths and depth",()=>{
  const root=new OutlineEntry("Root",0); const child=new OutlineEntry("Child",1); const copy=root.withChildren([child]); root.addChild(new OutlineEntry("Original",1)); const outline=new ListingOutline(); outline.entries=[copy];
  assert.deepEqual(outline.flatten().map(entry=>entry.path),[["Root"],["Root","Child"]]); assert.deepEqual(outline.entriesAtLevel(1).map(entry=>entry.title),["Child"]); assert.equal(outline.maxDepth(),1);
});

test("error wrapping keeps unclassified errors internal and class identity structural",()=>{
  assert.equal(AttributionClass.fromWire("unknown"),undefined); assert.equal(AttributionClass.isPermanent(AttributionClass.Input),true); assert.equal(AttributionClass.isPermanent(AttributionClass.Internal),false);
  assert.equal(new OtherError(new Error("x")).attributionClass(),AttributionClass.Internal); assert.equal(new ExecutionFailedError("x").message,"Op execution failed: x"); assert.equal(new BatchFailedError("x").message,"Batch op failed: x");
});
