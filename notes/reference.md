# Make an API request

> Generate your first words and learn API conventions

## Prerequisites

1. A [Cartesia account](https://play.cartesia.ai).
2. An [API key](https://play.cartesia.ai/keys).


```sh lines theme={null}


## Generate your first words

<Tabs>
  <Tab title="cURL">
    To generate your first words, run this command in your terminal, replacing `YOUR_API_KEY`:

    ```bash lines theme={null}
    export CARTESIA_API_KEY=XXX
    curl -N -X POST "https://api.cartesia.ai/tts/bytes" \
            -H "Cartesia-Version: 2025-04-16" \
            -H "X-API-Key: $CARTESIA_API_KEY" \
            -H "Content-Type: application/json" \
            -d '{"transcript": "Welcome to Cartesia Sonic!", "model_id": "sonic-3", "voice": {"mode":"id", "id": "694f9389-aac1-45b6-b726-9d9369183238"}, "output_format":{"container":"wav", "encoding":"pcm_s16le", "sample_rate":44100}}' > sonic-3.wav
    ```

    You can play the resulting `sonic-3.wav` file with `afplay sonic-3.wav` (on macOS) or `ffplay sonic-3.wav` (on any system with FFmpeg installed). You can also just double click it in your file explorer.

    This command calls the [Text to Speech (Bytes)](/api-reference/tts/bytes) endpoint which runs the text-to-speech generation and transmits the output in raw bytes.

    <Info>
      The bytes endpoint supports a variety of output formats, making it perfect for batch use cases where you want to save the audio in advance.

      In comparison, Cartesia's WebSocket and Server-Sent Events endpoints stream out raw PCM audio to avoid latency overhead from transcoding the audio.
    </Info>
  </Tab>

  <Tab title="Python">
    <Steps>
      <Step title="Install the SDK">
        ```sh lines theme={null}
        pip install cartesia

        # Or, if you're using uv
        uv add cartesia
        ```
      </Step>

      <Step title="Make the API call">
        ```python lines theme={null}
        import asyncio
        from cartesia import AsyncCartesia
        import os
        import subprocess

        client = AsyncCartesia(
            api_key=os.environ["CARTESIA_API_KEY"],
        )


        async def main():
            with open("sonic-3.wav", "wb") as f:
                bytes_iter = client.tts.bytes(
                    model_id="sonic-3",
                    transcript="Welcome to Cartesia Sonic!",
                    voice={
                        "mode": "id",
                        "id": "6ccbfb76-1fc6-48f7-b71d-91ac6298247b",
                    },
                    language="en",
                    output_format={
                        "container": "wav",
                        "sample_rate": 44100,
                        "encoding": "pcm_s16le",
                    },
                )

                async for chunk in bytes_iter:
                    f.write(chunk)


        if __name__ == "__main__":
            asyncio.run(main())

        # Play the file
        subprocess.run(["ffplay", "-autoexit", "-nodisp", "sonic-3.wav"])
        ```
      </Step>

      <Step title="Run the script">
        ```sh lines theme={null}
        env CARTESIA_API_KEY=YOUR_API_KEY python cartesia.py

        # Or, if you're using uv
        env CARTESIA_API_KEY=YOUR_API_KEY uv run cartesia.py
        ```
      </Step>
    </Steps>
  </Tab>

  <Tab title="JavaScript/TypeScript">
    <Steps>
      <Step title="Install the SDK">
        ```sh lines theme={null}
        # NPM
        npm install @cartesia/cartesia-js
        add @cartesia/cartesia-js
        ```
      </Step>

      <Step title="Make the API call">
        ```js lines theme={null}
        import { CartesiaClient } from "@cartesia/cartesia-js";
        import fs from "node:fs";
        import { spawn } from "node:child_process";
        import process from "node:process";

        if (!process.env.CARTESIA_API_KEY) {
          throw new Error("CARTESIA_API_KEY is not set");
        }

        // Set up the client.
        const client = new CartesiaClient({
          apiKey: process.env.CARTESIA_API_KEY,
        });

        // Make the API call.
        const response = await client.tts.bytes({
          modelId: "sonic-3",
          // You can find more voices at https://play.cartesia.ai/voices
          voice: {
            mode: "id",
            id: "694f9389-aac1-45b6-b726-9d9369183238",
          },
          // You can find the supported `output_format`s at https://docs.cartesia.ai/api-reference/tts/bytes
          outputFormat: {
            container: "wav",
            encoding: "pcm_s16le",
            sampleRate: 44100,
          },
          transcript: "Welcome to Cartesia Sonic!",
        });

        // Write `response` to a file. (We convert the response to a Uint8Array first.)
        fs.writeFileSync("sonic-3.wav", await new Response(response).bytes());

        // Play the file.
        spawn("ffplay", ["-autoexit", "-nodisp", "sonic-3.wav"]);
        ```
      </Step>

      <Step title="Run the script">
        ```sh lines theme={null}
        env CARTESIA_API_KEY=YOUR_API_KEY node hello.js
        ```

        The Cartesia API client also supports other runtimes, like Bun and Deno.
      </Step>
    </Steps>
  </Tab>
</Tabs>

The voice used above can be found [on the playground](https://play.cartesia.ai/voices/a0e99841-438c-4a64-b679-ae501e7d6091).


---

> To find navigation and other pages in this documentation, fetch the llms.txt file at: https://docs.cartesia.ai/llms.txt


# Authenticate your client applications

> Secure client access to Cartesia APIs using Access Tokens

You may want to make Cartesia API requests directly from your client application, eg, a web app. However, shipping your API key to the app is not secure, as a malicious user could extract your API key and issue API requests billed to your account.

Access Tokens provide a secure way to authenticate client-side requests to Cartesia's APIs without
exposing your API key.

<Note>
  Access Tokens are used in contexts like web apps which should not be bundled with an API key. For
  trusted contexts like server applications, local scripts, or iPython notebooks, you should simply
  use API keys.
</Note>

## Prerequisites

Before implementing Access Tokens:

1. Configure your server with a Cartesia API key
2. Implement user authentication in your application
3. Establish secure client-server communication

### Available Grants

Access Tokens support granular permissions through grants. Both TTS and STT grants are optional:

**TTS Grant**: With `grants: { tts: true }`, clients have access to:

* `/tts/bytes` - Synchronous TTS generation streamed with chunked encoding
* `/tts/sse` - Server-sent events for streaming
* `/tts/websocket` - WebSocket-based streaming

**STT Grant**: With `grants: { stt: true }`, clients have access to:

* `/stt/websocket` - WebSocket-based speech-to-text streaming
* `/stt` - Batch speech-to-text processing
* `/audio/transcriptions` - API-compatible transcription endpoint

**Agents Grant**: With `grants: { agent: true }`, clients have access to:

* the Agents websocket calling endpoint

You can request multiple grants in a single token:

```json  theme={null}
grants: { tts: true, stt: true, agent: false }
```

## Implementation Guide

### 1. Token Generation (Server-side)

Make a request to generate a new access token:

<CodeGroup>
  ```bash cURL lines theme={null}
  # TTS and STT access
  curl --location 'https://api.cartesia.ai/access-token' \
    -H 'Cartesia-Version: 2025-04-16' \
    -H 'Content-Type: application/json' \
    -H 'Authorization: Bearer sk_car_...' \
    -d '{ "grants": {"tts": true, "stt": true}, "expires_in": 60}'

  # TTS-only access
  curl --location 'https://api.cartesia.ai/access-token' \
    -H 'Cartesia-Version: 2025-04-16' \
    -H 'Content-Type: application/json' \
    -H 'Authorization: Bearer sk_car_...' \
    -d '{ "grants": {"tts": true}, "expires_in": 60}'
  ```

  ```javascript JavaScript lines theme={null}
  import { CartesiaClient } from "@cartesia/cartesia-js";

  const client = new CartesiaClient({ apiKey: "YOUR_API_KEY" });

  // TTS and STT access
  await client.auth.accessToken({
    grants: {
      tts: true,
      stt: true
    },
    expires_in: 60
  });

  // TTS-only access
  await client.auth.accessToken({
    grants: {
      tts: true,
      stt: true
    },
    expires_in: 60
  });
  ```
</CodeGroup>

