# A Linux environment for running the desktop e2e suite from a non-Linux machine (see
# desktop/README.md → "End-to-end tests"). CI does not use this image; it installs the same
# packages directly on the runner. Ubuntu 22.04 matches the runner image.
FROM ubuntu:22.04

ARG NODE_MAJOR=22
ARG GO_VERSION=1.26.4

ENV DEBIAN_FRONTEND=noninteractive \
    PATH=/usr/local/go/bin:/root/.cargo/bin:$PATH

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl git xz-utils build-essential pkg-config xauth xvfb \
      libwebkit2gtk-4.1-dev libxdo-dev libssl-dev libayatana-appindicator3-dev \
      librsvg2-dev libdbus-1-dev webkit2gtk-driver x11-utils \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL "https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz" | tar -C /usr/local -xz

RUN curl -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal \
    && cargo install tauri-driver --locked

WORKDIR /repo
