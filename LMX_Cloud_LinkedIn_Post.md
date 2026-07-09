Over the past few weeks I've been building LMX Cloud, and wanted to share what it is and what's gone into it so far.

LMX Cloud is an OpenAI-compatible API that routes AI inference requests across decentralized compute networks (io.net, Akash), with automatic failover if one provider is degraded or down. It's a drop-in replacement for a standard inference API — same request format developers already use, backed by infrastructure that isn't tied to a single provider.

What's built so far: multi-provider routing with health-aware fallback, real-time streaming completions, and support for 30+ models. A full developer dashboard covers API key management, usage tracking, and billing. The latest addition is wallet-based sign-in and on-chain USDC funding on Base, alongside standard email sign-in — so an account can be created and funded directly from a crypto wallet.

The direction going forward is infrastructure for autonomous AI agents — software that pays for its own compute without a human in the loop. That requires payment and identity that work for a wallet rather than a corporate account, which is what the current build is oriented around.
