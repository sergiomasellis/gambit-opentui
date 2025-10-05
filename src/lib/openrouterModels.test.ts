import { expect, test } from "bun:test";

import { isGpt5Model, normalizeOpenRouterModel } from "./openrouterModels";

test("normalizeOpenRouterModel extracts key fields", () => {
  const result = normalizeOpenRouterModel({
    id: "openai/gpt-4.1-mini",
    name: "OpenAI · GPT-4.1 Mini",
    description: "  versatile model  ",
    pricing: {
      prompt: "0.00001",
      completion: 0.00002,
      request: 0,
    },
    supported_parameters: ["Reasoning", "temperature"],
  })

  expect(result.id).toBe("openai/gpt-4.1-mini")
  expect(result.name).toBe("OpenAI · GPT-4.1 Mini")
  expect(result.description).toBe("versatile model")
  expect(result.provider).toBe("openai")
  expect(result.promptPrice).toBe("0.00001")
  expect(result.completionPrice).toBe("0.00002")
  expect(result.requestPrice).toBe("0")
  expect(result.supportsReasoning).toBe(true)
})

test("normalizeOpenRouterModel handles missing optional data", () => {
  const result = normalizeOpenRouterModel({
    id: "vendor/model-x",
  })

  expect(result.name).toBe("vendor/model-x")
  expect(result.description).toBeNull()
  expect(result.provider).toBe("vendor")
  expect(result.promptPrice).toBeNull()
  expect(result.completionPrice).toBeNull()
  expect(result.requestPrice).toBeNull()
  expect(result.supportsReasoning).toBe(false)
})

test("isGpt5Model checks id and name", () => {
  const gpt5 = normalizeOpenRouterModel({
    id: "openai/gpt-5-preview",
    name: "OpenAI GPT-5 Preview",
  })
  expect(isGpt5Model(gpt5)).toBe(true)

  const other = normalizeOpenRouterModel({
    id: "anthropic/claude-4",
    name: "Anthropic Claude 4",
  })
  expect(isGpt5Model(other)).toBe(false)
})
