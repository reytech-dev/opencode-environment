FROM eclipse-temurin:25-jdk

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
     git curl unzip ca-certificates docker.io \
  && rm -rf /var/lib/apt/lists/*

USER ubuntu

RUN mkdir -p /home/ubuntu/.m2 /home/ubuntu/.gradle
WORKDIR /workspace