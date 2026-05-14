# ClawHub Testing

This repo is an OpenClaw workspace-style project. The publishable ClawHub skill is:

```text
skills/party/
```

Do not publish the repository root. The root contains development files such as `package.json`, `scripts/`, and `node_modules/`.

## Local Check

```bash
npm install
npm run clawhub:login
npm run clawhub:sync:dry-run
```

The dry run scans `./skills` only, so it should find `skills/party`. The ClawHub CLI requires login even for sync dry runs.

## Publish

```bash
npm run clawhub:login
npm run clawhub:publish
```

After publishing, install it into an OpenClaw workspace with:

```bash
openclaw skills install party
openclaw skills list --eligible
```

Then test:

```bash
openclaw agent --message "/skill party_prompt Discuss the launch plan"
```
