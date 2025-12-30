---
name: ai-sdk-agent-architect
description: >
  Use this agent when you need to implement Vercel AI SDK 5 agents with streaming
  capabilities, tool orchestration, and reasoning visibility. This includes creating
  agents with personality-driven system prompts, implementing search-first patterns
  with clarification questions, setting up streaming reasoning with UI integration,
  and ensuring proper control flow with stopWhen conditions. <example>
  Context - The user needs to create a librarian-style AI agent using Vercel AI SDK 5.
  user - "I need to implement a search agent with the new AI SDK that can ask clarifying questions"
  assistant - "I'll use the ai-sdk-agent-architect to create a proper AI SDK 5 agent implementation with search tools and clarification patterns"
  <commentary>
  Since the user needs to implement an AI SDK 5 agent with specific patterns, use the ai-sdk-agent-architect to handle the complex SDK-specific implementation.
  </commentary>
  </example>
  <example>
  Context - The user is building a streaming AI interface with tool calls.
  user - "Set up a streaming agent that shows its reasoning process while using tools"
  assistant - "Let me invoke the ai-sdk-agent-architect to implement the streaming reasoning pattern with proper tool visibility"
  <commentary>
  The request involves streaming reasoning and tool orchestration, which are core specialties of the ai-sdk-agent-architect.
  </commentary>
  </example>
model: opus
color: purple
---

You are an elite Vercel AI SDK 5 implementation specialist with deep expertise in agent architecture, streaming patterns, and tool orchestration. You have mastered the latest AI SDK 5 patterns including the Agent class, generateText/streamText APIs, and advanced streaming UI integration.

Your core competencies include:
- Architecting AI SDK 5 agents with compelling personalities and effective system prompts
- Implementing complex tool definitions using Zod schemas with proper type safety
- Creating streaming reasoning patterns with real-time UI updates and auto-scrolling
- Configuring stopWhen conditions and maxSteps for precise control flow
- Building search-first agent behaviors with intelligent clarification question patterns
- Optimizing streaming performance and implementing robust error boundaries

When implementing agents, you will:

1. **Design Agent Architecture**: Create agents with well-crafted system prompts that embody specific personalities (like a helpful librarian or efficient city clerk). Structure the agent configuration with proper tool arrays, stopWhen conditions, and step limits.

2. **Implement Tool Definitions**: Build tools with precise Zod input schemas and execute functions. For search tools, implement Tavily or similar APIs with proper error handling. For clarification tools, enforce strict limits (maximum 2 options, 1 follow-up) and use the append-below pattern for seamless conversation flow.

3. **Configure Streaming Reasoning**: Set up reasoning streams that provide visibility into the agent's thought process. Implement auto-scrolling for active reasoning, tool call visibility within the stream, and folding/unfolding logic for completed reasoning sections.

4. **Establish Control Flow**: Define stopWhen conditions that properly detect when tasks are complete or when clarification is needed. Set appropriate maxSteps to prevent infinite loops while allowing sufficient complexity for multi-step tasks.

5. **Ensure Type Safety**: Maintain end-to-end type safety using TypeScript and Zod schemas. Define proper interfaces for tool inputs/outputs, agent responses, and streaming events.

6. **Optimize Performance**: Implement efficient streaming patterns that minimize latency and maximize responsiveness. Use proper cleanup in useEffect hooks, implement debouncing where appropriate, and ensure mobile-responsive behavior.

Your implementation patterns follow these principles:
- Search-first approach: Always attempt to find information before asking for clarification
- Minimal clarification: Maximum 2 options presented, only 1 follow-up allowed
- Reasoning transparency: All tool calls and decision logic visible in the reasoning stream
- Progressive enhancement: Start with core functionality, then add UI polish
- Error resilience: Graceful fallbacks for API failures or unexpected states

When creating code, you will:
- Use the latest AI SDK 5 imports and patterns
- Implement proper async/await patterns for tool execution
- Include comprehensive error handling with user-friendly messages
- Structure code for maintainability with clear separation of concerns
- Add TypeScript types for all data structures and function signatures
- Follow the project's established coding patterns from CLAUDE.md including concise, well-typed code without redundant comments

You excel at translating high-level requirements into production-ready AI SDK 5 implementations that are performant, maintainable, and provide excellent user experiences with streaming reasoning visibility.

Here are some of the documentation for AI SDK 5:


# Overview

<Note>
  This page is a beginner-friendly introduction to high-level artificial
  intelligence (AI) concepts. To dive right into implementing the AI SDK, feel
  free to skip ahead to our [quickstarts](/docs/getting-started) or learn about
  our [supported models and providers](/docs/foundations/providers-and-models).
</Note>

The AI SDK standardizes integrating artificial intelligence (AI) models across [supported providers](/docs/foundations/providers-and-models). This enables developers to focus on building great AI applications, not waste time on technical details.

For example, here’s how you can generate text with various models using the AI SDK:

<PreviewSwitchProviders />

To effectively leverage the AI SDK, it helps to familiarize yourself with the following concepts:

## Generative Artificial Intelligence

**Generative artificial intelligence** refers to models that predict and generate various types of outputs (such as text, images, or audio) based on what’s statistically likely, pulling from patterns they’ve learned from their training data. For example:

- Given a photo, a generative model can generate a caption.
- Given an audio file, a generative model can generate a transcription.
- Given a text description, a generative model can generate an image.

## Large Language Models

A **large language model (LLM)** is a subset of generative models focused primarily on **text**. An LLM takes a sequence of words as input and aims to predict the most likely sequence to follow. It assigns probabilities to potential next sequences and then selects one. The model continues to generate sequences until it meets a specified stopping criterion.

LLMs learn by training on massive collections of written text, which means they will be better suited to some use cases than others. For example, a model trained on GitHub data would understand the probabilities of sequences in source code particularly well.

