import type {
  StructuredOutputRequest,
  StructuredOutputResult,
  StructuredTextModel,
} from "./structured-text-model.js";

export class FakeStructuredTextModel implements StructuredTextModel {
  readonly requests: Array<StructuredOutputRequest<unknown>> = [];

  constructor(
    private readonly value: unknown,
    private readonly model = "fake-model",
  ) {}

  async generate<T>(
    request: StructuredOutputRequest<T>,
  ): Promise<StructuredOutputResult<T>> {
    this.requests.push(
      request as StructuredOutputRequest<unknown>,
    );

    return {
      data: request.parse(this.value),
      model: this.model,
    };
  }
}
