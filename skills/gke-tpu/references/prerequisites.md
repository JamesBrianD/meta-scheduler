# Prerequisites

## PATH setup (needed in every shell/command)

```bash
export PATH="/Users/$(whoami)/.local/bin:/opt/homebrew/bin:/opt/homebrew/share/google-cloud-sdk/bin:/usr/bin:$PATH"
```

## Install

```bash
# Google Cloud SDK
brew install --cask google-cloud-sdk

# kubectl + auth plugin
gcloud components install kubectl gke-gcloud-auth-plugin beta --quiet

# xpk (must use Python 3.13, NOT 3.14 — argparse incompatibility)
brew install pipx
pipx install xpk --python python3.13

# Auth — use project from gke.toml
gcloud auth login
gcloud config set project <gke.project>
gcloud auth application-default login
```
