import { fetchOpenRouterModels } from './src/lib/provider-models.js';

// Mock data simulating OpenRouter API response
const mockOpenRouterResponse = {
  data: [
    {
      id: "mistralai/mistral-medium-3",
      canonical_slug: "mistralai/mistral-medium-3",
      hugging_face_id: "",
      name: "Mistral: Mistral Medium 3",
      created: 1746627341,
      description: "Mistral Medium 3 is a high-performance enterprise-grade language model...",
      context_length: 131072,
      architecture: {
        modality: "text+image+file->text",
        input_modalities: ["text", "image", "file"],
        output_modalities: ["text"],
        tokenizer: "Mistral",
        instruct_type: null
      },
      pricing: {
        prompt: "0.0000004",
        completion: "0.000002",
        input_cache_read: "0.00000004"
      },
      top_provider: {
        context_length: 131072,
        max_completion_tokens: null,
        is_moderated: false
      },
      per_request_limits: null,
      supported_parameters: [
        "frequency_penalty",
        "max_tokens",
        "presence_penalty",
        "response_format",
        "seed",
        "stop",
        "structured_outputs",
        "temperature",
        "tool_choice",
        "tools",
        "top_p"
      ],
      default_parameters: {
        temperature: 0.3
      },
      supported_voices: null,
      knowledge_cutoff: "2025-03-31",
      expiration_date: null,
      links: {
        details: "/api/v1/models/mistralai/mistral-medium-3/endpoints"
      }
    }
  ]
};

// Mock provider configuration
const mockProvider = {
  protocol: 'openrouter',
  endpoint: 'https://openrouter.ai/api/v1',
  keys: [{ key: 'test-key', type: 'free' }],
  models: []
};

// Test the function
async function testOpenRouterModels() {
  try {
    // Mock fetch to return our test data
    global.fetch = async (url, options) => {
      return {
        ok: true,
        json: async () => mockOpenRouterResponse
      };
    };

    const result = await fetchOpenRouterModels(mockProvider, 'test-key', false);

    console.log('Test Results:');
    console.log('=============');

    if (result.models.length === 0) {
      console.log('❌ No models returned');
      return;
    }

    const model = result.models[0];
    console.log('Model ID:', model.id);
    console.log('Usage:', model.usage);
    console.log('Context Window:', model.contextWindow);
    console.log('Max Output Tokens:', model.maxOutputTokens);
    console.log('Input Modalities:', model.inputModalities);
    console.log('Output Modalities:', model.outputModalities);
    console.log('Supports Images:', model.supportsImages);
    console.log('Supports Prompt Cache:', model.supportsPromptCache);
    console.log('Supports Tools:', model.supportsTools);
    console.log('Supports Reasoning:', model.supportsReasoning);

    // Verify the new fields are correctly populated
    const expectedValues = {
      supportsImages: true,
      supportsPromptCache: true,
      supportsTools: true,
      supportsReasoning: true
    };

    let allTestsPassed = true;

    for (const [field, expectedValue] of Object.entries(expectedValues)) {
      if (model[field] !== expectedValue) {
        console.log(`❌ ${field}: expected ${expectedValue}, got ${model[field]}`);
        allTestsPassed = false;
      } else {
        console.log(`✅ ${field}: ${model[field]}`);
      }
    }

    if (allTestsPassed) {
      console.log('\\n🎉 All tests passed! The new fields are correctly populated.');
    } else {
      console.log('\\n❌ Some tests failed.');
    }

  } catch (error) {
    console.error('Error running test:', error);
  }
}

// Run the test
testOpenRouterModels();