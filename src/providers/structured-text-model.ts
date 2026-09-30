export type StructuredOutputRequest<T> = {
  instructions: string;
  input: string;
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  parse(value: unknown): T;
};

export type StructuredOutputResult<T> = {
  data: T;
  model: string;
};

export interface StructuredTextModel {
  generate<T>(
    request: StructuredOutputRequest<T>,
  ): Promise<StructuredOutputResult<T>>;
}
