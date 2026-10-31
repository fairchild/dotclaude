FROM ubuntu:24.04
ARG RUNNER_VERSION
ARG RUNNER_SHA256
ARG NODE_VERSION
ARG NODE_SHA256
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      bash ca-certificates curl git jq unzip zstd xz-utils tar \
      iproute2 kmod procps util-linux e2fsprogs openssh-client \
      python3 python3-venv build-essential tini \
    && rm -rf /var/lib/apt/lists/*
# ubuntu-latest ships node and npm; actions and repo scripts assume both.
RUN curl -fsSL -o node.tar.xz "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-arm64.tar.xz" \
    && echo "${NODE_SHA256}  node.tar.xz" | sha256sum -c - \
    && tar -xJf node.tar.xz -C /usr/local --strip-components=1 \
         --exclude CHANGELOG.md --exclude LICENSE --exclude README.md \
    && rm node.tar.xz \
    && node --version && npm --version
# The opt-in workflow installs browsers without --with-deps off hosted runners, so the
# image carries Chromium's system libraries rather than reaching for apt mid-job.
RUN apt-get update \
    && npx --yes playwright@1.59.1 install-deps chromium \
    && rm -rf /var/lib/apt/lists/* /root/.npm
# The job's user has no route to root: no sudo package and no sudoers entry. Everything that
# needs root happens in run-job.mjs before runuser hands over. kmod stays because gondolin's
# init calls modprobe; without root, a job cannot load modules anyway.
RUN useradd -m -s /bin/bash runner
# `playwright install chromium` downloads about 400 MiB and spends minutes unpacking it, and a
# discarded VM repeats that every run: 638 s of one 30-minute suite. Baking the
# revisions the suites pin into the job user's cache turns that step into a version check. A
# pin that falls behind the repo costs only the old download, since Playwright fetches any
# revision it lacks.
ARG PLAYWRIGHT_VERSIONS
USER runner
RUN for v in ${PLAYWRIGHT_VERSIONS}; do npx --yes "playwright@${v}" install chromium || exit 1; done \
    && rm -rf /home/runner/.npm \
    && ls /home/runner/.cache/ms-playwright
USER root
WORKDIR /home/runner/actions-runner
RUN curl -fsSL -o runner.tgz "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-arm64-${RUNNER_VERSION}.tar.gz" \
    && echo "${RUNNER_SHA256}  runner.tgz" | sha256sum -c - \
    && tar xzf runner.tgz && rm runner.tgz \
    && ./bin/installdependencies.sh \
    && chown -R runner:runner /home/runner
# setup-bun reuses ~/.bun/bin/bun, and nothing on PATH or in the tool cache, when a job asks for
# exactly the version already there; otherwise it fetches about 35 MB: 5 s of lint's 7 s step on
# 2026-09-30. A job that names no version is always sent the newest release, so this serves only
# the jobs that pin BUN_VERSION. A pin that falls behind the workflow costs only the old fetch.
ARG BUN_VERSION
ARG BUN_SHA256
RUN curl -fsSL -o /tmp/bun.zip "https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/bun-linux-aarch64.zip" \
    && echo "${BUN_SHA256}  /tmp/bun.zip" | sha256sum -c - \
    && unzip -q /tmp/bun.zip -d /tmp \
    && install -D -m 755 /tmp/bun-linux-aarch64/bun /home/runner/.bun/bin/bun \
    && chown -R runner:runner /home/runner/.bun \
    && rm -r /tmp/bun.zip /tmp/bun-linux-aarch64 \
    && runuser -u runner -- /home/runner/.bun/bin/bun --revision