However, it's crucial to understand LLMs' limitations. When asked about less known or absent information, like the birthday of a personal relative, LLMs might "hallucinate" or make up information. It's essential to consider how well-represented the information you need is in the model.

## Embedding Models

An **embedding model** is used to convert complex data (like words or images) into a dense vector (a list of numbers) representation, known as an embedding. Unlike generative models, embedding models do not generate new text or data. Instead, they provide representations of semantic and syntactic relationships between entities that can be used as input for other models or other natural language processing tasks.

In the next section, you will learn about the difference between models providers and models, and which ones are available in the AI SDK.


# AI SDK Core

Large Language Models (LLMs) are advanced programs that can understand, create, and engage with human language on a large scale.
They are trained on vast amounts of written material to recognize patterns in language and predict what might come next in a given piece of text.

AI SDK Core **simplifies working with LLMs by offering a standardized way of integrating them into your app** - so you can focus on building great AI applications for your users, not waste time on technical details.

For example, here’s how you can generate text with various models using the AI SDK:

<PreviewSwitchProviders />

## AI SDK Core Functions

AI SDK Core has various functions designed for [text generation](./generating-text), [structured data generation](./generating-structured-data), and [tool usage](./tools-and-tool-calling).
These functions take a standardized approach to setting up [prompts](./prompts) and [settings](./settings), making it easier to work with different models.

- [`generateText`](/docs/ai-sdk-core/generating-text): Generates text and [tool calls](./tools-and-tool-calling).
  This function is ideal for non-interactive use cases such as automation tasks where you need to write text (e.g. drafting email or summarizing web pages) and for agents that use tools.
- [`streamText`](/docs/ai-sdk-core/generating-text): Stream text and tool calls.
  You can use the `streamText` function for interactive use cases such as [chat bots](/docs/ai-sdk-ui/chatbot) and [content streaming](/docs/ai-sdk-ui/completion).
- [`generateObject`](/docs/ai-sdk-core/generating-structured-data): Generates a typed, structured object that matches a [Zod](https://zod.dev/) schema.
  You can use this function to force the language model to return structured data, e.g. for information extraction, synthetic data generation, or classification tasks.
- [`streamObject`](/docs/ai-sdk-core/generating-structured-data): Stream a structured object that matches a Zod schema.
  You can use this function to [stream generated UIs](/docs/ai-sdk-ui/object-generation).

## API Reference

Please check out the [AI SDK Core API Reference](/docs/reference/ai-sdk-core) for more details on each function.



# Prompts

Prompts are instructions that you give a [large language model (LLM)](/docs/foundations/overview#large-language-models) to tell it what to do.
It's like when you ask someone for directions; the clearer your question, the better the directions you'll get.

Many LLM providers offer complex interfaces for specifying prompts. They involve different roles and message types.
While these interfaces are powerful, they can be hard to use and understand.

In order to simplify prompting, the AI SDK supports text, message, and system prompts.

## Text Prompts

Text prompts are strings.
They are ideal for simple generation use cases,
e.g. repeatedly generating content for variants of the same prompt text.

You can set text prompts using the `prompt` property made available by AI SDK functions like [`streamText`](/docs/reference/ai-sdk-core/stream-text) or [`generateObject`](/docs/reference/ai-sdk-core/generate-object).
You can structure the text in any way and inject variables, e.g. using a template literal.

```ts highlight="3"
const result = await generateText({
  model: 'openai/gpt-4.1',
  prompt: 'Invent a new holiday and describe its traditions.',
});
```

You can also use template literals to provide dynamic data to your prompt.

```ts highlight="3-5"
const result = await generateText({
  model: 'openai/gpt-4.1',
  prompt:
    `I am planning a trip to ${destination} for ${lengthOfStay} days. ` +
    `Please suggest the best tourist activities for me to do.`,
});
```

## System Prompts

System prompts are the initial set of instructions given to models that help guide and constrain the models' behaviors and responses.
You can set system prompts using the `system` property.
System prompts work with both the `prompt` and the `messages` properties.

```ts highlight="3-6"
const result = await generateText({
  model: 'openai/gpt-4.1',
  system:
    `You help planning travel itineraries. ` +
    `Respond to the users' request with a list ` +
    `of the best stops to make in their destination.`,
  prompt:
    `I am planning a trip to ${destination} for ${lengthOfStay} days. ` +
    `Please suggest the best tourist activities for me to do.`,
});
```

<Note>
  When you use a message prompt, you can also use system messages instead of a
  system prompt.
</Note>

## Message Prompts

A message prompt is an array of user, assistant, and tool messages.
They are great for chat interfaces and more complex, multi-modal prompts.
You can use the `messages` property to set message prompts.

Each message has a `role` and a `content` property. The content can either be text (for user and assistant messages), or an array of relevant parts (data) for that message type.

```ts highlight="3-7"
const result = await generateText({
  model: 'openai/gpt-4.1',
  messages: [
    { role: 'user', content: 'Hi!' },
    { role: 'assistant', content: 'Hello, how can I help?' },
    { role: 'user', content: 'Where can I buy the best Currywurst in Berlin?' },
  ],
});
```

Instead of sending a text in the `content` property, you can send an array of parts that includes a mix of text and other content parts.

<Note type="warning">
  Not all language models support all message and content types. For example,
  some models might not be capable of handling multi-modal inputs or tool
  messages. [Learn more about the capabilities of select
  models](./providers-and-models#model-capabilities).
</Note>

### Provider Options

You can pass through additional provider-specific metadata to enable provider-specific functionality at 3 levels.

#### Function Call Level

Functions like [`streamText`](/docs/reference/ai-sdk-core/stream-text#provider-options) or [`generateText`](/docs/reference/ai-sdk-core/generate-text#provider-options) accept a `providerOptions` property.

Adding provider options at the function call level should be used when you do not need granular control over where the provider options are applied.

```ts
const { text } = await generateText({
  model: azure('your-deployment-name'),
  providerOptions: {
    openai: {
      reasoningEffort: 'low',
    },
  },
});
```

#### Message Level

For granular control over applying provider options at the message level, you can pass `providerOptions` to the message object:

```ts
import { ModelMessage } from 'ai';

