# Auto Video Workflow (Claude Agent SDK)

## Quickstart

1. Install dependencies:

```bash
npm install
```

2. Set environment variables:

```bash
export ANTHROPIC_API_KEY="your-key"
```

3. Run once:

```bash
npm run dev -- --config config.yaml
```

## Agent Smoke Test

```bash
export ANTHROPIC_API_KEY="your-key"
npm run smoke -- --prompt "用一句话解释什么是幂等"
```
