FROM rust:1-bookworm AS build
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl libssl3 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /src/target/release/prostgres_db /usr/local/bin/prostgres_db
RUN useradd --system --uid 65532 --no-create-home dataapi
ENV LISTEN_ADDR=0.0.0.0:8080
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=8 \
    CMD curl -fsS http://127.0.0.1:8080/health || exit 1
USER dataapi
CMD ["prostgres_db"]