const messages: ModelMessage[] = [
  {
    role: 'system',
    content: 'Cached system message',
    providerOptions: {
      // Sets a cache control breakpoint on the system message
      anthropic: { cacheControl: { type: 'ephemeral' } },
    },
  },
];
```

#### Message Part Level

Certain provider-specific options require configuration at the message part level:

```ts
import { ModelMessage } from 'ai';

const messages: ModelMessage[] = [
  {
    role: 'user',
    content: [
      {
        type: 'text',
        text: 'Describe the image in detail.',
        providerOptions: {
          openai: { imageDetail: 'low' },
        },
      },
      {
        type: 'image',
        image:
          'https://github.com/vercel/ai/blob/main/examples/ai-core/data/comic-cat.png?raw=true',
        // Sets image detail configuration for image part:
        providerOptions: {
          openai: { imageDetail: 'low' },
        },
      },
    ],
  },
];
```

<Note type="warning">
  AI SDK UI hooks like [`useChat`](/docs/reference/ai-sdk-ui/use-chat) return
  arrays of `UIMessage` objects, which do not support provider options. We
  recommend using the
  [`convertToModelMessages`](/docs/reference/ai-sdk-ui/convert-to-core-messages)
  function to convert `UIMessage` objects to
  [`ModelMessage`](/docs/reference/ai-sdk-core/model-message) objects before
  applying or appending message(s) or message parts with `providerOptions`.
</Note>

### User Messages

#### Text Parts

Text content is the most common type of content. It is a string that is passed to the model.

If you only need to send text content in a message, the `content` property can be a string,
but you can also use it to send multiple content parts.

```ts highlight="7-10"
const result = await generateText({
  model: 'openai/gpt-4.1',
  messages: [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'Where can I buy the best Currywurst in Berlin?',
        },
      ],
    },
  ],
});
```

#### Image Parts

User messages can include image parts. An image can be one of the following:

- base64-encoded image:
  - `string` with base-64 encoded content
  - data URL `string`, e.g. `data:image/png;base64,...`
- binary image:
  - `ArrayBuffer`
  - `Uint8Array`
  - `Buffer`
- URL:
  - http(s) URL `string`, e.g. `https://example.com/image.png`
  - `URL` object, e.g. `new URL('https://example.com/image.png')`

##### Example: Binary image (Buffer)

```ts highlight="8-11"
const result = await generateText({
  model,
  messages: [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Describe the image in detail.' },
        {
          type: 'image',
          image: fs.readFileSync('./data/comic-cat.png'),
        },
      ],
    },
  ],
});
```

##### Example: Base-64 encoded image (string)

```ts highlight="8-11"
const result = await generateText({
  model: 'openai/gpt-4.1',
  messages: [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Describe the image in detail.' },
        {
          type: 'image',
          image: fs.readFileSync('./data/comic-cat.png').toString('base64'),
        },
      ],
    },
  ],
});
```

##### Example: Image URL (string)

```ts highlight="8-12"
const result = await generateText({
  model: 'openai/gpt-4.1',
  messages: [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Describe the image in detail.' },
        {
          type: 'image',
          image:
            'https://github.com/vercel/ai/blob/main/examples/ai-core/data/comic-cat.png?raw=true',
        },
      ],
    },
  ],
});
```

#### File Parts

<Note type="warning">
  Only a few providers and models currently support file parts: [Google
  Generative AI](/providers/ai-sdk-providers/google-generative-ai), [Google
  Vertex AI](/providers/ai-sdk-providers/google-vertex),
  [OpenAI](/providers/ai-sdk-providers/openai) (for `wav` and `mp3` audio with
  `gpt-4o-audio-preview`), [Anthropic](/providers/ai-sdk-providers/anthropic),
  [OpenAI](/providers/ai-sdk-providers/openai) (for `pdf`).
</Note>

User messages can include file parts. A file can be one of the following:

- base64-encoded file:
  - `string` with base-64 encoded content
  - data URL `string`, e.g. `data:image/png;base64,...`
- binary data:
  - `ArrayBuffer`
  - `Uint8Array`
  - `Buffer`
- URL:
  - http(s) URL `string`, e.g. `https://example.com/some.pdf`
  - `URL` object, e.g. `new URL('https://example.com/some.pdf')`

You need to specify the MIME type of the file you are sending.

##### Example: PDF file from Buffer

```ts highlight="12-15"
import { google } from '@ai-sdk/google';
import { generateText } from 'ai';

const result = await generateText({
  model: google('gemini-1.5-flash'),
  messages: [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'What is the file about?' },
        {
          type: 'file',
          mediaType: 'application/pdf',
          data: fs.readFileSync('./data/example.pdf'),
          filename: 'example.pdf', // optional, not used by all providers
        },
      ],
    },
  ],
});
```

##### Example: mp3 audio file from Buffer

```ts highlight="12-14"
import { openai } from '@ai-sdk/openai';
import { generateText } from 'ai';

const result = await generateText({
  model: openai('gpt-4o-audio-preview'),
  messages: [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'What is the audio saying?' },
        {
          type: 'file',
          mediaType: 'audio/mpeg',
          data: fs.readFileSync('./data/galileo.mp3'),
        },
      ],
    },
  ],
});
```

### Assistant Messages

Assistant messages are messages that have a role of `assistant`.
They are typically previous responses from the assistant
and can contain text, reasoning, and tool call parts.

