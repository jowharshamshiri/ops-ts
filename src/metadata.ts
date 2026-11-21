import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";
import { ContextError } from "./error.js";
import { DryContext, WetContext } from "./contexts.js";
/** A JSON Schema document: an object of schema keywords, each a JSON value. */
export type JsonSchema = { readonly [keyword: string]: unknown };
export interface ValidationError { field: string; message: string; }
export interface ValidationWarning { field: string; message: string; }
export class ValidationReport { constructor(readonly isValid: boolean, readonly errors: ValidationError[] = [], readonly warnings: ValidationWarning[] = []) {} isFullyValid(): boolean { return this.isValid && this.warnings.length===0; } static success(): ValidationReport { return new ValidationReport(true); } }
const AjvConstructor = Ajv as unknown as new (options: {allErrors: boolean; strict: boolean}) => { compile(schema: JsonSchema): ValidateFunction };
const ajv = new AjvConstructor({allErrors:true, strict:true});
function validate(value: unknown, schema: JsonSchema): ValidationReport { let fn: ValidateFunction; try { fn=ajv.compile(schema); } catch(error) { throw new ContextError(`Invalid JSON Schema: ${error instanceof Error ? error.message : String(error)}`); } if(fn(value)) return ValidationReport.success(); const errors=(fn.errors ?? []).map((error: ErrorObject)=>({field:error.instancePath || error.params?.missingProperty || "$", message:error.message ?? "validation failed"})); return new ValidationReport(false,errors); }
function requiredOnly(value: unknown, schema: JsonSchema, label: string): ValidationReport { const requiredFields=schema.required; if(!Array.isArray(requiredFields)) return ValidationReport.success(); if(value === null || typeof value !== "object" || Array.isArray(value)) return new ValidationReport(false,[{field:"$",message:`${label} must be an object`}]); const record=value as Record<string,unknown>; const errors=requiredFields.filter((field):field is string=>typeof field === "string" && !(field in record)).map(field=>({field,message:`Required ${label.toLowerCase()} '${field}' is missing`})); return new ValidationReport(errors.length===0,errors); }
function validateRefs(ctx: WetContext, schema: JsonSchema): ValidationReport {
  // Wet values are deliberately opaque runtime references. All sibling ports
  // validate only the reference contract's required keys; applying JSON type
  // validation to sentinel values would reject valid references.
  const requiredFields=schema.required;
  const errors=(Array.isArray(requiredFields)?requiredFields:[]).filter((field):field is string=>typeof field === "string" && !ctx.contains(field)).map(field=>({field,message:`Required reference '${field}' is missing`}));
  return new ValidationReport(errors.length===0,errors);
}
export class OpMetadata {
  constructor(readonly name: string, public inputSchema?: JsonSchema, public referenceSchema?: JsonSchema, public outputSchema?: JsonSchema, public description?: string) {}
  static builder(name: string): OpMetadataBuilder { return new OpMetadataBuilder(name); }
  validateDryContext(ctx: DryContext): ValidationReport { return this.inputSchema ? requiredOnly(ctx.values(),this.inputSchema,"field") : ValidationReport.success(); }
  validateWetContext(ctx: WetContext): ValidationReport { return this.referenceSchema ? validateRefs(ctx,this.referenceSchema) : ValidationReport.success(); }
  validateContexts(dry: DryContext, wet: WetContext): ValidationReport { const a=this.validateDryContext(dry), b=this.validateWetContext(wet); return new ValidationReport(a.isValid&&b.isValid,[...a.errors,...b.errors],[...a.warnings,...b.warnings]); }
  validateOutput(output: unknown): ValidationReport { return this.outputSchema ? requiredOnly(output,this.outputSchema,"field") : ValidationReport.success(); }
}
export function validateJsonSchema(value: unknown, schema: JsonSchema, label: string): ValidationReport { let encoded: string; try { encoded=JSON.stringify(value); } catch(error) { throw new ContextError(`Failed to serialize ${label.toLowerCase()} for validation: ${error instanceof Error ? error.message : String(error)}`); } if(encoded === undefined) throw new ContextError(`Failed to serialize ${label.toLowerCase()} for validation: value is not JSON-serializable`); return validate(JSON.parse(encoded),schema); }
export class OpMetadataBuilder { private input?: JsonSchema; private refs?: JsonSchema; private output?: JsonSchema; private desc?: string; constructor(private readonly opName:string) {} inputSchema(schema: JsonSchema): this {this.input=schema;return this;} referenceSchema(schema: JsonSchema): this {this.refs=schema;return this;} outputSchema(schema: JsonSchema): this {this.output=schema;return this;} description(desc:string): this {this.desc=desc;return this;} build(): OpMetadata {return new OpMetadata(this.opName,this.input,this.refs,this.output,this.desc);} }
export class TriggerFuse { readonly id=crypto.randomUUID(); readonly createdAt=new Date(); readonly dryContext=new DryContext(); metadata?: OpMetadata; constructor(readonly triggerName:string) {} withData(key:string,value:unknown):this {this.dryContext.insert(key,value);return this;} withMetadata(metadata:OpMetadata):this {this.metadata=metadata;return this;} validateAndGetDryContext():DryContext { if(this.metadata){const report=this.metadata.validateDryContext(this.dryContext);if(!report.isValid) throw new ContextError(`Invalid dry context: ${JSON.stringify(report.errors)}`);} return this.dryContext.clone();} }
