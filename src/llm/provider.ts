export type LlmMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type LlmCompletionRequest = {
  messages: LlmMessage[];
  temperature?: number;
};

export type LlmCompletion = {
  text: string;
  model: string;
};

export interface LlmProvider {
  complete(request: LlmCompletionRequest): Promise<LlmCompletion>;
}