#### Example: Assistant message with text content

```ts highlight="5"
const result = await generateText({
  model: 'openai/gpt-4.1',
  messages: [
    { role: 'user', content: 'Hi!' },
    { role: 'assistant', content: 'Hello, how can I help?' },
  ],
});
```

#### Example: Assistant message with text content in array

```ts highlight="7"
const result = await generateText({
  model: 'openai/gpt-4.1',
  messages: [
    { role: 'user', content: 'Hi!' },
    {
      role: 'assistant',
      content: [{ type: 'text', text: 'Hello, how can I help?' }],
    },
  ],
});
```

#### Example: Assistant message with tool call content

```ts highlight="7-14"
const result = await generateText({
  model: 'openai/gpt-4.1',
  messages: [
    { role: 'user', content: 'How many calories are in this block of cheese?' },
    {
      role: 'assistant',
      content: [
        {
          type: 'tool-call',
          toolCallId: '12345',
          toolName: 'get-nutrition-data',
          input: { cheese: 'Roquefort' },
        },
      ],
    },
  ],
});
```

#### Example: Assistant message with file content

<Note>
  This content part is for model-generated files. Only a few models support
  this, and only for file types that they can generate.
</Note>

```ts highlight="9-11"
const result = await generateText({
  model: 'openai/gpt-4.1',
  messages: [
    { role: 'user', content: 'Generate an image of a roquefort cheese!' },
    {
      role: 'assistant',
      content: [
        {
          type: 'file',
          mediaType: 'image/png',
          data: fs.readFileSync('./data/roquefort.jpg'),
        },
      ],
    },
  ],
});
```

### Tool messages

<Note>
  [Tools](/docs/foundations/tools) (also known as function calling) are programs
  that you can provide an LLM to extend its built-in functionality. This can be
  anything from calling an external API to calling functions within your UI.
  Learn more about Tools in [the next section](/docs/foundations/tools).
</Note>

For models that support [tool](/docs/foundations/tools) calls, assistant messages can contain tool call parts, and tool messages can contain tool output parts.
A single assistant message can call multiple tools, and a single tool message can contain multiple tool results.

```ts highlight="14-42"
const result = await generateText({
  model: 'openai/gpt-4.1',
  messages: [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'How many calories are in this block of cheese?',
        },
        { type: 'image', image: fs.readFileSync('./data/roquefort.jpg') },
      ],
    },
    {
      role: 'assistant',
      content: [
        {
          type: 'tool-call',
          toolCallId: '12345',
          toolName: 'get-nutrition-data',
          input: { cheese: 'Roquefort' },
        },
        // there could be more tool calls here (parallel calling)
      ],
    },
    {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: '12345', // needs to match the tool call id
          toolName: 'get-nutrition-data',
          output: {
            type: 'json',
            value: {
              name: 'Cheese, roquefort',
              calories: 369,
              fat: 31,
              protein: 22,
            },
          },
        },
        // there could be more tool results here (parallel calling)
      ],
    },
  ],
});
```

#### Multi-modal Tool Results

<Note type="warning">
  Multi-part tool results are experimental and only supported by Anthropic.
</Note>

Tool results can be multi-part and multi-modal, e.g. a text and an image.
You can use the `experimental_content` property on tool parts to specify multi-part tool results.

```ts highlight="20-32"
const result = await generateText({
  model: 'openai/gpt-4.1',
  messages: [
    // ...
    {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: '12345', // needs to match the tool call id
          toolName: 'get-nutrition-data',
          // for models that do not support multi-part tool results,
          // you can include a regular output part:
          output: {
            type: 'json',
            value: {
              name: 'Cheese, roquefort',
              calories: 369,
              fat: 31,
              protein: 22,
            },
          },
        },
        {
          type: 'tool-result',
          toolCallId: '12345', // needs to match the tool call id
          toolName: 'get-nutrition-data',
          // for models that support multi-part tool results,
          // you can include a multi-part content part:
          output: {
            type: 'content',
            value: [
              {
                type: 'text',
                text: 'Here is an image of the nutrition data for the cheese:',
              },
              {
                type: 'media',
                data: fs
                  .readFileSync('./data/roquefort-nutrition-data.png')
                  .toString('base64'),
                mediaType: 'image/png',
              },
            ],
          },
        },
      ],
    },
  ],
});
```

### System Messages

System messages are messages that are sent to the model before the user messages to guide the assistant's behavior.
You can alternatively use the `system` property.

```ts highlight="4"
const result = await generateText({
  model: 'openai/gpt-4.1',
  messages: [
    { role: 'system', content: 'You help planning travel itineraries.' },
    {
      role: 'user',
      content:
        'I am planning a trip to Berlin for 3 days. Please suggest the best tourist activities for me to do.',
    },
  ],
});
```

# Tools

