import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { refererHeader, titleHeader } from "../config";

export function createModelSelector(apiKey: string) {
  const openrouter = createOpenRouter({
    apiKey,
    baseURL: "https://openrouter.ai/api/v1",
    headers: {
      "HTTP-Referer": refererHeader,
      "X-Title": titleHeader,
    },
  });

  return (modelId: string) => openrouter(modelId);
}
