FROM eclipse-temurin:21-jdk

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
     git curl unzip ca-certificates docker.io \
  && rm -rf /var/lib/apt/lists/*

RUN useradd -ms /bin/bash dev
USER dev
WORKDIR /workspace