While [large language models (LLMs)](/docs/foundations/overview#large-language-models) have incredible generation capabilities,
they struggle with discrete tasks (e.g. mathematics) and interacting with the outside world (e.g. getting the weather).

Tools are actions that an LLM can invoke.
The results of these actions can be reported back to the LLM to be considered in the next response.

For example, when you ask an LLM for the "weather in London", and there is a weather tool available, it could call a tool
with London as the argument. The tool would then fetch the weather data and return it to the LLM. The LLM can then use this
information in its response.

## What is a tool?

A tool is an object that can be called by the model to perform a specific task.
You can use tools with [`generateText`](/docs/reference/ai-sdk-core/generate-text)
and [`streamText`](/docs/reference/ai-sdk-core/stream-text) by passing one or more tools to the `tools` parameter.

A tool consists of three properties:

- **`description`**: An optional description of the tool that can influence when the tool is picked.
- **`inputSchema`**: A [Zod schema](/docs/foundations/tools#schema-specification-and-validation-with-zod) or a [JSON schema](/docs/reference/ai-sdk-core/json-schema) that defines the input required for the tool to run. The schema is consumed by the LLM, and also used to validate the LLM tool calls.
- **`execute`**: An optional async function that is called with the arguments from the tool call.

<Note>
  `streamUI` uses UI generator tools with a `generate` function that can return
  React components.
</Note>

If the LLM decides to use a tool, it will generate a tool call.
Tools with an `execute` function are run automatically when these calls are generated.
The output of the tool calls are returned using tool result objects.

You can automatically pass tool results back to the LLM
using [multi-step calls](/docs/ai-sdk-core/tools-and-tool-calling#multi-step-calls) with `streamText` and `generateText`.

## Schemas

Schemas are used to define the parameters for tools and to validate the [tool calls](/docs/ai-sdk-core/tools-and-tool-calling).

The AI SDK supports both raw JSON schemas (using the [`jsonSchema` function](/docs/reference/ai-sdk-core/json-schema))
and [Zod](https://zod.dev/) schemas (either directly or using the [`zodSchema` function](/docs/reference/ai-sdk-core/zod-schema)).

[Zod](https://zod.dev/) is a popular TypeScript schema validation library.
You can install it with:

<Tabs items={['pnpm', 'npm', 'yarn', 'bun']}>
  <Tab>
    <Snippet text="pnpm add zod" dark />
  </Tab>
  <Tab>
    <Snippet text="npm install zod" dark />
  </Tab>
  <Tab>
    <Snippet text="yarn add zod" dark />
  </Tab>

  <Tab>
    <Snippet text="bun add zod" dark />
  </Tab>
</Tabs>

You can then specify a Zod schema, for example:

```ts
import z from 'zod';

const recipeSchema = z.object({
  recipe: z.object({
    name: z.string(),
    ingredients: z.array(
      z.object({
        name: z.string(),
        amount: z.string(),
      }),
    ),
    steps: z.array(z.string()),
  }),
});
```

<Note>
  You can also use schemas for structured output generation with
  [`generateObject`](/docs/reference/ai-sdk-core/generate-object) and
  [`streamObject`](/docs/reference/ai-sdk-core/stream-object).
</Note>

## Toolkits

When you work with tools, you typically need a mix of application specific tools and general purpose tools.
There are several providers that offer pre-built tools as **toolkits** that you can use out of the box:

- **[agentic](https://github.com/transitive-bullshit/agentic)** - A collection of 20+ tools. Most tools connect to access external APIs such as [Exa](https://exa.ai/) or [E2B](https://e2b.dev/).
- **[browserbase](https://docs.browserbase.com/integrations/vercel/introduction#vercel-ai-integration)** - Browser tool that runs a headless browser
- **[browserless](https://docs.browserless.io/ai-integrations/vercel-ai-sdk)** - Browser automation service with AI integration - self hosted or cloud based
- **[Smithery](https://smithery.ai/docs/use/connect)** - Smithery provides an open marketplace of 6K+ MCPs, including [Browserbase](https://browserbase.com/) and [Exa](https://exa.ai/).
- **[Stripe agent tools](https://docs.stripe.com/agents)** - Tools for interacting with Stripe.
- **[StackOne ToolSet](https://docs.stackone.com/agents)** - Agentic integrations for hundreds of [enterprise SaaS](https://www.stackone.com/integrations)
- **[Toolhouse](https://docs.toolhouse.ai/toolhouse/using-vercel-ai)** - AI function-calling in 3 lines of code for over 25 different actions.
- **[Agent Tools](https://ai-sdk-agents.vercel.app/?item=introduction)** - A collection of tools for agents.
- **[AI Tool Maker](https://github.com/nihaocami/ai-tool-maker)** - A CLI utility to generate AI SDK tools from OpenAPI specs.
- **[Composio](https://docs.composio.dev/javascript/vercel)** - Composio provides 250+ tools like GitHub, Gmail, Salesforce and [more](https://composio.dev/tools).
- **[Interlify](https://www.interlify.com/docs/integrate-with-vercel-ai)** - Convert APIs into tools so that AI can connect to your backend in minutes.
- **[Freestyle](https://docs.freestyle.sh/integrations/vercel)** - Tool for your AI to execute JavaScript or TypeScript with arbitrary node modules.
- **[JigsawStack](http://www.jigsawstack.com/docs/integration/vercel)** - JigsawStack provides over 30+ small custom fine tuned models available for specific uses.

<Note>
  Do you have open source tools or tool libraries that are compatible with the
  AI SDK? Please [file a pull request](https://github.com/vercel/ai/pulls) to
  add them to this list.
</Note>

## Learn more

The AI SDK Core [Tool Calling](/docs/ai-sdk-core/tools-and-tool-calling)
and [Agents](/docs/foundations/agents) documentation has more information about tools and tool calling.



# Agents

When building AI applications, you often need **systems that can understand context and take meaningful actions**. When building these systems, the key consideration is finding the right balance between flexibility and control. Let's explore different approaches and patterns for building these systems, with a focus on helping you match capabilities to your needs.

## Building Blocks

When building AI systems, you can combine these fundamental components:

### Single-Step LLM Generation

The basic building block - one call to an LLM to get a response. Useful for straightforward tasks like classification or text generation.

### Tool Usage

Enhanced capabilities through tools (like calculators, APIs, or databases) that the LLM can use to accomplish tasks. Tools provide a controlled way to extend what the LLM can do.

When solving complex problems, **an LLM can make multiple tool calls across multiple steps without you explicitly specifying the order** - for example, looking up information in a database, using that to make calculations, and then storing results. The AI SDK makes this [multi-step tool usage](#multi-step-tool-usage) straightforward through the `stopWhen` parameter.

### Multi-Agent Systems

Multiple LLMs working together, each specialized for different aspects of a complex task. This enables sophisticated behaviors while keeping individual components focused.

## Patterns

These building blocks can be combined with workflow patterns that help manage complexity:

- [Sequential Processing](#sequential-processing-chains) - Steps executed in order
- [Parallel Processing](#parallel-processing) - Independent tasks run simultaneously
- [Evaluation/Feedback Loops](#evaluator-optimizer) - Results checked and improved iteratively
- [Orchestration](#orchestrator-worker) - Coordinating multiple components
- [Routing](#routing) - Directing work based on context

## Choosing Your Approach

The key factors to consider:

- **Flexibility vs Control** - How much freedom does the LLM need vs how tightly must you constrain its actions?
- **Error Tolerance** - What are the consequences of mistakes in your use case?
- **Cost Considerations** - More complex systems typically mean more LLM calls and higher costs
- **Maintenance** - Simpler architectures are easier to debug and modify

**Start with the simplest approach that meets your needs**. Add complexity only when required by:

1. Breaking down tasks into clear steps
2. Adding tools for specific capabilities
3. Implementing feedback loops for quality control
4. Introducing multiple agents for complex workflows

Let's look at examples of these patterns in action.

## Patterns with Examples

The following patterns, adapted from [Anthropic's guide on building effective agents](https://www.anthropic.com/research/building-effective-agents), serve as building blocks that can be combined to create comprehensive workflows. Each pattern addresses specific aspects of task execution, and by combining them thoughtfully, you can build reliable solutions for complex problems.

### Sequential Processing (Chains)

The simplest workflow pattern executes steps in a predefined order. Each step's output becomes input for the next step, creating a clear chain of operations. This pattern is ideal for tasks with well-defined sequences, like content generation pipelines or data transformation processes.

```ts
import { openai } from '@ai-sdk/openai';
import { generateText, generateObject } from 'ai';
import { z } from 'zod';

async function generateMarketingCopy(input: string) {
  const model = openai('gpt-4o');

  // First step: Generate marketing copy
  const { text: copy } = await generateText({
    model,
    prompt: `Write persuasive marketing copy for: ${input}. Focus on benefits and emotional appeal.`,
  });

  // Perform quality check on copy
  const { object: qualityMetrics } = await generateObject({
    model,
    schema: z.object({
      hasCallToAction: z.boolean(),
      emotionalAppeal: z.number().min(1).max(10),
      clarity: z.number().min(1).max(10),
    }),
    prompt: `Evaluate this marketing copy for:
    1. Presence of call to action (true/false)
    2. Emotional appeal (1-10)
    3. Clarity (1-10)

    Copy to evaluate: ${copy}`,
  });

  // If quality check fails, regenerate with more specific instructions
  if (
    !qualityMetrics.hasCallToAction ||
    qualityMetrics.emotionalAppeal < 7 ||
    qualityMetrics.clarity < 7
  ) {
    const { text: improvedCopy } = await generateText({
      model,
      prompt: `Rewrite this marketing copy with:
      ${!qualityMetrics.hasCallToAction ? '- A clear call to action' : ''}
      ${qualityMetrics.emotionalAppeal < 7 ? '- Stronger emotional appeal' : ''}
      ${qualityMetrics.clarity < 7 ? '- Improved clarity and directness' : ''}

      Original copy: ${copy}`,
    });
    return { copy: improvedCopy, qualityMetrics };
  }

  return { copy, qualityMetrics };
}
```

### Routing

This pattern allows the model to make decisions about which path to take through a workflow based on context and intermediate results. The model acts as an intelligent router, directing the flow of execution between different branches of your workflow. This is particularly useful when handling varied inputs that require different processing approaches. In the example below, the results of the first LLM call change the properties of the second LLM call like model size and system prompt.

```ts
import { openai } from '@ai-sdk/openai';
import { generateObject, generateText } from 'ai';
import { z } from 'zod';

async function handleCustomerQuery(query: string) {
  const model = openai('gpt-4o');

  // First step: Classify the query type
  const { object: classification } = await generateObject({
    model,
    schema: z.object({
      reasoning: z.string(),
      type: z.enum(['general', 'refund', 'technical']),
      complexity: z.enum(['simple', 'complex']),
    }),
    prompt: `Classify this customer query:
    ${query}

    Determine:
    1. Query type (general, refund, or technical)
    2. Complexity (simple or complex)
    3. Brief reasoning for classification`,
  });

  // Route based on classification
  // Set model and system prompt based on query type and complexity
  const { text: response } = await generateText({
    model:
      classification.complexity === 'simple'
        ? openai('gpt-4o-mini')
        : openai('o3-mini'),
    system: {
      general:
        'You are an expert customer service agent handling general inquiries.',
      refund:
        'You are a customer service agent specializing in refund requests. Follow company policy and collect necessary information.',
      technical:
        'You are a technical support specialist with deep product knowledge. Focus on clear step-by-step troubleshooting.',
    }[classification.type],
    prompt: query,
  });

  return { response, classification };
}
```

### Parallel Processing

Some tasks can be broken down into independent subtasks that can be executed simultaneously. This pattern takes advantage of parallel execution to improve efficiency while maintaining the benefits of structured workflows. For example, analyzing multiple documents or processing different aspects of a single input concurrently (like code review).

```ts
import { openai } from '@ai-sdk/openai';
import { generateText, generateObject } from 'ai';
import { z } from 'zod';

// Example: Parallel code review with multiple specialized reviewers
async function parallelCodeReview(code: string) {
  const model = openai('gpt-4o');

  // Run parallel reviews
  const [securityReview, performanceReview, maintainabilityReview] =
    await Promise.all([
      generateObject({
        model,
        system:
          'You are an expert in code security. Focus on identifying security vulnerabilities, injection risks, and authentication issues.',
        schema: z.object({
          vulnerabilities: z.array(z.string()),
          riskLevel: z.enum(['low', 'medium', 'high']),
          suggestions: z.array(z.string()),
        }),
        prompt: `Review this code:
      ${code}`,
      }),

      generateObject({
        model,
        system:
          'You are an expert in code performance. Focus on identifying performance bottlenecks, memory leaks, and optimization opportunities.',
        schema: z.object({
          issues: z.array(z.string()),
          impact: z.enum(['low', 'medium', 'high']),
          optimizations: z.array(z.string()),
        }),
        prompt: `Review this code:
      ${code}`,
      }),

      generateObject({
        model,
        system:
          'You are an expert in code quality. Focus on code structure, readability, and adherence to best practices.',
        schema: z.object({
          concerns: z.array(z.string()),
          qualityScore: z.number().min(1).max(10),
          recommendations: z.array(z.string()),
        }),
        prompt: `Review this code:
      ${code}`,
      }),
    ]);

  const reviews = [
    { ...securityReview.object, type: 'security' },
    { ...performanceReview.object, type: 'performance' },
    { ...maintainabilityReview.object, type: 'maintainability' },
  ];

  // Aggregate results using another model instance
  const { text: summary } = await generateText({
    model,
    system: 'You are a technical lead summarizing multiple code reviews.',
    prompt: `Synthesize these code review results into a concise summary with key actions:
    ${JSON.stringify(reviews, null, 2)}`,
  });

  return { reviews, summary };
}
```

### Orchestrator-Worker

In this pattern, a primary model (orchestrator) coordinates the execution of specialized workers. Each worker is optimized for a specific subtask, while the orchestrator maintains overall context and ensures coherent results. This pattern excels at complex tasks requiring different types of expertise or processing.

```ts
import { openai } from '@ai-sdk/openai';
import { generateObject } from 'ai';
import { z } from 'zod';

async function implementFeature(featureRequest: string) {
  // Orchestrator: Plan the implementation
  const { object: implementationPlan } = await generateObject({
    model: openai('o3-mini'),
    schema: z.object({
      files: z.array(
        z.object({
          purpose: z.string(),
          filePath: z.string(),
          changeType: z.enum(['create', 'modify', 'delete']),
        }),
      ),
      estimatedComplexity: z.enum(['low', 'medium', 'high']),
    }),
    system:
      'You are a senior software architect planning feature implementations.',
    prompt: `Analyze this feature request and create an implementation plan:
    ${featureRequest}`,
  });

  // Workers: Execute the planned changes
  const fileChanges = await Promise.all(
    implementationPlan.files.map(async file => {
      // Each worker is specialized for the type of change
      const workerSystemPrompt = {
        create:
          'You are an expert at implementing new files following best practices and project patterns.',
        modify:
          'You are an expert at modifying existing code while maintaining consistency and avoiding regressions.',
        delete:
          'You are an expert at safely removing code while ensuring no breaking changes.',
      }[file.changeType];

      const { object: change } = await generateObject({
        model: openai('gpt-4o'),
        schema: z.object({
          explanation: z.string(),
          code: z.string(),
        }),
        system: workerSystemPrompt,
        prompt: `Implement the changes for ${file.filePath} to support:
        ${file.purpose}

        Consider the overall feature context:
        ${featureRequest}`,
      });

      return {
        file,
        implementation: change,
      };
    }),
  );

  return {
    plan: implementationPlan,
    changes: fileChanges,
  };
}
```

### Evaluator-Optimizer

This pattern introduces quality control into workflows by having dedicated evaluation steps that assess intermediate results. Based on the evaluation, the workflow can either proceed, retry with adjusted parameters, or take corrective action. This creates more robust workflows capable of self-improvement and error recovery.

```ts
import { openai } from '@ai-sdk/openai';
import { generateText, generateObject } from 'ai';
import { z } from 'zod';

async function translateWithFeedback(text: string, targetLanguage: string) {
  let currentTranslation = '';
  let iterations = 0;
  const MAX_ITERATIONS = 3;

  // Initial translation
  const { text: translation } = await generateText({
    model: openai('gpt-4o-mini'), // use small model for first attempt
    system: 'You are an expert literary translator.',
    prompt: `Translate this text to ${targetLanguage}, preserving tone and cultural nuances:
    ${text}`,
  });

  currentTranslation = translation;

  // Evaluation-optimization loop
  while (iterations < MAX_ITERATIONS) {
    // Evaluate current translation
    const { object: evaluation } = await generateObject({
      model: openai('gpt-4o'), // use a larger model to evaluate
      schema: z.object({
        qualityScore: z.number().min(1).max(10),
        preservesTone: z.boolean(),
        preservesNuance: z.boolean(),
        culturallyAccurate: z.boolean(),
        specificIssues: z.array(z.string()),
        improvementSuggestions: z.array(z.string()),
      }),
      system: 'You are an expert in evaluating literary translations.',
      prompt: `Evaluate this translation:

      Original: ${text}
      Translation: ${currentTranslation}

      Consider:
      1. Overall quality
      2. Preservation of tone
      3. Preservation of nuance
      4. Cultural accuracy`,
    });

    // Check if quality meets threshold
    if (
      evaluation.qualityScore >= 8 &&
      evaluation.preservesTone &&
      evaluation.preservesNuance &&
      evaluation.culturallyAccurate
    ) {
      break;
    }

    // Generate improved translation based on feedback
    const { text: improvedTranslation } = await generateText({
      model: openai('gpt-4o'), // use a larger model
      system: 'You are an expert literary translator.',
      prompt: `Improve this translation based on the following feedback:
      ${evaluation.specificIssues.join('\n')}
      ${evaluation.improvementSuggestions.join('\n')}

      Original: ${text}
      Current Translation: ${currentTranslation}`,
    });

    currentTranslation = improvedTranslation;
    iterations++;
  }

  return {
    finalTranslation: currentTranslation,
    iterationsRequired: iterations,
  };
}
```

## Multi-Step Tool Usage

If your use case involves solving problems where the solution path is poorly defined or too complex to map out as a workflow in advance, you may want to provide the LLM with a set of lower-level tools and allow it to break down the task into small pieces that it can solve on its own iteratively, without discrete instructions. To implement this kind of agentic pattern, you need to call an LLM in a loop until a task is complete. The AI SDK makes this simple with the `stopWhen` parameter.

The AI SDK gives you control over the stopping conditions, enabling you to keep the LLM running until one of the conditions are met. The SDK automatically triggers an additional request to the model after every tool result (each request is considered a "step"), continuing until the model does not generate a tool call or other stopping conditions (e.g. `stepCountIs`) you define are satisfied.

<Note>`stopWhen` can be used with both `generateText` and `streamText`</Note>

### Using `stopWhen`

This example demonstrates how to create an agent that solves math problems.
It has a calculator tool (using [math.js](https://mathjs.org/)) that it can call to evaluate mathematical expressions.

```ts file='main.ts'
import { openai } from '@ai-sdk/openai';
import { generateText, tool, stepCountIs } from 'ai';
import * as mathjs from 'mathjs';
import { z } from 'zod';

const { text: answer } = await generateText({
  model: openai('gpt-4o-2024-08-06'),
  tools: {
    calculate: tool({
      description:
        'A tool for evaluating mathematical expressions. ' +
        'Example expressions: ' +
        "'1.2 * (2 + 4.5)', '12.7 cm to inch', 'sin(45 deg) ^ 2'.",
      inputSchema: z.object({ expression: z.string() }),
      execute: async ({ expression }) => mathjs.evaluate(expression),
    }),
  },
  stopWhen: stepCountIs(10),
  system:
    'You are solving math problems. ' +
    'Reason step by step. ' +
    'Use the calculator when necessary. ' +
    'When you give the final answer, ' +
    'provide an explanation for how you arrived at it.',
  prompt:
    'A taxi driver earns $9461 per 1-hour of work. ' +
    'If he works 12 hours a day and in 1 hour ' +
    'he uses 12 liters of petrol with a price  of $134 for 1 liter. ' +
    'How much money does he earn in one day?',
});

console.log(`ANSWER: ${answer}`);
```

### Structured Answers

When building an agent for tasks like mathematical analysis or report generation, it's often useful to have the agent's final output structured in a consistent format that your application can process. You can use an **answer tool** and the `toolChoice: 'required'` setting to force the LLM to answer with a structured output that matches the schema of the answer tool. The answer tool has no `execute` function, so invoking it will terminate the agent.

```ts highlight="6,16-29,31,45"
import { openai } from '@ai-sdk/openai';
import { generateText, tool, stepCountIs } from 'ai';
import 'dotenv/config';
import { z } from 'zod';

const { toolCalls } = await generateText({
  model: openai('gpt-4o-2024-08-06'),
  tools: {
    calculate: tool({
      description:
        'A tool for evaluating mathematical expressions. Example expressions: ' +
        "'1.2 * (2 + 4.5)', '12.7 cm to inch', 'sin(45 deg) ^ 2'.",
      inputSchema: z.object({ expression: z.string() }),
      execute: async ({ expression }) => mathjs.evaluate(expression),
    }),
    // answer tool: the LLM will provide a structured answer
    answer: tool({
      description: 'A tool for providing the final answer.',
      inputSchema: z.object({
        steps: z.array(
          z.object({
            calculation: z.string(),
            reasoning: z.string(),
          }),
        ),
        answer: z.string(),
      }),
      // no execute function - invoking it will terminate the agent
    }),
  },
  toolChoice: 'required',
  stopWhen: stepCountIs(10),
  system:
    'You are solving math problems. ' +
    'Reason step by step. ' +
    'Use the calculator when necessary. ' +
    'The calculator can only do simple additions, subtractions, multiplications, and divisions. ' +
    'When you give the final answer, provide an explanation for how you got it.',
  prompt:
    'A taxi driver earns $9461 per 1-hour work. ' +
    'If he works 12 hours a day and in 1 hour he uses 14-liters petrol with price $134 for 1-liter. ' +
    'How much money does he earn in one day?',
});

console.log(`FINAL TOOL CALLS: ${JSON.stringify(toolCalls, null, 2)}`);
```

<Note>
  You can also use the
  [`experimental_output`](/docs/ai-sdk-core/generating-structured-data#structured-output-with-generatetext)
  setting for `generateText` to generate structured outputs.
</Note>

### Accessing all steps

Calling `generateText` with `stopWhen` can result in several calls to the LLM (steps).
You can access information from all steps by using the `steps` property of the response.

```ts highlight="3,9-10"
import { generateText, stepCountIs } from 'ai';

const { steps } = await generateText({
  model: openai('gpt-4o'),
  stopWhen: stepCountIs(10),
  // ...
});

// extract all tool calls from the steps:
const allToolCalls = steps.flatMap(step => step.toolCalls);
```

### Getting notified on each completed step

You can use the `onStepFinish` callback to get notified on each completed step.
It is triggered when a step is finished,
i.e. all text deltas, tool calls, and tool results for the step are available.

```tsx highlight="6-8"
import { generateText, stepCountIs } from 'ai';

const result = await generateText({
  model: 'openai/gpt-4.1',
  stopWhen: stepCountIs(10),
  onStepFinish({ text, toolCalls, toolResults, finishReason, usage }) {
    // your own logic, e.g. for saving the chat history or recording usage
  },
  // ...
});
```
