FROM mcr.microsoft.com/devcontainers/base:trixie

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential postgresql-client-17 \
    && rm -rf /var/lib/apt/lists/*
